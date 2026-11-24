import os
import asyncio
import json
import random
import subprocess
import imageio_ffmpeg
from typing import List, Dict, Optional
from fastapi import APIRouter, Query, BackgroundTasks
from backend.analysis import AudioAnalyzer
from backend.download_manager import download_video, AUDIO_TEMP_DIR, YTDLP_PATH

router = APIRouter()
analyzer = AudioAnalyzer()

import math
from pathlib import Path

# Persistent analysis cache: video_id -> {tempo, energy, features_vector, key, key_confidence, loudness_db}
CACHE_FILE = os.path.join(AUDIO_TEMP_DIR, "analysis_cache.json")

WARM_TARGET = 2          # analyzed candidates we want among top 6 before scoring
WARM_MAX_WAIT = 60.0     # seconds; slow links are acceptable during playback

def _load_cache() -> Dict[str, dict]:
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        print(f"[Cache] Load failed: {e}")
    return {}

def _save_cache():
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(analysis_cache, f)
    except Exception as e:
        print(f"[Cache] Save failed: {e}")

async def _transcode_to_wav(src: str) -> str:
    """Decode any downloaded container (incl. DASH ftypdash m4a) to a temporary
    mono 22050 Hz 16-bit WAV that soundfile/librosa can read. Analysis-only."""
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    dst = src + ".analysis.wav"
    cmd = [
        ffmpeg, "-y", "-i", src,
        "-vn", "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le",
        dst,
    ]

    def _run():
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore"
        )

    result = await asyncio.to_thread(_run)
    if result.returncode != 0 or not os.path.exists(dst):
        tail = (result.stderr or "")[-500:]
        raise RuntimeError(f"ffmpeg transcode failed RC={result.returncode}: {tail}")
    return dst

analysis_cache: Dict[str, dict] = _load_cache()

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

KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
CAMELOT = {
    'C': ('8B', '5A'), 'C#': ('3B', '12A'), 'D': ('10B', '7A'), 'D#': ('5B', '2A'),
    'E': ('12B', '9A'), 'F': ('7B', '4A'), 'F#': ('2B', '11A'), 'G': ('9B', '6A'),
    'G#': ('4B', '1A'), 'A': ('11B', '8A'), 'A#': ('6B', '3A'), 'B': ('1B', '10A'),
}

def _pearson(a, b):
    n = len(a)
    ma = sum(a) / n
    mb = sum(b) / n
    num = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((x - mb) ** 2 for x in b))
    if da <= 1e-9 or db <= 1e-9:
        return 0.0
    return num / (da * db)

def chroma_to_key(features_vector):
    """Derive Camelot key + confidence from the 12-dim chroma prefix.
    Defensive: returns ('', 0) if chroma is missing/flat."""
    if not features_vector or len(features_vector) < 12:
        return "", 0.0
    chroma = list(features_vector[:12])
    if max(chroma) <= 1e-6:
        return "", 0.0

    best_corr, best_shift, best_mode = -1.0, 0, "major"
    runner = -1.0
    for shift in range(12):
        for mode, profile in (("major", KK_MAJOR), ("minor", KK_MINOR)):
            rotated = profile[-shift:] + profile[:-shift] if shift else profile[:]
            corr = _pearson(chroma, rotated)
            if corr > best_corr:
                runner = best_corr
                best_corr, best_shift, best_mode = corr, shift, mode
            elif corr > runner:
                runner = corr

    margin = max(0.0, best_corr - runner)
    conf = max(0.0, min(1.0, best_corr * 0.65 + margin * 0.35))
    if best_corr < 0.30 or conf < 0.10:
        return "", conf
    idx = 0 if best_mode == "major" else 1
    return CAMELOT[NOTES[best_shift]][idx], conf

def camelot_relation(a: str, b: str) -> str:
    if not a or not b:
        return "unknown"
    if a == b:
        return "compatible"
    try:
        na, la = int(a[:-1]), a[-1]
        nb, lb = int(b[:-1]), b[-1]
    except Exception:
        return "unknown"
    if na == nb and la != lb:
        return "compatible"
    if abs(na - nb) in (1, 11):
        return "compatible"
    return "incompatible"

def score_track(
    candidate: dict,
    cache: dict,
    current_bpm: Optional[float] = None,
    current_energy: Optional[float] = None,
    current_key: Optional[str] = None,
    current_key_conf: Optional[float] = None,
    current_loudness: Optional[float] = None,
) -> float:
    """Higher = better. Analyzed compatible/close/loudness-matched tracks rank up.
    Unanalyzed tracks get a neutral discovery score. Random is a small tie-breaker."""
    vid = candidate["id"]
    cached = cache.get(vid)
    rng = random.Random(vid)
    jitter = rng.random() * 0.05

    if not cached:
        return 0.30 + jitter   # cold penalty

    score = 0.35
    raw_abs = None
    confident_clash = False

    # Tempo proximity bonus (0..0.35). Penalty is applied LAST.
    cand_bpm = normalize_bpm(cached.get("tempo", 0))
    if current_bpm and cand_bpm > 0:
        norm_current = normalize_bpm(current_bpm)
        delta = abs(norm_current - cand_bpm)
        score += max(0.0, 1.0 - delta / 20.0) * 0.35
        raw_ratio = cand_bpm / max(0.001, norm_current)
        raw_abs = max(raw_ratio, 1.0 / raw_ratio)

    # Key bonus (0..0.35). Confident clash is flagged, penalized LAST.
    ck = cached.get("key") or ""
    ck_conf = cached.get("key_confidence", 0.0)
    cur_conf = current_key_conf or 0.0
    if current_key and ck and cur_conf >= 0.25 and ck_conf >= 0.25:
        rel = camelot_relation(current_key, ck)
        if rel == "compatible":
            score += 0.35
        elif rel == "incompatible" and cur_conf >= 0.35 and ck_conf >= 0.35:
            confident_clash = True
        else:
            score += 0.12
    else:
        score += 0.12   # unknown neutral

    # Energy continuity (0..0.10)
    cand_energy = cached.get("energy", 0.0)
    if current_energy is not None and cand_energy > 0:
        ed = abs(current_energy - cand_energy) / max(current_energy, cand_energy, 0.001)
        score += max(0.0, 1.0 - ed) * 0.10

    # Loudness continuity (0..0.10)
    cl = cached.get("loudness_db")
    if current_loudness is not None and cl is not None:
        ld = abs(current_loudness - cl)
        score += max(0.0, 1.0 - ld / 6.0) * 0.10

    # ── Safety penalties LAST, with hard caps ──
    if confident_clash:
        score = min(score * 0.45, 0.45)
    if raw_abs is not None:
        if raw_abs > 1.45:
            score = min(score * 0.5, 0.40)   # extreme tempo: cannot ride key bonus
        elif raw_abs > 1.25:
            score = min(score * 0.8, 0.65)

    return max(0.0, score) + jitter


def build_scored_queue(
    candidates: List[Dict],
    limit: int = 20,
    current_bpm: Optional[float] = None,
    current_energy: Optional[float] = None,
    current_key: Optional[str] = None,
    current_key_conf: Optional[float] = None,
    current_loudness: Optional[float] = None,
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
        s = score_track(
            c, analysis_cache,
            current_bpm=current_bpm,
            current_energy=current_energy,
            current_key=current_key,
            current_key_conf=current_key_conf,
            current_loudness=current_loudness,
        )
        scored.append((s, c))
    
    # Sort by score descending
    scored.sort(key=lambda x: -x[0])

    ordered = [c for _, c in scored]
    score_by_id = {c["id"]: s for s, c in scored}

    def _safe(c: Dict) -> bool:
        cached = analysis_cache.get(c["id"])
        if not cached:
            return False
        ck = cached.get("key") or ""
        if current_key and ck and (current_key_conf or 0) >= 0.25 and cached.get("key_confidence", 0) >= 0.25:
            if camelot_relation(current_key, ck) == "incompatible":
                return False
        if current_bpm:
            cand_bpm = normalize_bpm(cached.get("tempo", 0))
            if cand_bpm > 0:
                norm_current = normalize_bpm(current_bpm)
                raw_ratio = cand_bpm / max(0.001, norm_current)
                raw_abs = max(raw_ratio, 1.0 / raw_ratio)
                if raw_abs > 1.25:
                    return False
        return True

    # Promote safe candidates into the first 3 slots when available.
    for slot in range(min(3, len(ordered))):
        if _safe(ordered[slot]):
            continue
        for j in range(slot + 1, len(ordered)):
            if _safe(ordered[j]):
                ordered.insert(slot, ordered.pop(j))
                break

    for i, c in enumerate(ordered[:3]):
        cached = analysis_cache.get(c["id"])
        s = score_by_id.get(c["id"], 0)
        if cached:
            print(f"[Queue] #{i+1}: {c['title']} score={s:.3f} BPM={cached.get('tempo','?')} Key={cached.get('key','?')}")
        else:
            print(f"[Queue] #{i+1}: {c['title']} score={s:.3f} (no analysis)")

    return ordered[:limit]


# ─── PREFETCH AUDIO (with cache write) ──────────────────────

async def prefetch_audio(track: Dict):
    """Background: download -> transcode -> analyze -> cache -> persist.
    Uses the shared download_video lock so it never races /api/download."""
    if not track or track.get("source") != "youtube":
        return

    video_id = track["id"]
    if video_id in analysis_cache:
        return

    wav_path = None
    try:
        output_path = await download_video(video_id)
        wav_path = await _transcode_to_wav(output_path)

        features = await asyncio.to_thread(analyzer.analyze_track, wav_path)
        if features:
            key, key_conf = chroma_to_key(features.get("features_vector"))
            features["key"] = key
            features["key_confidence"] = key_conf
            features["loudness_db"] = 20 * math.log10(max(1e-6, features.get("energy", 0.0)))
            analysis_cache[video_id] = features
            _save_cache()
            print(
                f"[Prefetch] Cached {track['title']}: "
                f"BPM={features['tempo']:.1f} Energy={features['energy']:.4f} Key={key or '?'}"
            )
        else:
            print(f"[Prefetch] Analysis returned None for {track['title']}")
    except Exception as e:
        print(f"[Prefetch] Error for {video_id}: {e}")
    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.remove(wav_path)
            except Exception:
                pass


# ─── QUEUE ENDPOINT ─────────────────────────────────────────

@router.get("/queue/next")
async def get_next_queue(
    video_id: str,
    limit: int = 20,
    current_bpm: Optional[float] = Query(None),
    current_energy: Optional[float] = Query(None),
    current_key: Optional[str] = Query(None),
    current_key_conf: Optional[float] = Query(None),
    current_loudness: Optional[float] = Query(None),
    background_tasks: BackgroundTasks = None,
):
    candidates = await get_youtube_music_radio(video_id, limit=limit * 2)
    if not candidates:
        print(f"[Queue] yt-dlp empty, fallback for {video_id}")
        candidates = await get_youtube_queue_fallback(video_id, limit=limit * 2)

    # Adaptive warm-up: wait for WARM_TARGET analyzed candidates among the top 6,
    # or WARM_MAX_WAIT seconds. asyncio.wait(FIRST_COMPLETED) does not cancel
    # pending prefetches — unfinished downloads/analyses continue in background.
    top = candidates[:6]
    already = sum(1 for c in top if c["id"] in analysis_cache)
    target = min(WARM_TARGET, len(top))
    if already < target:
        warm = [c for c in top if c["id"] not in analysis_cache]
        if warm:
            tasks = [asyncio.create_task(prefetch_audio(c)) for c in warm]
            pending = set(tasks)
            loop = asyncio.get_running_loop()
            deadline = loop.time() + WARM_MAX_WAIT
            while pending and loop.time() < deadline:
                remaining = max(0.1, deadline - loop.time())
                done, pending = await asyncio.wait(
                    pending, timeout=min(5.0, remaining),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                warm_count = sum(1 for c in top if c["id"] in analysis_cache)
                if warm_count >= target:
                    break
            warm_count = sum(1 for c in top if c["id"] in analysis_cache)
            print(f"[Queue] warm-up: {warm_count}/{len(top)} analyzed (target {target})")

    queue = build_scored_queue(
        candidates, limit=limit,
        current_bpm=current_bpm,
        current_energy=current_energy,
        current_key=current_key,
        current_key_conf=current_key_conf,
        current_loudness=current_loudness,
    )

    # Merge cached analysis into the response so the client gets real bpm/key.
    for c in queue:
        cached = analysis_cache.get(c["id"])
        if cached:
            tempo = cached.get("tempo", 0)
            c["bpm"] = round(tempo, 2) if tempo else None
            c["key"] = cached.get("key") or None
            c["keyConfidence"] = cached.get("key_confidence")
            c["energy"] = cached.get("energy")
            c["loudnessDb"] = cached.get("loudness_db")

    # Prefetch deeper tracks so scoring has real data on subsequent requests.
    # Skip queue[0] — frontend downloads it immediately.
    if background_tasks:
        for t in queue[1:5]:
            background_tasks.add_task(prefetch_audio, t)

    order_summary = ", ".join(
        f"{i+1}:{c.get('title','?')}[{analysis_cache.get(c['id'], {}).get('key', '?')}|{analysis_cache.get(c['id'], {}).get('tempo', '?')}]"
        for i, c in enumerate(queue[:8])
    )
    print(f"[Queue] final order: {order_summary}")

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

