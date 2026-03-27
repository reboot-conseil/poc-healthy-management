"""LLM prompt templates for the analysis pipeline.

All prompt templates live here — never inline prompts in business logic (AGENTS.md).

Two templates are defined:
    UTTERANCE_BATCH_ANALYSIS_PROMPT — batch of N utterances: intention, sentiment, key_points, issues per utterance
    FINAL_REPORT_PROMPT             — synthesise the whole session into a final report with two dimensions:
                                      human/relational (synthesis_human) and substantive content (synthesis_content)
"""

from langchain_core.prompts import ChatPromptTemplate

# ── Batch utterance analysis ──────────────────────────────────────────────────
# Sends up to ANALYSIS_BATCH_SIZE utterances in a single LLM call and receives
# a structured array back, reducing total API round-trips by ~10x compared to
# the previous per-utterance loop.
#
# key_points captures the *concrete substance* of each utterance (facts, topics,
# decisions, ideas, blockers) so the final report can summarise both the human
# dynamics AND the actual content discussed — the gap flagged in user feedback.

UTTERANCE_BATCH_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """Tu es un expert en analyse de communication professionnelle et en synthèse de contenu.
Tu analyses des échanges lors de sessions de travail collaboratif (workathons).
Pour chaque prise de parole, tu extrais deux dimensions complémentaires :

DIMENSION HUMAINE :
- l'intention principale du locuteur
- le sentiment exprimé (positif, négatif, neutre ou mitigé)
- les problèmes de communication éventuellement détectés

DIMENSION CONTENU :
- les points concrets mentionnés : faits, idées, sujets, décisions, blocages, propositions, chiffres,
  prochaines étapes ou toute information substantielle exprimée par le locuteur

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
  "key_points": ["<point concret : fait, idée, décision, sujet ou information substantielle mentionnée>", ...],
  "issues": ["<problème de communication détecté>", ...]
}}

Règles :
- "key_points" doit capturer le CONTENU de ce qui est dit (pas le ton, pas l'émotion) : sujets abordés,
  propositions formulées, chiffres cités, décisions prises, blocages identifiés, prochaines étapes évoquées.
  Si la prise de parole ne contient aucun contenu substantiel (ex. : acquiescement court), retourne une liste vide.
- "issues" : si aucun problème de communication, retourne une liste vide.
Réponds UNIQUEMENT avec un tableau JSON valide, sans markdown ni backticks.
""",
        ),
    ]
)

# ── Final report ──────────────────────────────────────────────────────────────
# The report now covers two explicit dimensions so that clients see both the
# quality of human exchanges AND the concrete substance of what was discussed.
# This directly addresses the feedback: "ça parle pas de ce qu'ils ont dit".

FINAL_REPORT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """Tu es un consultant expert en facilitation, dynamiques de groupe et restitution de sessions de travail.
Tu produis des rapports de qualité professionnelle à destination de managers et DRH.
Ton analyse doit être bienveillante, constructive et actionnable.

Chaque rapport que tu produis couvre OBLIGATOIREMENT deux dimensions :
1. La dimension humaine et relationnelle : comment les participants ont interagi, la qualité de la communication,
   le climat émotionnel, les dynamiques de groupe.
2. La dimension contenu et substantielle : ce qui a été dit concrètement — sujets traités, idées exprimées,
   décisions prises, blocages identifiés, propositions formulées, prochaines étapes évoquées.
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
  "synthesis_human": "<Synthèse de la DIMENSION HUMAINE en 2 à 3 paragraphes : dynamique relationnelle entre participants, qualité et fluidité des échanges, climat émotionnel général, points forts de la communication, tensions ou malentendus observés>",
  "synthesis_content": "<Synthèse de la DIMENSION CONTENU en 2 à 3 paragraphes : sujets principaux abordés, idées et propositions formulées, décisions prises ou envisagées, blocages ou points de friction identifiés, prochaines étapes mentionnées. Cite des éléments concrets issus des échanges.>",
  "key_topics": [
    "<sujet ou point concret clé de la session — formulation courte et précise>",
    ...
  ],
  "improvement_axes": [
    "<axe d'amélioration 1 — couvre la dimension humaine OU contenu, actionnable et concret>",
    "<axe d'amélioration 2>",
    ...
  ]
}}

Règles :
- "synthesis_human" ne doit PAS résumer ce qui a été dit (le contenu), uniquement comment c'était dit.
- "synthesis_content" doit citer des éléments concrets (sujets, chiffres, noms de projets, décisions).
  Ne pas se limiter aux émotions ou à la dynamique — se concentrer sur la substance.
- "key_topics" : liste ordonnée des 5 à 10 sujets/points clés les plus importants abordés.
  Formulations courtes, factuelles, directement issues du contenu des échanges.
- "improvement_axes" : hiérarchisés par importance, directement applicables lors des prochaines sessions,
  et spécifiques à CETTE session (pas de recommandations génériques).
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni backticks.
""",
        ),
    ]
)
