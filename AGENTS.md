# AGENTS.md

Directives pour les agents IA (Claude Code, Codex, Cursor, etc.) travaillant sur ce repo.

---

## Rôle et périmètre

Tu travailles sur le POC **Captation & Transcription Workathon** — un système de captation audio en navigateur, transcription via Assembly AI, et analyse LLM des échanges (intention, sentiment, problèmes de communication), avec restitution d'un rapport final structuré.

Lis `CLAUDE.md` en premier pour comprendre l'architecture complète avant toute modification.

---

## Règles générales

- Ne jamais modifier `CLAUDE.md` ou `AGENTS.md` sans instruction explicite.
- Ne jamais committer de clés API, secrets ou credentials — utiliser les variables d'environnement définies dans `CLAUDE.md`.
- Ne jamais introduire de `any` en TypeScript ni supprimer les type hints Python.
- Toujours écrire des tests pour les nouvelles fonctions du pipeline (`backend/tests/`).
- Les PR doivent rester focalisées sur une seule fonctionnalité ou correction.

---

## Frontend (React + TypeScript)

### Composant d'enregistrement audio

Le hook `useAudioRecorder` est la pièce centrale du frontend. Il doit :

```typescript
// Comportement attendu
- Accéder au micro via navigator.mediaDevices.getUserMedia()
- Analyser le niveau RMS via AnalyserNode pour détecter les silences
- Seuil de silence : énergie RMS < 0.01 pendant > 400ms → nouveau chunk
- Accumuler les chunks Blob en mémoire (ou IndexedDB si séance > 30 min)
- En fin de séance : concaténer tous les chunks en un seul Blob audio
- Envoyer le fichier via POST /sessions/{id}/audio (multipart/form-data)
```

Ne pas implémenter de streaming WebSocket vers le backend — le traitement est différé, déclenché uniquement en fin de séance.

### Affichage du rapport

Le composant `ReportView` affiche :
1. La transcription complète avec les prises de parole (locuteur + horodatage + texte)
2. Pour chaque prise de parole : intention, sentiment, problèmes détectés
3. La synthèse globale et les axes d'amélioration

Poller `GET /reports/{session_id}` toutes les 5 secondes tant que `status !== 'done'`. Afficher un indicateur de progression pendant le traitement.

---

## Backend (Python + FastAPI)

### Endpoints à implémenter

```
POST   /sessions                    Créer une session
POST   /sessions/{id}/audio         Upload du fichier audio (déclenche le pipeline)
GET    /sessions/{id}               Statut de la session
GET    /reports/{session_id}        Rapport final (retourne 202 si pas encore prêt)
```

L'endpoint `POST /sessions/{id}/audio` doit :
1. Sauvegarder le fichier audio
2. Lancer le pipeline en tâche de fond (`BackgroundTasks` FastAPI)
3. Retourner immédiatement un `202 Accepted`

Ne jamais faire attendre la réponse HTTP sur la durée du pipeline.

### Pipeline LangGraph (`backend/app/pipeline/graph.py`)

```python
# Structure du StateGraph attendue
class PipelineState(TypedDict):
    session_id: str
    utterances: list[dict]          # issues d'Assembly AI
    current_index: int
    context_summary: str            # résumé cumulé des étapes précédentes
    analyzed_utterances: list[dict] # résultats enrichis

# Noeuds du graph
- transcribe_node     : appel Assembly AI, retourne la liste des utterances diarisées
- analyze_node        : appel LLM sur utterances[current_index] + context_summary
- update_context_node : met à jour context_summary avec le résultat de l'étape N
- loop_condition      : continue si current_index < len(utterances), sinon → generate_report
- report_node         : génère le rapport final et l'écrit en DB
```

### Intégration Assembly AI (`backend/app/pipeline/transcription.py`)

- Envoyer le fichier audio **complet** — ne pas découper en chunks pour l'envoi à Assembly AI.
- Activer `speaker_labels=True` pour la diarisation.
- Retourner une liste d'utterances au format :
  ```python
  [{"speaker": "A", "start": 4.2, "end": 8.1, "text": "Bonjour..."}]
  ```

### Gestion du contexte LLM

- Jusqu'à 20 prises de parole : passer toutes les analyses précédentes dans le prompt.
- Au-delà : passer un résumé glissant (résumer les N-10 premières, garder les 10 dernières intactes).
- Template de prompt dans `backend/app/pipeline/prompts.py` — ne jamais inliner les prompts dans la logique métier.

### Base de données

- ORM : SQLAlchemy 2.x avec sessions async (`AsyncSession`)
- Migrations : Alembic — toujours générer une migration pour tout changement de schéma
- Ne jamais faire de `DROP COLUMN` ou `DROP TABLE` dans une migration sans instruction explicite

---

## CI/CD (GitHub Actions)

### Workflow frontend (`.github/workflows/frontend.yml`)
- Trigger : push sur `main` et `dev`, PR vers `main`
- Steps : install → lint → typecheck → build → deploy Vercel (prod sur `main`, preview sur `dev`)

### Workflow backend (`.github/workflows/backend.yml`)
- Trigger : push sur `main` et `dev`, PR vers `main`
- Steps : install → lint (ruff) → typecheck (mypy) → pytest → deploy Railway (prod sur `main` uniquement)

Ne jamais déployer en production depuis une branche `feature/`.

---

## Comportement attendu par tâche

### "Implémenter la détection de silence"
→ Modifier uniquement `frontend/src/hooks/useAudioRecorder.ts`
→ Paramètres calibrables : seuil RMS, durée minimale de silence, durée minimale de chunk
→ Écrire un test unitaire Jest sur la logique de détection

### "Intégrer Assembly AI"
→ Modifier uniquement `backend/app/pipeline/transcription.py`
→ Utiliser le SDK officiel `assemblyai` (pip)
→ Gérer les cas d'erreur : timeout, quota dépassé, fichier trop court (< 2s)

### "Construire le graph LangGraph"
→ Modifier `backend/app/pipeline/graph.py`
→ Chaque nœud est une fonction pure testable indépendamment
→ Le state est immuable — retourner un nouveau dict à chaque nœud

### "Ajouter un endpoint FastAPI"
→ Créer ou modifier le fichier dans `backend/app/api/`
→ Documenter avec les docstrings FastAPI (utilisées pour OpenAPI)
→ Ajouter un test d'intégration dans `backend/tests/`

### "Modifier le schéma DB"
→ Modifier le model SQLAlchemy dans `backend/app/models/`
→ Générer la migration Alembic : `alembic revision --autogenerate -m "description"`
→ Vérifier le fichier de migration généré avant de le committer

---

## Ce qu'il ne faut pas faire

- Ne pas implémenter de WebSocket ou de streaming temps réel — le traitement est entièrement différé.
- Ne pas envoyer l'audio chunk par chunk à Assembly AI — toujours le fichier complet.
- Ne pas stocker les fichiers audio en base de données — utiliser le système de fichiers ou un object storage.
- Ne pas appeler le LLM sur l'audio brut — uniquement sur le texte issu de la transcription Assembly AI.
- Ne pas bloquer un worker FastAPI sur un appel synchrone long — toujours `await` ou `BackgroundTasks`.
