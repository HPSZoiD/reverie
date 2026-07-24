import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { AppShell } from './components/AppShell';
import { smooth } from './lib/animations';
import { HomeScreen } from './screens/HomeScreen';
import { SearchScreen } from './screens/SearchScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { NowPlayingScreen } from './screens/NowPlayingScreen';

const pageVariants: Variants = {
  initial: (custom: string) => ({
    y: custom === '/now-playing' ? '100%' : 24,
    opacity: custom === '/now-playing' ? 1 : 0,
  }),
  animate: { y: 0, opacity: 1, transition: smooth },
  exit: (custom: string) => ({
    y: custom === '/now-playing' ? '100%' : -16,
    opacity: custom === '/now-playing' ? 1 : 0,
    transition: { duration: 0.18, ease: 'easeIn' },
  }),
};

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait" custom={location.pathname}>
      <motion.div
        key={location.pathname}
        custom={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <Routes location={location}>
          <Route element={<AppShell />}>
            <Route index element={<HomeScreen />} />
            <Route path="search" element={<SearchScreen />} />
            <Route path="library" element={<LibraryScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="now-playing" element={<NowPlayingScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}