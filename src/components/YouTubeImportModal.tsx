import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { api, YouTubeExtractResult } from '@/services/api';

interface YouTubeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  onSuccess?: () => void;
}

export function YouTubeImportModal({
  isOpen,
  onClose,
  initialUrl = '',
  onSuccess,
}: YouTubeImportModalProps) {
  const { playTrack, setQueueOrder } = useAudio();
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [extractData, setExtractData] = useState<YouTubeExtractResult | null>(null);
  const [playlistName, setPlaylistName] = useState('');
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (initialUrl && initialUrl.trim().length > 0) {
      setUrl(initialUrl);
      void handleFetch(initialUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        void handleFetch(text.trim());
      }
    } catch {
      // clipboard permission denied — user can type manually
    }
  };

  const handleFetch = async (targetUrl?: string) => {
    const toFetch = (targetUrl || url).trim();
    if (!toFetch) return;
    setError(null);
    setLoading(true);
    setExtractData(null);
    try {
      const res = await api.extractYouTubeUrl(toFetch);
      if (!res.tracks || res.tracks.length === 0)
        throw new Error('No playable tracks found in this YouTube link.');
      setExtractData(res);
      setPlaylistName(res.title || 'YouTube Playlist');
      setSelectedTrackId(
        res.selected_id && res.tracks.some(t => t.id === res.selected_id)
          ? res.selected_id
          : res.tracks[0]?.id ?? null
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to extract playlist. Check the URL.');
    } finally {
      setLoading(false);
    }
  };

  const getOrderedTracks = () => {
    if (!extractData || extractData.tracks.length === 0)
      throw new Error('No tracks available');
    const tracks = extractData.tracks;
    const idx = selectedTrackId ? tracks.findIndex(t => t.id === selectedTrackId) : 0;
    const start = idx >= 0 ? idx : 0;
    return {
      startTrack: tracks[start],
      upcomingTracks: [...tracks.slice(start + 1), ...tracks.slice(0, start)],
    };
  };

  const handlePlayNow = async () => {
    if (!extractData) return;
    try {
      setSaving(true);
      const { startTrack, upcomingTracks } = getOrderedTracks();
      await playTrack(startTrack, upcomingTracks);
      setQueueOrder(upcomingTracks);
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      setError('Error starting playback: ' + (err as Error)?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToPlaylist = async (autoPlay = false) => {
    if (!extractData) return;
    const finalName = playlistName.trim() || extractData.title || 'YouTube Playlist';
    try {
      setSaving(true);
      await api.importYouTubePlaylist(finalName, extractData.tracks);
      window.dispatchEvent(new CustomEvent('playlists-updated'));
      if (autoPlay) {
        const { startTrack, upcomingTracks } = getOrderedTracks();
        await playTrack(startTrack, upcomingTracks);
        setQueueOrder(upcomingTracks);
      }
      onClose();
      onSuccess?.();
    } catch (err: unknown) {
      setError('Failed to create playlist: ' + (err as Error)?.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d0d] shadow-2xl flex flex-col my-auto overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-white/[0.07]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--reverie-accent)] text-background">
              <span className="material-symbols-outlined text-base" style={{ fontSize: 16 }}>playlist_play</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-headline text-sm font-extrabold uppercase tracking-tight text-white leading-tight">
                YouTube Playlist
              </p>
              <p className="font-mono text-[9px] text-muted leading-none mt-0.5">
                Import or play YouTube / YTM URLs
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-white hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* URL Input */}
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted mb-1.5 font-semibold">
                YouTube URL or playlist link
              </p>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleFetch(); } }}
                    placeholder="https://www.youtube.com/watch?v=…&list=…"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 font-body text-[11px] text-onSurface placeholder:text-muted/40 focus:border-[var(--reverie-accent)] focus:outline-none transition-colors pr-7"
                  />
                  {url && (
                    <button
                      type="button"
                      onClick={() => { setUrl(''); setExtractData(null); setError(null); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted/60 hover:text-white"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="shrink-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-[9px] uppercase font-bold text-muted hover:bg-white/10 hover:text-white transition-all"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>content_paste</span>
                  Paste
                </button>
                <button
                  type="button"
                  onClick={() => handleFetch()}
                  disabled={loading || !url.trim()}
                  className="shrink-0 flex items-center gap-1 rounded-lg bg-[var(--reverie-accent)] px-3 py-2 font-mono text-[9px] font-bold uppercase text-background transition hover:opacity-90 active:scale-95 disabled:opacity-40"
                >
                  {loading ? (
                    <span className="material-symbols-outlined animate-spin" style={{ fontSize: 12 }}>refresh</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>download</span>
                  )}
                  Fetch
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
                <span className="material-symbols-outlined text-red-400 shrink-0 mt-px" style={{ fontSize: 13 }}>error</span>
                <p className="font-body text-[11px] text-red-300 leading-snug">{error}</p>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div className="py-8 flex flex-col items-center justify-center gap-3">
                <div className="relative h-10 w-10">
                  <div className="absolute inset-0 rounded-full border-2 border-[var(--reverie-accent)]/20 border-t-[var(--reverie-accent)] animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[var(--reverie-accent)]" style={{ fontSize: 18 }}>graphic_eq</span>
                  </div>
                </div>
                <p className="font-body text-[11px] text-muted">Fetching playlist via yt-dlp…</p>
              </div>
            )}

            {/* Playlist preview */}
            {extractData && !loading && (
              <div className="space-y-3">
                {/* Info card */}
                <div className="flex gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                  {extractData.thumbnail ? (
                    <img
                      src={extractData.thumbnail}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-muted">
                      <span className="material-symbols-outlined" style={{ fontSize: 22 }}>queue_music</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="rounded-full bg-[var(--reverie-accent)]/15 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-[var(--reverie-accent)]">
                        {extractData.type === 'playlist' ? 'Playlist' : 'Video'}
                      </span>
                      <span className="font-mono text-[9px] text-muted">
                        {extractData.count} {extractData.count === 1 ? 'track' : 'tracks'}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={playlistName}
                      onChange={e => setPlaylistName(e.target.value)}
                      className="bg-transparent font-body text-sm font-bold text-white border-b border-white/15 focus:border-[var(--reverie-accent)] outline-none py-0.5 w-full truncate"
                    />
                    {extractData.author && (
                      <p className="font-body text-[10px] text-muted mt-0.5 truncate">
                        by {extractData.author}
                      </p>
                    )}
                  </div>
                </div>

                {/* Track list */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted font-semibold">
                      Track list ({extractData.tracks.length})
                    </p>
                    <p className="font-mono text-[8px] text-muted/50">Tap to set start</p>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/30 divide-y divide-white/[0.04]">
                    {extractData.tracks.map((t, idx) => {
                      const isSelected = selectedTrackId === t.id;
                      return (
                        <button
                          key={`${t.id}-${idx}`}
                          type="button"
                          onClick={() => setSelectedTrackId(t.id)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition ${
                            isSelected
                              ? 'bg-[var(--reverie-accent)]/10'
                              : 'hover:bg-white/[0.04]'
                          }`}
                        >
                          <span className={`font-mono text-[9px] w-4 text-center shrink-0 ${isSelected ? 'text-[var(--reverie-accent)]' : 'text-muted/50'}`}>
                            {idx + 1}
                          </span>
                          {t.thumbnail ? (
                            <img src={t.thumbnail} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                          ) : (
                            <div className="h-7 w-7 shrink-0 rounded bg-white/10" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className={`truncate font-body text-[11px] font-medium ${isSelected ? 'text-[var(--reverie-accent)]' : 'text-onSurface'}`}>
                              {t.title}
                            </p>
                            <p className="truncate font-body text-[9px] text-muted">{t.artist}</p>
                          </div>
                          {isSelected && (
                            <span className="shrink-0 font-mono text-[8px] font-bold text-[var(--reverie-accent)] uppercase tracking-wide">
                              Start
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-white/[0.07] flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[9px] font-semibold uppercase text-muted hover:text-white transition-colors px-2 py-1.5"
            >
              Cancel
            </button>

            <div className="flex-1" />

            {extractData ? (
              <>
                <button
                  type="button"
                  onClick={handlePlayNow}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 font-mono text-[9px] font-bold uppercase text-white transition active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>play_circle</span>
                  Play queue
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveToPlaylist(false)}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1.5 font-mono text-[9px] font-bold uppercase text-white transition active:scale-95 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>bookmark_add</span>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveToPlaylist(true)}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--reverie-accent)] px-3 py-1.5 font-mono text-[9px] font-bold uppercase text-background shadow-md shadow-[var(--reverie-accent)]/20 transition hover:opacity-90 active:scale-95 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13 }}>refresh</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>play_arrow</span>
                  )}
                  Save &amp; play
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleFetch()}
                disabled={loading || !url.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--reverie-accent)] px-4 py-1.5 font-mono text-[9px] font-bold uppercase text-background transition hover:opacity-90 active:scale-95 disabled:opacity-40"
              >
                {loading ? (
                  <span className="material-symbols-outlined animate-spin" style={{ fontSize: 13 }}>refresh</span>
                ) : (
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>arrow_forward</span>
                )}
                Load playlist
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
