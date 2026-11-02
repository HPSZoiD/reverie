import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { useSettings } from '@/contexts/SettingsContext';
import { api, Playlist } from '@/services/api';
import { TrackContextMenu } from '@/components/TrackContextMenu';
import { YouTubeImportModal } from '@/components/YouTubeImportModal';
import { staggerContainer, staggerItemFast } from '@/lib/animations';
import type { Track } from '@/types';

// Module-level cache for persistent state during session
const libraryCache: {
  playlists: Playlist[] | null;
  playlistTracks: Record<string, Track[]>;
  likedSongs: Track[] | null;
  history: Track[] | null;
} = {
  playlists: null,
  playlistTracks: {},
  likedSongs: null,
  history: null
};

export function LibraryScreen() {
  const { history: audioHistory, likedSongs: audioLiked, playTrack, setQueueOrder } = useAudio();
  const { marqueeSpeed } = useSettings();
  
  const [tab, setTab] = useState<'liked' | 'history' | 'playlists'>('playlists');
  const [playlists, setPlaylists] = useState<Playlist[]>(libraryCache.playlists || []);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showYouTubeModal, setShowYouTubeModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  useEffect(() => {
    if (tab === 'playlists') {
      if (libraryCache.playlists) {
        setPlaylists(libraryCache.playlists);
      } else {
        setLoadingPlaylists(true);
        api.getPlaylists()
          .then(data => {
            libraryCache.playlists = data;
            setPlaylists(data);
          })
          .catch(console.error)
          .finally(() => setLoadingPlaylists(false));
      }
    }
  }, [tab]);

  useEffect(() => {
    const handlePlaylistsUpdated = () => {
      libraryCache.playlists = null;
      libraryCache.playlistTracks = {};
      api.getPlaylists().then(data => {
        libraryCache.playlists = data;
        setPlaylists(data);
      }).catch(console.error);
    };
    window.addEventListener('playlists-updated', handlePlaylistsUpdated);
    return () => window.removeEventListener('playlists-updated', handlePlaylistsUpdated);
  }, [tab]);

  useEffect(() => {
    if (activePlaylist) {
      if (libraryCache.playlistTracks[activePlaylist.id]) {
        setPlaylistTracks(libraryCache.playlistTracks[activePlaylist.id]);
      } else {
        setLoadingTracks(true);
        api.getPlaylistTracks(activePlaylist.id)
          .then(tracks => {
            libraryCache.playlistTracks[activePlaylist.id] = tracks;
            setPlaylistTracks(tracks);
          })
          .catch(console.error)
          .finally(() => setLoadingTracks(false));
      }
    }
  }, [activePlaylist]);

  const handlePlay = (track: Track, context: Track[], e?: React.MouseEvent) => {
    if (e) {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.style.transform = 'scale(0.97)';
      setTimeout(() => btn.style.transform = '', 150);
    }
    void playTrack(track, context);
  };

  const handlePlayPlaylist = async (playlist: Playlist) => {
    let tracks = libraryCache.playlistTracks[playlist.id];
    if (!tracks || tracks.length === 0) {
      setLoadingTracks(true);
      try {
        tracks = await api.getPlaylistTracks(playlist.id);
        libraryCache.playlistTracks[playlist.id] = tracks;
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingTracks(false);
      }
    }
    if (tracks && tracks.length > 0) {
      await playTrack(tracks[0]);
      if (tracks.length > 1) {
        setQueueOrder(tracks.slice(1));
      } else {
        setQueueOrder([]);
      }
    }
  };

  const renderPlaylists = () => {
    if (loadingPlaylists && playlists.length === 0) {
      return <div className="py-20 text-center font-mono text-xs text-muted">Loading...</div>;
    }

    if (playlists.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="font-headline text-lg font-bold text-muted mb-2">No Playlists</p>
          <p className="font-body text-xs text-muted/60 max-w-[240px] mb-4">
            Create playlists manually or import any YouTube playlist link directly.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowYouTubeModal(true)}
              className="flex items-center gap-1.5 rounded-full bg-[var(--reverie-accent)] px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase text-background transition hover:opacity-90 active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">link</span>
              Import YouTube Link
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase text-white transition active:scale-95"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Custom
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-3">
        {playlists.map(pl => (
          <div
            key={pl.id}
            onClick={() => setActivePlaylist(pl)}
            className="group flex flex-col items-start gap-2 rounded-xl bg-surface2/50 p-4 text-left transition hover:bg-surface2/80 ring-1 ring-white/5 cursor-pointer"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-surface flex items-center justify-center ring-1 ring-white/5">
              {pl.thumbnail ? (
                <img src={pl.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
              ) : (
                <span className="material-symbols-outlined text-4xl text-muted/30">queue_music</span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePlayPlaylist(pl);
                }}
                className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--reverie-accent)] text-background shadow-lg transition-transform duration-200 hover:scale-110 active:scale-95"
                title="Play Playlist"
              >
                <span className="material-symbols-outlined text-xl fill-current ml-0.5">play_arrow</span>
              </button>
            </div>
            <div className="w-full min-w-0">
              <p className="truncate font-body text-sm font-bold text-onSurface">{pl.name}</p>
              <p className="truncate font-body text-[10px] text-muted">Playlist</p>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderTrackList = (tracks: Track[], emptyMsg: string, isLoading: boolean = false) => {
    if (isLoading && tracks.length === 0) {
      return <div className="py-20 text-center font-mono text-xs text-muted">Loading...</div>;
    }

    if (tracks.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface2">
            <span className="material-symbols-outlined text-4xl text-muted/30">
              {tab === 'liked' ? 'favorite' : tab === 'history' ? 'history' : 'queue_music'}
            </span>
          </div>
          <p className="font-headline text-lg font-bold text-muted mb-2">{emptyMsg}</p>
          <p className="font-body text-xs text-muted/60 max-w-[200px]">
            {tab === 'liked' 
              ? 'Tap the heart icon on any track to add it here' 
              : tab === 'history' 
                ? 'Your recently played songs will appear here'
                : 'Add tracks to this playlist to see them here'}
          </p>
        </div>
      );
    }

    return (
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="grid gap-2"
      >
        {tracks.map((t, idx) => (
          <motion.div
            key={`${t.id}-${idx}`}
            variants={staggerItemFast}
            whileHover={{ x: 3 }}
            className="group flex w-full items-center gap-3 rounded-lg border border-border bg-surface/30 p-2 transition-colors hover:bg-surface/60 overflow-hidden"
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left overflow-hidden"
              onClick={(e) => handlePlay(t, tracks, e)}
            >
              {t.thumbnail ? (
                <img src={t.thumbnail} alt="" loading="lazy" width="40" height="40" className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-border/50" />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface2 font-mono text-[9px] text-muted">Rev</div>
              )}
              <div className="min-w-0 flex-1">
                {/* Fixed Marquee clipping */}
                <div className="relative overflow-hidden w-full h-[18px]">
                  <div 
                    className="flex w-max animate-marquee gap-12 whitespace-nowrap"
                    style={{ animationDuration: `${marqueeSpeed}s` }}
                  >
                    <p className="font-body text-xs font-semibold text-onSurface group-hover:text-[var(--reverie-accent,#C8F23A)]">
                      {t.title}
                    </p>
                    <p className="font-body text-xs font-semibold text-onSurface group-hover:text-[var(--reverie-accent,#C8F23A)]">
                      {t.title}
                    </p>
                  </div>
                </div>
                <p className="truncate font-body text-[10px] text-muted opacity-80">
                  {t.artist}
                </p>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1 w-8 justify-center">
              <button
                onClick={() => setMenuTrack(t)}
                className="p-1 px-2 text-muted/50 transition-colors hover:text-white"
              >
                <span className="material-symbols-outlined text-[18px]">more_vert</span>
              </button>
            </div>
          </motion.div>
        ))}
      </motion.div>
    );
  };

  return (
    <div className="mx-auto max-w-lg px-4 pb-28 pt-8 min-h-[100dvh]">
      <header className="mb-6 flex items-center justify-between">
        {activePlaylist ? (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3 min-w-0">
              <button 
                onClick={() => setActivePlaylist(null)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 hover:bg-surface hover:text-white text-muted transition-colors"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
              </button>
              <h1 className="truncate font-headline text-lg font-extrabold uppercase tracking-tighter text-onSurface">
                {activePlaylist.name}
              </h1>
            </div>
            <button
              onClick={() => void handlePlayPlaylist(activePlaylist)}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--reverie-accent)] px-3.5 py-1.5 font-mono text-[10px] font-bold uppercase text-background shadow-md transition hover:opacity-90 active:scale-95"
            >
              <span className="material-symbols-outlined text-sm fill-current">play_arrow</span>
              Play All
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <h1 className="font-headline text-lg font-extrabold uppercase tracking-tighter text-onSurface">Your Library</h1>
            {!activePlaylist && tab === 'playlists' && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowYouTubeModal(true)}
                  className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 px-3 py-1 font-mono text-[9px] font-bold uppercase text-[var(--reverie-accent)] transition active:scale-95"
                  title="Import playlist or queue from YouTube link"
                >
                  <span className="material-symbols-outlined text-sm">link</span>
                  Import YT
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 rounded-full bg-[var(--reverie-accent)] px-3 py-1 font-mono text-[9px] font-bold uppercase text-background transition hover:opacity-90 active:scale-95"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  New
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {!activePlaylist && (
        <div className="mb-6 flex flex-wrap gap-2">
          {(
            [
              ['playlists', 'Playlists'],
              ['liked', 'Liked Songs'],
              ['history', 'History'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as any)}
              className={`relative flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider transition ${
                tab === id
                  ? 'bg-[var(--reverie-accent,#C8F23A)] text-background font-bold'
                  : 'border border-border bg-surface text-muted hover:text-onSurface'
              }`}
            >
              <span className="material-symbols-outlined text-sm">
                {id === 'liked' ? 'favorite' : id === 'history' ? 'history' : 'queue_music'}
              </span>
              {label}
            </button>
          ))}
        </div>
      )}

      <motion.div
        key={tab + (activePlaylist?.id ?? '')}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } }}
      >
        {!activePlaylist && tab === 'playlists' && renderPlaylists()}
        {!activePlaylist && tab === 'liked' && renderTrackList(audioLiked, 'Your liked songs will appear here.')}
        {!activePlaylist && tab === 'history' && renderTrackList(audioHistory, 'No listening history yet.')}
        {activePlaylist && renderTrackList(playlistTracks, 'No tracks in this playlist.', loadingTracks)}
      </motion.div>

      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowCreateModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-surface p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline text-lg font-extrabold uppercase text-onSurface">Create Playlist</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setShowYouTubeModal(true);
                }}
                className="font-mono text-[10px] text-[var(--reverie-accent)] hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">link</span>
                Import from YouTube
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newPlaylistName.trim()) return;
              try {
                await api.createPlaylist(newPlaylistName.trim());
                setNewPlaylistName('');
                setShowCreateModal(false);
                window.dispatchEvent(new CustomEvent('playlists-updated'));
              } catch (err) {
                console.error(err);
                alert('Failed to create playlist');
              }
            }} className="space-y-4">
              <input
                autoFocus
                type="text"
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
                placeholder="Playlist Name"
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-onSurface outline-none focus:border-[var(--reverie-accent)]"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-xs font-medium text-muted hover:text-white">
                  Cancel
                </button>
                <button type="submit" disabled={!newPlaylistName.trim()} className="px-4 py-2 text-xs font-bold text-background bg-[var(--reverie-accent)] rounded-xl disabled:opacity-50">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showYouTubeModal && (
        <YouTubeImportModal
          isOpen={showYouTubeModal}
          onClose={() => setShowYouTubeModal(false)}
        />
      )}

      {menuTrack && (
        <TrackContextMenu 
          track={menuTrack} 
          onClose={() => setMenuTrack(null)} 
          playlistId={activePlaylist?.id}
          onRemove={(trackId) => {
            const updated = playlistTracks.filter(t => t.id !== trackId);
            setPlaylistTracks(updated);
            if (activePlaylist) {
              libraryCache.playlistTracks[activePlaylist.id] = updated;
              // Reset playlist thumbnail if the first track was removed
              api.getPlaylists().then(data => {
                libraryCache.playlists = data;
                setPlaylists(data);
              });
            }
          }}
        />
      )}
    </div>
  );
}

