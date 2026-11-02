import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { api, Playlist } from '@/services/api';
import { Track } from '@/types';
import { X, ListMusic, Heart, PlusCircle, Play, ListPlus } from 'lucide-react';
import { modalOverlay, sheetUp, springBouncy, smooth, staggerContainer, staggerItem } from '@/lib/animations';

interface TrackContextMenuProps {
  track: Track;
  onClose: () => void;
  playlistId?: string;
  onRemove?: (trackId: string) => void;
}

export function TrackContextMenu({ track, onClose, playlistId, onRemove }: TrackContextMenuProps) {
  const { toggleLike, likedSongs, addPlayNext, addToQueue } = useAudio();
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);

  const isLiked = likedSongs.some(t => t.id === track.id);

  useEffect(() => {
    if (showPlaylists) {
      setLoading(true);
      api.getPlaylists()
        .then(setPlaylists)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [showPlaylists]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    try {
      await api.addTrackToPlaylist(playlistId, track);
      window.dispatchEvent(new CustomEvent('playlists-updated'));
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to add track to playlist');
    }
  };

  const handleRemoveFromPlaylist = async () => {
    if (!playlistId) return;
    try {
      await api.removeTrackFromPlaylist(playlistId, track.id);
      if (onRemove) onRemove(track.id);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to remove track from playlist');
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
      const pl = await api.createPlaylist(newPlaylistName);
      await api.addTrackToPlaylist(pl.id, track);
      window.dispatchEvent(new CustomEvent('playlists-updated'));
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to create playlist');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="ctx-overlay"
        variants={modalOverlay}
        initial="initial"
        animate="animate"
        exit="exit"
        className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          key="ctx-sheet"
          variants={sheetUp}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm bg-surface rounded-t-2xl sm:rounded-2xl border border-white/10 overflow-hidden"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/5">
            <motion.div
              initial={{ x: -16, opacity: 0 }}
              animate={{ x: 0, opacity: 1, transition: { delay: 0.15 } }}
              className="flex items-center gap-3 overflow-hidden"
            >
              <motion.img
                src={track.thumbnail}
                alt=""
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1, transition: { delay: 0.2, ...springBouncy } }}
                className="w-12 h-12 rounded-lg object-cover"
              />
              <div className="flex-1 overflow-hidden">
                <h3 className="text-onSurface font-bold truncate">{track.title}</h3>
                <p className="text-muted text-sm truncate">{track.artist}</p>
              </div>
            </motion.div>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={onClose}
              className="p-2 text-muted hover:text-white rounded-full hover:bg-white/5"
            >
              <X size={20} />
            </motion.button>
          </div>

          <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
            className="p-2"
          >
            {!showPlaylists ? (
              <>
                <motion.button
                  variants={staggerItem}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 rounded-xl transition-colors text-onSurface"
                  onClick={() => handleAction(() => toggleLike(track))}
                >
                  <Heart size={20} className={isLiked ? "text-[var(--reverie-accent)] fill-current" : "text-muted"} />
                  <span className="font-medium">{isLiked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}</span>
                </motion.button>

                <motion.button
                  variants={staggerItem}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 rounded-xl transition-colors text-onSurface"
                  onClick={() => setShowPlaylists(true)}
                >
                  <ListMusic size={20} className="text-muted" />
                  <span className="font-medium">Add to Playlist</span>
                </motion.button>

                <motion.button
                  variants={staggerItem}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 rounded-xl transition-colors text-onSurface"
                  onClick={() => handleAction(() => addPlayNext(track))}
                >
                  <Play size={20} className="text-muted" />
                  <span className="font-medium">Play Next</span>
                </motion.button>

                <motion.button
                  variants={staggerItem}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 rounded-xl transition-colors text-onSurface"
                  onClick={() => handleAction(() => addToQueue(track))}
                >
                  <ListPlus size={20} className="text-muted" />
                  <span className="font-medium">Add to Queue</span>
                </motion.button>

                {playlistId && (
                  <motion.button
                    variants={staggerItem}
                    whileTap={{ scale: 0.97 }}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-red-500/10 rounded-xl transition-colors text-red-400"
                    onClick={() => handleAction(() => handleRemoveFromPlaylist())}
                  >
                    <ListMusic size={20} className="text-red-400 rotate-180" />
                    <span className="font-medium">Remove from this Playlist</span>
                  </motion.button>
                )}
              </>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: smooth }}
                className="flex flex-col max-h-[50vh]"
              >
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="text-sm font-bold text-muted uppercase tracking-wider">Save to...</span>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="text-[var(--reverie-accent)] text-sm font-medium hover:underline"
                    onClick={() => setShowPlaylists(false)}
                  >
                    Back
                  </motion.button>
                </div>

                {loading ? (
                  <div className="p-4 text-center text-muted text-sm">Loading playlists...</div>
                ) : (
                  <motion.div
                    variants={staggerContainer}
                    initial="initial"
                    animate="animate"
                    className="overflow-y-auto overflow-x-hidden flex-1 p-1"
                  >
                    {showNewPlaylist ? (
                      <form onSubmit={handleCreatePlaylist} className="p-2 space-y-3">
                        <input
                          autoFocus
                          type="text"
                          value={newPlaylistName}
                          onChange={e => setNewPlaylistName(e.target.value)}
                          placeholder="Playlist Name"
                          className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-onSurface focus:outline-none focus:border-[var(--reverie-accent)]"
                        />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setShowNewPlaylist(false)} className="px-4 py-2 text-sm font-medium text-muted hover:text-white">
                            Cancel
                          </button>
                          <button type="submit" disabled={!newPlaylistName.trim()} className="px-4 py-2 text-sm font-medium text-black bg-[var(--reverie-accent)] rounded-lg disabled:opacity-50">
                            Create & Add
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <motion.button
                          variants={staggerItem}
                          whileTap={{ scale: 0.97 }}
                          className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 rounded-xl transition-colors text-onSurface"
                          onClick={() => setShowNewPlaylist(true)}
                        >
                          <PlusCircle size={20} className="text-[var(--reverie-accent)]" />
                          <span className="font-medium text-[var(--reverie-accent)]">New Playlist</span>
                        </motion.button>
                        {playlists.map(pl => (
                          <motion.button
                            key={pl.id}
                            variants={staggerItem}
                            whileTap={{ scale: 0.97 }}
                            className="w-full flex flex-col p-3 text-left hover:bg-white/5 rounded-xl transition-colors"
                            onClick={() => handleAddToPlaylist(pl.id)}
                          >
                            <span className="font-medium text-onSurface">{pl.name}</span>
                          </motion.button>
                        ))}
                      </>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
