# Reverie — Field Recon

01 NAME: Reverie (also branded "Reverie — HPS Labs" in index.html). No discoverable origin for the name in code comments or files.

02 ONE-LINE: Self-hosted music player with DJ-style auto-mix transitions and YouTube streaming.

03 PROBLEM: Personal music libraries and streaming services lack intelligent, beat-matched transitions between tracks. The project provides a local player that scans folders, analyzes audio features, and auto-mixes tracks using BPM/key detection — essentially automating what a DJ does manually.

04 STACK: React 18, TypeScript 5.6, Vite 5.4, Tailwind CSS 3.4, Framer Motion 12, @dnd-kit (drag-and-drop), lucide-react, react-router-dom 6. Python 3 backend: FastAPI, Uvicorn, SQLite (via sqlite3), librosa, scikit-learn, scipy, numpy, Pillow, PySide6, mutagen, python-multipart, Jinja2. External tools: yt-dlp, Node.js (for yt-dlp JS runtime). Web Audio API for the client-side AutoMix engine. No cloud infra — runs locally on Windows.

05 MECHANICS:
- Folder scanning: walks directories, extracts MP3/FLAC/M4A/OGG/WAV metadata via mutagen, stores in SQLite.
- Audio analysis: librosa extracts tempo (BPM), energy (RMS), chroma features, spectral centroid per track. Frontend AutoMix engine runs 4-window BPM consensus, Goertzel-based Camelot key detection, and mix-point energy-drop detection in-browser.
- AutoMix transitions: classifies transitions into tiers (PERFECT/CLEAN/MODERATE/HARD/XFADE_SHORT) based on BPM delta, confidence, energy, and harmonic compatibility. Executes beat-synced crossfades with 3-band dynamic EQ wiping via Web Audio API.
- YouTube integration: yt-dlp fetches audio from YouTube/YouTube Music. Streamflow queue fetches YTM radio playlists, scores candidates by BPM/energy compatibility, prefetches and analyzes upcoming tracks in background.
- User system: email/password auth with session tokens, guest fallback. Liked songs, playlists, listening history (capped at 30 entries), user settings (language preferences).

06 HARDEST PART: The AutoMixEngine transition execution — beat-syncing two decks using Web Audio API's `AudioBufferSourceNode` with native `playbackRate` automation, 3-band EQ wipe scheduling (High→Mid→Low frequency stagger), and sample-accurate timing that must survive background tabs and screen-off throttling. The code comment says: "Uses native Web Audio API automation for sample-accurate timing." A prior version used `requestAnimationFrame` hacks which failed in background tabs; the current version uses `setInterval` polling plus a one-sample buffer trick for clock-scheduled triggers.

07 NUMBERS: BPM detection range 60–200 (normalized to 70–140). Max playbackRate stretch: 6% (0.94–1.06). Listening history cap: 30 entries per user. 4 analysis windows at 10s, 60s, 90s, 120s offsets. 13-dimensional feature vector (12 chroma + spectral centroid) + BPM = 14 dimensions for similarity search. EQ wipe: High cut at 30%, Mid at 60%, Low at 90% of transition duration. Reverb impulse: 1.5s decay. Audio context FFT size: 256. Frontend poll interval: 200ms. Search cache TTL: 15 minutes, max 30 entries.

08 STATUS/YEAR: in-dev. Version 0.0.1 in package.json. No git history visible. The `_reboot` suffix in the folder name suggests this is a rewrite of a prior version. Fonts loaded include Syne (headlines) and JetBrains Mono (mono), suggesting recent design iteration.

09 ROLE: Solo. One developer owns backend (Python/FastAPI), frontend (React/TypeScript), the AutoMix DSP engine, the audio analysis pipeline, the UI design, and the startup scripts.

10 LOOK: Dark mode by default (`<html class="dark">`). Near-black background (#080808), off-white text (#F5F2EB), acid green accent (#C8F23A). Fonts: Syne for headlines (extrabold uppercase), Figtree for body, JetBrains Mono for labels/badges. Rounded corners are minimal (0.125rem default). Glassmorphism surfaces (`backdrop-blur-xl`, `bg-surface/40`). Album art gets cinematic/warm/clean CSS filters with a grain overlay. Now-playing screen has a full-bleed blurred album art background with halo pulse animation. Material Symbols Outlined for icons.

11 HUMAN MOMENT: The guest user is hardcoded as `guest@reverie.local` with password `guest` — the author built guest mode so they could test without signing up. The `start.ps1` script detects LAN IPs, adds Windows firewall rules, and prints a box-drawing banner saying "Reverie Engine" — the author wanted to `start.bat` and see the app accessible from their phone on the same network.

12 QUOTES:
- "Uses native Web Audio API automation for sample-accurate timing."
- "Debug printing can crash the endpoint on Windows consoles with non-CP1252 characters. Keep logs safe so the frontend can still function."
- "Bug fixes applied: #7: Correct startSample offsets per window, #8: Outlier filter with median ±10, threshold 15 BPM, #9: MediaElementAudioSourceNode created ONCE per element"

13 LINKS: UNKNOWN (no README, no git remote, no live URL found in codebase).
