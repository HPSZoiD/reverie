import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AutoMixEngine } from '@/lib/AutoMixEngine';
import { AudioPlayer } from '@/lib/AudioPlayer';
import { api } from '@/services/api';
import { useSettings } from '@/contexts/SettingsContext';
import type { AnalysisResult, Track, TransitionPlan, TransitionTier } from '@/types';

export interface AudioState {
  currentTrack: Track | null;
  nextTrack: Track | null;
  bpm: number | null;
  nextBpm: number | null;
  tier: TransitionTier;
  progress: number;
  duration: number;
  mixPointAt: number | null;
  overlapSecs: number;
  isPlaying: boolean;
  queue: Track[];
  transitionActive: boolean;
  upcomingTier: TransitionTier | null;
  outputDeck: 'A' | 'B';
  history: Track[];
  likedSongs: Track[];
  sleepTimerUntil: number | null;
}

export interface AudioActions {
  playTrack: (track: Track, _initialQueue?: Track[]) => Promise<void>;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  skipToNext: () => void;
  skipToPrevious: () => void;
  setQueueOrder: (tracks: Track[]) => void;
  toggleLike: (track: Track) => void;
  setSleepTimer: (minutes: number | null) => void;
  playNext: () => void;
  playPrevious: () => void;
  addPlayNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
}

const Ctx = createContext<(AudioState & AudioActions) | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const { automixEnabled } = useSettings();
  const automixEnabledRef = useRef(automixEnabled);
  automixEnabledRef.current = automixEnabled;
  const engineRef = useRef<AutoMixEngine | null>(null);
  const playerARef = useRef<AudioPlayer | null>(null);
  const playerBRef = useRef<AudioPlayer | null>(null);
  const prepareTaskVersionRef = useRef(0);

  const activeDeckRef = useRef<'A' | 'B'>('A');
  const currentTrackRef = useRef<Track | null>(null);
  const nextTrackRef = useRef<Track | null>(null);
  const currentAnalysisRef = useRef<AnalysisResult | null>(null);
  const nextAnalysisRef = useRef<AnalysisResult | null>(null);
  const planRef = useRef<TransitionPlan | null>(null);
  const queuePreparedForIdRef = useRef<string | null>(null);
  // Track the previous track ID for deferred cleanup
  const pendingCleanupRef = useRef<string | null>(null);

  // Bug fix: queueRef always mirrors latest queue state (avoids stale closures)
  const queueRef = useRef<Track[]>([]);
  // Bug fix: prevent concurrent prepareNextForCurrent calls
  const isPreparingRef = useRef(false);
  // Bug fix: 30-track recently-played ring buffer to prevent repeats
  const recentlyPlayedRef = useRef<string[]>([]);
  const RECENT_HISTORY_SIZE = 30;

  const [outputDeck, setOutputDeck] = useState<'A' | 'B'>('A');
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [nextTrack, setNextTrack] = useState<Track | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [nextBpm, setNextBpm] = useState<number | null>(null);
  const [tier, setTier] = useState<TransitionTier>('IDLE');
  const [upcomingTier, setUpcomingTier] = useState<TransitionTier | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mixPointAt, setMixPointAt] = useState<number | null>(null);
  const [overlapSecs, setOverlapSecs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queue, _setQueue] = useState<Track[]>([]);
  // Wrapper to keep queueRef always in sync with state
  const setQueue = useCallback((updater: Track[] | ((prev: Track[]) => Track[])) => {
    _setQueue((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      queueRef.current = next;
      return next;
    });
  }, []);
  const [transitionActive, setTransitionActive] = useState(false);
  const [sleepTimerUntil, _setSleepTimerUntil] = useState<number | null>(null);
  const sleepTimerUntilRef = useRef<number | null>(null);

  /**
   * Lazily creates the plain <audio> element used for NON-AutoMix playback.
   * The OS media pipeline drives this element (hardware decode, keeps playing
   * with the screen off), which is what makes background playback stutter-free.
   */
  const getAudioEl = useCallback(() => {
    if (!audioElRef.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.ontimeupdate = () => {
        if (automixEnabledRef.current) return;
        const d = a.duration || 1;
        const t = Math.min(a.currentTime, d);
        // No React state churn while hidden — the OS already knows the position.
        if (!document.hidden) {
          setProgress(Math.min(1, Math.max(0, t / d)));
          setDuration(d);
        }
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.setPositionState?.({
              duration: d,
              playbackRate: 1,
              position: t,
            });
          } catch { /* unsupported */ }
        }
        if (sleepTimerUntilRef.current && Date.now() >= sleepTimerUntilRef.current) {
          a.pause();
          _setSleepTimerUntil(null);
          sleepTimerUntilRef.current = null;
          setIsPlaying(false);
          console.log('[Reverie] Sleep timer reached, pausing playback.');
        }
      };
      a.onended = () => {
        if (automixEnabledRef.current) return;
        advanceAudioNextRef.current();
      };
      a.onerror = () => {
        console.error('[Reverie] <audio> playback error', a.error);
      };
      audioElRef.current = a;
    }
    return audioElRef.current;
  }, []);

  // Library & Likes persistence
  const [history, setHistoryState] = useState<Track[]>([]);
  const [likedSongs, setLikedSongsState] = useState<Track[]>([]);

  useEffect(() => {
    api.getHistory().then(setHistoryState).catch(console.error);
    api.getLikedSongs().then(setLikedSongsState).catch(console.error);
  }, []);

  const addToHistory = useCallback((track: Track) => {
    setHistoryState((prev) => {
      // Remove if already exists to move to top
      const filtered = prev.filter((t) => t.id !== track.id);
      const next = [track, ...filtered].slice(0, 30);
      return next;
    });
    api.addHistory(track).catch(console.error);
  }, []);

  const toggleLike = useCallback((track: Track) => {
    setLikedSongsState((prev) => {
      const isLiked = prev.some((t) => t.id === track.id);
      let next;
      if (isLiked) {
        next = prev.filter((t) => t.id !== track.id);
        api.removeLikedSong(track.id).catch(console.error);
      } else {
        next = [track, ...prev];
        api.addLikedSong(track).catch(console.error);
      }
      return next;
    });
  }, []);

  const getActivePlayer = useCallback((): AudioPlayer | null => {
    return activeDeckRef.current === 'A' ? playerARef.current : playerBRef.current;
  }, []);

  const runExecuteRef = useRef<(plan: TransitionPlan) => void>(() => {});
  const advanceToNextRef = useRef<() => void>(() => {});
  const advanceAudioNextRef = useRef<() => void>(() => {});
  const playTrackRef = useRef<(t: Track) => Promise<void>>(async () => {});
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Reset a deck's gain node and EQ to neutral values (cancels all scheduled ramps).
   * This is critical to call before starting a new track on a deck that may
   * still have gain automation from a previous transition.
   */
  const resetDeckGain = useCallback((deckLabel: 'A' | 'B', gainValue: number) => {
    const eng = engineRef.current;
    if (!eng?.context) return;
    const deck = deckLabel === 'A' ? eng.deckA : eng.deckB;
    if (!deck) return;

    // Reset all automation
    eng.resetDeck(deck);

    // Set gain to requested value
    const now = eng.context.currentTime;
    deck.gain.gain.setValueAtTime(gainValue, now);
  }, []);

  const scheduleTransition = useCallback(
    (plan: TransitionPlan) => {
      planRef.current = plan;

      // Sample-accurate trigger: arm a silent one-sample buffer on the Web
      // Audio clock so the transition fires at exactly fadeOutAt even when
      // JS timers are throttled (screen off / background tab). The interval
      // poller remains as a fallback safety net.
      const eng = engineRef.current;
      const ctx = eng?.context;
      const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
      if (ctx && deck?.isPlaying) {
        const ct = eng!.getCurrentPlaybackTime(deck);
        const delay = Math.max(0, plan.fadeOutAt - ct);

        const trigger = () => {
          if (!automixEnabledRef.current) return;
          const active = activeDeckRef.current === 'A'
            ? eng!.deckA
            : eng!.deckB;
          if (active?.isPlaying && planRef.current === plan) {
            runExecuteRef.current(plan);
          }
        };

        if (delay <= 0.05) {
          // Fade point is essentially now — fire immediately on next tick
          window.setTimeout(trigger, 0);
        } else {
          try {
            const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
            buf.getChannelData(0)[0] = 0;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const zero = ctx.createGain();
            zero.gain.value = 0;
            src.connect(zero);
            zero.connect(ctx.destination);
            src.onended = trigger;
            src.start(ctx.currentTime + delay);
          } catch {
            // Fall back to an approximate timer if clock scheduling fails
            window.setTimeout(trigger, delay * 1000);
          }
        }
      }

      console.log(`[AutoMix] Transition armed for fadeOutAt: ${plan.fadeOutAt.toFixed(2)}s`);
    },
    []
  );


  // ═══════════════════════════════════════
  // PREPARE NEXT TRACK (download + analyze + plan)
  // ═══════════════════════════════════════
  const prepareNextForCurrent = useCallback(
    async (ct: Track) => {
      if (!engineRef.current || !playerARef.current || !playerBRef.current) return;
      
      if (queuePreparedForIdRef.current === ct.id && nextTrackRef.current?.id === queueRef.current[0]?.id) return;
      if (isPreparingRef.current) return; // Prevent concurrent prepares

      prepareTaskVersionRef.current += 1;
      const currentTaskVersion = prepareTaskVersionRef.current;
      isPreparingRef.current = true;
      queuePreparedForIdRef.current = ct.id;

      try {
        // 1. Read queue from REF (not stale closure!)
        let currentQ = queueRef.current;

        // Filter out current track + recently played from the live queue (non-recursive)
        const badIds = new Set([ct.id, ...recentlyPlayedRef.current]);
        let cleanQ = currentQ.filter(t => !badIds.has(t.id));

        // If queue is empty or all items were duplicates, fetch a new queue
        if (cleanQ.length === 0) {
          console.log('[Reverie] Queue empty, fetching new queue from server...');
          const q = await api.getQueue(ct.id, currentAnalysisRef.current?.bpm ?? undefined);
          if (prepareTaskVersionRef.current !== currentTaskVersion) return;
          cleanQ = q.filter(t => !badIds.has(t.id));
        }

        if (cleanQ.length !== currentQ.length) {
          console.warn(`[Reverie] Replaced queue: removed duplicates or fetched new`);
          setQueue(cleanQ);
          currentQ = cleanQ;
        }

        const next = currentQ[0];
        const upcoming = currentQ[1];

        if (!next) {
          setNextTrack(null);
          nextTrackRef.current = null;
          setUpcomingTier(null);
          planRef.current = null;
          nextAnalysisRef.current = null;
          setNextBpm(null);
          return;
        }

        console.log('[Reverie] Preparing next track:', next.title);

        // 2. Download (and optionally prefetch upcoming)
        const [dl1] = await Promise.all([
          api.download(next.id),
          upcoming ? api.download(upcoming.id).catch(() => null) : Promise.resolve(null)
        ]);

        if (prepareTaskVersionRef.current !== currentTaskVersion) {
          console.log('[Reverie] Prepare task preempted during download.');
          return;
        }

        if (!dl1?.audio_url) {
          throw new Error('No audio URL returned for next track');
        }

        const enriched: Track = { ...next, audio_url: dl1.audio_url };
        setNextTrack(enriched);
        nextTrackRef.current = enriched;

        // 3. & 4. Deck load + mix planning are ONLY needed for AutoMix.
        //    In normal (<audio>) mode the next track just needs its audio_url
        //    to be ready so it can advance instantly on 'ended'.
        if (automixEnabled) {
          const inactive = activeDeckRef.current === 'A' ? playerBRef.current : playerARef.current;
          if (!inactive) return;

          // Reset the inactive deck's gain to 0 (it will be ramped up during execute)
          const inactiveDeckLabel: 'A' | 'B' = activeDeckRef.current === 'A' ? 'B' : 'A';
          resetDeckGain(inactiveDeckLabel, 0);

          nextAnalysisRef.current = null;
          inactive.onAnalyzed = (r) => {
            if (prepareTaskVersionRef.current !== currentTaskVersion) return;
            nextAnalysisRef.current = r;
            setNextBpm(r.bpm);
          };

          // CRITICAL FIX: load() now blocks until buffer is downloaded, decoded, and analyzed.
          // When this resolves, nextAnalysisRef.current IS populated.
          await inactive.load(enriched.audio_url!, enriched.bpm);

          if (prepareTaskVersionRef.current !== currentTaskVersion) {
            console.log('[Reverie] Prepare task preempted during load.');
            return;
          }

          // 4. Plan the mix — nextAnalysisRef.current is guaranteed to be set now.
          if (currentAnalysisRef.current && nextAnalysisRef.current) {
            const activePlayer = activeDeckRef.current === 'A' ? playerARef.current : playerBRef.current;
            const dur = activePlayer?.duration ?? 0;
            if (!dur) return;

            const plan = engineRef.current!.planTransition(
              currentAnalysisRef.current,
              nextAnalysisRef.current,
              dur
            );

            console.log('[AutoMix] Plan created:', plan.method, '| fadeOutAt:', plan.fadeOutAt.toFixed(1));
            setUpcomingTier(plan.method);
            setOverlapSecs(plan.overlapSecs);
            planRef.current = plan;
            scheduleTransition(plan);
          }
        }
        queuePreparedForIdRef.current = null;
      } catch (err) {
        console.error('[Reverie] prepare next failed:', err);
        setNextTrack(null);
        nextTrackRef.current = null;
        setUpcomingTier(null);
        planRef.current = null;
        nextAnalysisRef.current = null;
        setNextBpm(null);
        queuePreparedForIdRef.current = null;
      } finally {
        if (prepareTaskVersionRef.current === currentTaskVersion) {
          isPreparingRef.current = false;
        }
      }
    },
    [scheduleTransition, resetDeckGain, setQueue, automixEnabled]
  );

  // ═══════════════════════════════════════
  // EXECUTE TRANSITION (the actual crossfade)
  // ═══════════════════════════════════════
  const runExecute = useCallback((plan: TransitionPlan) => {
    const eng = engineRef.current;
    if (!eng?.deckA || !eng.deckB) return;
    const nextT = nextTrackRef.current;
    if (!nextT?.audio_url) {
      console.warn('[AutoMix] No next track ready. Skipping transition.');
      return;
    }
    if (nextT.id !== queueRef.current[0]?.id) {
      console.warn('[AutoMix] Next track does not match head of queue. Cancelling transition.');
      planRef.current = null;
      setUpcomingTier(null);
      return;
    }

    const active = activeDeckRef.current === 'A' ? eng.deckA : eng.deckB;
    const incoming = activeDeckRef.current === 'A' ? eng.deckB : eng.deckA;

    setTransitionActive(true);
    setTier(plan.method); // Show active tier in UI

    // Swap active deck BEFORE execute so sync event listeners see the right deck
    const newActive: 'A' | 'B' = activeDeckRef.current === 'A' ? 'B' : 'A';
    activeDeckRef.current = newActive;
    setOutputDeck(newActive);

    // Execute the Web Audio gain/EQ automation
    eng.execute(plan, active, incoming);
    console.log(`[AutoMix] Transition executing: ${plan.method} over ${plan.overlapSecs.toFixed(1)}s`);

    // Force isPlaying true so polling loop keeps running during the transition
    setIsPlaying(true);

    // Save previous track ID for deferred cleanup
    pendingCleanupRef.current = currentTrackRef.current?.id ?? null;

    // Update state to the new track
    const advanced = nextT;
    const na = nextAnalysisRef.current;
    setCurrentTrack(advanced);
    currentTrackRef.current = advanced;
    setBpm(na?.bpm ?? null);
    setMixPointAt(na?.mixPointAt ?? null);
    setNextTrack(null);
    nextTrackRef.current = null;
    setNextBpm(null);
    nextAnalysisRef.current = null;
    planRef.current = null;
    currentAnalysisRef.current = na ?? null;
    setQueue((qq) => qq.slice(1));

    // Bug fix: Track recently played to prevent repeats (30-track history)
    recentlyPlayedRef.current = [
      advanced.id,
      ...recentlyPlayedRef.current,
    ].slice(0, RECENT_HISTORY_SIZE);
    queuePreparedForIdRef.current = null;
    setUpcomingTier(null);

    // ═══════════════════════════════════════
    // CRITICAL FIX: Defer cleanup and next-track preparation
    // until AFTER the crossfade completes.
    // The old code did this immediately, which killed the
    // fading-out deck's audio mid-transition.
    // ═══════════════════════════════════════
    const deferMs = (plan.overlapSecs + 1.5) * 1000;
    window.setTimeout(() => {
      setTransitionActive(false);

      // Now it's safe to clean up the old track file from the server
      const prevId = pendingCleanupRef.current;
      if (prevId) {
        pendingCleanupRef.current = null;
        api.cleanup(prevId).catch((e: unknown) =>
          console.error('[Reverie] Cleanup failed', e)
        );
      }

      // 3. Reset UI state
      console.log(`[AutoMix] Cleanup Finished: ${prevId}`);
      setTransitionActive(false);
      setTier('IDLE');
      
      const cur = currentTrackRef.current;
      if (cur) {
        prepareNextForCurrent(cur).catch((e: unknown) =>
          console.error('[Reverie] Post-transition prepare failed', e)
        );
      }
    }, deferMs);
  }, [prepareNextForCurrent, setQueue]);

  runExecuteRef.current = runExecute;

  // ═══════════════════════════════════════
  // PLAIN ADVANCE (no AutoMix crossfade)
  // Used when AutoMix is off (or no transition was armed): the next track is
  // already downloaded/decoded/analyzed in the inactive deck, so we just swap
  // decks and start it — no gap, no re-download, no refetched queue.
  // ═══════════════════════════════════════
  const advanceToNext = useCallback(() => {
    const eng = engineRef.current;
    if (!eng?.deckA || !eng.deckB) return;
    const nextQItem = queueRef.current[0];
    const isReady = nextTrackRef.current?.id && nextTrackRef.current.id === nextQItem?.id && nextTrackRef.current.audio_url;

    if (!isReady) {
      if (nextQItem) {
        setQueue((qq) => qq.slice(1));
        void playTrackRef.current(nextQItem);
      } else {
        setIsPlaying(false);
      }
      return;
    }

    const nextT = nextTrackRef.current!;
    const active = activeDeckRef.current === 'A' ? eng.deckA : eng.deckB;
    const incoming = activeDeckRef.current === 'A' ? eng.deckB : eng.deckA;

    // Manual skips pause an actively playing outgoing deck; natural ends
    // arrive with it already stopped.
    if (active.isPlaying) eng.pause(active);

    // Swap active deck BEFORE playback so the polling loop follows the right deck
    const newActive: 'A' | 'B' = activeDeckRef.current === 'A' ? 'B' : 'A';
    activeDeckRef.current = newActive;
    setOutputDeck(newActive);

    // Restore neutral gain/EQ and start the preloaded buffer directly
    eng.resetDeck(incoming);
    eng.play(incoming);

    setIsPlaying(true);
    setTier('IDLE');
    setUpcomingTier(null);

    const prevId = currentTrackRef.current?.id ?? null;
    const na = nextAnalysisRef.current;

    setCurrentTrack(nextT);
    currentTrackRef.current = nextT;
    setBpm(na?.bpm ?? null);
    setMixPointAt(na?.mixPointAt ?? null);
    setNextTrack(null);
    nextTrackRef.current = null;
    setNextBpm(null);
    nextAnalysisRef.current = null;
    planRef.current = null;
    currentAnalysisRef.current = na ?? null;
    setQueue((qq) => qq.slice(1));

    // Track recently played to prevent immediate repeats (keeps queue intact)
    recentlyPlayedRef.current = [nextT.id, ...recentlyPlayedRef.current].slice(0, RECENT_HISTORY_SIZE);
    queuePreparedForIdRef.current = null;

    // Old file no longer needed — no crossfade overlap to protect
    if (prevId) {
      api.cleanup(prevId).catch((e: unknown) =>
        console.error('[Reverie] Cleanup failed', e)
      );
    }

    // Prepare the following track while this one plays
    const cur = currentTrackRef.current;
    if (cur) {
      prepareNextForCurrent(cur).catch((e: unknown) =>
        console.error('[Reverie] Post-advance prepare failed', e)
      );
    }
  }, [prepareNextForCurrent, setQueue]);

  advanceToNextRef.current = advanceToNext;

  // ═══════════════════════════════════════
  // PLAIN ADVANCE (normal mode, <audio> element)
  // Auto-advance for non-AutoMix playback: swap the element's src to the
  // already-downloaded next track and play. Fires from 'ended'.
  // ═══════════════════════════════════════
  const advanceAudioNext = useCallback(() => {
    const audio = audioElRef.current;
    const nextQItem = queueRef.current[0];
    const isReady = nextTrackRef.current?.id && nextTrackRef.current.id === nextQItem?.id && nextTrackRef.current.audio_url;

    if (!audio) {
      setIsPlaying(false);
      return;
    }

    if (isReady && nextTrackRef.current) {
      const nextT = nextTrackRef.current;
      audio.src = nextT.audio_url!;
      audio.currentTime = 0;
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

      const prevId = currentTrackRef.current?.id ?? null;
      setCurrentTrack(nextT);
      currentTrackRef.current = nextT;
      setBpm(null);
      setMixPointAt(null);
      setNextTrack(null);
      nextTrackRef.current = null;
      setNextBpm(null);
      nextAnalysisRef.current = null;
      currentAnalysisRef.current = null;
      planRef.current = null;
      setQueue((qq) => qq.slice(1));

      recentlyPlayedRef.current = [nextT.id, ...recentlyPlayedRef.current].slice(0, RECENT_HISTORY_SIZE);
      queuePreparedForIdRef.current = null;

      if (prevId) {
        api.cleanup(prevId).catch((e: unknown) =>
          console.error('[Reverie] Cleanup failed', e)
        );
      }

      const cur = currentTrackRef.current;
      if (cur) {
        prepareNextForCurrent(cur).catch((e: unknown) =>
          console.error('[Reverie] Post-advance prepare failed', e)
        );
      }
    } else if (nextQItem) {
      setQueue((qq) => qq.slice(1));
      void playTrackRef.current(nextQItem);
    } else {
      setIsPlaying(false);
    }
  }, [prepareNextForCurrent, setQueue]);

  advanceAudioNextRef.current = advanceAudioNext;

  const fetchAndPrepareNextTrack = useCallback(async () => {
    const ct = currentTrackRef.current;
    if (!ct?.audio_url) return;
    try {
      await prepareNextForCurrent(ct);
    } catch (e) {
      console.error('[Reverie] prepare next', e);
    }
  }, [prepareNextForCurrent]);

  // ═══════════════════════════════════════
  // INITIALIZATION (Buffer-based — no HTMLAudioElements)
  // ═══════════════════════════════════════
  const didInitAudio = useRef(false);
  useEffect(() => {
    if (didInitAudio.current) return;
    didInitAudio.current = true;

    const engine = new AutoMixEngine();
    engine.init();
    engineRef.current = engine;

    // Sample-accurate natural-end detection. Fires from the Web Audio clock
    // (source.onended) so auto-advance works even when timers are throttled
    // in background tabs or with the screen off.
    engine.onDeckEnded = (deck) => {
      const eng = engineRef.current;
      const active = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
      if (!eng || deck !== active) return;

      // A stale armed transition is irrelevant once the deck actually ended
      planRef.current = null;

      const nextQItem = queueRef.current[0];
      const isReady = nextTrackRef.current?.id && nextTrackRef.current.id === nextQItem?.id && nextTrackRef.current.audio_url;

      if (isReady) {
        advanceToNextRef.current();
      } else if (nextQItem) {
        setQueue((qq) => qq.slice(1));
        void playTrackRef.current(nextQItem);
      } else {
        setIsPlaying(false);
      }
    };

    playerARef.current = new AudioPlayer(
      () => engine.deckA,
      () => engine.context,
      engine
    );
    playerBRef.current = new AudioPlayer(
      () => engine.deckB,
      () => engine.context,
      engine
    );

    return () => {
      // Nothing to cleanup here
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Progress tracking & AutoMix polling
  // Uses setInterval instead of requestAnimationFrame so polling keeps
  // running while the tab is hidden (RAF is fully suspended in background
  // tabs, which silently killed AutoMix transitions and auto-advance).
  useEffect(() => {
    // This loop only drives the Web Audio decks (AutoMix mode). Normal mode
    // playback runs entirely on the <audio> element (native ontimeupdate),
    // so the poller shouldn't even exist there.
    if (!isPlaying || !automixEnabled) return;
    const id = window.setInterval(() => {
      const eng = engineRef.current;
      const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;

      if (deck && eng) {
        const ct = eng.getCurrentPlaybackTime(deck);
        const d = deck.audioBuffer?.duration || 1;

        // Skip React state updates while hidden (screen off / background) —
        // they only churn the main thread and cause jank. The OS still gets
        // the position via MediaSession below, so progress stays correct.
        if (!document.hidden) {
          setProgress(Math.min(1, Math.max(0, ct / d)));
          setDuration(d);
        }

        // Surface playback position to the OS (lock screen / media panel)
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.setPositionState?.({
              duration: d,
              playbackRate: 1,
              position: Math.min(ct, d),
            });
          } catch { /* unsupported */ }
        }

        // AutoMix Transition Polling
        const plan = planRef.current;
        if (automixEnabled && plan && ct >= plan.fadeOutAt) {
          console.log(`[AutoMix] Polled trigger at ${ct.toFixed(2)}s (target: ${plan.fadeOutAt.toFixed(2)}s)`);
          runExecuteRef.current(plan);
          return;
        }

        // Check if track ended naturally (no transition available)
        if (ct >= d && !planRef.current) {
          const nextQItem = queueRef.current[0];
          const isReady = nextTrackRef.current?.id && nextTrackRef.current.id === nextQItem?.id && nextTrackRef.current.audio_url;

          if (isReady) {
            advanceToNextRef.current();
          } else if (nextQItem) {
            setQueue((qq) => qq.slice(1));
            void playTrackRef.current(nextQItem);
          } else {
            setIsPlaying(false);
          }
          return;
        }

        // Sleep Timer Check
        if (sleepTimerUntilRef.current && Date.now() >= sleepTimerUntilRef.current) {
          const activeDeck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
          if (activeDeck) eng?.pause(activeDeck);
          setIsPlaying(false);
          _setSleepTimerUntil(null);
          sleepTimerUntilRef.current = null;
          console.log('[Reverie] Sleep timer reached, pausing playback.');
        }
      }
    }, 200);

    // Sync state on document visibility change (returning from background tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const eng = engineRef.current;
        if (eng?.context && eng.context.state === 'suspended') {
          eng.context.resume().catch(console.error);
        }
        // Deck-sync only matters in AutoMix mode; in normal mode the <audio>
        // element's ontimeupdate already kept everything current.
        if (!automixEnabledRef.current) return;
        const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
        if (deck && eng) {
          const ct = eng.getCurrentPlaybackTime(deck);
          const d = deck.audioBuffer?.duration || 1;
          setProgress(Math.min(1, Math.max(0, ct / d)));
          setDuration(d);
          // Check if track ended while in background
          if (ct >= d) {
            const plan = planRef.current;
            if (automixEnabled && plan) {
              runExecuteRef.current(plan);
            } else if (nextTrackRef.current?.audio_url) {
              advanceToNextRef.current();
            } else {
              setIsPlaying(false);
            }
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isPlaying, outputDeck, currentTrack?.id, automixEnabled]);

  // ═══════════════════════════════════════
  // PLAY TRACK (user-initiated)
  // ═══════════════════════════════════════
  const playTrack = useCallback(
    async (track: Track, _initialQueue?: Track[]) => {
      queuePreparedForIdRef.current = null;
      planRef.current = null;
      isPreparingRef.current = false;

      // New session: reset recently played history so old tracks can appear again
      recentlyPlayedRef.current = [];
      setUpcomingTier(null);

      // If an explicit queue is provided (e.g. from a playlist or YouTube queue import),
      // seed the queue with the remaining tracks. Otherwise start empty for radio discovery.
      if (_initialQueue && _initialQueue.length > 0) {
        const remaining = _initialQueue.filter(x => x.id !== track.id);
        setQueue(remaining);
      } else {
        setQueue([]);
      }

      // Download the audio file from YouTube
      const dl = await api.download(track.id);
      const t: Track = {
        ...track,
        audio_url: dl.audio_url,
        thumbnail: track.thumbnail || '',
      };

      // ─── NORMAL MODE (AutoMix OFF): plain <audio> element playback ───
      // The OS media pipeline drives playback, so it keeps playing smoothly
      // with the screen off / tab hidden. No Web Audio involved here.
      if (!automixEnabled) {
        const eng = engineRef.current;
        if (eng?.deckA?.isPlaying) eng.pause(eng.deckA);
        if (eng?.deckB?.isPlaying) eng.pause(eng.deckB);

        const audio = getAudioEl();
        audio.src = t.audio_url!;
        audio.currentTime = 0;
        void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

        setTier('IDLE');
        addToHistory(t);
        setCurrentTrack(t);
        currentTrackRef.current = t;
        setNextTrack(null);
        nextTrackRef.current = null;
        setNextBpm(null);
        currentAnalysisRef.current = null;
        nextAnalysisRef.current = null;

        void prepareNextForCurrent(t).catch((e: unknown) =>
          console.error('[Reverie] prepare next (audio mode)', e)
        );
        return;
      }

      // ─── AutoMix Mode: dual-deck Web Audio engine ───
      const engine = engineRef.current;
      const pa = playerARef.current;
      const pb = playerBRef.current;
      if (!engine?.context || !pa || !pb) return;

      setTier('ANALYZING');

      // Stop both decks
      const deckA = engine.deckA;
      const deckB = engine.deckB;
      if (deckA?.isPlaying) engine.pause(deckA);
      if (deckB?.isPlaying) engine.pause(deckB);

      // CRITICAL FIX: Reset BOTH deck gains before starting fresh
      // Otherwise a previous transition may have left gain at 0.001
      resetDeckGain('A', activeDeckRef.current === 'A' ? 1.0 : 0);
      resetDeckGain('B', activeDeckRef.current === 'B' ? 1.0 : 0);

      addToHistory(t);
      setCurrentTrack(t);
      currentTrackRef.current = t;
      setNextTrack(null);
      nextTrackRef.current = null;
      setNextBpm(null);
      currentAnalysisRef.current = null;
      nextAnalysisRef.current = null;

      const active = getActivePlayer();
      if (!active) return;

      active.onAnalyzed = (analysis) => {
        currentAnalysisRef.current = analysis;
        setBpm(analysis.bpm);
        setMixPointAt(analysis.mixPointAt);
        // Always prepare the next track so the queue keeps advancing;
        // AutoMix only controls the transition itself.
        void fetchAndPrepareNextTrack();
      };

      // load() now blocks until download + decode + analysis are complete
      await active.load(t.audio_url!, t.bpm);

      if (engine.context.state === 'suspended') await engine.context.resume();

      active.play();
      setIsPlaying(true);
      setTier('IDLE');
    },
    [fetchAndPrepareNextTrack, getActivePlayer, resetDeckGain, setQueue, addToHistory, automixEnabled, getAudioEl, prepareNextForCurrent]
  );

  playTrackRef.current = playTrack;

  const pause = useCallback(() => {
    if (!automixEnabled) {
      const a = audioElRef.current;
      if (a) a.pause();
      setIsPlaying(false);
      return;
    }
    const eng = engineRef.current;
    const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
    if (deck && eng) eng.pause(deck);
    setIsPlaying(false);
  }, [automixEnabled]);

  const resume = useCallback(() => {
    if (!automixEnabled) {
      const a = audioElRef.current;
      if (a) void a.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      return;
    }
    const eng = engineRef.current;
    void eng?.context?.resume();
    const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
    if (deck && eng) eng.play(deck);
    setIsPlaying(true);
    // Re-arm any pending transition clock after resuming from a pause
    const p = planRef.current;
    if (p) scheduleTransition(p);
  }, [automixEnabled, scheduleTransition]);

  const seek = useCallback(
    (time: number) => {
      if (!automixEnabled) {
        const a = audioElRef.current;
        if (a) a.currentTime = time;
        return;
      }
      const eng = engineRef.current;
      const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
      if (deck && eng) eng.seek(deck, time);
      const p = planRef.current;
      if (p) scheduleTransition(p);
    },
    [scheduleTransition, automixEnabled]
  );

  const skipToNext = useCallback(() => {
    const nextQItem = queueRef.current[0];
    const isReady = nextTrackRef.current?.id && nextTrackRef.current.id === nextQItem?.id && nextTrackRef.current.audio_url;

    if (isReady) {
      if (!automixEnabled) {
        advanceAudioNextRef.current();
      } else {
        advanceToNext();
      }
    } else if (nextQItem) {
      setQueue((qq) => qq.slice(1));
      void playTrackRef.current(nextQItem);
    }
  }, [advanceToNext, automixEnabled]);

  const skipToPrevious = useCallback(() => {
    if (!automixEnabled) {
      const a = audioElRef.current;
      if (a && a.currentTime > 3) a.currentTime = 0;
      return;
    }
    const eng = engineRef.current;
    const deck = activeDeckRef.current === 'A' ? eng?.deckA : eng?.deckB;
    if (!eng || !deck) return;
    const ct = eng.getCurrentPlaybackTime(deck);
    if (ct > 3) {
      eng.seek(deck, 0);
      const p = planRef.current;
      if (p) scheduleTransition(p);
    }
  }, [scheduleTransition]);

  const setQueueOrder = useCallback((tracks: Track[]) => {
    setQueue(prev => {
      const firstChanged = prev[0]?.id !== tracks[0]?.id;
      if (firstChanged && currentTrackRef.current) {
        prepareTaskVersionRef.current += 1;
        nextTrackRef.current = null;
        setNextTrack(null);
        planRef.current = null;
        setUpcomingTier(null);
        nextAnalysisRef.current = null;
        setNextBpm(null);
        queuePreparedForIdRef.current = null;
        isPreparingRef.current = false;
        // Run in next tick so the state update applies first
        setTimeout(() => {
          if (currentTrackRef.current) {
            prepareNextForCurrent(currentTrackRef.current).catch(console.error);
          }
        }, 0);
      }
      return tracks;
    });
  }, [prepareNextForCurrent]);

  const addPlayNext = useCallback((track: Track) => {
    setQueue(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      const newQueue = [track, ...filtered];
      if (currentTrackRef.current) {
        prepareTaskVersionRef.current += 1;
        nextTrackRef.current = null;
        setNextTrack(null);
        planRef.current = null;
        setUpcomingTier(null);
        nextAnalysisRef.current = null;
        setNextBpm(null);
        queuePreparedForIdRef.current = null;
        isPreparingRef.current = false;
        setTimeout(() => {
          if (currentTrackRef.current) {
            prepareNextForCurrent(currentTrackRef.current).catch(console.error);
          }
        }, 0);
      }
      return newQueue;
    });
  }, [prepareNextForCurrent]);

  const addToQueue = useCallback((track: Track) => {
    setQueue(prev => {
      const filtered = prev.filter(t => t.id !== track.id);
      const newQueue = [...filtered, track];
      // If queue was empty, adding to end ALSO changes the first item!
      if (prev.length === 0 && currentTrackRef.current) {
        prepareTaskVersionRef.current += 1;
        nextTrackRef.current = null;
        setNextTrack(null);
        planRef.current = null;
        setUpcomingTier(null);
        nextAnalysisRef.current = null;
        setNextBpm(null);
        queuePreparedForIdRef.current = null;
        isPreparingRef.current = false;
        setTimeout(() => {
          if (currentTrackRef.current) {
            prepareNextForCurrent(currentTrackRef.current).catch(console.error);
          }
        }, 0);
      }
      return newQueue;
    });
  }, [prepareNextForCurrent]);

  const setSleepTimer = useCallback((minutes: number | null) => {
    const val = minutes === null ? null : Date.now() + minutes * 60 * 1000;
    sleepTimerUntilRef.current = val;
    _setSleepTimerUntil(val);
  }, []);

  // ═══════════════════════════════════════
  // MODE SWITCH (AutoMix ON <-> OFF) mid-playback
  // ═══════════════════════════════════════
  useEffect(() => {
    const cur = currentTrackRef.current;
    if (!cur?.audio_url) return;

    if (!automixEnabled && isPlaying) {
      // Web Audio decks -> <audio> element: keep the same track, same position.
      const eng = engineRef.current;
      let pos = 0;
      if (eng && eng.context) {
        const deck = activeDeckRef.current === 'A' ? eng.deckA : eng.deckB;
        if (deck) {
          if (deck.isPlaying) pos = eng.getCurrentPlaybackTime(deck);
          if (deck.isPlaying) eng.pause(deck);
        }
        if (eng.deckA?.isPlaying) eng.pause(eng.deckA);
        if (eng.deckB?.isPlaying) eng.pause(eng.deckB);
      }
      const audio = getAudioEl();
      audio.src = cur.audio_url;
      const clampPos = Math.max(0, Math.min(pos, (audio.duration || pos) - 0.1));
      audio.currentTime = clampPos;
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else if (automixEnabled && isPlaying && audioElRef.current && !audioElRef.current.paused) {
      // <audio> element -> Web Audio decks: restart the current track cleanly.
      audioElRef.current.pause();
      playTrackRef.current(cur).catch((e: unknown) =>
        console.error('[Reverie] Mode switch to AutoMix failed', e)
      );
    }
  }, [automixEnabled, getAudioEl]);

  const value = useMemo(
    () => ({
      currentTrack,
      nextTrack,
      bpm,
      nextBpm,
      tier,
      progress,
      duration,
      mixPointAt,
      overlapSecs,
      isPlaying,
      queue,
      transitionActive,
      upcomingTier,
      outputDeck,
      sleepTimerUntil,
      playTrack,
      togglePlay: isPlaying ? pause : resume,
      pause,
      resume,
      seek,
      skipToNext,
      skipToPrevious,
      setQueueOrder,
      toggleLike,
      setSleepTimer,
      history,
      likedSongs,
      playNext: skipToNext,
      playPrevious: skipToPrevious,
      addPlayNext,
      addToQueue,
    }),
    [
      currentTrack,
      nextTrack,
      bpm,
      nextBpm,
      tier,
      progress,
      duration,
      mixPointAt,
      overlapSecs,
      isPlaying,
      queue,
      transitionActive,
      upcomingTier,
      outputDeck,
      sleepTimerUntil,
      playTrack,
      pause,
      resume,
      seek,
      skipToNext,
      skipToPrevious,
      setQueueOrder,
      toggleLike,
      setSleepTimer,
      history,
      likedSongs,
      addPlayNext,
      addToQueue,
    ]
  );

  // MediaSession API — OS media controls (lock screen, media keys, earphones)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title || 'Unknown',
      artist: currentTrack.artist || 'Unknown Artist',
      album: 'Reverie',
      artwork: currentTrack.thumbnail
        ? [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', resume);
    navigator.mediaSession.setActionHandler('pause', pause);
    navigator.mediaSession.setActionHandler('previoustrack', skipToPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', skipToNext);
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) seek(details.seekTime);
    });
  }, [resume, pause, skipToPrevious, skipToNext, seek]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
        
        e.preventDefault();
        if (isPlaying) {
          pause();
        } else {
          resume();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, pause, resume]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAudio(): AudioState & AudioActions {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAudio must be used within AudioProvider');
  return v;
}

export function useAudioSelector<T>(selector: (s: AudioState & AudioActions) => T): T {
  const full = useAudio();
  return useMemo(() => selector(full), [full, selector]);
}
