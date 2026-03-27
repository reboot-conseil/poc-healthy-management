"""Unit tests for the LangGraph analysis pipeline nodes.

Each node is tested in isolation with mocked LLM calls (AGENTS.md: "each node
is a pure function testable independently"). No real API calls are made.

Test coverage:
    - analyze_all_node  — groups utterances into batches, calls LLM per batch,
                          enriches all utterances, handles alignment padding
    - report_node       — generates the final report structure
"""

from unittest.mock import MagicMock, patch

import pytest

from app.pipeline.graph import (
    PipelineState,
    UtteranceAnalysis,
    UtteranceBatchAnalysis,
    analyze_all_node,
    report_node,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_utterance(speaker: str = "A", text: str = "Bonjour tout le monde.") -> dict:
    return {"speaker": speaker, "start": 0.0, "end": 3.0, "text": text}


def _make_state(**overrides) -> PipelineState:
    base: PipelineState = {
        "session_id": "test-session-123",
        "audio_path": "/tmp/test.mp3",
        "speakers_expected": None,
        "language_code": None,
        "utterances": [
            _make_utterance("A"),
            _make_utterance("B", "Merci pour cette introduction."),
        ],
        "analyzed_utterances": [],
        "report": None,
    }
    return {**base, **overrides}


def _make_batch_result(*pairs: tuple[str, str]) -> UtteranceBatchAnalysis:
    """Helper: build a UtteranceBatchAnalysis from (intention, sentiment) pairs."""
    return UtteranceBatchAnalysis(
        analyses=[
            UtteranceAnalysis(intention=intention, sentiment=sentiment, issues=[])
            for intention, sentiment in pairs
        ]
    )


# ── analyze_all_node tests ────────────────────────────────────────────────────


class TestAnalyzeAllNode:
    def _patch_batch_llm(self, mock_result: UtteranceBatchAnalysis):
        """Return a context-manager patch that makes the batch LLM return mock_result."""
        mock_chain = MagicMock()
        mock_chain.invoke.return_value = mock_result
        patcher = patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT")
        return patcher, mock_chain

    def test_enriches_all_utterances(self):
        """analyze_all_node must produce one enriched entry per input utterance."""
        utterances = [_make_utterance("A"), _make_utterance("B", "Bonne idée.")]
        state = _make_state(utterances=utterances)

        batch_result = _make_batch_result(
            ("Saluer", "positif"),
            ("Approuver", "positif"),
        )

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = batch_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = analyze_all_node(state)

        assert len(new_state["analyzed_utterances"]) == 2
        assert new_state["analyzed_utterances"][0]["intention"] == "Saluer"
        assert new_state["analyzed_utterances"][1]["intention"] == "Approuver"

    def test_preserves_original_utterance_fields(self):
        """Enriched utterances must keep original speaker / start / end / text."""
        utterance = {"speaker": "C", "start": 10.5, "end": 15.0, "text": "C'est une bonne idée."}
        state = _make_state(utterances=[utterance])

        batch_result = _make_batch_result(("Approuver une proposition", "positif"))

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = batch_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = analyze_all_node(state)

        enriched = new_state["analyzed_utterances"][0]
        assert enriched["speaker"] == "C"
        assert enriched["start"] == 10.5
        assert enriched["end"] == 15.0
        assert enriched["text"] == "C'est une bonne idée."

    def test_batches_respect_batch_size(self):
        """With 12 utterances and batch_size=5, the LLM must be called 3 times."""
        utterances = [_make_utterance("A", f"Texte {i}.") for i in range(12)]
        state = _make_state(utterances=utterances)

        call_count = 0

        def fake_invoke(inputs):
            nonlocal call_count
            call_count += 1
            count = inputs["count"]
            return _make_batch_result(*[("Intention", "neutre")] * count)

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.side_effect = fake_invoke
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            with patch("app.pipeline.graph.settings") as mock_settings:
                mock_settings.ANALYSIS_BATCH_SIZE = 5
                mock_settings.GOOGLE_CLOUD_PROJECT = ""
                new_state = analyze_all_node(state)

        assert call_count == 3  # ceil(12 / 5)
        assert len(new_state["analyzed_utterances"]) == 12

    def test_pads_short_batch_response(self):
        """If the LLM returns fewer analyses than utterances in a batch, pad with placeholders."""
        utterances = [_make_utterance("A", f"Texte {i}.") for i in range(3)]
        state = _make_state(utterances=utterances)

        # LLM returns only 1 analysis for a batch of 3
        short_result = UtteranceBatchAnalysis(
            analyses=[UtteranceAnalysis(intention="Only one", sentiment="neutre", issues=[])]
        )

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = short_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = analyze_all_node(state)

        assert len(new_state["analyzed_utterances"]) == 3
        # First real, rest padded
        assert new_state["analyzed_utterances"][0]["intention"] == "Only one"
        assert new_state["analyzed_utterances"][1]["intention"] == "N/A"
        assert new_state["analyzed_utterances"][2]["intention"] == "N/A"

    def test_handles_empty_utterances(self):
        """With an empty utterances list, analyzed_utterances must be empty."""
        state = _make_state(utterances=[])

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT"):
            new_state = analyze_all_node(state)

        assert new_state["analyzed_utterances"] == []

    def test_state_is_immutable(self):
        """analyze_all_node must return a new dict; the original must be unchanged."""
        state = _make_state()
        original_analyzed = state["analyzed_utterances"]

        batch_result = _make_batch_result(("Saluer", "positif"), ("Répondre", "neutre"))

        with patch("app.pipeline.graph.UTTERANCE_BATCH_ANALYSIS_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = batch_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = analyze_all_node(state)

        assert new_state is not state
        assert state["analyzed_utterances"] is original_analyzed


# ── report_node tests ─────────────────────────────────────────────────────────


class TestReportNode:
    def _make_analyzed(self) -> list[dict]:
        return [
            {
                "speaker": "A",
                "start": 0.0,
                "end": 3.0,
                "text": "Bonjour.",
                "intention": "Saluer",
                "sentiment": "positif",
                "key_points": [],
                "issues": [],
            },
            {
                "speaker": "B",
                "start": 3.5,
                "end": 7.0,
                "text": "Commençons.",
                "intention": "Lancer la réunion",
                "sentiment": "neutre",
                "key_points": ["Démarrage de la session"],
                "issues": ["Manque d'introduction"],
            },
        ]

    def test_generates_report_with_correct_structure(self):
        """report_node must set state['report'] with synthesis_human, synthesis_content, key_topics, improvement_axes, utterances."""
        state = _make_state(analyzed_utterances=self._make_analyzed())

        mock_result = MagicMock()
        mock_result.synthesis_human = "La session s'est bien déroulée dans l'ensemble."
        mock_result.synthesis_content = "Les participants ont abordé la question des délais."
        mock_result.key_topics = ["Délais", "Budget"]
        mock_result.improvement_axes = ["Améliorer les introductions", "Clarifier les objectifs"]

        with patch("app.pipeline.graph.FINAL_REPORT_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = mock_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = report_node(state)

        report = new_state["report"]
        assert report is not None
        assert report["synthesis_human"] == "La session s'est bien déroulée dans l'ensemble."
        assert report["synthesis_content"] == "Les participants ont abordé la question des délais."
        assert report["key_topics"] == ["Délais", "Budget"]
        assert len(report["improvement_axes"]) == 2
        assert "Améliorer les introductions" in report["improvement_axes"]
        assert len(report["utterances"]) == 2

    def test_report_utterances_preserve_all_fields(self):
        """Each utterance in the report must have all required fields including key_points."""
        state = _make_state(analyzed_utterances=self._make_analyzed())

        mock_result = MagicMock()
        mock_result.synthesis_human = "Synthèse humaine."
        mock_result.synthesis_content = "Synthèse contenu."
        mock_result.key_topics = []
        mock_result.improvement_axes = ["Axe 1"]

        with patch("app.pipeline.graph.FINAL_REPORT_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = mock_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = report_node(state)

        required_keys = {"speaker", "start", "end", "text", "intention", "sentiment", "key_points", "issues"}
        for u in new_state["report"]["utterances"]:
            assert required_keys.issubset(u.keys())

    def test_state_is_immutable(self):
        """report_node must return a new state dict without mutating the original."""
        state = _make_state(analyzed_utterances=self._make_analyzed())

        mock_result = MagicMock()
        mock_result.synthesis_human = "test humain"
        mock_result.synthesis_content = "test contenu"
        mock_result.key_topics = []
        mock_result.improvement_axes = []

        with patch("app.pipeline.graph.FINAL_REPORT_PROMPT") as mock_prompt:
            mock_chain = MagicMock()
            mock_chain.invoke.return_value = mock_result
            mock_prompt.__or__ = MagicMock(return_value=mock_chain)

            new_state = report_node(state)

        assert new_state is not state
        assert state["report"] is None
