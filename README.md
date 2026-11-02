# Reverie — HPS Labs

**Reverie is a self-hosted music player with DJ-style auto-mix transitions and YouTube streaming capabilities.**

## 🎵 Overview

Reverie is a full-featured audio application that combines local music library management with intelligent beat-matched transitions and YouTube integration. It's designed to provide an immersive listening experience by intelligently mixing tracks together using advanced audio analysis and DJ-style transitions.

Key features include:
- Local music library scanning and management
- Advanced audio analysis for tempo, energy, and harmonic compatibility
- Intelligent auto-mix transitions with 3-band dynamic EQ wiping
- YouTube Music integration with real-time radio queue generation
- Harmonic mixing using Camelot Wheel key detection
- Sample-accurate beat synchronization
- Web-based interface with modern UI/UX

## 🏗️ Architecture

### Backend (Python/Server-side)
- **Framework**: FastAPI with Uvicorn
- **Database**: SQLite (via sqlite3)
- **Audio Analysis**: librosa, scikit-learn, numpy, scipy, Pillow
- **Audio Processing**: PySide6, mutagen
- **Web Tools**: Jinja2 templates, python-multipart
- **YouTube Integration**: yt-dlp with Node.js runtime support

### Frontend (React/Client-side)
- **Framework**: React 18 with TypeScript 5.6 and Vite 5.4
- **Styling**: Tailwind CSS 3.4 with custom dark theme
- **UI Components**: lucide-react icons, @dnd-kit for drag-and-drop, Framer Motion for animations
- **Routing**: react-router-dom 6
- **Audio Engine**: Web Audio API for auto-mix transitions

## 🔧 Key Technical Features

### Audio Analysis Engine
- **Beat Detection**: Multi-window BPM detection with consensus algorithm
- **Key Detection**: Camelot Wheel mapping using Goertzel-based chroma analysis
- **Energy Analysis**: RMS-based energy calculation for dynamic EQ
- **Mix Point Detection**: Energy drop detection for optimal transition points
- **Tempo Normalization**: Standardized 70-140 BPM range matching AutoMix frontend

### Auto-Mix Engine (Web Audio API)
- **Sample-Accurate Transitions**: Uses AudioBufferSourceNode architecture for precise timing
- **3-Band Dynamic EQ Wiping**: Low/Mid/High frequency bands processed independently during transitions
- **Playback Rate Automation**: Native Web Audio API automation instead of requestAnimationFrame hacks
- **Harmonic Mixing**: Camelot Wheel key compatibility detection
- **Beat-Synced Transitions**: Synchronized with musical beats for seamless mixing

### YouTube Integration
- **Real Radio Queues**: Uses yt-dlp to fetch actual YouTube Music radio queues (RDAMVM playlist)
- **Fallback API**: Manual YTM API as backup when yt-dlp fails
- **Analysis-Aware Ranking**: Scores tracks by BPM/energy compatibility when cached analysis is available
- **Background Prefetching**: Downloads and analyzes upcoming tracks in background

## 📁 Project Structure

```
reverie/
├── backend/
│   ├── database.py          # SQLite database management with user, playlist, history tables
│   ├── discovery.py         # Recommendation engine based on audio similarity and BPM compatibility
│   ├── analysis.py          # Audio feature extraction using librosa
│   ├── streamflow_queue.py  # YouTube queue generation with analysis-aware ranking
│   └── download_manager.py  # YouTube download manager with locking for concurrency
├── src/
│   ├── components/          # React UI components
│   ├── contexts/            # React context providers (user, theme, etc.)
│   ├── lib/                 # Audio processing libraries (AutoMixEngine, AudioPlayer)
│   ├── screens/             # Main application screens
│   ├── services/            # API service layer
│   └── utils/               # Utility functions
├── server.py                # FastAPI server with all endpoints
└── package.json             # Frontend dependencies and scripts
```

## 🚀 Features

### Local Music Library Management
- Folder scanning with metadata extraction (MP3, FLAC, M4A, OGG, WAV)
- Track analysis for tempo, energy, and chroma features
- Play counting and skip tracking
- Local music library organization

### AutoMix Transitions
- Beat-synced crossfades with 3-band dynamic EQ wiping via Web Audio API
- Sample-accurate timing using AudioBufferSourceNode architecture
- Harmonic mixing using Camelot Wheel key detection
- Tempo normalization to 70-140 BPM range
- Intelligent transition planning based on audio analysis

### YouTube Integration
- YouTube Music radio queue generation via yt-dlp
- Playlist and video extraction with thumbnail support
- Background prefetching of audio for analysis
- Real-time queue ranking by compatibility scores

### User System
- Authentication (email/password)
- Playlists and liked songs management
- Listening history tracking
- User settings with language preferences

### Recommendations
- Content-based filtering using audio features
- Exploration/exploitation balance with epsilon-greedy algorithm
- Similarity-based track recommendations
- History-aware suggestion generation

## 🛠️ Development Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Run backend server:
```bash
python server.py
```

## 📊 Audio Processing Pipeline

### Backend Analysis
1. **Feature Extraction**: 13-dimensional feature vector (12 chroma + spectral centroid) + BPM = 14 dimensions for similarity search
2. **BPM Normalization**: 60-200 BPM range normalized to 70-140 range matching AutoMix frontend
3. **Similarity Matching**: Cosine similarity with BPM compatibility filtering

### Frontend Analysis
1. **Multi-window BPM Detection**: 4 different window sizes for consensus algorithm
2. **Key Detection**: Camelot Wheel mapping using Goertzel-based chroma analysis
3. **Energy Drop Detection**: Identifies optimal mix points in tracks
4. **Safe Offset Detection**: Avoids silence and low-energy sections

## 🔧 Configuration

The application uses SQLite for data persistence and supports:
- Multiple scanned music folders
- User accounts with authentication
- Playlist management
- Listening history tracking
- Language preferences

## 🎯 Technical Highlights

### Audio Analysis Architecture
- **Multi-window BPM Detection**: 4 different time windows to ensure BPM accuracy
- **Consensus Algorithm**: Filters out outliers and calculates median BPM
- **Key Detection**: Uses Goertzel algorithm for efficient chroma vector calculation
- **Energy Analysis**: RMS-based energy calculation for dynamic EQ decisions

### AutoMix Engine Architecture
- **Sample-Accurate Timing**: AudioBufferSourceNode architecture ensures precise timing
- **3-Band EQ Wiping**: Low/Mid/High frequency bands processed independently during transitions
- **Playback Rate Automation**: Native Web Audio API automation instead of JavaScript hacks
- **Beat-Synced Transitions**: Synchronized with musical beats for seamless mixing

### YouTube Integration Architecture
- **yt-dlp Integration**: Uses yt-dlp with Node.js runtime support
- **Analysis-Aware Ranking**: Scores tracks by compatibility when cached analysis is available
- **Background Prefetching**: Downloads and analyzes upcoming tracks in background
- **Fallback Mechanisms**: Manual YTM API as backup when yt-dlp fails

## 📚 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user info

### Music Library
- `GET /api/tracks` - Get all tracks in library
- `GET /api/search` - Search tracks by query
- `GET /api/stream/{track_id}` - Stream a track
- `POST /api/scan` - Scan music folders for new tracks
- `POST /api/analyze` - Analyze tracks for audio features

### User Data
- `GET /api/liked-songs` - Get liked songs
- `POST /api/liked-songs` - Add song to liked list
- `DELETE /api/liked-songs/{track_id}` - Remove song from liked list
- `GET /api/history` - Get listening history
- `POST /api/history` - Add entry to history
- `GET /api/user/settings` - Get user settings
- `PUT /api/user/settings` - Update user settings

### Playlists
- `GET /api/playlists` - Get all playlists
- `POST /api/playlists` - Create new playlist
- `DELETE /api/playlists/{playlist_id}` - Delete playlist
- `GET /api/playlists/{playlist_id}/tracks` - Get tracks in playlist
- `POST /api/playlists/{playlist_id}/tracks` - Add track to playlist
- `DELETE /api/playlists/{playlist_id}/tracks/{track_id}` - Remove track from playlist

### YouTube Integration
- `POST /api/download` - Download YouTube audio
- `POST /api/youtube/extract` - Extract playlist or video info from URL
- `POST /api/youtube/playlist/import` - Import YouTube playlist to local library
- `GET /api/queue/next` - Get next queue of tracks for AutoMix
- `GET /api/search` - Search YouTube videos

## 🎨 UI Components

### Core Screens
- Home Screen: Main dashboard with recommendations and recently played
- Library Screen: Browse local music library
- Now Playing Screen: Audio playback controls with visualizer
- Queue Screen: View and manage AutoMix queue
- Search Screen: Search local library and YouTube
- Settings Screen: User preferences and system settings

### UI Features
- Dark theme with custom Tailwind CSS styling
- Responsive design for desktop usage
- Animated transitions using Framer Motion
- Drag-and-drop playlist management
- Context menus for track actions
- Progress indicators and visual feedback

## 🧠 Intelligent Recommendations

The recommendation engine uses a hybrid approach:
1. **Similarity-based (Exploitation)**: Uses cosine similarity with BPM compatibility filtering
2. **Exploration**: Fallback to weighted random selection when no history exists
3. **Epsilon-Greedy Algorithm**: Balances between exploring new tracks and playing familiar ones

## 🔒 Security Considerations

- Passwords are hashed using SHA-256
- Session management with UUID tokens
- Database schema designed to prevent injection attacks
- Input validation for all API endpoints

## 🚨 Known Limitations

1. Windows-specific Node.js path handling in yt-dlp integration
2. Limited fallback options when yt-dlp fails
3. Audio analysis performance on very large libraries
4. Browser-based audio processing limitations

## 📈 Performance Optimization

- Caching of analysis results for frequently accessed tracks
- Background processing for library scanning and analysis
- Efficient database queries with proper indexing
- Lazy loading of UI components for better startup performance

## 🧪 Testing

The application includes:
- Unit tests for audio analysis algorithms
- Integration tests for API endpoints
- End-to-end tests for frontend components
- Performance benchmarks for audio processing

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## 📄 License

MIT License - see LICENSE file for details.

---

*Reverie — HPS Labs | Self-hosted music player with intelligent auto-mixing*