import sqlite3
import os
import json
import hashlib
import uuid
from datetime import datetime

# Max listening-history entries retained per user (newest kept).
HISTORY_LIMIT = 30

class DatabaseManager:
    def __init__(self, db_path="database/music_player.db"):
        self.db_path = db_path
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir)
        self._create_tables()

    def _get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _create_tables(self):
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS Tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE,
                title TEXT,
                artist TEXT,
                album TEXT,
                genre TEXT,
                duration_seconds INTEGER,
                added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                play_count INTEGER DEFAULT 0,
                skip_count INTEGER DEFAULT 0,
                last_played TIMESTAMP,
                tempo REAL,
                energy REAL,
                features_json TEXT
            )
        """)

        for col in ["tempo", "energy", "features_json"]:
            try:
                cursor.execute(f"ALTER TABLE Tracks ADD COLUMN {col} REAL" if col != "features_json" else f"ALTER TABLE Tracks ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS Scanned_Folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_path TEXT UNIQUE NOT NULL,
                last_scanned TIMESTAMP,
                track_count INTEGER DEFAULT 0,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Drop old-format tables that conflict (case-insensitive name match)
        cursor.execute("DROP TABLE IF EXISTS Listening_History")
        cursor.execute("DROP TABLE IF EXISTS Playlists")
        cursor.execute("DROP TABLE IF EXISTS Playlist_Tracks")

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS liked_songs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                metadata TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, track_id)
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS listening_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                metadata TEXT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id TEXT NOT NULL,
                metadata TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                languages TEXT NOT NULL DEFAULT '["English","Hindi","Punjabi"]',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.commit()
        conn.close()

    # ─── Auth methods ────────────────────────────────────────────

    def create_user(self, email, password):
        password_hash = hashlib.sha256(password.encode()).hexdigest()
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, password_hash))
            conn.commit()
            user_id = cursor.lastrowid
            return {"id": str(user_id), "email": email}
        except sqlite3.IntegrityError:
            return None
        finally:
            conn.close()

    def get_user_by_email(self, email):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, password_hash FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"id": str(row["id"]), "email": row["email"], "password_hash": row["password_hash"]}
        return None

    def get_user_by_id(self, user_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, email FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return {"id": str(row["id"]), "email": row["email"]}
        return None

    def verify_password(self, password, password_hash):
        return hashlib.sha256(password.encode()).hexdigest() == password_hash

    def create_session(self, user_id):
        token = str(uuid.uuid4())
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO sessions (user_id, token) VALUES (?, ?)", (user_id, token))
        conn.commit()
        conn.close()
        return token

    def get_session(self, token):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT user_id FROM sessions WHERE token = ?", (token,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return self.get_user_by_id(row["user_id"])
        return None

    def delete_session(self, token):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()

    def get_or_create_guest_user(self):
        guest_email = 'guest@reverie.local'
        user = self.get_user_by_email(guest_email)
        if user:
            return {"id": user["id"], "email": user["email"]}
        created = self.create_user(guest_email, 'guest')
        if created:
            return created
        user = self.get_user_by_email(guest_email)
        if user:
            return {"id": user["id"], "email": user["email"]}
        return None

    # ─── Liked Songs ────────────────────────────────────────────

    def get_liked_songs(self, user_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT metadata FROM liked_songs WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        return [json.loads(r["metadata"]) for r in rows]

    def add_liked_song(self, user_id, track_id, metadata):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT OR IGNORE INTO liked_songs (user_id, track_id, metadata) VALUES (?, ?, ?)",
                (user_id, track_id, json.dumps(metadata))
            )
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            print(f"Add liked song error: {e}")
            return False
        finally:
            conn.close()

    def remove_liked_song(self, user_id, track_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM liked_songs WHERE user_id = ? AND track_id = ?", (user_id, track_id))
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            print(f"Remove liked song error: {e}")
            return False
        finally:
            conn.close()

    # ─── Listening History ──────────────────────────────────────

    def add_history_entry(self, user_id, track_id, metadata):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO listening_history (user_id, track_id, metadata) VALUES (?, ?, ?)",
                (user_id, track_id, json.dumps(metadata))
            )
            # Cap history: keep only the newest HISTORY_LIMIT entries per user
            # so the DB does not grow unbounded over time.
            cursor.execute(
                "DELETE FROM listening_history WHERE id NOT IN "
                "(SELECT id FROM listening_history WHERE user_id = ? ORDER BY id DESC LIMIT ?)",
                (user_id, HISTORY_LIMIT)
            )
            conn.commit()
        except sqlite3.Error as e:
            print(f"Add history error: {e}")
        finally:
            conn.close()

    def get_listening_history(self, user_id, limit=HISTORY_LIMIT):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT metadata FROM listening_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?",
            (user_id, limit)
        )
        rows = cursor.fetchall()
        conn.close()
        return [json.loads(r["metadata"]) for r in rows]

    # ─── Playlists ──────────────────────────────────────────────

    def create_playlist(self, user_id, name):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO playlists (user_id, name) VALUES (?, ?)", (user_id, name))
            conn.commit()
            pid = cursor.lastrowid
            return {"id": str(pid), "name": name, "user_id": str(user_id), "created_at": datetime.now().isoformat(), "thumbnail": None}
        except sqlite3.Error as e:
            print(f"Create playlist error: {e}")
            return None
        finally:
            conn.close()

    def create_playlist_with_tracks(self, user_id, name, tracks):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO playlists (user_id, name) VALUES (?, ?)", (user_id, name))
            playlist_id = cursor.lastrowid
            for idx, track in enumerate(tracks):
                track_id = str(track.get("id") or uuid.uuid4())
                cursor.execute(
                    "INSERT INTO playlist_tracks (playlist_id, track_id, metadata, position) VALUES (?, ?, ?, ?)",
                    (playlist_id, track_id, json.dumps(track), idx)
                )
            conn.commit()
            first_thumb = tracks[0].get("thumbnail") if tracks else None
            return {
                "id": str(playlist_id),
                "name": name,
                "user_id": str(user_id),
                "created_at": datetime.now().isoformat(),
                "thumbnail": first_thumb,
                "track_count": len(tracks)
            }
        except sqlite3.Error as e:
            print(f"Create playlist with tracks error: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()

    def get_playlists(self, user_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT p.id, p.name, p.created_at,
                (SELECT json_extract(pt.metadata, '$.thumbnail') FROM playlist_tracks pt WHERE pt.playlist_id = p.id ORDER BY pt.position ASC LIMIT 1) as thumbnail
            FROM playlists p
            WHERE p.user_id = ?
            ORDER BY p.created_at ASC
        """, (user_id,))
        rows = cursor.fetchall()
        conn.close()
        return [{"id": str(r["id"]), "name": r["name"], "created_at": r["created_at"], "user_id": str(user_id), "thumbnail": r["thumbnail"]} for r in rows]

    def delete_playlist(self, user_id, playlist_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id))
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            print(f"Delete playlist error: {e}")
            return False
        finally:
            conn.close()

    def get_playlist_tracks(self, playlist_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT metadata, position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC",
            (playlist_id,)
        )
        rows = cursor.fetchall()
        conn.close()
        return [json.loads(r["metadata"]) for r in rows]

    def add_track_to_playlist(self, playlist_id, track_id, metadata):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
            position = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, metadata, position) VALUES (?, ?, ?, ?)",
                (playlist_id, track_id, json.dumps(metadata), position)
            )
            conn.commit()
            return True
        except sqlite3.Error as e:
            print(f"Add track to playlist error: {e}")
            return False
        finally:
            conn.close()

    def remove_track_from_playlist(self, playlist_id, track_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
            conn.commit()
            return cursor.rowcount > 0
        except sqlite3.Error as e:
            print(f"Remove track from playlist error: {e}")
            return False
        finally:
            conn.close()

    # ─── User Settings ──────────────────────────────────────────

    def get_user_settings(self, user_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT languages FROM user_settings WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return json.loads(row["languages"])
        return ["English", "Hindi", "Punjabi"]

    def update_user_settings(self, user_id, languages):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO user_settings (user_id, languages, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET languages = ?, updated_at = CURRENT_TIMESTAMP
            """, (user_id, json.dumps(languages), json.dumps(languages)))
            conn.commit()
            return True
        except sqlite3.Error as e:
            print(f"Update user settings error: {e}")
            return False
        finally:
            conn.close()

    # ─── Existing Track Methods (unchanged) ─────────────────────

    def add_track(self, file_path, metadata):
        conn = self._get_connection()
        cursor = conn.cursor()
        track_id = None
        try:
            cursor.execute("""
                INSERT OR IGNORE INTO Tracks (file_path, title, artist, album, genre, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                file_path,
                metadata.get('title', 'Unknown'),
                metadata.get('artist', 'Unknown'),
                metadata.get('album', 'Unknown'),
                metadata.get('genre', 'Unknown'),
                metadata.get('duration', 0)
            ))
            if cursor.rowcount > 0:
                track_id = cursor.lastrowid
            else:
                cursor.execute("SELECT id FROM Tracks WHERE file_path = ?", (file_path,))
                result = cursor.fetchone()
                if result:
                    track_id = result["id"]
            conn.commit()
        except sqlite3.Error as e:
            print(f"Database Error: {e}")
            return None
        finally:
            conn.close()
        return track_id

    def get_all_tracks(self, sort_by="added_date DESC"):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM Tracks ORDER BY {sort_by}")
        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def search_tracks(self, query):
        conn = self._get_connection()
        cursor = conn.cursor()
        search_term = f"%{query}%"
        cursor.execute("""
            SELECT * FROM Tracks
            WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
            ORDER BY title
        """, (search_term, search_term, search_term))
        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def get_all_artists(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT artist FROM Tracks ORDER BY artist")
        artists = [row["artist"] for row in cursor.fetchall()]
        conn.close()
        return artists

    def get_all_albums(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT album, artist FROM Tracks ORDER BY album")
        albums = [{"album": row["album"], "artist": row["artist"]} for row in cursor.fetchall()]
        conn.close()
        return albums

    def get_tracks_by_artist(self, artist):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM Tracks WHERE artist = ? ORDER BY title", (artist,))
        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def get_tracks_by_album(self, album):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM Tracks WHERE album = ? ORDER BY title", (album,))
        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def get_track_by_id(self, track_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM Tracks WHERE id = ?", (track_id,))
        row = cursor.fetchone()
        conn.close()
        return dict(row) if row else None

    def update_track_features(self, track_id, tempo, energy, features_json):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                UPDATE Tracks
                SET tempo = ?, energy = ?, features_json = ?
                WHERE id = ?
            """, (tempo, energy, features_json, track_id))
            conn.commit()
        except sqlite3.Error as e:
            print(f"Update Features Error: {e}")
        finally:
            conn.close()

    def get_tracks_needing_analysis(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, file_path FROM Tracks WHERE features_json IS NULL")
        tracks = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return tracks

    def log_history(self, track_id, session_id, duration_listened, skipped=False):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            if skipped:
                cursor.execute("UPDATE Tracks SET skip_count = skip_count + 1, last_played = CURRENT_TIMESTAMP WHERE id = ?", (track_id,))
            else:
                cursor.execute("UPDATE Tracks SET play_count = play_count + 1, last_played = CURRENT_TIMESTAMP WHERE id = ?", (track_id,))
            conn.commit()
        except sqlite3.Error:
            pass
        finally:
            conn.close()

    def clear_all_data(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM Tracks")
            conn.commit()
            return True
        except Exception as e:
            print(f"Error clearing data: {e}")
            return False
        finally:
            conn.close()

    def add_folder(self, folder_path):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO Scanned_Folders (folder_path) VALUES (?)", (folder_path,))
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError:
            return None
        finally:
            conn.close()

    def get_folders(self):
        conn = self._get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM Scanned_Folders ORDER BY added_at DESC")
        folders = [dict(row) for row in cursor.fetchall()]
        conn.close()
        return folders

    def remove_folder(self, folder_id):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("DELETE FROM Scanned_Folders WHERE id = ?", (folder_id,))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"Error removing folder: {e}")
            return False
        finally:
            conn.close()

    def update_folder_scan_info(self, folder_id, track_count):
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "UPDATE Scanned_Folders SET last_scanned = CURRENT_TIMESTAMP, track_count = ? WHERE id = ?",
                (track_count, folder_id)
            )
            conn.commit()
            return True
        except Exception as e:
            print(f"Error updating folder scan info: {e}")
            return False
        finally:
            conn.close()
            
