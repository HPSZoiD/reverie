import os
import sys
import shutil
import asyncio
import threading

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
# Ensure we can import backend modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.database import DatabaseManager
from backend.discovery import DiscoveryEngine
from backend.analysis import AudioAnalyzer
from backend.streamflow_queue import router as streamflow_router, extract_youtube_url
from backend.download_manager import download_video, download_locks, locks_mutex, AUDIO_TEMP_DIR

app = FastAPI(title="Reverie Music Player")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"status": "ok", "service": "Reverie Audio Engine"}

# Debug: Log 422 errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    try:
        body = await request.body()
        print(f"Validation Error at {request.url}. Body: {body.decode()}")
    except:
        print(f"Validation Error at {request.url}. Could not read body.")
    print(f"Errors: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(exc.body)},
    )

# Setup Paths
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

WEB_DIR = os.path.join(BASE_DIR, "web")
STATIC_DIR = os.path.join(WEB_DIR, "static")
TEMPLATES_DIR = os.path.join(WEB_DIR, "templates")

# Ensure directories exist
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(AUDIO_TEMP_DIR, exist_ok=True)

# Mount Static Files
app.mount("/audio", StaticFiles(directory=AUDIO_TEMP_DIR), name="audio")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Templates
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Backend Instances
db = DatabaseManager()
discovery = DiscoveryEngine(db)
analyzer = AudioAnalyzer()

# Include Streamflow Queue Router
app.include_router(streamflow_router, prefix="/api")

# State for background tasks
scan_status = {"running": False, "progress": 0, "total": 0}
analyze_status = {"running": False, "progress": 0, "total": 0}

# ─── Auth Helper ────────────────────────────────────────────────

def get_current_user(request: Request):
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        token = auth[7:]
        user = db.get_session(token)
        if user:
            return user
    return db.get_or_create_guest_user()

def require_user(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@app.get("/api/search")
async def search_tracks(q: str = Query(""), source: str = "local"):
    if not q:
        return []
    if source == "youtube":
        from backend.streamflow_queue import search as yt_search
        return await yt_search(q)
    tracks = db.search_tracks(q)
    return tracks

# --- YouTube Download Endpoint (for React frontend) ---

class DownloadRequest(BaseModel):
    video_id: str

@app.post("/api/download")
async def download_audio(data: DownloadRequest, request: Request):
    """Downloads YouTube audio via yt-dlp and returns a serving URL."""
    video_id = data.video_id

    try:
        output_path = await download_video(video_id)
        return {
            "success": True,
            "audio_url": f"{request.base_url}audio/{video_id}.m4a",
            "filename": f"{video_id}.m4a"
        }
    except RuntimeError as e:
        error_msg = str(e)
        print(f"[ERROR] yt-dlp failed for {video_id}: {error_msg}")
        return JSONResponse(status_code=500, content={
            "success": False,
            "error": error_msg
        })
    except Exception as e:
        print(f"[EXCEPTION] Download error for {video_id}: {str(e)}")
        return JSONResponse(status_code=500, content={
            "success": False,
            "error": str(e)
        })

# ─── YouTube URL / Playlist Endpoints ─────────────────────────

class YouTubeExtractRequest(BaseModel):
    url: str

@app.post("/api/youtube/extract")
async def extract_yt(data: YouTubeExtractRequest):
    """Extracts tracks / playlist info from any YouTube or YouTube Music URL via yt-dlp."""
    try:
        res = await extract_youtube_url(data.url)
        return res
    except Exception as e:
        print(f"[YouTube Extract Error] {e}")
        return JSONResponse(status_code=400, content={"error": str(e)})

class YouTubePlaylistImportRequest(BaseModel):
    name: str
    tracks: list[dict]

@app.post("/api/youtube/playlist/import")
async def import_yt_playlist(data: YouTubePlaylistImportRequest, request: Request):
    """Creates a new playlist and saves all extracted YouTube tracks in one atomic database operation."""
    user = require_user(request)
    if not data.tracks:
        return JSONResponse(status_code=400, content={"error": "No tracks provided"})
    pl = db.create_playlist_with_tracks(user["id"], data.name, data.tracks)
    if not pl:
        return JSONResponse(status_code=500, content={"error": "Failed to create playlist"})
    return pl


# ─── Auth Endpoints ─────────────────────────────────────────────

class AuthRequest(BaseModel):
    email: str
    password: str

@app.post("/api/auth/signup")
async def auth_signup(data: AuthRequest):
    user = db.create_user(data.email, data.password)
    if not user:
        return JSONResponse(status_code=409, content={"error": "Email already registered"})
    token = db.create_session(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"]}}

@app.post("/api/auth/login")
async def auth_login(data: AuthRequest):
    user = db.get_user_by_email(data.email)
    if not user or not db.verify_password(data.password, user["password_hash"]):
        return JSONResponse(status_code=401, content={"error": "Invalid email or password"})
    token = db.create_session(user["id"])
    return {"token": token, "user": {"id": user["id"], "email": user["email"]}}

@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    user = get_current_user(request)
    if user:
        auth = request.headers.get('Authorization', '')
        token = auth[7:]
        db.delete_session(token)
    return {"success": True}

@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = get_current_user(request)
    return {"user": user}

# ─── Liked Songs ────────────────────────────────────────────────

@app.get("/api/liked-songs")
async def get_liked_songs(request: Request):
    user = require_user(request)
    return db.get_liked_songs(user["id"])

class LikedSongRequest(BaseModel):
    track_id: str
    metadata: dict

@app.post("/api/liked-songs")
async def add_liked_song(data: LikedSongRequest, request: Request):
    user = require_user(request)
    db.add_liked_song(user["id"], data.track_id, data.metadata)
    return {"success": True}

@app.delete("/api/liked-songs/{track_id}")
async def remove_liked_song(track_id: str, request: Request):
    user = require_user(request)
    db.remove_liked_song(user["id"], track_id)
    return {"success": True}

# ─── User Settings ──────────────────────────────────────────────

class SettingsRequest(BaseModel):
    languages: list[str]

@app.get("/api/user/settings")
async def get_user_settings(request: Request):
    user = require_user(request)
    return db.get_user_settings(user["id"])

@app.put("/api/user/settings")
async def update_user_settings(data: SettingsRequest, request: Request):
    user = require_user(request)
    db.update_user_settings(user["id"], data.languages)
    return {"success": True}

@app.delete("/api/audio/{video_id}")
async def delete_audio(video_id: str):
    """Deletes a cached audio file from the temporary directory."""
    try:
        path = os.path.join(AUDIO_TEMP_DIR, f"{video_id}.m4a")
        if os.path.exists(path):
            os.remove(path)
            return {"success": True, "message": f"Deleted {video_id}"}
        return {"success": True, "message": "File not found, nothing to delete"}
    except Exception as e:
        print(f"Error deleting {video_id}: {e}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/")
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/api/tracks")
async def get_tracks():
    tracks = db.get_all_tracks()
    return tracks

@app.get("/api/search")
async def search_tracks(q: str = Query(""), source: str = "local"):
    if not q:
        return []
    if source == "youtube":
        from backend.streamflow_queue import search as yt_search
        return await yt_search(q)
    tracks = db.search_tracks(q)
    return tracks

@app.get("/api/stream/{track_id}")
async def stream_track(track_id: int):
    track = db.get_track_by_id(track_id)
    if not track:
        return JSONResponse(status_code=404, content={"message": "Track not found"})
    
    file_path = track['file_path']
    if not os.path.exists(file_path):
        return JSONResponse(status_code=404, content={"message": "File not found on disk"})
    
    # FileResponse supports range requests for seeking
    from fastapi.responses import FileResponse
    return FileResponse(file_path, media_type="audio/mpeg")

# ─── Listening History ──────────────────────────────────────────

class HistoryEntry(BaseModel):
    track_id: str
    metadata: dict

@app.get("/api/history")
async def get_history(request: Request):
    user = require_user(request)
    return db.get_listening_history(user["id"], limit=30)

@app.post("/api/history")
async def add_history(data: HistoryEntry, request: Request):
    user = require_user(request)
    db.add_history_entry(user["id"], data.track_id, data.metadata)
    return {"success": True}

# ─── Playlists ──────────────────────────────────────────────────

class PlaylistCreate(BaseModel):
    name: str

@app.get("/api/playlists")
async def get_playlists(request: Request):
    user = require_user(request)
    return db.get_playlists(user["id"])

@app.post("/api/playlists")
async def create_playlist(data: PlaylistCreate, request: Request):
    user = require_user(request)
    pl = db.create_playlist(user["id"], data.name)
    if not pl:
        return JSONResponse(status_code=500, content={"error": "Failed to create playlist"})
    return pl

@app.delete("/api/playlists/{playlist_id}")
async def delete_playlist(playlist_id: int, request: Request):
    user = require_user(request)
    success = db.delete_playlist(user["id"], playlist_id)
    return {"success": success}

@app.get("/api/playlists/{playlist_id}/tracks")
async def get_playlist_tracks(playlist_id: int):
    return db.get_playlist_tracks(playlist_id)

class PlaylistTrackRequest(BaseModel):
    track_id: str
    metadata: dict

@app.post("/api/playlists/{playlist_id}/tracks")
async def add_playlist_track(playlist_id: int, data: PlaylistTrackRequest, request: Request):
    user = require_user(request)
    success = db.add_track_to_playlist(playlist_id, data.track_id, data.metadata)
    return {"success": success}

@app.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
async def remove_playlist_track(playlist_id: int, track_id: str, request: Request):
    user = require_user(request)
    success = db.remove_track_from_playlist(playlist_id, track_id)
    return {"success": success}

@app.get("/api/recommendations")
async def get_recommendations(limit: int = 20, epsilon: float = 0.3, user_id: str = Query(None)):
    recs = discovery.generate_recommendations(limit, epsilon, user_id=user_id)
    # Ensure source is specified for frontend logic (Bug fix)
    for r in recs:
        if 'source' not in r:
            r['source'] = 'local'
    return recs

@app.post("/api/library/clear")
async def clear_library():
    """Clear all scanned tracks and analysis data from database (not files)"""
    success = db.clear_all_data()
    return {"success": success}

# --- Scanned Folders Management ---

@app.get("/api/folders")
async def get_folders():
    """Get all registered scan folder paths"""
    return db.get_folders()

class FolderAdd(BaseModel):
    path: str

@app.post("/api/folders")
async def add_folder(data: FolderAdd):
    """Add a new folder path to scan"""
    folder_id = db.add_folder(data.path)
    if folder_id:
        return {"success": True, "id": folder_id}
    return {"success": False, "message": "Folder already exists"}

@app.delete("/api/folders/{folder_id}")
async def remove_folder(folder_id: int):
    """Remove a folder from the scan list"""
    success = db.remove_folder(folder_id)
    return {"success": success}

class ScanRequest(BaseModel):
    path: str

@app.post("/api/scan")
async def start_scan(data: ScanRequest):
    global scan_status
    if scan_status["running"]:
        return {"status": "already_running"}
    
    def run_scan():
        global scan_status
        scan_status = {"running": True, "progress": 0, "total": 0}
        
        import mutagen
        from mutagen.easyid3 import EasyID3
        from mutagen.flac import FLAC
        
        SUPPORTED = ('.mp3', '.flac', '.m4a', '.ogg', '.wav')
        
        files_to_scan = []
        for root, dirs, files in os.walk(data.path):
            for file in files:
                if file.lower().endswith(SUPPORTED):
                    files_to_scan.append(os.path.join(root, file))
        
        scan_status["total"] = len(files_to_scan)
        
        for i, file_path in enumerate(files_to_scan):
            try:
                title = os.path.splitext(os.path.basename(file_path))[0]
                artist = "Unknown Artist"
                album = "Unknown Album"
                duration = 0
                
                try:
                    if file_path.lower().endswith('.mp3'):
                        audio = EasyID3(file_path)
                        title = audio.get('title', [title])[0]
                        artist = audio.get('artist', [artist])[0]
                        album = audio.get('album', [album])[0]
                        duration = int(mutagen.File(file_path).info.length)
                    elif file_path.lower().endswith('.flac'):
                        audio = FLAC(file_path)
                        title = audio.get('title', [title])[0]
                        artist = audio.get('artist', [artist])[0]
                        album = audio.get('album', [album])[0]
                        duration = int(audio.info.length)
                except Exception:
                    pass
                
                metadata = {
                    'title': title,
                    'artist': artist,
                    'album': album,
                    'genre': 'Unknown',
                    'duration': duration
                }
                db.add_track(file_path, metadata)
            except Exception as e:
                print(f"Error scanning {file_path}: {e}")
            
            scan_status["progress"] = i + 1
        
        scan_status["running"] = False
    
    thread = threading.Thread(target=run_scan)
    thread.start()
    return {"status": "started"}

@app.get("/api/scan/status")
async def get_scan_status():
    return scan_status

@app.post("/api/analyze")
async def start_analysis():
    global analyze_status
    if analyze_status["running"]:
        return {"status": "already_running"}
    
    def run_analysis():
        global analyze_status
        import json
        
        tracks = db.get_tracks_needing_analysis()
        analyze_status = {"running": True, "progress": 0, "total": len(tracks)}
        
        for i, track in enumerate(tracks):
            try:
                features = analyzer.analyze_track(track['file_path'])
                if features:
                    db.update_track_features(
                        track['id'],
                        features.get('tempo', 0),
                        features.get('energy', 0),
                        json.dumps(features.get('features_vector', []))
                    )
            except Exception as e:
                print(f"Error analyzing track {track['id']}: {e}")
            
            analyze_status["progress"] = i + 1
        
        analyze_status["running"] = False
    
    thread = threading.Thread(target=run_analysis)
    thread.start()
    return {"status": "started"}

@app.get("/api/analyze/status")
async def get_analyze_status():
    return analyze_status

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
