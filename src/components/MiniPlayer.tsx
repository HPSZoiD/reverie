import { motion, AnimatePresence } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@/contexts/SettingsContext';
import { springStiff, smooth, layoutIds } from '@/lib/animations';

export function MiniPlayer() {
  const { currentTrack, isPlaying, togglePlay, playNext, playPrevious, progress, duration } = useAudio();
  const { marqueeSpeed } = useSettings();
  const navigate = useNavigate();

  const progressPercent = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          key="miniplayer"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1, transition: springStiff }}
          exit={{ y: 100, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
          className="fixed bottom-[72px] left-0 right-0 z-50 px-3"
        >
          <div className="mx-auto flex h-[72px] max-w-lg overflow-hidden rounded-2xl border border-white/5 bg-[#0D0D0D]/95 shadow-2xl backdrop-blur-xl">
            {/* Track Info */}
            <motion.div
              whileTap={{ scale: 0.96 }}
              className="flex flex-1 cursor-pointer items-center gap-3 px-4"
              onClick={() => navigate('/now-playing')}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface2 ring-1 ring-white/5">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentTrack.id}
                    src={currentTrack.thumbnail}
                    alt=""
                    loading="lazy"
                    width="48"
                    height="48"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1, transition: smooth }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                    className="h-full w-full object-cover"
                    layoutId={layoutIds.albumArt(currentTrack.id)}
                  />
                </AnimatePresence>
              </div>
              <div className="min-w-0 flex-1">
                <div className="overflow-hidden whitespace-nowrap">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentTrack.id}
                      initial={{ y: 12, opacity: 0 }}
                      animate={{ y: 0, opacity: 1, transition: smooth }}
                      exit={{ y: -12, opacity: 0, transition: { duration: 0.12 } }}
                      className={`inline-block font-body text-sm font-bold text-onSurface ${currentTrack.title.length > 20 ? 'animate-marquee' : ''}`}
                      style={{ animationDuration: `${marqueeSpeed}s` }}
                    >
                      <span>{currentTrack.title}</span>
                      {currentTrack.title.length > 20 && <span className="mx-8">{currentTrack.title}</span>}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <motion.p
                  key={`artist-${currentTrack.id}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { delay: 0.05 } }}
                  className="truncate font-body text-[10px] uppercase tracking-widest text-muted mt-0.5"
                >
                  {currentTrack.artist}
                </motion.p>
              </div>
            </motion.div>

            {/* Controls */}
            <div className="flex items-center gap-1 px-4">
              <motion.button
                whileTap={{ scale: 0.85 }}
                type="button"
                onClick={playPrevious}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[24px]">skip_previous</span>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.85 }}
                type="button"
                onClick={togglePlay}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--reverie-accent,#C8F23A)] text-background shadow-lg"
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={isPlaying ? 'pause' : 'play'}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1, transition: springStiff }}
                    exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.1 } }}
                    className="material-symbols-outlined fill-current text-[28px] ml-0.5"
                  >
                    {isPlaying ? 'pause' : 'play_arrow'}
                  </motion.span>
                </AnimatePresence>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.85 }}
                type="button"
                onClick={playNext}
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[24px]">skip_next</span>
              </motion.button>
            </div>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/5">
              <motion.div
                className="h-full bg-[var(--reverie-accent,#C8F23A)]"
                animate={{ width: `${progressPercent}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 30 }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
