"""LangGraph pipeline state definition and node functions.

Architecture (AGENTS.md):
    transcribe_node → analyze_node → update_context_node → [loop] → report_node

Only transcribe_node is implemented here; the remaining nodes are placeholders
for the LangGraph analysis phase (out of scope for the AssemblyAI sprint).
"""

from typing import TypedDict

from app.pipeline.transcription import TranscriptionError, transcribe_audio


class PipelineState(TypedDict):
    """Immutable pipeline state threaded through every LangGraph node.

    The state is never mutated in place — each node returns a new dict
    via {**state, <changed_keys>} (AGENTS.md: "le state est immuable").
    """

    session_id: str
    audio_path: str
    # Optional: known participant count — improves diarisation accuracy
    speakers_expected: int | None
    # Populated by transcribe_node; read by analyze_node
    utterances: list[dict]
    # Incremented by update_context_node; used by analyze_node to iterate
    current_index: int
    # Rolling LLM context built by update_context_node
    context_summary: str
    # Utterances enriched with intention / sentiment / issues by analyze_node
    analyzed_utterances: list[dict]


def transcribe_node(state: PipelineState) -> PipelineState:
    """LangGraph node — transcribe the full audio file and populate utterances.

    Calls AssemblyAI synchronously via transcribe_audio() (AGENTS.md: always
    send the complete file). Returns an updated state with the utterances list
    populated and current_index reset to 0, ready for analyze_node.

    This function is **synchronous** by design so it is compatible with both
    the synchronous LangGraph executor and direct unit testing. When invoked
    from an async context (e.g. the FastAPI background task), wrap with:

        state = await asyncio.to_thread(transcribe_node, initial_state)

    Args:
        state: Pipeline state with audio_path set.

    Returns:
        Updated state dict (new object — original is unchanged).

    Raises:
        TranscriptionError: Propagated from transcribe_audio() on any failure.
    """
    utterances = transcribe_audio(
        state["audio_path"],
        speakers_expected=state.get("speakers_expected"),
    )
    return {**state, "utterances": utterances, "current_index": 0}
