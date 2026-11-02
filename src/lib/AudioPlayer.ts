import type { AnalysisResult, DeckState } from '../types';
import type { AutoMixEngine } from './AutoMixEngine';

/**
 * Deck playback helper for the buffer-based AutoMixEngine.
 * Each AudioPlayer wraps one deck (A or B) and provides load/play/pause/seek.
 *
 * load() fully downloads, decodes, analyzes, and loads the buffer into the deck
 * before resolving — guaranteeing analysis is complete when load() returns.
 */
export class AudioPlayer {
  onTimeUpdate: ((time: number) => void) | null = null;
  onEnded: (() => void) | null = null;
  onAnalyzed: ((result: AnalysisResult) => void) | null = null;

  private loopId: number | null = null;
  private _duration: number = 0;

  constructor(
    private readonly getDeck: () => DeckState | null,
    private readonly getAudioContext: () => AudioContext | null,
    private readonly engine: AutoMixEngine
  ) {}

  /**
   * Downloads the audio file, decodes it to an AudioBuffer,
   * loads it into the deck, and runs analysis.
   * Resolves ONLY after analysis is complete.
   */
  async load(audioUrl: string, fallbackBpm?: number | null): Promise<void> {
    const ctx = this.engine.context;
    if (!ctx) throw new Error('AutoMixEngine not initialized');

    const deck = this.getDeck();
    if (!deck) throw new Error('Deck not available');

    console.log(`[AudioPlayer] Fetching and decoding: ${audioUrl}`);

    // 1. Fetch the ENTIRE file
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();

    // 2. Decode to AudioBuffer
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    this._duration = buffer.duration;

    // 3. Load buffer into deck
    this.engine.loadBuffer(deck, buffer);

    // 4. Run analysis (BLOCKING — this is the key fix)
    console.log(`[AudioPlayer] Analyzing buffer (${buffer.duration.toFixed(1)}s)...`);
    const result = await this.engine.analyze(buffer, fallbackBpm);
    deck.analysis = result;

    console.log(`[AudioPlayer] Analysis complete — BPM: ${result.bpm.toFixed(1)} | Key: ${result.key}`);
    this.onAnalyzed?.(result);
  }

  /**
   * Starts playback of the deck.
   */
  play(): void {
    const deck = this.getDeck();
    if (!deck) return;

    const ctx = this.getAudioContext();
    if (ctx?.state === 'suspended') void ctx.resume();

    this.engine.play(deck);

    // Start progress polling
    this.startProgressLoop();
  }

  /**
   * Pauses playback of the deck.
   */
  pause(): void {
    const deck = this.getDeck();
    if (!deck) return;

    this.engine.pause(deck);
    this.stopProgressLoop();
  }

  /**
   * Seeks to a specific time in the deck.
   */
  seek(time: number): void {
    const deck = this.getDeck();
    if (!deck) return;

    const d = this.duration;
    const t = Math.max(0, Math.min(d || time, time));
    this.engine.seek(deck, t);
  }

  /**
   * Sets the gain of the deck.
   */
  setGain(value: number, rampTime?: number): void {
    const deck = this.getDeck();
    const ctx = this.getAudioContext();
    if (!deck?.gain || !ctx) return;
    const now = ctx.currentTime;
    const g = deck.gain.gain;
    const target = Math.max(0, Math.min(4, value));
    if (rampTime != null && rampTime > 0) {
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + rampTime);
    } else {
      g.setValueAtTime(target, now);
    }
  }

  /**
   * Sets the lowpass filter of the deck.
   */
  setFilter(frequency: number, gainDb: number, rampTime?: number): void {
    const deck = this.getDeck();
    const ctx = this.getAudioContext();
    if (!deck?.filter || !ctx) return;
    const now = ctx.currentTime;
    const fq = deck.filter.frequency;
    const f = Math.max(20, Math.min(20000, frequency));
    const gn = deck.filter.gain;
    const gd = Math.max(-40, Math.min(40, gainDb));
    if (rampTime != null && rampTime > 0) {
      fq.setValueAtTime(fq.value, now);
      fq.exponentialRampToValueAtTime(f, now + rampTime);
      gn.setValueAtTime(gn.value, now);
      gn.linearRampToValueAtTime(gd, now + rampTime);
    } else {
      fq.setValueAtTime(f, now);
      gn.setValueAtTime(gd, now);
    }
  }

  /**
   * Returns the current playback time from the engine's deck state.
   */
  get currentTime(): number {
    const deck = this.getDeck();
    if (!deck) return 0;
    return this.engine.getCurrentPlaybackTime(deck);
  }

  /**
   * Returns the total duration of the loaded buffer.
   */
  get duration(): number {
    const deck = this.getDeck();
    return deck?.audioBuffer?.duration ?? this._duration;
  }

  /**
   * Returns the AudioBuffer loaded in the deck.
   */
  getAudioBuffer(): AudioBuffer | null {
    const deck = this.getDeck();
    return deck?.audioBuffer ?? null;
  }

  private startProgressLoop(): void {
    this.stopProgressLoop();

    // setInterval (not requestAnimationFrame) so the end-of-track detection
    // keeps firing while the tab is hidden. Browsers suspend RAF in
    // background tabs but still run interval callbacks (clamped to ~1s).
    this.loopId = window.setInterval(() => {
      const deck = this.getDeck();
      if (!deck?.isPlaying) {
        this.loopId = null;
        return;
      }
      this.onTimeUpdate?.(this.currentTime);

      // Check if playback reached the end
      if (deck.audioBuffer && this.currentTime >= deck.audioBuffer.duration) {
        this.onEnded?.();
        this.loopId = null;
        return;
      }
    }, 200);
  }

  private stopProgressLoop(): void {
    if (this.loopId != null) {
      window.clearInterval(this.loopId);
      this.loopId = null;
    }
  }
}
