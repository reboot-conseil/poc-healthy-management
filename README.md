# 🎙️ Workathon — Captation, Transcription & Facilitation IA

Système de captation audio, transcription, diarisation et analyse des échanges lors de workathons. Pendant la séance, un facilitateur IA (Gemini Live) accompagne les participants en temps réel : il entend les échanges, suit le déroulé du script étape par étape et répond vocalement quand on lui parle directement. En fin de séance, le pipeline analyse la transcription pour générer un rapport structuré (intentions, sentiments, axes d'amélioration).

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
- [Facilitation IA en direct](#facilitation-ia-en-direct)
- [Base de données](#base-de-données)
- [Points de vigilance](#points-de-vigilance)

---

## Fonctionnalités

- **Captation audio** — enregistrement depuis un micro groupe directement dans le navigateur
- **Facilitation IA en direct** — Gemini Live entend les participants, suit les étapes du script et répond vocalement quand interpellé
- **Script de workathon** — séquence d'étapes chronométrées lue à voix haute (TTS) avec navigation manuelle et transition automatique
- **Gestion des scripts** — création, modification et suppression de scripts personnalisés via une interface dédiée
- **Transcription** — conversion speech-to-text via Assembly AI sur le fichier audio complet
- **Diarisation** — identification et attribution des prises de parole par locuteur
- **Analyse LLM** — détection des intentions, sentiments et problèmes de communication par prise de parole, avec contexte cumulé
- **Rapport final** — synthèse structurée avec axes d'amélioration, générée en fin de séance

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Navigateur                            │
│                                                              │
│  Micro groupe → Web Audio API → MediaRecorder (WebM/Opus)    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Script workathon (useWorkathonScript)               │    │
│  │   ├─ Étapes chronométrées + TTS (lecture voix haute) │    │
│  │   └─ Mise à jour du contexte Gemini à chaque étape   │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Facilitation IA (useGeminiLive)                     │    │
│  │   ├─ WebSocket /api/tts/live                         │    │
│  │   ├─ PCM 16 kHz → Gemini Live (Vertex AI)            │    │
│  │   └─ Réponses audio 24 kHz ← Gemini                  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [fin de séance] → fichier audio complet → HTTP POST         │
└────────────┬─────────────────────────┬───────────────────────┘
             │ audio complet            │ WebSocket PCM (live)
┌────────────▼──────────────┐  ┌───────▼──────────────────────┐
│    Backend (FastAPI)      │  │  Backend (FastAPI)           │
│                           │  │                              │
│  Étape 1 — Assembly AI    │  │  /api/tts/live               │
│    STT + Diarisation       │  │   relay WebSocket ↔          │
│    → [SPEAKER_X] HH:MM "…" │  │   Gemini Live (Vertex AI)    │
│                           │  │                              │
│  Étape 2 — LangGraph      │  │  /api/tts/ws                 │
│    analyse séquentielle    │  │   TTS one-shot               │
│    intention · sentiment   │  └──────────────────────────────┘
│    problèmes de comm.      │
│                           │
│  Rapport → PostgreSQL     │
└────────────┬──────────────┘
             │
┌────────────▼──────────────┐
│    PostgreSQL (Railway)   │
│  sessions · utterances    │
│  reports · scripts        │
└───────────────────────────┘
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React 18 + TypeScript |
| Backend | Python 3.12 + FastAPI |
| Facilitation IA temps réel | Gemini Live 2.5 Flash Native Audio (Vertex AI) |
| Pipeline IA post-séance | LangChain + LangGraph + Gemini 2.5 Flash |
| Transcription & Diarisation | Assembly AI API |
| Base de données | PostgreSQL |
| Hébergement frontend | Vercel |
| Hébergement backend | Railway |
| CI/CD | GitHub Actions |

---

## Prérequis

- Python 3.11+
- Node.js 18+
- [Docker](https://www.docker.com/) + Docker Compose (pour PostgreSQL en local)
- Un compte [Assembly AI](https://www.assemblyai.com/)
- Un projet [Google Cloud](https://console.cloud.google.com/) avec l'API Vertex AI activée

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

### Frontend

```bash
cd frontend
npm install
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

### Backend — `backend/.env`

Copier `.env.example` en `.env` dans `backend/` et renseigner les valeurs :

```bash
cp backend/.env.example backend/.env
```

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

# Google Cloud — Vertex AI (LangGraph + Gemini Live)
# Authentification locale : gcloud auth application-default login
# Production : variable GOOGLE_APPLICATION_CREDENTIALS pointant vers un JSON de compte de service
GOOGLE_CLOUD_PROJECT=your_gcp_project_id
GOOGLE_CLOUD_LOCATION=us-central1

# Modèle Gemini pour l'analyse post-séance (LangGraph)
GEMINI_MODEL=gemini-2.5-flash

# Nombre de prises de parole analysées par appel LLM
ANALYSIS_BATCH_SIZE=10
```

### Frontend — `frontend/.env`

```bash
cp frontend/.env.example frontend/.env
```

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

# 3. Démarrer le frontend
cd frontend
npm run dev
```

- Frontend : `http://localhost:5173`
- API : `http://localhost:8000`
- Documentation OpenAPI interactive : `http://localhost:8000/docs`

### Authentification Google Cloud en local

La facilitation Gemini Live et l'analyse LangGraph utilisent les Application Default Credentials (ADC) :

```bash
gcloud auth application-default login
```

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
DATABASE_URL=postgresql+asyncpg://...
ALLOWED_ORIGINS=https://your-app.vercel.app
UPLOAD_DIR=uploads
GOOGLE_CLOUD_PROJECT=...
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
ANALYSIS_BATCH_SIZE=10
# GOOGLE_APPLICATION_CREDENTIALS doit pointer vers le JSON du compte de service
# ou utiliser Workload Identity Federation
```

### Frontend → Vercel

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
├── backend/
│   ├── .env.example                 # Template de configuration
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── app/
│   │   ├── main.py                  # FastAPI app, lifespan, CORS
│   │   ├── config.py                # Settings (pydantic-settings, .env)
│   │   ├── api/
│   │   │   ├── sessions.py          # POST /sessions, POST /{id}/audio, GET /{id}
│   │   │   ├── reports.py           # GET /reports/{session_id}
│   │   │   ├── scripts.py           # CRUD /scripts — scripts de workathon
│   │   │   └── tts.py               # WS /api/tts/ws (TTS one-shot) + /api/tts/live (Gemini Live relay)
│   │   ├── pipeline/
│   │   │   ├── transcription.py     # Assembly AI — STT + diarisation (étape 1)
│   │   │   └── graph.py             # PipelineState + LangGraph (étape 2)
│   │   ├── models/
│   │   │   ├── session.py           # SQLAlchemy model sessions
│   │   │   ├── utterance.py         # SQLAlchemy model utterances
│   │   │   └── script.py            # SQLAlchemy model scripts
│   │   └── db/
│   │       └── database.py          # Engine async + AsyncSessionLocal
│   └── tests/
│       ├── conftest.py
│       └── test_transcription.py    # Tests unitaires transcription.py
│
├── frontend/
│   └── src/
│       ├── components/
│       ├── hooks/
│       │   ├── useAudioRecorder.ts   # Web Audio API + MediaRecorder
│       │   ├── useGeminiLive.ts      # Facilitation Gemini Live (WebSocket bidirectionnel)
│       │   └── useWorkathonScript.ts # Gestion des étapes chronométrées + TTS
│       ├── lib/
│       │   └── tts.ts               # TTS one-shot (WebSocket + fallback navigateur)
│       ├── data/
│       │   └── workathon-script.ts  # Script par défaut (6 étapes, 60 min)
│       ├── pages/
│       │   ├── SessionPage.tsx      # Orchestration session live (enregistrement + IA)
│       │   ├── ReportPage.tsx       # Affichage rapport final
│       │   └── ScriptsPage.tsx      # CRUD scripts de workathon
│       └── api/
│           └── client.ts            # HTTP client vers le backend
│
├── .github/
│   └── workflows/
│       ├── frontend.yml             # Deploy Vercel
│       └── backend.yml              # Deploy Railway
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

### Étape 2 — Analyse LLM séquentielle (LangGraph) ✅

Chaque prise de parole est analysée séquentiellement. Le LLM reçoit pour chaque étape N :
- Le texte de la prise de parole N
- Un résumé cumulé des étapes 1 à N-1 (résumé glissant au-delà de 20 prises de parole)

Le `StateGraph` LangGraph orchestre les nœuds :

```
transcribe_node → analyze_node → update_context_node → [loop] → report_node
```

### Rapport final ✅

Le rapport agrège les deux couches :
- **Transcription structurée** : qui a dit quoi et quand
- **Analyse LLM** : intention, sentiment et problèmes détectés par prise de parole
- **Synthèse globale** : axes d'amélioration issus de l'ensemble de la séance

---

## Facilitation IA en direct

Pendant l'enregistrement, un assistant IA (Gemini Live via Vertex AI) accompagne la séance en temps réel.

### Protocole WebSocket

Deux endpoints WebSocket sont exposés par `backend/app/api/tts.py` :

#### `/api/tts/ws` — TTS one-shot

Utilisé pour lire à voix haute la description de chaque étape du script au démarrage.

```
Client → Serveur :  {"text": "..."}
Serveur → Client :  {"type": "audio", "data": "<base64 PCM 24kHz>"}  (N fois)
                    {"type": "done"}
```

#### `/api/tts/live` — Session Gemini Live persistante

Ouverte pour toute la durée de l'enregistrement. Gemini entend les participants et répond quand on lui parle directement.

```
Client → Serveur :  {"type": "audio",   "data": "<base64 PCM 16kHz>"}   (continu)
                    {"type": "context",  "message": "CONTEXTE: Étape 2/6 — Idéation (15min): ..."}
Serveur → Client :  {"type": "audio",   "data": "<base64 PCM 24kHz>"}   (réponse IA)
                    {"type": "turn_complete"}
```

**Formats audio :**
- Entrée (micro → Gemini) : PCM signé 16 bits, mono, 16 000 Hz
- Sortie (Gemini → navigateur) : PCM signé 16 bits, mono, 24 000 Hz

### Script de workathon

Le script par défaut (`workathon-script.ts`) définit 6 étapes pour une séance de 60 minutes :

| # | Étape | Durée |
|---|---|---|
| 1 | Cadrage | 5 min |
| 2 | Tour de table | 5 min |
| 3 | Idéation | 15 min |
| 4 | Vote et sélection | 5 min |
| 5 | Prototypage | 20 min |
| 6 | Pitch et restitution | 10 min |

À chaque changement d'étape, la description est lue à voix haute via `/api/tts/ws` et un message de contexte est envoyé silencieusement à Gemini (`CONTEXTE: ...`) pour qu'il adapte ses interventions à la phase en cours — sans répondre verbalement à ce message.

Des scripts personnalisés peuvent être créés, modifiés et supprimés depuis la page **Scripts** (`/scripts`), et sélectionnés au démarrage d'une session.

### Comportement de Gemini

- Répond en français, voix naturelle et bienveillante
- Deux à trois phrases maximum sauf si un développement est demandé
- Intègre silencieusement les messages `CONTEXTE:` pour contextualiser ses prochaines interventions
- Modèle : `gemini-live-2.5-flash-native-audio` (Vertex AI)

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

-- Scripts de workathon personnalisés
scripts (id, title, steps JSONB, created_at)
```

---

## Points de vigilance

**Durée de traitement**
Le pipeline Assembly AI + LangGraph peut prendre 1 à 3 minutes pour une séance d'une heure. L'endpoint `POST /sessions/{id}/audio` retourne immédiatement un `202 Accepted` et lance le pipeline en `BackgroundTask`. Le client poll `GET /sessions/{id}` (retourne `202` tant que `status == "processing"`, `200` quand `done` ou `error`).

**Taille des fichiers audio**
Pour des séances supérieures à une heure, le fichier audio peut dépasser 100 Mo. L'upload est streamé en chunks de 1 Mo via `aiofiles` pour éviter la saturation mémoire.

**Précision de la diarisation**
La diarisation peut confondre le même locuteur sous deux labels différents sur des prises de parole très courtes (< 2s) ou avec une intonation atypique. Passer `speakers_expected` au nombre exact de participants améliore significativement la précision. Exemple : `POST /sessions/{id}/audio?speakers_expected=5`.

**Sélection du modèle Assembly AI**
La variable `ASSEMBLYAI_SPEECH_MODELS` contrôle la priorité des modèles. Pour des séances exclusivement en français, `universal-3-pro` seul suffit et réduit la latence. Le champ `speech_model_used` est loggué après chaque transcription pour audit.

**Fenêtre de contexte LLM**
Au-delà de 20 prises de parole, le backend applique un résumé glissant : les N-10 premières étapes sont condensées, les 10 dernières restent intactes dans le prompt.

**Gemini Live — durée de session**
La session WebSocket `/api/tts/live` reste ouverte pour toute la durée de l'enregistrement (jusqu'à ~1h). En cas de déconnexion réseau, le frontend doit rouvrir la connexion — le contexte Gemini est perdu mais les réponses reprennent normalement.

**Authentification Google Cloud**
En développement, utiliser `gcloud auth application-default login`. En production, fournir un compte de service avec le rôle `Vertex AI User` via la variable `GOOGLE_APPLICATION_CREDENTIALS` (chemin vers un fichier JSON) ou Workload Identity Federation.

**RGPD**
Les données audio contiennent des voix identifiables. Valider la conformité du sous-traitant Assembly AI (DPA, localisation des données) avant tout déploiement en production. Les flux envoyés à Gemini Live transitent par Google Cloud Vertex AI — vérifier les conditions de traitement des données.

---

## Contribuer

1. Créer une branche `feature/ma-fonctionnalite` depuis `dev`
2. Développer et tester localement
3. Ouvrir une PR vers `dev`
4. Après review, merge vers `dev` puis vers `main` pour la mise en production

Conventions de commit : `feat:`, `fix:`, `chore:`, `docs:`, `test:`
