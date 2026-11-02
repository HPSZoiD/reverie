import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAudio } from '@/contexts/AudioContext';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TrackContextMenu } from '@/components/TrackContextMenu';
import { springBouncy, springStiff, smooth, staggerContainer, staggerItemFast, scaleIn, layoutIds } from '@/lib/animations';
import type { TransitionTier, Track } from '@/types';
import { getCachedAlbumArt, ProcessedArt } from '@/utils/album-processor';

type DndTrack = Track & { _dndId: string };

function SortableTrackItem({ tr, onPlay }: { tr: DndTrack; onPlay: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tr._dndId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    opacity: isDragging ? 0.9 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`group flex w-full items-center gap-2 rounded-lg p-1 transition-colors ${isDragging ? 'bg-surface2 shadow-xl ring-1 ring-[var(--reverie-accent,#C8F23A)]/50' : 'hover:bg-surface2'}`}>
      <div {...attributes} {...listeners} className="touch-none flex items-center justify-center p-2 text-muted/50 cursor-grab active:cursor-grabbing hover:text-white transition-colors">
        <span className="material-symbols-outlined text-[18px]">drag_indicator</span>
      </div>
      <button
        type="button"
        onClick={() => {
          const btn = document.activeElement as HTMLButtonElement;
          btn?.blur();
          onPlay();
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left p-1"
      >
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-surface2 ring-1 ring-border group-hover:ring-[var(--reverie-accent,#C8F23A)]/50">
          {tr.thumbnail && <img src={tr.thumbnail} alt="" loading="lazy" width="40" height="40" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
            <span className="material-symbols-outlined text-[16px] text-white">play_arrow</span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-body text-xs font-medium text-onSurface group-hover:text-[var(--reverie-accent,#C8F23A)]">{tr.title}</p>
          <p className="truncate font-body text-[10px] text-muted">{tr.artist}</p>
        </div>
      </button>
    </div>
  );
}

function tierLabel(t: TransitionTier | null | undefined): string {
  if (!t || t === 'IDLE' || t === 'ANALYZING') return '—';
  return t.replace(/_/g, ' ');
}

export function NowPlayingScreen() {
  const nav = useNavigate();
  const {
    currentTrack, nextTrack, bpm, nextBpm, tier, progress, duration, mixPointAt,
    isPlaying, transitionActive, pause, resume, seek, skipToNext, skipToPrevious,
    queue, playTrack, likedSongs, toggleLike, sleepTimerUntil, setSleepTimer, setQueueOrder,
    upcomingTier,
  } = useAudio();

  const isLiked = likedSongs.some((s) => s.id === currentTrack?.id);
  const [showQueue, setShowQueue] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [queueWithIds, setQueueWithIds] = useState<DndTrack[]>([]);
  useEffect(() => {
    setQueueWithIds(prev => queue.map((tr, i) => {
      const existing = prev[i];
      if (existing && existing.id === tr.id) return existing;
      return { ...tr, _dndId: `${tr.id}-${Math.random().toString(36).substr(2, 5)}` };
    }));
  }, [queue]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = queueWithIds.findIndex((x) => x._dndId === active.id);
      const newIndex = queueWithIds.findIndex((x) => x._dndId === over.id);
      setQueueOrder(arrayMove(queue, oldIndex, newIndex));
    }
  };

  const handleDownload = async () => {
    if (!currentTrack?.audio_url || isDownloading) return;
    try {
      setIsDownloading(true);
      const res = await fetch(currentTrack.audio_url);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${currentTrack.artist} - ${currentTrack.title}.m4a`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      console.error('[Reverie] Download failed', e);
    } finally {
      setIsDownloading(false);
      setShowMoreMenu(false);
    }
  };

  const mixBar = useMemo(() => {
    if (!mixPointAt || !duration) return 0;
    return Math.min(1, (progress * duration) / mixPointAt);
  }, [mixPointAt, duration, progress]);

  const fmt = (s: number) => {
    if (!s || !Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    seek(x * duration);
  };

  if (!currentTrack) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6">
        <p className="font-body text-muted">Nothing playing</p>
        <motion.button
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={() => nav('/search')}
          className="rounded-lg bg-[var(--reverie-accent,#C8F23A)] px-4 py-2 font-mono text-sm font-medium text-background"
        >
          Find music
        </motion.button>
      </div>
    );
  }

  const thumb = currentTrack.thumbnail;

  const [processedArt, setProcessedArt] = useState<ProcessedArt | null>(null);
  useEffect(() => {
    if (thumb) {
      getCachedAlbumArt(thumb, 'cinematic').then(setProcessedArt).catch(console.error);
    } else {
      setProcessedArt(null);
    }
  }, [thumb]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: smooth }}
      className="relative min-h-[100dvh] overflow-y-auto scrollbar-none pb-6"
    >
      {thumb && (
        <div
          className="fixed inset-0 scale-110 bg-cover bg-center blur-3xl opacity-40"
          style={{ backgroundImage: `url(${thumb})` }}
        />
      )}
      <div className="fixed inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />

      <header className="relative z-50 flex items-center justify-between px-4 pt-4">
        <motion.button
          whileTap={{ scale: 0.85 }}
          type="button"
          onClick={() => nav(-1)}
          className="rounded-full p-2 text-onSurface hover:bg-surface2"
          aria-label="Back"
        >
          <span className="material-symbols-outlined">keyboard_arrow_down</span>
        </motion.button>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Now Playing</span>
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.85 }}
            type="button"
            className={`rounded-full p-2 hover:bg-surface2 transition-colors ${showMoreMenu ? 'text-[var(--reverie-accent,#C8F23A)] bg-surface2' : 'text-onSurface'}`}
            aria-label="More"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
          >
            <span className="material-symbols-outlined">more_vert</span>
          </motion.button>

          <AnimatePresence>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <motion.div
                  key="more-menu"
                  variants={scaleIn}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="absolute right-0 top-full z-50 mt-2 w-48 origin-top-right rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl"
                >
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    variants={staggerItemFast}
                    onClick={() => { setShowMoreMenu(false); setMenuTrack(currentTrack); }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-body text-xs text-onSurface hover:bg-surface2 transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">playlist_add</span>
                    Add to Playlist
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    variants={staggerItemFast}
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left font-body text-xs transition-colors ${isDownloading ? 'text-muted cursor-not-allowed' : 'text-onSurface hover:bg-surface2'}`}
                  >
                    <span className={`material-symbols-outlined text-lg ${isDownloading ? 'animate-pulse' : ''}`}>
                      {isDownloading ? 'downloading' : 'download'}
                    </span>
                    {isDownloading ? 'Downloading...' : 'Download Track'}
                  </motion.button>

                  <div className="my-1.5 h-[1px] w-full bg-border/50" />
                  <div className="px-3 pb-1 pt-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">Sleep Timer</div>

                  {[15, 30, 60].map(mins => {
                    const isActive = sleepTimerUntil !== null && Math.abs(sleepTimerUntil - Date.now() - mins * 60000) < 60000;
                    return (
                      <motion.button
                        key={mins}
                        variants={staggerItemFast}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => { setSleepTimer(mins); setShowMoreMenu(false); }}
                        className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-body text-xs transition-colors ${isActive ? 'bg-[var(--reverie-accent,#C8F23A)]/10 text-[var(--reverie-accent,#C8F23A)]' : 'text-onSurface hover:bg-surface2'}`}
                      >
                        <span className="flex items-center gap-3">
                          <span className={`material-symbols-outlined text-lg ${isActive ? '' : 'text-muted group-hover:text-onSurface'}`}>schedule</span>
                          {mins} minutes
                        </span>
                        {isActive && <span className="material-symbols-outlined text-[14px]">check</span>}
                      </motion.button>
                    );
                  })}

                  {sleepTimerUntil && (
                    <motion.button
                      variants={staggerItemFast}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => { setSleepTimer(null); setShowMoreMenu(false); }}
                      className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-body text-xs text-error transition-colors hover:bg-error/10"
                    >
                      <span className="material-symbols-outlined text-lg">timer_off</span>
                      Cancel Timer
                    </motion.button>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center px-6 pt-4">
        {/* Album Art */}
        <div className="relative mb-4 w-full max-w-[304px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentTrack.id}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1, transition: springBouncy }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
            >
              {thumb && (
                <div
                  className="pointer-events-none animate-halo-pulse absolute inset-0 opacity-70 blur-[50px]"
                  style={{ backgroundImage: `url(${thumb})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                />
              )}
              <div className="pointer-events-none absolute -inset-8 rounded-full bg-[var(--reverie-accent,#C8F23A)]/20 blur-[80px]" />
              <motion.div
                layoutId={layoutIds.albumArt(currentTrack.id)}
                className="relative z-10 aspect-square w-full overflow-hidden rounded-xl shadow-[0_0_80px_rgba(0,0,0,0.5)] ring-1 ring-border/50"
              >
                {thumb ? (
                  <>
                    <img 
                      src={processedArt?.dataUrl || thumb} 
                      alt="" 
                      loading="eager" 
                      width="400" 
                      height="400" 
                      className={`h-full w-full object-cover transition-all duration-700 ${processedArt?.cssClass || ''}`} 
                    />
                    <div className="album-grain" />
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-surface2 font-mono text-muted text-xs">No art</div>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Track Info + Like */}
        <div className="mb-4 flex w-full max-w-xs items-start justify-between gap-4 px-1">
          <div className="min-w-0 flex-1 text-left">
            <AnimatePresence mode="wait">
              <motion.h1
                key={currentTrack.id}
                initial={{ y: 12, opacity: 0 }}
                animate={{ y: 0, opacity: 1, transition: smooth }}
                exit={{ y: -12, opacity: 0, transition: { duration: 0.12 } }}
                className="truncate font-headline text-xl font-extrabold uppercase leading-tight tracking-tight text-onSurface"
              >
                {currentTrack.title}
              </motion.h1>
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.p
                key={`artist-${currentTrack.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.05 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="mt-0.5 truncate font-body text-xs text-muted/70 tracking-wide uppercase"
              >
                {currentTrack.artist}
              </motion.p>
            </AnimatePresence>
          </div>
          <motion.button
            whileTap={{ scale: 0.75 }}
            type="button"
            onClick={() => toggleLike(currentTrack)}
            className="flex h-10 w-10 items-center justify-center rounded-full"
          >
            <motion.span
              key={isLiked ? 'liked' : 'unliked'}
              initial={{ scale: 0 }}
              animate={{ scale: 1, transition: springBouncy }}
              className={`material-symbols-outlined text-2xl transition-colors duration-300 ${
                isLiked ? 'fill-1 text-[var(--reverie-accent,#C8F23A)]' : 'text-muted'
              }`}
            >
              favorite
            </motion.span>
          </motion.button>
        </div>

        {/* Progress Bar */}
        <div className="mb-1 w-full max-w-xs font-mono text-[10px] text-muted">
          <div className="flex justify-between">
            <span>{fmt(progress * duration)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
        <div
          role="slider"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={progress * duration}
          className="mb-8 h-1.5 w-full max-w-xs cursor-pointer rounded-full bg-border"
          onClick={onSeek}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek(Math.min(duration, progress * duration + 5));
            if (e.key === 'ArrowLeft') seek(Math.max(0, progress * duration - 5));
          }}
        >
          <motion.div
            className="relative h-full rounded-full bg-[var(--reverie-accent,#C8F23A)]"
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 150, damping: 25 }}
          >
            <div className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-onSurface shadow" />
          </motion.div>
        </div>

        {/* Playback Controls */}
        <div className="mb-6 flex items-center justify-center gap-4">
          <motion.button
            whileTap={{ scale: 0.85 }}
            type="button"
            onClick={skipToPrevious}
            className="rounded-full p-2.5 text-onSurface hover:bg-surface2"
            aria-label="Previous"
          >
            <span className="material-symbols-outlined text-2xl">skip_previous</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.85 }}
            type="button"
            onClick={() => (isPlaying ? pause() : resume())}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--reverie-accent,#C8F23A)] text-background shadow-lg shadow-[var(--reverie-accent,#C8F23A)]/25"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={isPlaying ? 'np-pause' : 'np-play'}
                initial={{ scale: 0.5, opacity: 0, rotate: -30 }}
                animate={{ scale: 1, opacity: 1, rotate: 0, transition: springBouncy }}
                exit={{ scale: 0.5, opacity: 0, rotate: 30, transition: { duration: 0.1 } }}
                className="material-symbols-outlined text-3xl font-bold"
              >
                {isPlaying ? 'pause' : 'play_arrow'}
              </motion.span>
            </AnimatePresence>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.85 }}
            type="button"
            onClick={skipToNext}
            className="rounded-full p-2.5 text-onSurface hover:bg-surface2"
            aria-label="Next"
          >
            <span className="material-symbols-outlined text-2xl">skip_next</span>
          </motion.button>
        </div>

        {/* AutoMix Panel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.2, ...smooth } }}
          className="w-full max-w-xs rounded-xl border border-border bg-surface/90 p-3.5 shadow-xl backdrop-blur-md"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-muted">Automix</span>
            <motion.span
              animate={transitionActive ? { scale: [1, 1.05, 1] } : {}}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className={`flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase ${
                transitionActive ? 'text-[var(--reverie-accent,#C8F23A)]' : 'text-onSurface'
              }`}
            >
              {tierLabel(upcomingTier ?? tier)}
              <motion.span
                animate={transitionActive ? { scale: [1, 1.5, 1], opacity: [1, 0.5, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  transitionActive ? 'bg-[var(--reverie-accent,#C8F23A)]' : 'bg-muted'
                }`}
              />
            </motion.span>
          </div>
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-muted">
            <span>{bpm != null ? `${Math.round(bpm)} BPM` : '— BPM'}</span>
            <span className="text-border">────────</span>
            <span>{nextBpm != null ? `${Math.round(nextBpm)} BPM` : '— BPM'}</span>
          </div>
          <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <motion.div
              className={`h-full rounded-full ${transitionActive ? 'bg-[var(--reverie-accent,#C8F23A)]' : 'bg-muted'}`}
              animate={{ width: `${Math.min(100, mixBar * 100)}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 20 }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 font-body text-[10px] text-muted">
            <span className="min-w-0 flex-1 truncate text-left opacity-60 uppercase tracking-tighter">↑ {currentTrack.title}</span>
            <span className="min-w-0 flex-1 truncate text-right opacity-60 uppercase tracking-tighter">
              {nextTrack ? `${nextTrack.title} ↑` : '—'}
            </span>
          </div>
        </motion.div>

        {/* Queue Toggle Button */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowQueue(!showQueue)}
          className="mt-3 flex w-full max-w-xs items-center justify-between rounded-xl border border-border bg-surface/40 p-3 shadow-lg backdrop-blur-md hover:bg-surface/60 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-muted">queue_music</span>
            <span className="font-headline text-xs font-extrabold uppercase tracking-tight text-onSurface">Up Next</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--reverie-accent,#C8F23A)] font-bold">
              {queue.length} Tracks
            </span>
            <motion.span
              animate={{ rotate: showQueue ? 180 : 0 }}
              transition={springStiff}
              className="material-symbols-outlined text-muted text-[20px]"
            >
              expand_more
            </motion.span>
          </div>
        </motion.button>

        {/* Inline Queue List */}
        <AnimatePresence>
          {showQueue && (
            <motion.div
              key="queue-list"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1, transition: { duration: 0.35, ease: [0.32, 0.72, 0, 1] } }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
              className="w-full max-w-sm overflow-hidden"
            >
              <div className="mt-3 rounded-xl border border-border bg-surface/40 p-4 shadow-lg backdrop-blur-md">
                {queueWithIds.length === 0 ? (
                  <div className="py-8 text-center font-mono text-xs text-muted">Queue is empty</div>
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={queueWithIds.map(t => t._dndId)} strategy={verticalListSortingStrategy}>
                      <motion.div
                        variants={staggerContainer}
                        initial="initial"
                        animate="animate"
                        className="flex flex-col gap-2"
                      >
                        {queueWithIds.map((tr) => (
                          <motion.div key={tr._dndId} variants={staggerItemFast}>
                            <SortableTrackItem
                              tr={tr}
                              onPlay={() => { void playTrack(tr); setShowQueue(false); }}
                            />
                          </motion.div>
                        ))}
                      </motion.div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      {menuTrack && <TrackContextMenu track={menuTrack} onClose={() => setMenuTrack(null)} />}
    </motion.div>
  );
}
