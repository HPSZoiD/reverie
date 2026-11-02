import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAudio } from '@/contexts/AudioContext';
import { api } from '@/services/api';
import { TrackContextMenu } from '@/components/TrackContextMenu';
import { YouTubeImportModal } from '@/components/YouTubeImportModal';
import { staggerContainer, staggerItemFast } from '@/lib/animations';
import type { Track } from '@/types';

let globalQ = '';
let globalDebounced = '';
let globalResults: Track[] = [];

// In-memory search cache so returning to the Search screen is instant and
// does not re-run the network search or replay the loading animation.
type CacheEntry = { ts: number; items: Track[] };
const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 30;

function storeCache(query: string, items: Track[]) {
  const key = query.trim().toLowerCase();
  if (!key) return;
  searchCache.set(key, { ts: Date.now(), items });
  if (searchCache.size > CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
}

function readCache(query: string): Track[] | null {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.items;
}

export function SearchScreen() {
  const nav = useNavigate();
  const { playTrack } = useAudio();
  const [q, setQ] = useState(globalQ);
  const [debounced, setDebounced] = useState(globalDebounced);
  const [results, setResults] = useState<Track[]>(globalResults);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [listening, setListening] = useState(false);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);
  const [ytModalUrl, setYtModalUrl] = useState('');

  const isYtUrl = /^(https?:\/\/)?(www\.|music\.)?(youtube\.com|youtu\.be)\/.+$/i.test(debounced.trim());

  useEffect(() => { globalQ = q; }, [q]);
  useEffect(() => { globalDebounced = debounced; }, [debounced]);
  useEffect(() => { globalResults = results; }, [results]);

  useEffect(() => {
    if (q.trim() !== debounced) setSearching(true);
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q, debounced]);

  useEffect(() => {
    if (!debounced) { setResults([]); setSearching(false); return; }

    if (isYtUrl) {
      setResults([]);
      setSearching(false);
      return;
    }

    // Instant path: this exact query already has fresh cached results.
    const cached = readCache(debounced);
    if (cached) {
      setResults(cached);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setResults([]);
    setSearching(true);
    (async () => {
      try {
        const r = await api.search(debounced);
        const arr = Array.isArray(r) ? r : [];
        storeCache(debounced, arr);
        if (!cancelled) setResults(arr);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debounced, isYtUrl]);

  const onPick = useCallback(
    async (tr: Track) => {
      setLoadingId(tr.id);
      try {
        await playTrack(tr);
        nav('/now-playing');
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingId(null);
      }
    },
    [nav, playTrack]
  );

  const voice = () => {
    type SpeechRecCtor = new () => {
      lang: string; onstart: (() => void) | null; onend: (() => void) | null;
      onresult: ((ev: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null;
      start: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: SpeechRecCtor; webkitSpeechRecognition?: SpeechRecCtor; };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return; }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onresult = (ev) => { const text = ev.results[0]?.[0]?.transcript; if (text) setQ(text); };
    rec.start();
  };

  const hasResults = results.length > 0;
  const showEmpty = !q.trim() && !searching && !isYtUrl;

  return (
    <div className={`mx-auto max-w-lg px-4 pt-8 ${hasResults || isYtUrl ? 'min-h-[100dvh]' : 'h-[100dvh]'}`}>
      <h1 className="mb-4 font-headline text-lg font-extrabold uppercase tracking-tight">Search</h1>
      <div className="mb-6 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tracks, artists, vibes, or YouTube playlist URL…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-body text-xs text-onSurface placeholder:text-muted focus:border-[var(--reverie-accent,#C8F23A)] focus:outline-none transition-all duration-200"
        />
        <motion.button
          whileTap={{ scale: 0.85 }}
          type="button"
          onClick={() => {
            setYtModalUrl(q.trim());
            setShowYouTubeModal(true);
          }}
          className="rounded-lg border border-border px-2 font-mono text-[10px] uppercase text-muted hover:text-[var(--reverie-accent)] hover:border-[var(--reverie-accent)] transition-colors"
          title="Import YouTube URL or Playlist"
        >
          <span className="material-symbols-outlined text-[20px] align-middle">link</span>
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.85 }}
          type="button"
          onClick={voice}
          className={`rounded-lg border border-border px-2 font-mono text-[10px] uppercase ${
            listening ? 'border-[var(--reverie-accent,#C8F23A)] text-[var(--reverie-accent,#C8F23A)]' : 'text-muted'
          }`}
          aria-label="Voice search"
        >
          <span className="material-symbols-outlined text-[20px] align-middle">mic</span>
        </motion.button>
      </div>

      {isYtUrl && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 rounded-2xl border border-[var(--reverie-accent)]/30 bg-surface2/60 p-4 backdrop-blur-md"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--reverie-accent)] text-background font-bold">
              <span className="material-symbols-outlined text-2xl">playlist_play</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-headline text-sm font-bold text-white mb-1">
                YouTube Link Detected
              </h3>
              <p className="font-body text-xs text-muted mb-3 truncate">
                {debounced}
              </p>
              <button
                type="button"
                onClick={() => {
                  setYtModalUrl(debounced);
                  setShowYouTubeModal(true);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--reverie-accent)] px-3.5 py-1.5 font-mono text-xs font-bold uppercase text-background transition hover:opacity-90 active:scale-95"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                Load & Play Playlist
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {showEmpty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface2">
            <span className="material-symbols-outlined text-3xl text-muted/30">search</span>
          </div>
          <p className="font-headline text-base font-bold text-muted mb-1">Find your vibe</p>
          <p className="font-body text-xs text-muted/60">Search for songs, artists, or moods</p>
        </div>
      ) : searching ? (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="relative mb-6 h-16 w-16">
            <div className="absolute inset-0 rounded-full border-2 border-[var(--reverie-accent,#C8F23A)]/20" />
            <div className="absolute inset-2 rounded-full border-2 border-[var(--reverie-accent,#C8F23A)]/40 animate-ping" style={{ animationDuration: '1.5s' }} />
            <div className="absolute inset-4 rounded-full border-2 border-[var(--reverie-accent,#C8F23A)]/60 animate-ping" style={{ animationDuration: '1.5s', animationDelay: '0.2s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-[var(--reverie-accent,#C8F23A)] animate-pulse">graphic_eq</span>
            </div>
          </div>
          <p className="font-headline text-sm font-bold text-onSurface mb-1">Searching</p>
          <p className="font-mono text-xs text-muted/60">"{debounced}"</p>
          <div className="mt-4 flex gap-1">
            <div className="h-1 w-1 rounded-full bg-[var(--reverie-accent,#C8F23A)] animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="h-1 w-1 rounded-full bg-[var(--reverie-accent,#C8F23A)] animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="h-1 w-1 rounded-full bg-[var(--reverie-accent,#C8F23A)] animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      ) : results.length === 0 && q.trim() ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface2">
            <span className="material-symbols-outlined text-3xl text-muted/30">search_off</span>
          </div>
          <p className="font-headline text-base font-bold text-muted mb-1">No results</p>
          <p className="font-body text-xs text-muted/60">We couldn't find anything for "{q}"</p>
        </div>
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-3"
        >
          {results.map((tr) => (
            <motion.div
              key={tr.id}
              variants={staggerItemFast}
              className={`flex w-full items-center gap-3 group py-1 ${loadingId === tr.id ? 'opacity-50' : ''}`}
            >
              <motion.button
                whileTap={{ scale: 0.97 }}
                className="flex flex-1 min-w-0 items-center gap-3 text-left"
                disabled={loadingId === tr.id}
                onClick={() => onPick(tr)}
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface2 ring-1 ring-white/5">
                  {tr.thumbnail ? (
                    <img src={tr.thumbnail} alt="" loading="lazy" width="44" height="44" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-[9px] text-muted">Rev</div>
                  )}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-body text-xs font-bold text-onSurface group-hover:text-[var(--reverie-accent,#C8F23A)] transition-colors">
                    {tr.title}
                  </p>
                  <p className="truncate font-body text-[10px] text-muted mt-0.5">{tr.artist}</p>
                </div>
              </motion.button>
              <div className="flex shrink-0 items-center justify-center w-10">
                {loadingId === tr.id ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--reverie-accent,#C8F23A)] border-t-transparent" />
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.85 }}
                    onClick={() => setMenuTrack(tr)}
                    className="p-2 text-muted/50 hover:text-white transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">more_vert</span>
                  </motion.button>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {menuTrack && <TrackContextMenu track={menuTrack} onClose={() => setMenuTrack(null)} />}

      {showYouTubeModal && (
        <YouTubeImportModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
          initialUrl={ytModalUrl}
        />
      )}
    </div>
  );
}
