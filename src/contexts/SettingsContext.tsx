import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/services/api';

const LS_BUFFER = 'reverie-buffer-mode';
const LS_MARQUEE = 'reverie-marquee-speed';
const LS_PREFETCH = 'reverie-prefetch';
const LS_ACCENT = 'reverie-accent';
const LS_LANGUAGES = 'reverie-languages';
const LS_AUTOMIX = 'reverie-automix';

export interface SettingsState {
  bufferMode: boolean;
  marqueeSpeed: number;
  prefetchCount: number;
  accent: string;
  languages: string[];
  automixEnabled: boolean;
  setBufferMode: (v: boolean) => void;
  setMarqueeSpeed: (v: number) => void;
  setPrefetchCount: (v: number) => void;
  setAccent: (v: string) => void;
  setLanguages: (v: string[]) => void;
  setAutomixEnabled: (v: boolean) => void;
}

const Ctx = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bufferMode, setBufferModeState] = useState(() => localStorage.getItem(LS_BUFFER) !== 'stream');
  const [marqueeSpeed, setMarqueeSpeedState] = useState(() =>
    Number.parseFloat(localStorage.getItem(LS_MARQUEE) ?? '15')
  );
  const [prefetchCount, setPrefetchState] = useState(() =>
    Number.parseInt(localStorage.getItem(LS_PREFETCH) ?? '2', 10)
  );
  const [accent, setAccentState] = useState(() => localStorage.getItem(LS_ACCENT) ?? '#C8F23A');
  const [automixEnabled, setAutomixEnabledState] = useState(
    () => localStorage.getItem(LS_AUTOMIX) !== 'off'
  );
  const [languages, setLanguagesState] = useState<string[]>(() => {
    const saved = localStorage.getItem(LS_LANGUAGES);
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return ['English', 'Hindi', 'Punjabi'];
  });

  // Pull languages from Supabase if user is logged in
  useEffect(() => {
    if (user) {
      api.getUserSettings()
         .then(setLanguagesState)
         .catch(err => console.error('Failed to load user settings', err));
    }
  }, [user]);

  useEffect(() => {
    document.documentElement.style.setProperty('--reverie-accent', accent);
  }, [accent]);

  const setBufferMode = useCallback((v: boolean) => {
    setBufferModeState(v);
    localStorage.setItem(LS_BUFFER, v ? 'buffer' : 'stream');
  }, []);

  const setMarqueeSpeed = useCallback((v: number) => {
    setMarqueeSpeedState(v);
    localStorage.setItem(LS_MARQUEE, String(v));
  }, []);

  const setPrefetchCount = useCallback((v: number) => {
    setPrefetchState(v);
    localStorage.setItem(LS_PREFETCH, String(v));
  }, []);

  const setAccent = useCallback((v: string) => {
    setAccentState(v);
    localStorage.setItem(LS_ACCENT, v);
  }, []);

  const setAutomixEnabled = useCallback((v: boolean) => {
    setAutomixEnabledState(v);
    localStorage.setItem(LS_AUTOMIX, v ? 'on' : 'off');
  }, []);

  const setLanguages = useCallback((v: string[]) => {
    setLanguagesState(v);
    localStorage.setItem(LS_LANGUAGES, JSON.stringify(v));
    if (user) {
      api.updateUserSettings(v).catch(err => console.error('Failed to save settings', err));
    }
  }, [user]);

  const value = useMemo(
    () => ({
      bufferMode,
      marqueeSpeed,
      prefetchCount,
      accent,
      languages,
      automixEnabled,
      setBufferMode,
      setMarqueeSpeed,
      setPrefetchCount,
      setAccent,
      setLanguages,
      setAutomixEnabled,
    }),
    [
      bufferMode,
      marqueeSpeed,
      prefetchCount,
      accent,
      languages,
      automixEnabled,
      setBufferMode,
      setMarqueeSpeed,
      setPrefetchCount,
      setAccent,
      setLanguages,
      setAutomixEnabled,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings must be used within SettingsProvider');
  return v;
}
