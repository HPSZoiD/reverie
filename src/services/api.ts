import type { Track } from '../types';

const API = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:8000`;

const TOKEN_KEY = 'reverie-auth-token';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface DownloadResult {
  success: boolean;
  audio_url: string;
  filename: string;
}

export interface Playlist {
  id: string;
  name: string;
  created_at: string;
  user_id: string;
  thumbnail?: string;
  track_count?: number;
}

export interface YouTubeExtractResult {
  type: 'playlist' | 'video';
  title: string;
  author?: string;
  thumbnail?: string;
  tracks: Track[];
  count: number;
  selected_id?: string;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  auth: {
    signup: (email: string, password: string) =>
      apiFetch<{ token: string; user: { id: string; email: string } }>(`${API}/api/auth/signup`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    login: (email: string, password: string) =>
      apiFetch<{ token: string; user: { id: string; email: string } }>(`${API}/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    logout: () =>
      apiFetch<{ success: boolean }>(`${API}/api/auth/logout`, {
        method: 'POST',
      }),

    me: () =>
      apiFetch<{ user: { id: string; email: string } | null }>(`${API}/api/auth/me`),
  },

  search: (q: string): Promise<Track[]> =>
    fetch(`${API}/api/search?q=${encodeURIComponent(q)}&source=youtube`).then((r) => r.json()),

  download: (videoId: string): Promise<DownloadResult> =>
    apiFetch<DownloadResult>(`${API}/api/download`, {
      method: 'POST',
      body: JSON.stringify({ video_id: videoId }),
    }),

  getQueue: (
    videoId: string,
    current?: {
      bpm?: number | null;
      key?: string | null;
      keyConfidence?: number | null;
      energy?: number | null;
      loudnessDb?: number | null;
    }
  ): Promise<Track[]> => {
    const p = new URLSearchParams({ video_id: videoId });
    if (current?.bpm) p.set('current_bpm', String(current.bpm));
    if (current?.key) p.set('current_key', current.key);
    if (current?.keyConfidence != null) p.set('current_key_conf', String(current.keyConfidence));
    if (current?.energy != null) p.set('current_energy', String(current.energy));
    if (current?.loudnessDb != null) p.set('current_loudness', String(current.loudnessDb));
    return fetch(`${API}/api/queue/next?${p.toString()}`).then((r) => r.json());
  },

  getRecommendations: (userId: string): Promise<Track[]> =>
    fetch(`${API}/api/recommendations?limit=8&epsilon=0.3&user_id=${encodeURIComponent(userId)}`).then((r) => r.json()),

  cleanup: (videoId: string): Promise<{ success: boolean }> =>
    fetch(`${API}/api/audio/${encodeURIComponent(videoId)}`, { method: 'DELETE' }).then((r) => r.json()),

  getHomeData: async (searchQuery: string, hasHistory: boolean, languages: string[], userId: string) => {
    const langStr = languages.join(' ');
    const cacheKey = `reverie-home-cache-${userId}-${languages.join('-')}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < 3600000) {
          return parsed.data;
        }
      }
    } catch {
      // ignore
    }

    const [recs, trend, newRel, pers] = await Promise.all([
      api.search(`top ${langStr} hits 2025`).catch(() => []),
      api.search(`trending ${langStr} songs 2025`).catch(() => []),
      api.search(`new ${langStr} releases 2025`).catch(() => []),
      hasHistory ? api.search(searchQuery).catch(() => []) : Promise.resolve([]),
    ]);

    const data = {
      quickPicks: Array.isArray(recs) ? recs : [],
      trending: Array.isArray(trend) ? trend : [],
      newReleases: Array.isArray(newRel) ? newRel : [],
      personalized: Array.isArray(pers) ? pers : [],
    };

    // Only cache in sessionStorage if we actually retrieved non-empty results
    if (data.quickPicks.length > 0 || data.trending.length > 0 || data.newReleases.length > 0) {
      sessionStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    }
    return data;
  },

  // ─── User Settings ─────────────────────────────────────

  getUserSettings: async (): Promise<string[]> => {
    const data = await apiFetch<string[]>(`${API}/api/user/settings`);
    return data || ['English', 'Hindi', 'Punjabi'];
  },

  updateUserSettings: async (languages: string[]) => {
    await apiFetch(`${API}/api/user/settings`, {
      method: 'PUT',
      body: JSON.stringify({ languages }),
    });
  },

  // ─── Liked Songs ───────────────────────────────────────

  getLikedSongs: async (): Promise<Track[]> => {
    return apiFetch<Track[]>(`${API}/api/liked-songs`);
  },

  addLikedSong: async (track: Track) => {
    await apiFetch(`${API}/api/liked-songs`, {
      method: 'POST',
      body: JSON.stringify({ track_id: track.id, metadata: track }),
    });
  },

  removeLikedSong: async (trackId: string) => {
    await apiFetch(`${API}/api/liked-songs/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    });
  },

  // ─── Listening History ─────────────────────────────────

  getHistory: async (): Promise<Track[]> => {
    return apiFetch<Track[]>(`${API}/api/history`);
  },

  addHistory: async (track: Track) => {
    await apiFetch(`${API}/api/history`, {
      method: 'POST',
      body: JSON.stringify({ track_id: track.id, metadata: track }),
    });
  },

  // ─── Playlists ────────────────────────────────────────

  getPlaylists: async (): Promise<Playlist[]> => {
    return apiFetch<Playlist[]>(`${API}/api/playlists`);
  },

  createPlaylist: async (name: string): Promise<Playlist> => {
    return apiFetch<Playlist>(`${API}/api/playlists`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  deletePlaylist: async (playlistId: string) => {
    await apiFetch(`${API}/api/playlists/${playlistId}`, {
      method: 'DELETE',
    });
  },

  getPlaylistTracks: async (playlistId: string): Promise<Track[]> => {
    return apiFetch<Track[]>(`${API}/api/playlists/${playlistId}/tracks`);
  },

  addTrackToPlaylist: async (playlistId: string, track: Track) => {
    await apiFetch(`${API}/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ track_id: track.id, metadata: track }),
    });
  },

  removeTrackFromPlaylist: async (playlistId: string, trackId: string) => {
    await apiFetch(`${API}/api/playlists/${playlistId}/tracks/${encodeURIComponent(trackId)}`, {
      method: 'DELETE',
    });
  },

  // ─── YouTube URL / Playlist ────────────────────────────

  extractYouTubeUrl: (url: string): Promise<YouTubeExtractResult> =>
    apiFetch<YouTubeExtractResult>(`${API}/api/youtube/extract`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  importYouTubePlaylist: (name: string, tracks: Track[]): Promise<Playlist & { track_count: number }> =>
    apiFetch<Playlist & { track_count: number }>(`${API}/api/youtube/playlist/import`, {
      method: 'POST',
      body: JSON.stringify({ name, tracks }),
    }),
};

export { API };
