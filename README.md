
# 𝐑𝐄𝐕𝐄𝐑𝐈𝐄

> *A next‑generation music intelligence platform — blending local audio libraries, YouTube streaming, and AI‑driven seamless transitions into one dark, minimal experience.*

**Reverie** is a full‑stack music player built with **FastAPI** (Python) on the backend and **React + Vite + Tailwind CSS** on the frontend (with a secondary static‑HTML interface). It scans your local music folders, analyzes track audio features using librosa, streams audio directly from your filesystem and YouTube, and — most importantly — uses a sophisticated **AutoMix engine** to beat‑match and crossfade between tracks like a professional DJ.

---

## ✦ Core Features

| Feature | Description |
|---|---|
| **Local Library Scanner** | Recursively scan folders for MP3, FLAC, M4A, OGG, WAV files. Extracts metadata via mutagen. |
| **Audio Analysis Pipeline** | Python‑side analysis (librosa) extracts BPM, energy, chroma features, spectral centroid. Stored per‑track for similarity search. |
| **Smart Discovery Engine** | Cosine‑similarity + BPM tier ranking to recommend musically compatible tracks. Epsilon‑greedy exploration/exploitation balance. |
| **AutoMix Engine** | Real‑time client‑side beat‑matched transitions with phrase snapping, adaptive EQ wiping, tempo ramping, and reverb. **The crown jewel.** |
| **YouTube Integration** | Search YouTube, download audio via yt‑dlp, fetch real YouTube Music radio queues. |
| **StreamFlow Queue** | Analysis‑aware queue ranking — prefetches & caches audio analysis to score upcoming tracks by BPM/energy compatibility. |
| **User System** | Auth (signup/login), liked songs, listening history, playlists, language preferences. |
| **Two Frontends** | Modern React SPA (src/) with framer‑motion animations + grainy textures + dark theme. Legacy static HTML/JS interface (web/). |
| **Audio Visualizer** | Circular radial bar frequency visualizer synced to the active deck's AnalyserNode. |

---

## ✦ Project Structure

```
reverie_reboot/
├── backend/
│   ├── __init__.py
│   ├── database.py          # SQLite DB manager — users, tracks, playlists, history, settings
│   ├── analysis.py          # librosa-based BPM, energy, chroma feature extraction
│   ├── discovery.py         # Cosine-similarity + BPM-tier recommendation engine
│   ├── streamflow_queue.py  # YouTube radio fetching, scoring, prefetch, search
│   └── download_manager.py  # yt-dlp audio download with per-video async locks
│
├── frontend/
│   ├── types.ts             # Shared TS interfaces (Track, AnalysisResult, DeckState, etc.)
│   ├── automix-engine.ts    # AutoMix Engine v2.0 — AudioBufferSourceNode architecture
│   └── AutoMixEngine2.ts    # AutoMix Engine v2 — MediaElementAudioSourceNode based (dual-deck)
│
├── src/                     # [React + Vite] Modern frontend
│   ├── main.tsx             # Entry — BrowserRouter, AuthProvider, AudioProvider
│   ├── App.tsx              # Route definitions with animated page transitions
│   ├── screens/             # HomeScreen, SearchScreen, LibraryScreen, SettingsScreen, NowPlayingScreen
│   ├── components/          # AppShell, AuthModal, PlayerBar, and more
│   ├── contexts/            # AudioContext, AuthContext, SettingsContext
│   ├── lib/                 # Utilities, animations
│   └── services/            # API service layer
│
├── web/                     # [Static HTML/JS] Legacy frontend
│   ├── templates/index.html # 754-line single-page app with Tailwind CDN
│   └── static/js/
│       ├── automix.js       # AutoMix Engine (JS port, dual-deck HTMLMediaElement based)
│       ├── player.js        # Dual-deck audio player with crossfade orchestration
│       ├── app.js           # Main app logic — library, playlists, recommendations, settings
│       └── visualizer.js    # Circular radial frequency visualizer
│
├── server.py                # FastAPI app — all API routes, CORS, auth, scan, analyze
├── package.json             # Vite + React + Tailwind + framer-motion deps
├── requirements.txt         # Python deps: FastAPI, uvicorn, librosa, numpy, mutagen, scikit-learn
├── tailwind.config.js       # Custom dark theme — Syne/Figtree/JetBrains Mono, neon-accent palette
├── vite.config.ts           # Vite config with @/ alias, port 5173
├── tsconfig.json            # TypeScript strict config
├── start.ps1                # PowerShell launcher — starts both backend & frontend in background jobs
└── .env                     # Environment variables (empty, ready for secrets)
```

---

## ✦ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.13, FastAPI, Uvicorn, SQLite |
| **Audio Analysis** | librosa, numpy, scipy, scikit‑learn, mutagen |
| **YouTube** | yt‑dlp (via venv), httpx (fallback API) |
| **Frontend (React)** | React 18, TypeScript 5.6, Vite 5, Tailwind CSS 3.4, framer‑motion, lucide‑react, @dnd‑kit |
| **Frontend (Static)** | Vanilla JS (ES6 class syntax), Tailwind CDN, Web Audio API |
| **Fonts** | Syne (headlines), Figtree (body), JetBrains Mono (code/mono), Material Symbols (icons) |
| **Auth** | SHA‑256 password hashing, UUID session tokens |

---

## ✦ Quick Start

```powershell
# 1. Clone and enter directory
cd reverie_reboot

# 2. Create & activate Python virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install -r requirements.txt
npm install

# 4. Run the launcher
.\start.ps1
```

The launcher starts both:
- **Backend** → `http://127.0.0.1:8000` (FastAPI + Uvicorn)
- **Frontend** → `http://localhost:5173` (Vite dev server)

---

## ✦ API Endpoints (FastAPI)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tracks` | List all scanned tracks |
| `GET` | `/api/search?q=&source=local\|youtube` | Search local library or YouTube |
| `GET` | `/api/stream/{track_id}` | Stream audio file (supports range requests) |
| `POST` | `/api/download` | Download YouTube audio via yt‑dlp |
| `DELETE` | `/api/audio/{video_id}` | Delete cached audio file |
| `GET` | `/api/recommendations` | Get AI music recommendations |
| `POST` | `/api/scan` | Start folder scan (background thread) |
| `GET` | `/api/scan/status` | Scan progress |
| `POST` | `/api/analyze` | Start audio feature analysis (background thread) |
| `GET` | `/api/analyze/status` | Analysis progress |
| `GET` | `/api/queue/next?video_id=` | Get scored YouTube radio queue (StreamFlow) |
| `POST` | `/api/auth/signup` | Create account |
| `POST` | `/api/auth/login` | Log in |
| `GET` | `/api/auth/me` | Current user session |
| `GET/POST` | `/api/liked-songs` | Like/unlike tracks |
| `GET/POST` | `/api/history` | Listening history |
| `GET/POST` | `/api/playlists` | User playlist CRUD |
| `GET/PUT` | `/api/user/settings` | Language preferences |

---

## ✦ Configuration

The **tailwind.config.js** defines the design system:

```js
colors: {
  background: '#080808',   // near-black canvas
  surface:   '#111111',   // elevated surfaces
  surface2:  '#161616',   // deeper surfaces
  onSurface: '#F5F2EB',  // warm white text
  muted:     '#5A5A5A',  // secondary text
  accent:    '#C8F23A',  // neon chartreuse accent
  border:    '#1E1E1E',  // subtle borders
}
```

The **.env** file is ready for environment variables — extend it for YouTube API keys, database paths, etc.

---

## ✦ Documentation

| Document | Description |
|---|---|
| `repo/AUTOMIX_ENGINE.md` | **Deep dive into the AutoMix engine** — BPM detection, phrase snapping, transition tiers, EQ wiping, harmonic mixing |
| `repo/ARCHITECTURE.md` | System architecture, data flow, threading model, deployment notes |

---

```
╔══════════════════════════════════════════════════════╗
║  Made with ☕, code, and late‑night bass by HPS Labs ║
║  ─── Reverie v0.0.1 ───                              ║
╚══════════════════════════════════════════════════════╝
```

---

*Reverie is an open‑source project. Contributions, forks, and late‑night feature experiments are welcome.*
#   r e v e r i e  
 