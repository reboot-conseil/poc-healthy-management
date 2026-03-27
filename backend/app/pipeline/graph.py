"""LangGraph pipeline — full StateGraph for transcription + LLM analysis.

Pipeline flow (linear — no loop):
    transcribe_node → analyze_all_node → report_node → END

Design constraints (AGENTS.md):
    - Each node is a pure function — no direct DB calls, testable in isolation.
    - State is immutable — every node returns a NEW dict via {**state, key: value}.
    - All DB persistence is handled by run_pipeline() in sessions.py after
      pipeline_graph.invoke() returns.
    - The LLM is synchronous — callers must wrap graph.invoke() in
      asyncio.to_thread() to avoid blocking the event loop.

Performance:
    analyze_all_node groups utterances into batches of ANALYSIS_BATCH_SIZE (default 10).
    Each batch is sent to the LLM in a single call, reducing total API round-trips
    from N (one per utterance) to ceil(N / ANALYSIS_BATCH_SIZE).
    For 438 utterances: 438 calls → 44 calls (~10x speedup).
"""

import logging
from typing import TypedDict

from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from app.config import settings
from app.pipeline.prompts import (
    FINAL_REPORT_PROMPT,
    UTTERANCE_BATCH_ANALYSIS_PROMPT,
)
from app.pipeline.transcription import TranscriptionError, transcribe_audio

logger = logging.getLogger(__name__)

# ── Pydantic output schemas ───────────────────────────────────────────────────


class UtteranceAnalysis(BaseModel):
    """Structured output for a single utterance within a batch response."""

    intention: str = Field(description="Main intention of the speaker in one short sentence")
    sentiment: str = Field(description="One of: positif, négatif, neutre, mitigé")
    key_points: list[str] = Field(
        default_factory=list,
        description="Concrete substance: specific facts, topics, ideas, decisions or blockers mentioned; empty if none",
    )
    issues: list[str] = Field(
        default_factory=list,
        description="List of communication issues detected; empty if none",
    )


class UtteranceBatchAnalysis(BaseModel):
    """Structured output expected from the LLM for a batch of utterances.

    The LLM returns a JSON array; we wrap it in this model so
    with_structured_output() can validate and parse it reliably.
    """

    analyses: list[UtteranceAnalysis] = Field(
        description="One UtteranceAnalysis per utterance, in the same order as the input batch"
    )


class FinalReportContent(BaseModel):
    """Structured output expected from the LLM for the final report.

    Two synthesis fields capture distinct dimensions of the session:
    - synthesis_human   : relational/emotional quality of exchanges
    - synthesis_content : concrete substance — topics, decisions, ideas, next steps
    """

    synthesis_human: str = Field(
        description="Human/relational dimension: communication dynamics, emotional climate, group interaction quality"
    )
    synthesis_content: str = Field(
        description="Content dimension: topics discussed, decisions made, key ideas, blockers, next steps"
    )
    key_topics: list[str] = Field(
        description="Ordered list of 5-10 key concrete topics or decisions raised in the session"
    )
    improvement_axes: list[str] = Field(
        description="Ordered list of concrete, actionable improvement recommendations specific to this session"
    )


# ── Lazy LLM singletons ───────────────────────────────────────────────────────
# Not instantiated at module load time — would crash uvicorn if env vars are
# absent. Built on first call inside a background task and cached thereafter.

_llm_instance: ChatGoogleGenerativeAI | None = None
_batch_llm_instance: object | None = None
_report_llm_instance: object | None = None


def _get_llm() -> ChatGoogleGenerativeAI:
    """Return the base LLM, building it on first call."""
    global _llm_instance
    if _llm_instance is None:
        use_vertex = bool(settings.GOOGLE_CLOUD_PROJECT)
        _llm_instance = ChatGoogleGenerativeAI(
            model=settings.GEMINI_MODEL,
            project=settings.GOOGLE_CLOUD_PROJECT or None,
            location=settings.GOOGLE_CLOUD_LOCATION,
            vertexai=use_vertex,
            temperature=0.2,
            max_tokens=4096,
            # Fail fast rather than hanging forever on a stalled API call.
            # 120 s covers large batches; transient errors are retried below.
            request_timeout=120,
        )
    return _llm_instance


def _get_batch_llm() -> object:
    """Return the structured-output LLM for batch utterance analysis."""
    global _batch_llm_instance
    if _batch_llm_instance is None:
        _batch_llm_instance = _get_llm().with_structured_output(UtteranceBatchAnalysis)
    return _batch_llm_instance


def _get_report_llm() -> object:
    """Return the structured-output LLM for final report generation."""
    global _report_llm_instance
    if _report_llm_instance is None:
        _report_llm_instance = _get_llm().with_structured_output(FinalReportContent)
    return _report_llm_instance


# ── Pipeline state ────────────────────────────────────────────────────────────


class PipelineState(TypedDict):
    """Immutable pipeline state threaded through every LangGraph node.

    The state is never mutated in place — each node returns a new dict
    via {**state, <changed_keys>} (AGENTS.md: "le state est immuable").
    """

    session_id: str
    audio_path: str
    # Optional: known participant count — improves diarisation accuracy
    speakers_expected: int | None
    # Optional: BCP-47 language code (e.g. "fr", "en"). When set, disables
    # language_detection and gives the full inference budget to diarisation.
    language_code: str | None
    # Populated by transcribe_node; read by analyze_all_node
    utterances: list[dict]
    # Utterances enriched with intention / sentiment / issues by analyze_all_node
    analyzed_utterances: list[dict]
    # Final report generated by report_node; persisted by run_pipeline
    report: dict | None


# ── Node: transcribe ──────────────────────────────────────────────────────────


def transcribe_node(state: PipelineState) -> PipelineState:
    """LangGraph node — transcribe the full audio file and populate utterances.

    Calls AssemblyAI synchronously via transcribe_audio() (AGENTS.md: always
    send the complete file). Returns an updated state with the utterances list
    populated, ready for analyze_all_node.

    This function is **synchronous** by design so it is compatible with both
    the synchronous LangGraph executor and direct unit testing. When invoked
    from an async context (e.g. the FastAPI background task), wrap with:

        state = await asyncio.to_thread(pipeline_graph.invoke, initial_state)

    Args:
        state: Pipeline state with audio_path set.

    Returns:
        Updated state dict (new object — original is unchanged).

    Raises:
        TranscriptionError: Propagated from transcribe_audio() on any failure.
    """
    logger.info(
        "[session=%s] Step 1/3 — Transcription started (file=%s)",
        state["session_id"],
        state["audio_path"],
    )
    utterances = transcribe_audio(
        state["audio_path"],
        speakers_expected=state.get("speakers_expected"),
        language_code=state.get("language_code"),
    )
    logger.info(
        "[session=%s] Step 1/3 — Transcription complete: %d utterances",
        state["session_id"],
        len(utterances),
    )
    return {**state, "utterances": utterances}


# ── Node: analyze_all ─────────────────────────────────────────────────────────


def _format_utterances_block(utterances: list[dict], start_index: int = 1) -> str:
    """Format a list of utterances as a numbered block for the batch prompt."""
    lines = []
    for i, u in enumerate(utterances, start=start_index):
        lines.append(f"[{i}] {u['speaker']} : {u['text']}")
    return "\n".join(lines)


def _format_context_from_batch(utterances: list[dict]) -> str:
    """Format raw utterance text as lightweight context for the next batch."""
    return "\n".join(f"{u['speaker']} : {u['text']}" for u in utterances)


def analyze_all_node(state: PipelineState) -> PipelineState:
    """LangGraph node — enrich all utterances with LLM analysis, in batches.

    Groups utterances into chunks of settings.ANALYSIS_BATCH_SIZE and sends
    each chunk to the LLM in a single API call, receiving a structured array
    of UtteranceAnalysis objects back. This reduces total LLM calls from N
    (one per utterance) to ceil(N / batch_size).

    Context strategy:
        Each batch receives the raw text of the immediately preceding batch as
        context (plain "speaker: text" lines). No LLM-based compression is
        performed — the raw preceding batch is both cheaper and more accurate
        than a compressed rolling summary for the purpose of grounding each
        analysis in recent conversational flow.

    Args:
        state: Pipeline state with utterances populated by transcribe_node.

    Returns:
        Updated state dict with analyzed_utterances fully populated.
    """
    utterances = state["utterances"]
    batch_size = settings.ANALYSIS_BATCH_SIZE
    total = len(utterances)
    num_batches = (total + batch_size - 1) // batch_size

    logger.info(
        "[session=%s] Step 2/3 — Batch analysis started: %d utterances, batch_size=%d (%d batches)",
        state["session_id"],
        total,
        batch_size,
        num_batches,
    )

    analyzed_utterances: list[dict] = []
    context = "Début de la session — pas encore de contexte."

    for batch_num, batch_start in enumerate(range(0, total, batch_size), start=1):
        batch = utterances[batch_start : batch_start + batch_size]
        utterances_block = _format_utterances_block(batch, start_index=batch_start + 1)

        logger.info(
            "[session=%s] Batch %d/%d: utterances %d-%d",
            state["session_id"],
            batch_num,
            num_batches,
            batch_start + 1,
            batch_start + len(batch),
        )

        # Retry up to 3 times on transient errors (rate limits, timeouts, 5xx).
        # stop_after_attempt(4) = 1 original + 3 retries.
        chain = (UTTERANCE_BATCH_ANALYSIS_PROMPT | _get_batch_llm()).with_retry(
            stop_after_attempt=4,
        )
        result: UtteranceBatchAnalysis = chain.invoke(
            {
                "context": context,
                "count": len(batch),
                "utterances_block": utterances_block,
            }
        )

        # Defensive alignment: if the LLM returns fewer analyses than expected
        # (e.g. truncated response), pad with neutral placeholders so downstream
        # code always has one analysis per utterance.
        analyses = result.analyses
        if len(analyses) < len(batch):
            logger.warning(
                "[session=%s] Batch %d returned %d analyses for %d utterances — padding with placeholders",
                state["session_id"],
                batch_num,
                len(analyses),
                len(batch),
            )
            while len(analyses) < len(batch):
                analyses.append(
                    UtteranceAnalysis(intention="N/A", sentiment="neutre", key_points=[], issues=[])
                )

        for utterance, analysis in zip(batch, analyses):
            analyzed_utterances.append(
                {
                    **utterance,
                    "intention": analysis.intention,
                    "sentiment": analysis.sentiment,
                    "key_points": analysis.key_points,
                    "issues": analysis.issues,
                }
            )

        # Pass the raw text of this batch as context to the next batch
        context = _format_context_from_batch(batch)

    logger.info(
        "[session=%s] Step 2/3 — Batch analysis complete: %d utterances enriched",
        state["session_id"],
        len(analyzed_utterances),
    )
    return {**state, "analyzed_utterances": analyzed_utterances}


# ── Node: report ──────────────────────────────────────────────────────────────


def _format_analysis_for_report(utterance: dict) -> str:
    """Format a single analysed utterance as a concise block for the report prompt.

    Includes both the human-dimension fields (intention, sentiment, issues) and the
    content-dimension field (key_points) so the report LLM has the full picture to
    produce both synthesis_human and synthesis_content.
    """
    issues_str = "; ".join(utterance.get("issues") or []) or "aucun"
    key_points = utterance.get("key_points") or []
    key_points_str = "; ".join(key_points) if key_points else "aucun"
    return (
        f"[{utterance['speaker']}] {utterance['text']}\n"
        f"  → intention: {utterance.get('intention', '?')} | "
        f"sentiment: {utterance.get('sentiment', '?')} | "
        f"points clés: {key_points_str} | "
        f"problèmes: {issues_str}"
    )


def report_node(state: PipelineState) -> PipelineState:
    """LangGraph node — generate the final structured report from all analyses.

    Formats the full analysed transcript and sends it to the LLM to produce:
        - A global synthesis of the session
        - Ordered actionable improvement axes

    The report dict is stored in state["report"]; run_pipeline() in sessions.py
    is responsible for persisting it to the DB (keeps this node pure / testable).

    Args:
        state: Pipeline state after analyze_all_node has run.

    Returns:
        Updated state dict with report populated.
    """
    logger.info(
        "[session=%s] Step 3/3 — Generating final report (%d utterances analyzed)",
        state["session_id"],
        len(state["analyzed_utterances"]),
    )

    utterances_block = "\n\n".join(
        _format_analysis_for_report(u) for u in state["analyzed_utterances"]
    )

    chain = FINAL_REPORT_PROMPT | _get_report_llm()
    result: FinalReportContent = chain.invoke(
        {"utterances_with_analysis": utterances_block}
    )

    report = {
        "synthesis_human": result.synthesis_human,
        "synthesis_content": result.synthesis_content,
        "key_topics": result.key_topics,
        "improvement_axes": result.improvement_axes,
        "utterances": [
            {
                "speaker": u["speaker"],
                "start": u["start"],
                "end": u["end"],
                "text": u["text"],
                "intention": u.get("intention"),
                "sentiment": u.get("sentiment"),
                "key_points": u.get("key_points", []),
                "issues": u.get("issues", []),
            }
            for u in state["analyzed_utterances"]
        ],
    }

    return {**state, "report": report}


# ── StateGraph assembly ───────────────────────────────────────────────────────


def _build_graph() -> object:
    """Compile and return the LangGraph pipeline graph.

    Linear flow — no loops or conditional edges:
        transcribe → analyze_all → report → END

    The compiled graph is stored as the module-level `pipeline_graph` and
    should be invoked via:

        final_state = pipeline_graph.invoke(initial_state)

    Always call this inside asyncio.to_thread() from async contexts.
    """
    builder = StateGraph(PipelineState)

    builder.add_node("transcribe", transcribe_node)
    builder.add_node("analyze_all", analyze_all_node)
    builder.add_node("report", report_node)

    builder.set_entry_point("transcribe")
    builder.add_edge("transcribe", "analyze_all")
    builder.add_edge("analyze_all", "report")
    builder.add_edge("report", END)

    return builder.compile()


# Module-level compiled graph — import and invoke this from sessions.py
pipeline_graph = _build_graph()
