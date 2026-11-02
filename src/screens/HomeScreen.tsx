import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { useSettings } from '@/contexts/SettingsContext';
import { api } from '@/services/api';
import { TrackContextMenu } from '@/components/TrackContextMenu';
import { staggerContainer, staggerItem } from '@/lib/animations';
import type { Track } from '@/types';

function buildSearchQueryFromHistory(history: Track[]): string {
  if (history.length > 0) {
    const genres: Record<string, number> = {};
    history.forEach((t) => {
      const parts = t.artist.split(/[,&]/);
      parts.forEach((p) => {
        const trimmed = p.trim();
        if (trimmed) genres[trimmed] = (genres[trimmed] || 0) + 1;
      });
    });
    const topGenres = Object.entries(genres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1);
    if (topGenres.length > 0) {
      return `new ${topGenres[0][0]} songs 2025`;
    }
    return `songs similar to ${history[0].artist} 2025`;
  }
  return 'new releases punjabi hindi english 2025';
}

// Cache to prevent flicker on back navigation
let globalHomeData: {
  personalized: Track[];
  trending: Track[];
  quickPicks: Track[];
  newReleases: Track[];
} | null = null;
let globalLoading = true;

interface SectionProps {
  tracks: Track[];
  onPlay: (tr: Track, context: Track[]) => void;
  onOpenMenu?: (tr: Track) => void;
}

function TrendingSection({ tracks, onPlay }: SectionProps) {
  if (!tracks.length) return null;
  return (
    <motion.section
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mb-10"
    >
      <div className="mb-4 flex items-end justify-between px-1">
        <h2 className="font-headline text-xl font-extrabold uppercase tracking-tighter">Trending</h2>
        <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-muted mb-0.5 opacity-50">Global Chart</span>
      </div>
      <div className="flex gap-3.5 overflow-x-auto pb-4 scrollbar-none snap-x">
        {tracks.slice(0, 8).map((tr, idx) => (
          <motion.button
            key={tr.id}
            variants={staggerItem}
            whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.2 } }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={() => onPlay(tr, tracks)}
            className="w-[180px] shrink-0 text-left snap-start group"
          >
            <div className="relative mb-3 aspect-square overflow-hidden rounded-xl bg-surface2 shadow-lg ring-1 ring-white/5">
              <img src={tr.thumbnail} alt="" loading="lazy" width="180" height="180" className="h-full w-full object-cover" />
              <div className="absolute bottom-3 left-3 h-6 w-6 flex items-center justify-center bg-[var(--reverie-accent,#C8F23A)] font-mono text-[9px] font-bold text-background rounded-sm">
                {(idx + 1).toString().padStart(2, '0')}
              </div>
            </div>
            <div className="px-0.5">
              <h3 className="truncate font-body text-sm font-bold text-onSurface leading-tight">{tr.title}</h3>
              <p className="truncate font-body text-[10px] text-muted mt-0.5">{tr.artist}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}

function QuickPicksBento({ tracks, onPlay }: SectionProps) {
  if (tracks.length < 3) return null;
  const [featured, ...others] = tracks;

  return (
    <motion.section
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mb-10"
    >
      <div className="mb-4 px-1">
        <h2 className="font-headline text-xl font-extrabold uppercase tracking-tighter">Quick Picks</h2>
        <p className="font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--reverie-accent,#C8F23A)]">Based on Activity</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <motion.button
          variants={staggerItem}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onPlay(featured, tracks)}
          className="col-span-2 relative flex items-center gap-3 rounded-2xl bg-surface/50 p-3 ring-1 ring-white/5 hover:bg-surface"
        >
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg">
            <img src={featured.thumbnail} alt="" loading="lazy" width="64" height="64" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="font-mono text-[7px] uppercase tracking-[0.2em] text-[var(--reverie-accent,#C8F23A)] mb-0.5">Recent</p>
            <h3 className="truncate font-headline text-lg font-extrabold uppercase tracking-tighter text-onSurface">{featured.title}</h3>
            <p className="truncate font-body text-[10px] text-muted">{featured.artist}</p>
          </div>
          <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-[var(--reverie-accent,#C8F23A)] text-background shadow-md">
            <span className="material-symbols-outlined fill-current text-lg ml-0.5">play_arrow</span>
          </div>
        </motion.button>

        {others.slice(0, 2).map((tr) => (
          <motion.button
            key={tr.id}
            variants={staggerItem}
            whileHover={{ y: -3, scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onPlay(tr, tracks)}
            className="group text-left"
          >
            <div className="mb-2 aspect-square overflow-hidden rounded-xl bg-surface ring-1 ring-white/5">
              <img src={tr.thumbnail} alt="" loading="lazy" width="80" height="80" className="h-full w-full object-cover" />
            </div>
            <h4 className="truncate font-body text-xs font-bold text-onSurface leading-tight">{tr.title}</h4>
            <p className="truncate font-body text-[9px] text-muted">{tr.artist}</p>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}

function NewReleasesSection({ tracks, onPlay, onOpenMenu }: SectionProps) {
  if (!tracks.length) return null;
  return (
    <motion.section
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className="mb-10"
    >
      <div className="mb-4 px-1">
        <h2 className="font-headline text-xl font-extrabold uppercase tracking-tighter">New Releases</h2>
      </div>
      <div className="space-y-2">
        {tracks.slice(0, 5).map((tr) => (
          <motion.div
            key={tr.id}
            variants={staggerItem}
            whileHover={{ x: 3 }}
            className="flex w-full items-center gap-3 group py-1"
          >
            <motion.button
              whileTap={{ scale: 0.97 }}
              className="flex flex-1 min-w-0 items-center gap-3 text-left"
              onClick={() => onPlay(tr, tracks)}
            >
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface ring-1 ring-white/5">
                <img src={tr.thumbnail} alt="" loading="lazy" width="44" height="44" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <h4 className="truncate font-body text-xs font-bold text-onSurface group-hover:text-[var(--reverie-accent,#C8F23A)] transition-colors">{tr.title}</h4>
                <p className="truncate font-body text-[10px] text-muted">{tr.artist}</p>
              </div>
            </motion.button>
            <div className="flex shrink-0 items-center gap-2">
              <span className="badge-mono border-none py-0 px-1 opacity-50">Master</span>
              {onOpenMenu && (
                <motion.button
                  whileTap={{ scale: 0.85 }}
                  onClick={() => onOpenMenu(tr)}
                  className="p-2 text-muted/30 hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">more_vert</span>
                </motion.button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

export function HomeScreen() {
  const { playTrack, history } = useAudio();
  const { languages } = useSettings();
  const [data, setData] = useState(
    globalHomeData || { personalized: [], trending: [], quickPicks: [], newReleases: [] }
  );
  const [loading, setLoading] = useState(globalLoading);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);

  useEffect(() => {
    // If we already have cached data, don't show loading shimmer
    if (globalHomeData && (globalHomeData.trending.length > 0 || globalHomeData.quickPicks.length > 0)) {
      setLoading(false);
    }

    let cancelled = false;
    const fetchData = async () => {
      try {
        const hasHistory = history.length > 0;
        const searchQuery = buildSearchQueryFromHistory(history);
        const res = await api.getHomeData(searchQuery, hasHistory, languages, 'guest');
        if (!cancelled) {
          const hasItems = (res.trending?.length || 0) > 0 || (res.quickPicks?.length || 0) > 0 || (res.newReleases?.length || 0) > 0;
          if (hasItems) {
            const newData = {
              personalized: res.personalized || [],
              trending: res.trending || [],
              quickPicks: res.quickPicks || [],
              newReleases: res.newReleases || [],
            };
            globalHomeData = newData;
            globalLoading = false;
            setData(newData);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [languages, history.length]);

  const handlePlay = useCallback((tr: Track, context: Track[]) => {
    void playTrack(tr, context);
  }, [playTrack]);

  return (
    <div className="px-5 pt-8 pb-8">
      {loading ? (
        <div className="space-y-10">
          <div>
            <div className="mb-4 h-6 w-24 rounded shimmer" />
            <div className="flex gap-3.5 overflow-x-auto pb-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="w-[180px] shrink-0">
                  <div className="mb-3 aspect-square rounded-xl shimmer" />
                  <div className="h-3 w-3/4 rounded shimmer mb-1" />
                  <div className="h-2 w-1/2 rounded shimmer" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-4 h-6 w-28 rounded shimmer" />
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 h-24 rounded-2xl shimmer" />
              <div className="h-32 rounded-xl shimmer" />
              <div className="h-32 rounded-xl shimmer" />
            </div>
          </div>
          <div>
            <div className="mb-4 h-6 w-28 rounded shimmer" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="h-11 w-11 shrink-0 rounded-lg shimmer" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-3/4 rounded shimmer" />
                  <div className="h-2 w-1/2 rounded shimmer" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <TrendingSection tracks={data.trending} onPlay={handlePlay} />
          <QuickPicksBento tracks={data.quickPicks} onPlay={handlePlay} />
          <NewReleasesSection tracks={data.newReleases} onPlay={handlePlay} onOpenMenu={setMenuTrack} />
        </>
      )}

      {menuTrack && <TrackContextMenu track={menuTrack} onClose={() => setMenuTrack(null)} />}
    </div>
  );
}
