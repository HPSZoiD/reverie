import os
import asyncio
import json
import random
from typing import List, Dict, Optional
from fastapi import APIRouter, Query, BackgroundTasks
from backend.analysis import AudioAnalyzer
from backend.download_manager import download_video, AUDIO_TEMP_DIR, YTDLP_PATH

router = APIRouter()
analyzer = AudioAnalyzer()

# In-memory analysis cache: video_id -> {bpm, energy, features_vector}
# Populated by prefetch_audio background tasks
analysis_cache: Dict[str, dict] = {}

async def run_command(command: List[str]) -> str:
    """Helper to run shell commands asynchronously using a separate thread for Windows compatibility."""
    import subprocess
    def _run():
        return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    
    result = await asyncio.to_thread(_run)
    
    if result.returncode != 0:
        error = result.stderr.strip() if result.stderr else "No stderr"
        print(f"Command failed (RC={result.returncode}): {' '.join(command)}")
        print(f"Stderr: {error}")
        raise Exception(f"Exit {result.returncode}: {error}")
    return result.stdout


# ─── YT-DLP RADIO (primary) ─────────────────────────────────

async def get_youtube_music_radio(video_id: str, limit: int = 20) -> List[Dict]:
    """Fetches the real YouTube Music radio queue using yt-dlp.
    
    Uses the RDAMVM playlist (YouTube Music radio mix seeded by a specific video).
    This returns the same tracks and order you see in the YTM app's 'Up Next'.
    """
    radio_url = f"https://music.youtube.com/watch?v={video_id}&list=RDAMVM{video_id}"
    command = [
        YTDLP_PATH,
        radio_url,
        "--flat-playlist",
        "--dump-json",
        "--no-download",
        "--playlist-end", str(limit),
        "--js-runtimes", "node:C:\\Program Files\\nodejs\\node.exe",
        "--remote-components", "ejs:github",
        "--no-cache-dir",
    ]
    try:
        output = await run_command(command)
        tracks = []
        for line in output.strip().split('\n'):
            if not line:
                continue
            try:
                data = json.loads(line)
                vid = data.get("id")
                if not vid or vid == video_id:
                    continue
                title = data.get("title", "Unknown")
                artist = (data.get("channel") or data.get("uploader") or "").replace("- Topic", "").strip() or "YouTube Music"
                thumbnail = ""
                thumbs = data.get("thumbnails")
                if thumbs and isinstance(thumbs, list) and len(thumbs) > 0:
                    thumbnail = thumbs[-1].get("url", "") if isinstance(thumbs[-1], dict) else ""
                elif isinstance(thumbs, dict):
                    thumbnail = thumbs.get("url", "")
                tracks.append({
                    "id": vid,
                    "title": title,
                    "artist": artist,
                    "thumbnail": thumbnail,
                    "bpm": None,
                    "source": "youtube"
                })
            except json.JSONDecodeError:
                continue
        print(f"[Radio] yt-dlp returned {len(tracks)} tracks for {video_id}")
        return tracks
    except Exception as e:
        print(f"[Radio] yt-dlp failed for {video_id}: {e}")
        return []


# ─── FALLBACK: Manual YTM API ───────────────────────────────

YTM_NEXT_URL = "https://music.youtube.com/youtubei/v1/next"
YTM_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
    "Origin": "https://music.youtube.com",
    "Referer": "https://music.youtube.com/"
}
YTM_CONTEXT = {
    "context": {
        "client": {
            "clientName": "WEB_REMIX",
            "clientVersion": "1.20240320.01.00"
        }
    }
}

def get_nested(data: dict, keys: List[str], default=None):
    """Safely get values from nested dictionary."""
    for key in keys:
        if isinstance(data, dict):
            data = data.get(key)
        elif isinstance(data, list) and isinstance(key, int):
            try:
                data = data[key]
            except IndexError:
                return default
        else:
            return default
    return data if data is not None else default

async def get_youtube_queue_fallback(video_id: str, limit: int = 20) -> List[Dict]:
    """Fallback: fetches YouTube Music 'Up Next' tracks via the internal API."""
    import httpx
    payload = {
        **YTM_CONTEXT,
        "videoId": video_id,
        "playlistId": f"RDAMVM{video_id}",
        "tunerSettingValue": "AUTOMIX_SETTING_NORMAL"
    }
    
    async with httpx.AsyncClient(headers=YTM_HEADERS, timeout=10.0) as client:
        try:
            for attempt in range(3):
                response = await client.post(YTM_NEXT_URL, json=payload)
                if response.status_code == 429:
                    await asyncio.sleep(2 ** attempt)
                    continue
                response.raise_for_status()
                break
            
            data = response.json()
            
            def find_renderer(obj, target):
                if isinstance(obj, dict):
                    if target in obj: return obj[target]
                    for k, v in obj.items():
                        res = find_renderer(v, target)
                        if res: return res
                elif isinstance(obj, list):
                    for item in obj:
                        res = find_renderer(item, target)
                        if res: return res
                return None

            panel = find_renderer(data, "playlistPanelRenderer")
            if not panel:
                print(f"[Fallback] Could not find playlistPanelRenderer for {video_id}")
                return []
            
            items = panel.get("contents", [])
            tracks = []
            
            for item in items:
                v = item.get("playlistPanelVideoRenderer")
                if not v: continue
                
                track_id = v.get("videoId")
                if track_id == video_id:
                    continue
                
                title = get_nested(v, ["title", "runs", 0, "text"])
                artist = get_nested(v, ["longBylineText", "runs", 0, "text"])
                thumbnails = get_nested(v, ["thumbnail", "thumbnails"], [])
                thumb = thumbnails[-1]["url"] if thumbnails else ""
                
                tracks.append({
                    "id": track_id,
                    "title": title,
                    "artist": artist,
                    "thumbnail": thumb,
                    "bpm": None,
                    "source": "youtube"
                })
                
                if len(tracks) >= limit:
                    break
            
            print(f"[Fallback] Manual API returned {len(tracks)} tracks for {video_id}")
            return tracks
        except Exception as e:
            print(f"[Fallback] Manual API failed for {video_id}: {e}")
            return []


# ─── ANALYSIS-AWARE RANKING ─────────────────────────────────

def normalize_bpm(bpm: float) -> float:
    """Normalize BPM to 70-140 range matching the frontend AutoMix engine."""
    if not bpm or bpm <= 0:
        return 120
    while bpm > 140:
        bpm /= 2
    while bpm < 70:
        bpm *= 2
    return bpm

def score_track(
    candidate: dict,
    cache: dict,
    current_bpm: Optional[float] = None,
    current_energy: Optional[float] = None,
) -> float:
    """Score a candidate track for queue ordering. Higher = better.
    
    Factors:
    - BPM proximity to current track (0.5 weight)
    - Energy similarity (0.3 weight)
    - Freshness/random boost (0.2 weight, epsilon-greedy style)
    
    Candidates without cached analysis data get a neutral score.
    """
    vid = candidate["id"]
    cached = cache.get(vid)
    
    score = 0.5  # neutral baseline
    
    if cached:
        cand_bpm = normalize_bpm(cached.get("tempo", 0))
        cand_energy = cached.get("energy", 0)
        
        # BPM proximity: closer = higher score (0 to 0.5)
        if current_bpm and cand_bpm > 0:
            norm_current = normalize_bpm(current_bpm)
            delta = abs(norm_current - cand_bpm)
            bpm_score = max(0, 1.0 - (delta / 30.0)) * 0.5
            score += bpm_score
        
        # Energy similarity (0 to 0.3)
        if current_energy is not None and cand_energy > 0:
            energy_diff = abs(current_energy - cand_energy) / max(current_energy, cand_energy, 0.001)
            energy_score = max(0, 1.0 - energy_diff) * 0.3
            score += energy_score
    
    # Random freshness boost (0 to 0.2)
    # Use the video_id as a deterministic seed so ordering is stable
    random.seed(vid)
    score += random.random() * 0.2
    random.seed()
    
    return score


def build_scored_queue(
    candidates: List[Dict],
    limit: int = 20,
    current_bpm: Optional[float] = None,
) -> List[Dict]:
    """Score and rank candidates, returning the top N.
    
    Tracks with cached analysis data (BPM, energy) are ranked higher
    when they're compatible with the current track. New/unseen tracks
    still appear but get shuffled to lower positions for discovery.
    """
    if not candidates:
        return []
    
    # Score each candidate
    scored = []
    for c in candidates:
        s = score_track(c, analysis_cache, current_bpm=current_bpm)
        scored.append((s, c))
    
    # Sort by score descending
    scored.sort(key=lambda x: -x[0])
    
    # Debug: log top 3 with scores
    for i, (s, c) in enumerate(scored[:3]):
        cached = analysis_cache.get(c["id"])
        if cached:
            print(f"[Queue] #{i+1}: {c['title']} score={s:.3f} BPM={cached.get('tempo', '?')}")
        else:
            print(f"[Queue] #{i+1}: {c['title']} score={s:.3f} (no analysis)")
    
    return [c for _, c in scored[:limit]]


# ─── PREFETCH AUDIO (with cache write) ──────────────────────

async def prefetch_audio(track: Dict):
    """Background task to download + analyze audio, writing results to cache.
    Uses the shared download_video lock so it never races with /api/download."""
    if not track or track.get("source") != "youtube":
        return
    
    video_id = track["id"]
    if video_id in analysis_cache:
        return
    
    try:
        # download_video uses a per-video asyncio lock shared with /api/download
        output_path = await download_video(video_id)
        
        features = await asyncio.to_thread(analyzer.analyze_track, output_path)
        if features:
            analysis_cache[video_id] = features
            print(f"[Prefetch] Cached {track['title']}: BPM={features['tempo']:.1f} Energy={features['energy']:.4f}")
        else:
            print(f"[Prefetch] Analysis returned None for {track['title']}")
    except Exception as e:
        print(f"[Prefetch] Error for {video_id}: {e}")


# ─── QUEUE ENDPOINT ─────────────────────────────────────────

@router.get("/queue/next")
async def get_next_queue(
    video_id: str,
    limit: int = 20,
    current_bpm: Optional[float] = Query(None),
    background_tasks: BackgroundTasks = None,
):
    """Get the next queue of tracks for AutoMix.
    
    Uses yt-dlp to fetch YouTube Music's real radio (RDAMVM playlist).
    Falls back to the manual YTM API if yt-dlp fails.
    Ranks candidates by BPM/energy compatibility when cached analysis is available.
    """
    # 1. Try yt-dlp radio first (returns real YTM Up Next)
    candidates = await get_youtube_music_radio(video_id, limit=limit * 2)
    
    # 2. Fallback to manual API if yt-dlp returned nothing
    if not candidates:
        print(f"[Queue] yt-dlp returned empty, trying fallback API for {video_id}")
        candidates = await get_youtube_queue_fallback(video_id, limit=limit * 2)
    
    # 3. Score and rank by compatibility
    queue = build_scored_queue(candidates, limit=limit, current_bpm=current_bpm)
    
    # 4. Background prefetch (download + analyze) for upcoming tracks.
    #    Skip queue[0] — the frontend calls /api/download for it immediately, so
    #    prefetching it would race. Only prefetch deeper tracks.
    if background_tasks and len(queue) >= 2:
        background_tasks.add_task(prefetch_audio, queue[1])
    
    return queue


# ─── SEARCH ─────────────────────────────────────────────────

@router.get("/search")
async def search(q: str, limit: int = 20):
    """Search YouTube via yt-dlp."""
    command = [
        YTDLP_PATH,
        f"ytsearch{limit}:{q}",
        "--dump-json",
        "--flat-playlist",
        "--no-playlist",
        "--js-runtimes", "node:C:\\Program Files\\nodejs\\node.exe",
        "--remote-components", "ejs:github",
        "--no-cache-dir"
    ]
    try:
        output = await run_command(command)
        results = []
        for line in output.strip().split('\n'):
            if not line: continue
            try:
                data = json.loads(line)
                results.append({
                    "id": data.get("id"),
                    "title": data.get("title"),
                    "artist": data.get("uploader", "").replace("- Topic", "").strip(),
                    "thumbnail": data.get("thumbnails", [{}])[0].get("url") if data.get("thumbnails") else None,
                    "bpm": None,
                    "source": "youtube"
                })
            except json.JSONDecodeError:
                continue
        return results
    except Exception as e:
        print(f"Error searching YouTube for '{q}': {e}")
        return []


# ─── EXTRACT PLAYLIST / LINK ────────────────────────────────

from urllib.parse import urlparse, parse_qs

async def extract_youtube_url(url: str) -> dict:
    """Extract playlist or video information from a YouTube or YouTube Music URL using yt-dlp."""
    url = url.strip()
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    selected_id = qs.get("v", [None])[0]

    command = [
        YTDLP_PATH,
        url,
        "--flat-playlist",
        "-J",
        "--no-download",
        "--js-runtimes", "node:C:\\Program Files\\nodejs\\node.exe",
        "--remote-components", "ejs:github",
        "--no-cache-dir",
    ]

    try:
        output = await run_command(command)
        data = json.loads(output)
    except Exception as e:
        print(f"[Extract Error] Failed to extract YouTube URL {url}: {e}")
        raise RuntimeError(f"Could not load YouTube link: {str(e)}")

    entries = data.get("entries")
    if entries is not None:
        title = data.get("title") or "YouTube Playlist"
        author = data.get("channel") or data.get("uploader") or ""
        author = author.replace("- Topic", "").strip() if author else "YouTube"

        tracks = []
        for e in entries:
            if not e or not e.get("id"):
                continue
            vid = e.get("id")
            t_title = e.get("title") or "Unknown Title"
            t_artist = e.get("channel") or e.get("uploader") or author or "YouTube"
            t_artist = t_artist.replace("- Topic", "").strip()

            thumb = ""
            thumbs = e.get("thumbnails")
            if thumbs and isinstance(thumbs, list) and len(thumbs) > 0:
                thumb = thumbs[-1].get("url", "") if isinstance(thumbs[-1], dict) else ""
            elif isinstance(thumbs, dict):
                thumb = thumbs.get("url", "")
            if not thumb:
                thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

            tracks.append({
                "id": vid,
                "title": t_title,
                "artist": t_artist,
                "thumbnail": thumb,
                "duration": e.get("duration") or 0,
                "bpm": None,
                "source": "youtube"
            })

        playlist_thumb = tracks[0]["thumbnail"] if tracks else None

        return {
            "type": "playlist",
            "title": title,
            "author": author,
            "thumbnail": playlist_thumb,
            "tracks": tracks,
            "count": len(tracks),
            "selected_id": selected_id
        }
    else:
        vid = data.get("id")
        t_title = data.get("title") or "Unknown Title"
        t_artist = data.get("channel") or data.get("uploader") or "YouTube"
        t_artist = t_artist.replace("- Topic", "").strip()

        thumb = ""
        thumbs = data.get("thumbnails")
        if thumbs and isinstance(thumbs, list) and len(thumbs) > 0:
            thumb = thumbs[-1].get("url", "") if isinstance(thumbs[-1], dict) else ""
        elif isinstance(thumbs, dict):
            thumb = thumbs.get("url", "")
        if not thumb and vid:
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"

        single_track = {
            "id": vid,
            "title": t_title,
            "artist": t_artist,
            "thumbnail": thumb,
            "duration": data.get("duration") or 0,
            "bpm": None,
            "source": "youtube"
        }

        return {
            "type": "video",
            "title": t_title,
            "author": t_artist,
            "thumbnail": thumb,
            "tracks": [single_track],
            "count": 1,
            "selected_id": vid
        }

