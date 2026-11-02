import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAudio } from '@/contexts/AudioContext';
import { MiniPlayer } from './MiniPlayer';
import { springBouncy, smooth } from '@/lib/animations';

const nav = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/library', label: 'Library', icon: 'library_music' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function NavTab({ to, label, icon, isActive }: { to: string; label: string; icon: string; isActive: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className="group relative flex flex-1 flex-col items-center gap-1.5 px-4 py-1"
    >
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          transition={springBouncy}
          className="absolute -top-3 h-0.5 w-6 rounded-full bg-[var(--reverie-accent,#C8F23A)]"
        />
      )}
      <motion.span
        whileHover={{ scale: 1.15, y: -2 }}
        whileTap={{ scale: 0.85 }}
        className={`material-symbols-outlined text-[24px] transition-colors duration-300 ${
          isActive ? 'fill-current text-[var(--reverie-accent,#C8F23A)]' : 'text-muted group-hover:text-[var(--reverie-accent,#C8F23A)]'
        }`}
      >
        {icon}
      </motion.span>
      <span
        className={`font-mono text-[9px] font-bold uppercase tracking-widest transition-colors duration-300 ${
          isActive ? 'text-[var(--reverie-accent,#C8F23A)]' : 'text-muted group-hover:text-[var(--reverie-accent,#C8F23A)]'
        }`}
      >
        {label}
      </span>
    </NavLink>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const { currentTrack } = useAudio();

  const showMini = pathname !== '/now-playing' && !!currentTrack;
  const isNowPlaying = pathname === '/now-playing';

  return (
    <>
      <AnimatePresence>
        {isNowPlaying && currentTrack?.thumbnail && (
          <motion.div
            key="nowplaying-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: smooth }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="fixed inset-0"
          >
            <div
              className="absolute inset-0 scale-110 bg-cover bg-center blur-3xl opacity-50"
              style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
            />
            <div className="absolute inset-0 bg-background/20" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`relative min-h-[100dvh] text-onSurface pb-24 font-body antialiased ${isNowPlaying ? 'bg-transparent' : 'bg-background'}`}>
        <header className={`sticky top-0 z-50 flex h-14 items-center justify-center px-4 ${isNowPlaying ? 'bg-transparent' : 'bg-background/80 backdrop-blur-xl'}`}>
          <h1 className="font-headline text-lg font-extrabold uppercase tracking-tighter text-[var(--reverie-accent,#C8F23A)] select-none">
            Reverie
          </h1>
        </header>

        <main className="mx-auto max-w-lg">
          <Outlet />
        </main>

        {showMini && <MiniPlayer />}

        <nav className={`fixed bottom-0 left-0 right-0 z-40 border-t border-white/5 backdrop-blur-lg ${isNowPlaying ? 'bg-transparent border-transparent' : 'bg-background/95'}`}>
          <div className="relative mx-auto flex max-w-lg items-center justify-around px-2 py-3">
            {nav.map((n) => (
              <NavTab key={n.to} to={n.to} label={n.label} icon={n.icon} isActive={pathname === n.to} />
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}
