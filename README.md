# 🎙️ Workathon — Captation & Transcription

Système de captation audio, transcription, diarisation et analyse des échanges lors de workathons. Le système capture les discussions en groupe, les transcrit, identifie les intervenants et analyse automatiquement les intentions, sentiments et problèmes de communication afin de générer un rapport structuré en fin de séance.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Lancement en développement](#lancement-en-développement)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Structure du projet](#structure-du-projet)
- [Pipeline de traitement](#pipeline-de-traitement)
- [Base de données](#base-de-données)
- [Points de vigilance](#points-de-vigilance)

---

## Fonctionnalités

- **Captation audio** — enregistrement depuis un micro groupe directement dans le navigateur
- **Segmentation intelligente** — découpage automatique du flux audio à la détection de silences
- **Transcription** — conversion speech-to-text via Assembly AI sur le fichier audio complet
- **Diarisation** — identification et attribution des prises de parole par locuteur
- **Analyse LLM** — détection des intentions, sentiments et problèmes de communication par prise de parole, avec contexte cumulé
- **Rapport final** — synthèse structurée avec axes d'amélioration, générée en fin de séance

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Navigateur                        │
│                                                     │
│  Micro groupe → Web Audio API → Détection silence   │
│              → MediaRecorder → File de chunks       │
│              → [fin de séance] → HTTP POST          │
└──────────────────────┬──────────────────────────────┘
                       │ fichier audio complet
┌──────────────────────▼──────────────────────────────┐
│                   Backend (FastAPI)                 │
│                                                     │
│  Étape 1 — Assembly AI                              │
│    fichier complet → STT + Diarisation              │
│    → transcription diarisée [SPEAKER_X] HH:MM "…"  │
│                                                     │
│  Étape 2 — LangGraph (séquentiel)                   │
│    pour chaque prise de parole N :                  │
│      utterance[N] + contexte[1..N-1] → LLM          │
│      → intention · sentiment · problèmes            │
│                                                     │
│  Rapport final → PostgreSQL                         │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              PostgreSQL (Railway)                   │
│  sessions · utterances · reports                    │
└─────────────────────────────────────────────────────┘
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 18 + TypeScript |
| Backend | Python 3.11 + FastAPI |
| Pipeline IA | LangChain + LangGraph |
| Transcription & Diarisation | Assembly AI API |
| Base de données | PostgreSQL |
| Hébergement frontend | Vercel |
| Hébergement backend | Railway |
| CI/CD | GitHub Actions |

---

## Prérequis

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+
- Un compte [Assembly AI](https://www.assemblyai.com/)
- Un compte [OpenAI](https://platform.openai.com/) ou [Anthropic](https://www.anthropic.com/) (selon le LLM retenu)

---

## Installation

### Cloner le repo

```bash
git clone https://github.com/your-org/workathon-poc.git
cd workathon-poc
```

### Frontend

```bash
cd frontend
npm install
```

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows : .venv\Scripts\activate
pip install -r requirements.txt
```

### Base de données

```bash
cd backend
alembic upgrade head
```

---

## Configuration

### Backend — `.env`

```env
# API de transcription
ASSEMBLYAI_API_KEY=your_assemblyai_key

# LLM (choisir l'un ou l'autre)
OPENAI_API_KEY=your_openai_key
# ANTHROPIC_API_KEY=your_anthropic_key

# Base de données
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/workathon

# CORS
ALLOWED_ORIGINS=http://localhost:5173
```

### Frontend — `.env.local`

```env
VITE_API_URL=http://localhost:8000
```

---

## Lancement en développement

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

L'API est disponible sur `http://localhost:8000`.
La documentation OpenAPI est accessible sur `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm run dev
```

L'application est disponible sur `http://localhost:5173`.

---

## Tests

### Backend

```bash
cd backend
pytest tests/ -v
```

### Frontend

```bash
cd frontend
npm run test
```

### Lint & typage

```bash
# Backend
ruff check .
mypy app/

# Frontend
npm run lint
npm run typecheck
```

---

## Déploiement

### Frontend → Vercel

Le déploiement est automatique via GitHub Actions :
- Push sur `main` → déploiement en production
- Push sur `dev` ou PR vers `main` → déploiement en preview

Configurer les variables d'environnement dans le dashboard Vercel :
```
VITE_API_URL=https://your-backend.railway.app
```

### Backend → Railway

Le déploiement est automatique via GitHub Actions sur push vers `main`.

Configurer les variables d'environnement dans le dashboard Railway :
```
ASSEMBLYAI_API_KEY=...
OPENAI_API_KEY=...
DATABASE_URL=...
ALLOWED_ORIGINS=https://your-app.vercel.app
```

---

## Structure du projet

```
/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Recorder.tsx         # Interface d'enregistrement
│   │   │   ├── SessionView.tsx      # Vue session en cours
│   │   │   └── ReportView.tsx       # Affichage rapport final
│   │   ├── hooks/
│   │   │   └── useAudioRecorder.ts  # Web Audio API + détection silence
│   │   └── api/
│   │       └── client.ts            # Client HTTP vers backend
│   ├── package.json
│   └── tsconfig.json
│
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app + routes
│   │   ├── api/
│   │   │   ├── sessions.py          # Endpoints sessions
│   │   │   └── reports.py           # Endpoints rapports
│   │   ├── pipeline/
│   │   │   ├── transcription.py     # Intégration Assembly AI
│   │   │   ├── graph.py             # LangGraph StateGraph
│   │   │   └── prompts.py           # Templates prompts LLM
│   │   ├── models/                  # SQLAlchemy models
│   │   └── db/
│   │       └── database.py          # Connexion PostgreSQL (async)
│   ├── tests/
│   ├── alembic/                     # Migrations DB
│   └── requirements.txt
│
├── .github/
│   └── workflows/
│       ├── frontend.yml
│       └── backend.yml
│
├── CLAUDE.md                        # Contexte projet pour Claude Code
├── AGENTS.md                        # Directives pour agents IA
└── README.md
```

---

## Pipeline de traitement

### Étape 1 — Transcription globale (Assembly AI)

Le fichier audio complet de la séance est envoyé à Assembly AI en une seule requête avec `speaker_labels=True`. Assembly AI retourne une transcription diarisée horodatée :

```json
[
  { "speaker": "A", "start": 4.2,  "end": 8.1,  "text": "Bonjour à tous…" },
  { "speaker": "B", "start": 9.0,  "end": 14.3, "text": "Merci, donc le sujet…" },
  { "speaker": "A", "start": 15.1, "end": 21.7, "text": "Je pense que…" }
]
```

> L'envoi du fichier **complet** (et non chunk par chunk) est intentionnel : la diarisation est un problème global — le modèle a besoin d'entendre toutes les occurrences d'un locuteur pour construire son empreinte vocale avec précision.

### Étape 2 — Analyse LLM séquentielle (LangGraph)

Chaque prise de parole est analysée séquentiellement. Le LLM reçoit pour chaque étape N :
- Le texte de la prise de parole N
- Un résumé cumulé des étapes 1 à N-1 (résumé glissant au-delà de 20 prises de parole)

Le `StateGraph` LangGraph orchestre les nœuds suivants :

```
transcribe_node → analyze_node → update_context_node → [loop] → report_node
```

### Rapport final

Le rapport agrège les deux couches :
- **Transcription structurée** : qui a dit quoi et quand
- **Analyse LLM** : intention, sentiment et problèmes détectés par prise de parole
- **Synthèse globale** : axes d'amélioration issus de l'ensemble de la séance

---

## Base de données

```sql
-- Sessions d'enregistrement
sessions (id, created_at, title, status, audio_path)
  status : 'recording' | 'processing' | 'done' | 'error'

-- Prises de parole diarisées et analysées
utterances (id, session_id, speaker, start_time, end_time, text,
            intention, sentiment, issues JSONB)

-- Rapports finaux
reports (id, session_id, content JSONB, created_at)
```

---

## Points de vigilance

**Durée de traitement**
Le pipeline Assembly AI + LangGraph peut prendre 1 à 3 minutes pour une séance d'une heure. L'endpoint de traitement retourne immédiatement un `202 Accepted` et traite en tâche de fond. Le frontend poll `GET /reports/{session_id}` jusqu'à ce que le statut passe à `done`.

**Taille des fichiers audio**
Pour des séances supérieures à une heure, le fichier audio peut dépasser 100 Mo. Le frontend utilise IndexedDB pour l'accumulation des chunks au-delà de 30 minutes.

**Fenêtre de contexte LLM**
Au-delà de 20 prises de parole, le backend applique un résumé glissant : les N-10 premières étapes sont condensées, les 10 dernières restent intactes dans le prompt.

**RGPD**
Les données audio contiennent des voix identifiables. Valider la conformité du sous-traitant Assembly AI (DPA, localisation des données) avant tout déploiement en production.

---

## Contribuer

1. Créer une branche `feature/ma-fonctionnalite` depuis `dev`
2. Développer et tester localement
3. Ouvrir une PR vers `dev`
4. Après review, merge vers `dev` puis vers `main` pour la mise en production

Conventions de commit : `feat:`, `fix:`, `chore:`, `docs:`, `test:`
