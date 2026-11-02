import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { YouTubeImportModal } from '@/components/YouTubeImportModal';
import { staggerContainer, staggerItemFast, springBouncy } from '@/lib/animations';
import type { TransitionTier } from '@/types';

function tierShort(t: TransitionTier | null | undefined): string {
  if (!t || t === 'IDLE' || t === 'ANALYZING') return '—';
  return t;
}

export function QueueScreen() {
  const { queue, currentTrack, nextTrack, upcomingTier, setQueueOrder } = useAudio();
  const [dragId, setDragId] = useState<string | null>(null);
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);

  const rows = useMemo(() => {
    const list = [...queue];
    return list.map((t, i) => ({ t, i }));
  }, [queue]);

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) return;
      const idx = queue.findIndex((x) => x.id === dragId);
      const j = queue.findIndex((x) => x.id === targetId);
      if (idx < 0 || j < 0) return;
      const next = [...queue];
      const [moved] = next.splice(idx, 1);
      next.splice(j, 0, moved);
      setQueueOrder(next);
      setDragId(null);
    },
    [dragId, queue, setQueueOrder]
  );

  return (
    <div className="min-h-[100dvh] px-4 pb-28 pt-8">
      <div className="mb-2 flex items-center justify-between">
        <motion.h1
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: springBouncy }}
          className="font-headline text-2xl font-extrabold uppercase tracking-tight"
        >
          Queue
        </motion.h1>
        <button
          type="button"
          onClick={() => setShowYouTubeModal(true)}
          className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1 font-mono text-[9px] font-bold uppercase text-[var(--reverie-accent)] transition active:scale-95"
          title="Load YouTube Playlist into Queue"
        >
          <span className="material-symbols-outlined text-sm">link</span>
          Load YouTube Link
        </button>
      </div>
      <p className="mb-6 font-mono text-xs text-muted">Drag to reorder upcoming tracks.</p>

      <AnimatePresence>
        {currentTrack && (
          <motion.div
            key="now"
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: springBouncy }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            className="mb-6 rounded-xl border border-[var(--reverie-accent,#C8F23A)]/30 bg-surface p-4"
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--reverie-accent,#C8F23A)]">
              Now
            </p>
            <div className="flex gap-3">
              {currentTrack.thumbnail ? (
                <img src={currentTrack.thumbnail} alt="" className="h-14 w-14 rounded-lg object-cover" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-surface2" />
              )}
              <div className="min-w-0">
                <p className="truncate font-body font-medium">{currentTrack.title}</p>
                <p className="truncate font-body text-sm text-muted">{currentTrack.artist}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.ul
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="space-y-2"
      >
        <AnimatePresence>
          {rows.map(({ t, i }) => {
            const isNext = nextTrack?.id === t.id;
            return (
              <motion.li
                key={`${t.id}-${i}`}
                layout
                variants={staggerItemFast}
                initial="initial"
                animate="animate"
                exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
                whileHover={{ scale: 1.01, x: 2 }}
                whileTap={{ scale: 0.98 }}
                draggable
                onDragStart={() => onDragStart(t.id)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(t.id)}
                className="flex cursor-grab items-center gap-3 rounded-xl border border-border bg-surface p-3 active:cursor-grabbing"
              >
                {t.thumbnail ? (
                  <img src={t.thumbnail} alt="" className="h-12 w-12 rounded-md object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-md bg-surface2" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm font-medium">{t.title}</p>
                  <p className="truncate font-body text-xs text-muted">{t.artist}</p>
                </div>
                <div className="shrink-0 text-right font-mono text-[10px] text-muted">
                  <div>{t.bpm != null ? `${Math.round(t.bpm)} BPM` : '—'}</div>
                  {isNext ? (
                    <div className="mt-1 rounded bg-surface2 px-1.5 py-0.5 text-[9px] uppercase text-[var(--reverie-accent,#C8F23A)]">
                      {tierShort(upcomingTier)}
                    </div>
                  ) : null}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>

      {!queue.length && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.3 } }}
          className="mt-8 font-body text-sm text-muted"
        >
          Queue updates when a track is playing.
        </motion.p>
      )}

      {showYouTubeModal && (
        <YouTubeImportModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
        />
      )}
    </div>
  );
}
