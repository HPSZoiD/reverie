import asyncio
import os
import subprocess
import shutil
import tempfile

YTDLP_PATH = shutil.which('yt-dlp')
if not YTDLP_PATH:
    venv_ytdlp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'venv', 'Scripts', 'yt-dlp.exe')
    if os.path.exists(venv_ytdlp):
        YTDLP_PATH = venv_ytdlp
    else:
        YTDLP_PATH = 'yt-dlp'

AUDIO_TEMP_DIR = os.path.join(tempfile.gettempdir(), "reverie_audio")
os.makedirs(AUDIO_TEMP_DIR, exist_ok=True)

download_locks: dict[str, asyncio.Lock] = {}
locks_mutex = asyncio.Lock()


async def download_video(video_id: str) -> str:
    """Download a YouTube video's audio. Returns the output path.
    Thread-safe via per-video asyncio locks.
    """
    async with locks_mutex:
        if video_id not in download_locks:
            download_locks[video_id] = asyncio.Lock()
        lock = download_locks[video_id]

    output_path = os.path.join(AUDIO_TEMP_DIR, f"{video_id}.m4a")

    async with lock:
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path

        command = [
            YTDLP_PATH,
            "-f", "bestaudio[ext=m4a]/bestaudio/best",
            "--no-playlist",
            "--js-runtimes", "node:C:\\Program Files\\nodejs\\node.exe",
            "--remote-components", "ejs:github",
            "--force-overwrites",
            "--no-cache-dir",
            "--no-part",
            "--no-mtime",
            "-o", output_path,
            f"https://www.youtube.com/watch?v={video_id}"
        ]

        def _run():
            return subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='ignore')

        result = await asyncio.to_thread(_run)

        if result.returncode != 0:
            raise RuntimeError(result.stderr or result.stdout or "Unknown yt-dlp error")

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise RuntimeError("Download completed but file not found")

        return output_path
