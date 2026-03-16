# CLAUDE.md

Ce fichier fournit le contexte du projet et les directives pour Claude Code lors des sessions de développement.

---

## Contexte du projet

**Projet :** POC Captation & Transcription Workathon
**Client :** Healthy Management
**Prestataire :** Reboot Conseil
**Budget :** 5 200 € HT — 8 à 9 jours ouvrés

### Objectif

Système de captation audio, transcription, diarisation et analyse des échanges lors de workathons. Le POC valide les fondations techniques nécessaires à une plateforme complète de facilitation par IA.

### Pipeline technique (vue d'ensemble)

```
[Navigateur]
  Micro groupe (mono mixé)
    → Web Audio API / AnalyserNode
    → Détection de silence (seuil énergie)
    → MediaRecorder → file de chunks WebM/Opus
    → Fichier audio complet (fin de séance)
    → HTTP POST → Backend

[Backend — traitement séquentiel]
  Étape 1 : Assembly AI (fichier complet)
    → STT haute précision
    → Diarisation globale
    → Transcription diarisée horodatée [SPEAKER_X] HH:MM "..."

  Étape 2 : LangGraph pipeline (sur texte)
    Pour chaque prise de parole N :
      → Prompt LLM = utterance[N] + résumé contexte [1..N-1]
      → Détection : intention, sentiment, problèmes de communication
      → Mise à jour du context store

  Rapport final :
    → Transcription complète diarisée
    → Intentions + sentiments par prise de parole
    → Axes d'amélioration (synthèse globale)
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React + TypeScript |
| Backend | Python 3.11+ + FastAPI |
| Pipeline IA | LangChain + LangGraph |
| Transcription | Assembly AI API |
| Base de données | PostgreSQL (JSONB pour résultats LLM) |
| Hébergement frontend | Vercel |
| Hébergement backend | Railway |
| CI/CD | GitHub + GitHub Actions |

---

## Structure du repo

```
/
├── frontend/                  # React + TypeScript (Vercel)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Recorder.tsx       # Capture audio + détection silence
│   │   │   ├── SessionView.tsx    # Vue session en cours
│   │   │   └── ReportView.tsx     # Affichage rapport final
│   │   ├── hooks/
│   │   │   └── useAudioRecorder.ts  # Web Audio API + MediaRecorder
│   │   └── api/
│   │       └── client.ts          # HTTP client vers backend
│   └── ...
│
├── backend/                   # Python + FastAPI (Railway)
│   ├── app/
│   │   ├── main.py                # FastAPI app + routes
│   │   ├── api/
│   │   │   ├── sessions.py        # POST /sessions, GET /sessions/{id}
│   │   │   └── reports.py         # GET /reports/{session_id}
│   │   ├── pipeline/
│   │   │   ├── transcription.py   # Intégration Assembly AI
│   │   │   ├── graph.py           # LangGraph StateGraph
│   │   │   └── prompts.py         # Templates de prompts LLM
│   │   ├── models/
│   │   │   ├── session.py         # SQLAlchemy models
│   │   │   ├── utterance.py
│   │   │   └── report.py
│   │   └── db/
│   │       └── database.py        # Connexion PostgreSQL
│   ├── tests/
│   └── requirements.txt
│
├── .github/
│   └── workflows/
│       ├── frontend.yml           # Deploy Vercel
│       └── backend.yml            # Deploy Railway
│
├── CLAUDE.md                  # Ce fichier
└── AGENTS.md                  # Directives agents IA
```

---

## Schéma base de données

```sql
-- Sessions d'enregistrement
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    title       TEXT,
    status      TEXT NOT NULL DEFAULT 'recording', -- recording | processing | done | error
    audio_path  TEXT
);

-- Prises de parole diarisées
CREATE TABLE utterances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id),
    speaker     TEXT NOT NULL,           -- SPEAKER_A, SPEAKER_B...
    start_time  FLOAT NOT NULL,          -- secondes
    end_time    FLOAT NOT NULL,
    text        TEXT NOT NULL,
    intention   TEXT,
    sentiment   TEXT,
    issues      JSONB,                   -- problèmes de communication détectés
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rapports finaux
CREATE TABLE reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES sessions(id),
    content     JSONB NOT NULL,          -- rapport structuré complet
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## Commandes utiles

```bash
# Backend — développement local
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend — développement local
cd frontend
npm install
npm run dev

# Tests backend
cd backend
pytest tests/ -v

# Migrations DB (Alembic)
alembic upgrade head
```

---

## Variables d'environnement

### Backend (Railway)
```
ASSEMBLYAI_API_KEY=...
OPENAI_API_KEY=...          # ou ANTHROPIC_API_KEY selon le LLM retenu
DATABASE_URL=postgresql://...
ALLOWED_ORIGINS=https://your-app.vercel.app
```

### Frontend (Vercel)
```
VITE_API_URL=https://your-backend.railway.app
```

---

## Conventions de code

- **Python** : PEP 8, type hints obligatoires, docstrings sur les fonctions publiques
- **TypeScript** : strict mode activé, pas de `any`
- **Commits** : format conventionnel — `feat:`, `fix:`, `chore:`, `docs:`
- **Branches** : `main` (prod), `dev` (intégration), `feature/xxx` (développement)

---

## Points de vigilance

1. **Durée de traitement** : le pipeline Assembly AI + LangGraph peut prendre 1 à 3 minutes pour une séance longue. Les endpoints de traitement sont asynchrones — ne jamais bloquer le worker FastAPI.
2. **Taille du fichier audio** : prévoir la gestion des fichiers > 100 Mo (séances > 1h). Utiliser `python-multipart` pour les uploads FastAPI.
3. **Context window LLM** : au-delà de ~30 prises de parole, implémenter un résumé glissant pour éviter de dépasser la fenêtre de contexte.
4. **RGPD** : les données audio contiennent des voix identifiables. Valider la conformité Assembly AI (point A3 du rétroplanning) avant tout envoi en production.
5. **Diarisation** : Assembly AI travaille sur le fichier complet pour une meilleure précision — ne pas envoyer chunk par chunk pour la diarisation.
