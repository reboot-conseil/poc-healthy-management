"""LLM prompt templates for the analysis pipeline.

All prompt templates live here — never inline prompts in business logic (AGENTS.md).

Two templates are defined:
    UTTERANCE_BATCH_ANALYSIS_PROMPT — batch of N utterances: intention, sentiment, issues per utterance
    FINAL_REPORT_PROMPT             — synthesise the whole session into a final report
"""

from langchain_core.prompts import ChatPromptTemplate

# ── Batch utterance analysis ──────────────────────────────────────────────────
# Sends up to ANALYSIS_BATCH_SIZE utterances in a single LLM call and receives
# a structured array back, reducing total API round-trips by ~10x compared to
# the previous per-utterance loop.

UTTERANCE_BATCH_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """Tu es un expert en analyse de communication professionnelle.
Tu analyses des échanges lors de sessions de travail collaboratif (workathons).
Pour chaque prise de parole, tu extrais :
- l'intention principale du locuteur
- le sentiment exprimé (positif, négatif, neutre ou mitigé)
- les problèmes de communication éventuellement détectés

Tu reçois un lot de prises de parole numérotées et tu retournes une analyse pour chacune,
dans le même ordre, sous la forme d'un tableau JSON.
""",
        ),
        (
            "human",
            """Contexte des échanges précédant ce lot (peut être vide en début de session) :
{context}

---

Voici les {count} prises de parole à analyser :

{utterances_block}

---

Retourne un tableau JSON contenant exactement {count} objets, dans le même ordre que les prises de parole ci-dessus.
Chaque objet doit avoir exactement ces clés :
{{
  "intention": "<intention principale en une phrase courte>",
  "sentiment": "<positif | négatif | neutre | mitigé>",
  "issues": ["<problème de communication détecté>", ...]
}}

Si aucun problème de communication n'est détecté pour une prise de parole, retourne une liste vide pour "issues".
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown ni backticks.
""",
        ),
    ]
)

# ── Final report ──────────────────────────────────────────────────────────────

FINAL_REPORT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """Tu es un consultant expert en facilitation et dynamiques de groupe.
Tu produis des rapports de qualité professionnelle à destination de managers et DRH.
Ton analyse doit être bienveillante, constructive et actionnable.
""",
        ),
        (
            "human",
            """Voici la transcription complète et les analyses individuelles d'une session de travail collaboratif.

=== TRANSCRIPTION ET ANALYSES PAR PRISE DE PAROLE ===
{utterances_with_analysis}

=== FIN DE LA TRANSCRIPTION ===

Sur la base de ces échanges, produis un rapport final structuré en JSON avec exactement ces clés :
{{
  "synthesis": "<synthèse globale de la session en 3 à 5 paragraphes : dynamique générale, qualité des échanges, points forts et points faibles>",
  "improvement_axes": [
    "<axe d'amélioration 1 — actionnable et concret>",
    "<axe d'amélioration 2>",
    ...
  ]
}}

Les axes d'amélioration doivent être concrets, hiérarchisés par importance, et directement applicables lors des prochaines sessions.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni backticks.
""",
        ),
    ]
)
