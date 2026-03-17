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
| Backend | Python 3.12 + FastAPI |
| Pipeline IA | LangChain + LangGraph |
| Transcription & Diarisation | Assembly AI API |
| Base de données | PostgreSQL |
| Hébergement frontend | Vercel |
| Hébergement backend | Railway |
| CI/CD | GitHub Actions |

---

## Prérequis

- Python 3.11+
- [Docker](https://www.docker.com/) + Docker Compose (pour PostgreSQL en local)
- Un compte [Assembly AI](https://www.assemblyai.com/)
- Un compte [OpenAI](https://platform.openai.com/) ou [Anthropic](https://www.anthropic.com/) (pour la phase LangGraph — étape 2)

> Node.js 18+ requis uniquement pour le frontend (non encore implémenté dans ce POC).

---

## Installation

### Cloner le repo

```bash
git clone git@github.com:reboot-conseil/poc-healthy-management-.git
cd poc-healthy-management
```

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows : venv\Scripts\activate
pip install -r requirements.txt
```

### Base de données (Docker)

PostgreSQL tourne dans un conteneur Docker — aucune installation système requise.

```bash
# Depuis la racine du projet
docker compose up -d db
```

Le conteneur expose PostgreSQL sur `localhost:5432` avec les identifiants du `.env`. Les tables sont créées automatiquement au premier démarrage du backend.

---

## Configuration

Copier `.env.example` en `.env` dans `backend/` et renseigner les valeurs :

```bash
cp backend/.env.example backend/.env
```

### Variables backend — `backend/.env`

```env
# AssemblyAI — https://www.assemblyai.com/dashboard
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here

# Modèles STT par ordre de priorité (Universal-3 Pro pour FR/EN/ES/PT/DE/IT,
# Universal-2 en fallback pour les 99 autres langues)
ASSEMBLYAI_SPEECH_MODELS=universal-3-pro,universal-2

# PostgreSQL async (asyncpg driver)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/workathon

# CORS — origines autorisées (séparées par virgule)
ALLOWED_ORIGINS=http://localhost:5173

# Dossier de stockage des fichiers audio uploadés
UPLOAD_DIR=uploads
```

### Frontend — `.env.local` (non implémenté)

```env
VITE_API_URL=http://localhost:8000
```

---

## Lancement en développement

```bash
# 1. Démarrer PostgreSQL
docker compose up -d db

# 2. Démarrer le backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

- API : `http://localhost:8000`
- Documentation OpenAPI interactive : `http://localhost:8000/docs`

---

## Tests

### Tests unitaires backend

```bash
cd backend
pytest tests/ -v
```

Les tests couvrent `transcription.py` : chemin nominal, statut d'erreur, utterances vides, garde durée < 2s, normalisation des labels locuteurs, conversion millisecondes → secondes. Tous les appels AssemblyAI et filesystem sont mockés.

### Test d'intégration avec un vrai fichier audio

Un script de test est fourni à la racine du projet :

```bash
# Depuis la racine — utilise kick-off.mp3 automatiquement s'il est présent
./test_upload.sh

# Passer un fichier explicitement
./test_upload.sh /chemin/vers/audio.mp3

# Avec le nombre de participants connu (améliore la diarisation)
./test_upload.sh /chemin/vers/audio.mp3 5
```

Le script :
1. Crée une session via `POST /sessions`
2. Upload le fichier via `POST /sessions/{id}/audio`
3. Poll le statut toutes les 10 secondes jusqu'à `done` ou `error`
4. Écrit deux fichiers dans `results/` :
   - `results/<nom>_<session_id>.txt` — transcription lisible ligne par ligne
   - `results/<nom>_<session_id>.json` — tableau JSON complet (entrée pour la phase LangGraph)

### Lint & typage

```bash
cd backend
ruff check .
mypy app/
```

---

## Déploiement

### Backend → Railway

Le déploiement est automatique via GitHub Actions sur push vers `main`.

Configurer les variables d'environnement dans le dashboard Railway :
```
ASSEMBLYAI_API_KEY=...
ASSEMBLYAI_SPEECH_MODELS=universal-3-pro,universal-2
OPENAI_API_KEY=...
DATABASE_URL=postgresql+asyncpg://...
ALLOWED_ORIGINS=https://your-app.vercel.app
UPLOAD_DIR=uploads
```

### Frontend → Vercel (non implémenté)

Le déploiement sera automatique via GitHub Actions :
- Push sur `main` → déploiement en production
- Push sur `dev` ou PR vers `main` → déploiement en preview

Variables d'environnement à configurer dans le dashboard Vercel :
```
VITE_API_URL=https://your-backend.railway.app
```

---

## Structure du projet

```
/
├── docker-compose.yml               # PostgreSQL en développement local
├── test_upload.sh                   # Script de test end-to-end (upload + poll + export)
├── results/                         # Transcriptions exportées (.txt et .json)
│
├── backend/                         # ✅ Implémenté
│   ├── .env.example                 # Template de configuration
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py                  # FastAPI app, lifespan, CORS
│   │   ├── config.py                # Settings (pydantic-settings, .env)
│   │   ├── api/
│   │   │   └── sessions.py          # POST /sessions, POST /{id}/audio, GET /{id}
│   │   ├── pipeline/
│   │   │   ├── transcription.py     # Assembly AI — STT + diarisation (étape 1)
│   │   │   └── graph.py             # PipelineState + transcribe_node (LangGraph)
│   │   ├── models/
│   │   │   ├── session.py           # SQLAlchemy model sessions
│   │   │   └── utterance.py         # SQLAlchemy model utterances
│   │   └── db/
│   │       └── database.py          # Engine async + AsyncSessionLocal
│   └── tests/
│       ├── conftest.py
│       └── test_transcription.py    # Tests unitaires transcription.py
│
├── frontend/                        # 🔜 Non implémenté
│   └── src/
│       ├── components/
│       │   ├── Recorder.tsx
│       │   ├── SessionView.tsx
│       │   └── ReportView.tsx
│       ├── hooks/
│       │   └── useAudioRecorder.ts
│       └── api/
│           └── client.ts
│
├── .github/
│   └── workflows/                   # 🔜 Non implémenté
│       ├── frontend.yml
│       └── backend.yml
│
├── CLAUDE.md
├── AGENTS.md
└── README.md
```

---

## Pipeline de traitement

### Étape 1 — Transcription globale (Assembly AI) ✅

Le fichier audio complet est envoyé à Assembly AI via `transcription.py` avec la configuration suivante :

| Paramètre | Valeur | Raison |
|---|---|---|
| `speech_models` | `["universal-3-pro", "universal-2"]` | U3 Pro pour FR/EN/ES/PT/DE/IT, fallback Universal-2 pour les autres langues |
| `speaker_labels` | `True` | Diarisation obligatoire |
| `language_detection` | `True` | Plus robuste que `language_code="fr"` pour les séances mixtes |
| `speakers_expected` | optionnel | Contraint le modèle au nombre exact de participants — réduit les erreurs d'attribution |

Résultat retourné par `transcribe_audio()` :

```json
[
  { "speaker": "A", "start": 4.2,  "end": 8.1,  "text": "Bonjour à tous…" },
  { "speaker": "B", "start": 9.0,  "end": 14.3, "text": "Merci, donc le sujet…" },
  { "speaker": "A", "start": 15.1, "end": 21.7, "text": "Je pense que…" }
]
```

Les timestamps AssemblyAI (en millisecondes) sont convertis en secondes. Les labels `SPEAKER_A` sont normalisés en `A`.

> L'envoi du fichier **complet** (et non chunk par chunk) est intentionnel : la diarisation est un problème global — le modèle construit l'empreinte vocale de chaque locuteur sur l'ensemble de la séance. Fragmenter le fichier dégrade significativement la précision.

Le `transcribe_node` LangGraph encapsule cet appel et met à jour le `PipelineState` immuable :

```python
def transcribe_node(state: PipelineState) -> PipelineState:
    utterances = transcribe_audio(state["audio_path"], state.get("speakers_expected"))
    return {**state, "utterances": utterances, "current_index": 0}
```

### Étape 2 — Analyse LLM séquentielle (LangGraph) 🔜

Chaque prise de parole est analysée séquentiellement. Le LLM reçoit pour chaque étape N :
- Le texte de la prise de parole N
- Un résumé cumulé des étapes 1 à N-1 (résumé glissant au-delà de 20 prises de parole)

Le `StateGraph` LangGraph orchestrera les nœuds suivants :

```
transcribe_node → analyze_node → update_context_node → [loop] → report_node
```

### Rapport final 🔜

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
Le pipeline Assembly AI + LangGraph peut prendre 1 à 3 minutes pour une séance d'une heure. L'endpoint `POST /sessions/{id}/audio` retourne immédiatement un `202 Accepted` et lance le pipeline en `BackgroundTask`. Le client poll `GET /sessions/{id}` (retourne `202` tant que `status == "processing"`, `200` quand `done` ou `error`).

**Taille des fichiers audio**
Pour des séances supérieures à une heure, le fichier audio peut dépasser 100 Mo. L'upload est streamé en chunks de 1 Mo via `aiofiles` pour éviter la saturation mémoire. Le frontend devra utiliser IndexedDB pour l'accumulation des chunks au-delà de 30 minutes.

**Précision de la diarisation**
La diarisation peut confondre le même locuteur sous deux labels différents sur des prises de parole très courtes (< 2s) ou avec une intonation atypique (questions, fins de phrase). Passer `speakers_expected` au nombre exact de participants améliore significativement la précision en contraignant le modèle. Exemple : `POST /sessions/{id}/audio?speakers_expected=5`.

**Sélection du modèle Assembly AI**
La variable `ASSEMBLYAI_SPEECH_MODELS` contrôle la priorité des modèles. Pour des séances exclusivement en français, `universal-3-pro` seul suffit et réduit la latence. Le champ `speech_model_used` est loggué après chaque transcription pour audit.

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
