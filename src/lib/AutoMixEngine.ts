// ═══════════════════════════════════════════
// REVERIE — AutoMix Engine v2.0 (TypeScript)
// Enhanced with:
//   - AudioBufferSourceNode architecture (sample-accurate playback)
//   - Native playbackRate automation (no more requestAnimationFrame hacks)
//   - Harmonic mixing (Camelot Wheel key detection via Goertzel algorithm)
//   - 3-band Dynamic EQ (Low/Mid/High wiping during transitions)
//   - Fixed activeTrackStartTime bug (accurate beat sync)
//   - All original features preserved (BPM consensus, phrase snapping, etc.)
// ═══════════════════════════════════════════

import type { AnalysisResult, DeckState, TransitionPlan, TransitionTier } from '../types';

declare global {
  interface Window {
    __automixStats?: Record<string, number>;
    __automixDecisions?: any[];
    exportAutomixDebug?: () => string;
  }
}

// Krumhansl–Kessler tonal hierarchies, index 0 = tonic.
const KEY_PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KEY_PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export class AutoMixEngine {
  context: AudioContext | null = null;
  deckA: DeckState | null = null;
  deckB: DeckState | null = null;
  private impulseBuffer: AudioBuffer | null = null;
  masterGain: GainNode | null = null;
  masterLimiter: DynamicsCompressorNode | null = null;
  onDeckEnded: ((deck: DeckState) => void) | null = null;

  // ═══════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════

  /**
   * Initializes the engine. Creates AudioContext, decks, and reverb impulse.
   * Call this once before any playback.
   */
  init(): void {
    if (!this.context) {
      this.context = new AudioContext();
    }

    if (!this.masterGain) {
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 1.0;
    }

    if (!this.masterLimiter) {
      this.masterLimiter = this.context.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1.0;
      this.masterLimiter.knee.value = 0;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.003;
      this.masterLimiter.release.value = 0.15;
      this.masterGain.connect(this.masterLimiter);
      this.masterLimiter.connect(this.context.destination);
    }

    if (!this.impulseBuffer) {
      this.impulseBuffer = this.generateReverbImpulse(1.5);
    }

    if (!this.deckA) {
      this.deckA = this.setupDeck();
    }

    if (!this.deckB) {
      this.deckB = this.setupDeck();
    }
  }

  /**
   * Loads a new audio buffer into a specified deck.
   */
  loadBuffer(deck: DeckState, buffer: AudioBuffer): void {
    if (deck.isPlaying) this.pause(deck);
    deck.audioBuffer = buffer;
    deck.startOffset = 0;
    deck.isPlaying = false;
    deck.sourceNode = null;
  }

  /**
   * Fetches and decodes an audio file into an AudioBuffer.
   */
  async loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await this.context!.decodeAudioData(arrayBuffer);
  }

  /**
   * Creates the audio node chain for a deck.
   * Routing: Source → Analyser → EQ Low → EQ Mid → EQ High → Gain → Filter → Destination
   *          Filter → Convolver → ReverbGain → Destination (parallel reverb)
   */
  private setupDeck(): DeckState {
    const ctx = this.context!;

    const gain = ctx.createGain();
    const eqLow = ctx.createBiquadFilter();
    const eqMid = ctx.createBiquadFilter();
    const eqHigh = ctx.createBiquadFilter();
    const filter = ctx.createBiquadFilter();
    const convolver = ctx.createConvolver();
    const reverbGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    // Configure EQ
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    eqLow.gain.value = 0;

    eqMid.type = 'peaking';
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 0.5;
    eqMid.gain.value = 0;

    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 3000;
    eqHigh.gain.value = 0;

    filter.type = 'lowpass';
    filter.frequency.value = 20000;

    convolver.buffer = this.impulseBuffer;
    reverbGain.gain.value = 0;

    analyser.fftSize = 256;

    // Routing: Analyser → EQ Low → EQ Mid → EQ High → Gain → Filter → Destination
    // Source is connected when play() is called
    analyser.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(gain);
    gain.connect(filter);
    filter.connect(this.masterGain!);

    // Parallel reverb path
    filter.connect(convolver);
    convolver.connect(reverbGain);
    reverbGain.connect(this.masterGain!);

    return {
      audioBuffer: null,
      sourceNode: null,
      startTime: 0,
      startOffset: 0,
      isPlaying: false,
      gain,
      eqLow,
      eqMid,
      eqHigh,
      filter,
      convolver,
      reverbGain,
      analyser,
    };
  }

  /**
   * Generates a reverb impulse response buffer.
   */
  private generateReverbImpulse(duration: number): AudioBuffer {
    const ctx = this.context!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const multiplier = Math.pow(1 - i / length, 3);
        data[i] = (Math.random() * 2 - 1) * multiplier;
      }
    }

    return impulse;
  }

  // ═══════════════════════════════════════
  // PLAYBACK CONTROL (FIXED: activeTrackStartTime bug)
  // ═══════════════════════════════════════

  /**
   * Starts playback of a deck from its current offset.
   * Creates a new AudioBufferSourceNode each time (since they can only be started once).
   */
  play(deck: DeckState): void {
    if (!deck.audioBuffer || !this.context) return;

    // Stop old source if exists
    if (deck.sourceNode) {
      try {
        deck.sourceNode.onended = null;
        deck.sourceNode.stop();
        deck.sourceNode.disconnect();
      } catch {}
    }

    // Solo playback uses the same loudness gain as transitions. Also reset any
    // EQ left over from a previous outgoing fade so direct starts aren't muffled.
    const now = this.context.currentTime;
    const soloGain = deck.analysis?.normalGain ?? 1;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(soloGain, now);
    deck.eqLow.gain.cancelScheduledValues(now);
    deck.eqLow.gain.setValueAtTime(0, now);
    deck.eqMid.gain.cancelScheduledValues(now);
    deck.eqMid.gain.setValueAtTime(0, now);
    deck.eqHigh.gain.cancelScheduledValues(now);
    deck.eqHigh.gain.setValueAtTime(0, now);
    deck.filter.frequency.cancelScheduledValues(now);
    deck.filter.frequency.setValueAtTime(20000, now);

    // Create new source
    const source = this.context.createBufferSource();
    source.buffer = deck.audioBuffer;
    source.connect(deck.analyser);

    // Set up end handler
    source.onended = () => {
      if (deck.sourceNode === source) {
        deck.isPlaying = false;
        deck.sourceNode = null;
        // Pin the offset to the end so fallback polling can detect it,
        // but the real signal is the onDeckEnded callback (sample-accurate
        // even when JS timers are throttled in background tabs).
        if (deck.audioBuffer) {
          deck.startOffset = deck.audioBuffer.duration;
        }
        this.onDeckEnded?.(deck);
      }
    };

    const startTime = this.context.currentTime;
    source.start(0, deck.startOffset);

    deck.sourceNode = source;
    deck.startTime = startTime;
    deck.isPlaying = true;
  }

  /**
   * Pauses playback of a deck, saving the current position.
   */
  pause(deck: DeckState): void {
    if (!deck.sourceNode || !this.context || !deck.isPlaying) return;

    const elapsed = Math.max(0, this.context.currentTime - deck.startTime);
    deck.startOffset += elapsed;

    try {
      deck.sourceNode.onended = null;
      deck.sourceNode.stop();
      deck.sourceNode.disconnect();
    } catch {}

    deck.sourceNode = null;
    deck.isPlaying = false;
  }

  /**
   * Seeks to a specific time in a deck.
   */
  seek(deck: DeckState, time: number): void {
    const wasPlaying = deck.isPlaying;
    if (wasPlaying) this.pause(deck);
    deck.startOffset = Math.max(0, Math.min(time, deck.audioBuffer?.duration || 0));
    if (wasPlaying) this.play(deck);
  }

  /**
   * Returns the current accurate playback time of a deck.
   * FIX: Replaces the buggy activeTrackStartTime which was never updated.
   */
  getCurrentPlaybackTime(deck: DeckState): number {
    if (!deck.isPlaying || !this.context) return deck.startOffset;
    const elapsed = Math.max(0, this.context.currentTime - deck.startTime);
    return deck.startOffset + elapsed;
  }

  // ═══════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════

  /**
   * Analyzes an audio buffer and returns the analysis result.
   * Includes BPM detection, key detection, mix point detection, and energy analysis.
   */
  async analyze(buffer: AudioBuffer, fallbackBpm?: number | null): Promise<AnalysisResult> {
    let bpm = 0;
    let tempoVariable = false;
    let mixPointAt: number | null = null;
    let confidence = 0;
    let energy = 0;
    let key = ''; // '' = unknown
    let keyConfidence = 0;
    let bpmRaw = 0;
    let bpmConfidenceRaw = 0;
    let bpmAgreement = 0;
    let bpmSource: 'detector' | 'metadata' | 'none' = 'none';
    let bpmWindowCount = 0;
    let bpmWindowsTotal = 0;
    let windowBpms: number[] = [];
    let mixLocalRatio = 1;
    let loudnessDb = -16;
    let normalGain = 1;
    let rmsAtMixPoint = 0;
    let avgRMS = 0;
    let bpmRange = 0;
    let bpmReliable = false;
    let analysisFallback = false;

    let beatOffset = 0;
    const safeOffsets = this.detectSafeOffsets(buffer);

    console.log(`[AutoMix] High-precision analysis (4-window BPM + Key detection + Energy Drop)...`);

    const windowResults: { offset: number; bpm: number; conf: number }[] = [];

    try {
      // ═══ BPM Detection (4-window consensus) ═══
      const windows = [10, 60, 90, 120].filter((t) => t + 10 < buffer.duration);

      for (const offset of windows) {
        const { bpm: winBPM, confidence: winConf } = this.detectBPMFromBuffer(buffer, offset);
        if (winBPM > 0) {
          windowResults.push({ offset, bpm: winBPM, conf: winConf });
          console.log(`[AutoMix] Window at ${offset}s: ${winBPM.toFixed(2)} BPM (Conf: ${winConf.toFixed(2)})`);
        }
      }

      // Calculate global energy (lightweight RMS)
      const channelData = buffer.getChannelData(0);
      const step = Math.floor(channelData.length / 1000);
      let sumSq = 0;
      let count = 0;
      for (let i = 0; i < channelData.length; i += step) {
        sumSq += channelData[i] * channelData[i];
        count++;
      }
      energy = Math.sqrt(sumSq / count);
      loudnessDb = 20 * Math.log10(Math.max(1e-6, energy));
      // Target -14 dBFS RMS. Clamp so quiet masters boost ≤1.5x, hot masters cut ≤0.5x.
      normalGain = Math.max(0.5, Math.min(1.5, Math.pow(10, (-14 - loudnessDb) / 20)));

      if (windowResults.length > 0) {
        // Reference octave: median of independently normalized windows.
        const normAll = windowResults.map(w => this.normalizeBPM(w.bpm)).sort((a, b) => a - b);
        const reference = normAll[Math.floor((normAll.length - 1) / 2)];

        // Fold each RAW window to the octave closest to the reference BEFORE
        // median/agreement. This prevents half/double windows from collapsing
        // the outlier filter down to a single survivor.
        const folded = windowResults.map(w => {
          const candidates = [w.bpm * 0.5, w.bpm, w.bpm * 2].filter(v => v >= 55 && v <= 200);
          let best = candidates[0] ?? w.bpm;
          let bestD = Math.abs(best - reference);
          for (const c of candidates) {
            const d = Math.abs(c - reference);
            if (d < bestD) { bestD = d; best = c; }
          }
          return { bpm: best, conf: w.conf };
        });

        const foldedSorted = folded.map(f => f.bpm).sort((a, b) => a - b);
        const baseMedian = foldedSorted[Math.floor((foldedSorted.length - 1) / 2)];
        const filtered = folded.filter(f => Math.abs(f.bpm - baseMedian) < 10);

        const filteredBPMs = filtered.map(f => f.bpm);
        const filteredConfs = filtered.map(f => f.conf);
        const filteredSorted = [...filteredBPMs].sort((a, b) => a - b);
        bpm = filteredSorted[Math.floor(filteredSorted.length / 2)];
        bpmRaw = bpm;

        const rawConf = filteredConfs.reduce((a, b) => a + b, 0) / Math.max(1, filteredConfs.length);
        const range = filteredSorted.length > 0
          ? Math.max(...filteredSorted) - Math.min(...filteredSorted)
          : 0;
        const windowCount = filteredBPMs.length;

        let agreement = 0;
        if (windowCount >= 2) {
          agreement = Math.max(0, 1 - range / 12);
          if (windowCount < 3) agreement *= 0.85;
          confidence = Math.min(1, rawConf * 0.55 + agreement * 0.45);
          confidence = Math.min(confidence, Math.max(rawConf, agreement * 0.75));
        } else {
          // Single surviving window: lower trust, but NOT near-zero.
          agreement = 0;
          confidence = Math.min(0.60, rawConf * 0.75 + 0.25);
        }

        // Evidence-gated floor: tight agreement across >=2 folded windows is real
        // evidence even when raw autocorrelation peak/variance is modest.
        // This is NOT the old synthetic floor: it requires octave-folded consensus
        // and window count, and it cannot reach PERFECT (0.70) by itself.
        if (windowCount >= 3 && range <= 2) {
          confidence = Math.max(confidence, 0.65);
        } else if (windowCount >= 2 && range <= 2) {
          confidence = Math.max(confidence, 0.58);
        }

        bpmConfidenceRaw = rawConf;
        bpmAgreement = agreement;
        bpmWindowCount = windowCount;
        bpmWindowsTotal = windowResults.length;
        windowBpms = filteredBPMs;
        bpmSource = 'detector';

      // 4. Tempo Variable Check
      bpmRange = range;
      const referenceBpm = bpm > 0 ? bpm : 120;
      const threshold = Math.max(14, referenceBpm * 0.12);
      if (range > threshold) {
        tempoVariable = true;
        console.warn(`[AutoMix] Tempo Variable! Filtered Range: ${range.toFixed(1)} BPM (Threshold: ${threshold.toFixed(1)}).`);
      }
      bpmReliable = true;

        console.log(
          `[AutoMix] Consensus: BPM=${bpm.toFixed(2)} | Conf=${confidence.toFixed(2)} | Energy=${energy.toFixed(3)}`
        );

        // ═══ Mix Point Detection ═══
        // Normalize BEFORE comb + mix-point so the comb period and barDuration agree.
        bpm = this.normalizeBPM(bpm);
        beatOffset = this.detectBeatOffset(buffer, bpm);
        const result = this.detectMixPoint(buffer, bpm, beatOffset, safeOffsets.audibleEndAt);
        mixPointAt = result.mixPoint;
        rmsAtMixPoint = result.rmsAtMixPoint;
        avgRMS = result.avgRMS;
        mixLocalRatio = result.localDropRatio;

        console.log(`[AutoMix] Mix point (Energy Drop) at: ${mixPointAt.toFixed(2)}s`);
      }

      // ═══ Key Detection (NEW: Camelot Wheel) ═══
      const keyResult = await this.detectKey(buffer);
      key = keyResult.key;
      keyConfidence = keyResult.confidence;
      console.log(`[AutoMix] Key: ${key || 'unknown'} (conf ${keyConfidence.toFixed(2)})`);
} catch (e) {
    console.error('[AutoMix] Analysis failed:', e);
    analysisFallback = true;
    if (fallbackBpm && fallbackBpm > 0) {
      bpm = fallbackBpm;
      confidence = 0.60;
      bpmReliable = true;
      bpmSource = 'metadata';
    } else {
      bpm = 0;
      confidence = 0.15;
      bpmReliable = false;
      bpmSource = 'none';
    }
    key = '';
    keyConfidence = 0;
  }

  if (!bpmReliable && !analysisFallback) {
    analysisFallback = true;
    if (fallbackBpm && fallbackBpm > 0) {
      bpm = fallbackBpm;
      confidence = 0.60;
      bpmReliable = true;
      bpmSource = 'metadata';
    } else {
      bpm = 0;
      confidence = 0.15;
      bpmReliable = false;
      bpmSource = 'none';
    }
  }

  if (bpm > 0) {
    if (bpmRaw === 0) bpmRaw = bpm;
    bpm = this.normalizeBPM(bpm);
  }
  if (beatOffset === 0 && bpm > 0) {
    beatOffset = this.detectBeatOffset(buffer, bpm);
  }
    // beatOffset and safeOffsets were computed early. detectMixPoint is already
    // grid-aligned to beatOffset, so no second competing phrase re-snap here.
    const barDuration = bpm > 0 ? (60 / bpm) * 4 : 2;
    const overlapBars = mixPointAt
      ? Math.min(16, Math.max(4, Math.floor((safeOffsets.audibleEndAt - mixPointAt) / barDuration)))
      : 8;

    return {
      bpm,
      bpmRaw,
      tempoVariable,
      mixPointAt,
      overlapBars,
      beatOffset,
      energy,
      confidence,
      key,
      keyConfidence,
      bpmConfidenceRaw,
      bpmAgreement,
      bpmSource,
      bpmWindowCount,
      bpmWindowsTotal,
      windowBpms,
      mixLocalRatio,
      loudnessDb,
      normalGain,
      rmsAtMixPoint,
      avgRMS,
      bpmReliable,
      bpmRange,
      analysisFallback,
      safeStartOffset: safeOffsets.safeStartOffset,
      introSilenceSecs: safeOffsets.introSilenceSecs,
      introEnergy: safeOffsets.introEnergy,
      audibleEndAt: safeOffsets.audibleEndAt,
      outroSilenceSecs: safeOffsets.outroSilenceSecs,
    };
  }

  /**
   * Detects the musical key using a Goertzel chroma vector correlated against
   * the Krumhansl–Kessler major/minor profiles for all 24 keys.
   * Maps the winner to a Camelot Wheel code (e.g., "8B" for C Major).
   */
  private async detectKey(buffer: AudioBuffer): Promise<{ key: string; confidence: number }> {
    const sampleRate = buffer.sampleRate;
    const duration = Math.min(30, buffer.duration);
    const length = Math.floor(duration * sampleRate);
    const channelData = buffer.getChannelData(0).slice(0, length);

    const chroma = new Array(12).fill(0);
    const noteFrequencies = [
      261.63, 277.18, 293.66, 311.13, 329.63, 349.23,
      369.99, 392.00, 415.30, 440.00, 466.16, 493.88
    ];

    const windowSize = sampleRate;
    const numWindows = Math.floor(length / windowSize);

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      const end = start + windowSize;
      const windowData = channelData.slice(start, end);

      for (let oct = 0; oct < 3; oct++) {
        for (let note = 0; note < 12; note++) {
          const freq = noteFrequencies[note] * Math.pow(2, oct - 1);
          chroma[note] += this.goertzelEnergy(windowData, sampleRate, freq);
        }
      }
    }

    const maxChroma = Math.max(...chroma);
    if (maxChroma <= 1e-6) return { key: '', confidence: 0 };

    for (let i = 0; i < 12; i++) chroma[i] /= maxChroma;

    const sorted = [...chroma].sort((a, b) => b - a);
    if (sorted[0] - sorted[1] <= 1e-6) return { key: '', confidence: 0 };

    const meanChroma = chroma.reduce((a, b) => a + b, 0) / 12;
    let best = { tonic: 0, mode: 'major' as 'major' | 'minor', corr: -1 };
    let secondCorr = -1;

    for (const profile of [
      { mode: 'major' as const, values: KEY_PROFILE_MAJOR },
      { mode: 'minor' as const, values: KEY_PROFILE_MINOR },
    ]) {
      const meanProfile = profile.values.reduce((a, b) => a + b, 0) / 12;
      for (let tonic = 0; tonic < 12; tonic++) {
        let num = 0;
        let dC = 0;
        let dP = 0;
        for (let pc = 0; pc < 12; pc++) {
          const dc = chroma[pc] - meanChroma;
          const dp = profile.values[(pc - tonic + 12) % 12] - meanProfile;
          num += dc * dp;
          dC += dc * dc;
          dP += dp * dp;
        }
        const corr = dC > 1e-9 && dP > 1e-9 ? num / Math.sqrt(dC * dP) : -1;
        if (corr > best.corr) {
          secondCorr = best.corr;
          best = { tonic, mode: profile.mode, corr };
        } else if (corr > secondCorr) {
          secondCorr = corr;
        }
      }
    }

    if (best.corr < 0) return { key: '', confidence: 0 };
    // Confidence from profile fit plus margin over the runner-up key.
    const margin = Math.max(0, best.corr - secondCorr);
    const confidence = Math.max(0, Math.min(1, best.corr * 0.65 + margin * 0.35));
    // Weak profile fits are noise; stay neutral rather than guess.
    if (best.corr < 0.30 || confidence < 0.10) return { key: '', confidence };

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return { key: this.noteToCamelot(noteNames[best.tonic], best.mode), confidence };
  }

  /**
   * Calculates the energy of a specific frequency in a signal using the Goertzel algorithm.
   */
  private goertzelEnergy(samples: Float32Array, sampleRate: number, targetFreq: number): number {
    const k = Math.floor(0.5 + samples.length * targetFreq / sampleRate);
    const omega = (2 * Math.PI * k) / samples.length;
    const coeff = 2 * Math.cos(omega);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < samples.length; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }

  /**
   * Maps a musical note and mode to a Camelot Wheel code.
   */
  private noteToCamelot(note: string, mode: 'major' | 'minor'): string {
    const camelotMap: Record<string, { major: string; minor: string }> = {
      'C':   { major: '8B',  minor: '5A'  },
      'C#':  { major: '3B',  minor: '12A' },
      'D':   { major: '10B', minor: '7A'  },
      'D#':  { major: '5B',  minor: '2A'  },
      'E':   { major: '12B', minor: '9A'  },
      'F':   { major: '7B',  minor: '4A'  },
      'F#':  { major: '2B',  minor: '11A' },
      'G':   { major: '9B',  minor: '6A'  },
      'G#':  { major: '4B',  minor: '1A'  },
      'A':   { major: '11B', minor: '8A'  },
      'A#':  { major: '6B',  minor: '3A'  },
      'B':   { major: '1B',  minor: '10A' },
    };

    return camelotMap[note]?.[mode] || '';
  }

  /**
   * Comb-filter beat/bar-phase detector.
   * Instead of "first transient = downbeat", find the phase whose beat grid
   * accumulates the most onset novelty, then pick the strongest bar phase.
   */
  private detectBeatOffset(buffer: AudioBuffer, bpm = 0): number {
    const sampleRate = buffer.sampleRate;
    const analysisLength = Math.min(buffer.length, sampleRate * 30);
    const data = buffer.getChannelData(0).slice(0, analysisLength);
    const envelope = this.computeEnergyEnvelope(data, sampleRate, 0.01);
    if (envelope.length < 8) return 0;

    // Half-wave rectified energy flux = onset novelty.
    const novelty = new Float32Array(envelope.length);
    for (let i = 1; i < envelope.length; i++) {
      novelty[i] = Math.max(0, envelope[i] - envelope[i - 1]);
    }

    // Fallback for unknown BPM: old first-peaks heuristic.
    if (!bpm || bpm <= 0) {
      const avg = envelope.reduce((a, b) => a + b, 0) / envelope.length;
      const th = avg * 1.5;
      for (let i = 1; i < envelope.length - 1; i++) {
        if (envelope[i] > th && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
          return i * 0.01;
        }
      }
      return 0;
    }

    const hop = 0.01;
    const beatFrames = Math.max(1, Math.round((60 / bpm) / hop));

    // 1) Beat phase: comb over up to 16 beats.
    let bestPhase = 0;
    let bestPhaseScore = -1;
    for (let phase = 0; phase < beatFrames && phase < novelty.length; phase++) {
      let sum = 0, count = 0;
      for (let k = 0; k < 16; k++) {
        const idx = phase + k * beatFrames;
        if (idx >= novelty.length) break;
        sum += novelty[idx];
        count++;
      }
      const score = count > 0 ? sum / count : 0;
      if (score > bestPhaseScore) {
        bestPhaseScore = score;
        bestPhase = phase;
      }
    }

    // 2) Bar phase: among the 4 beats, pick the one with strongest bar-periodic onsets.
    let bestOffset = bestPhase;
    let bestBarScore = -1;
    for (let b = 0; b < 4; b++) {
      const off = bestPhase + b * beatFrames;
      if (off >= novelty.length) break;
      let sum = 0, count = 0;
      for (let k = 0; k < 8; k++) {
        const idx = off + k * 4 * beatFrames;
        if (idx >= novelty.length) break;
        sum += novelty[idx];
        count++;
      }
      const score = count > 0 ? sum / count : 0;
      if (score > bestBarScore) {
        bestBarScore = score;
        bestOffset = off;
      }
    }

    return bestOffset * hop;
  }

  /**
   * Detects the BPM of a specific 10-second window in the buffer.
   */
  private detectBPMFromBuffer(buffer: AudioBuffer, offset: number): { bpm: number; confidence: number } {
    const sampleRate = buffer.sampleRate;
    const start = Math.floor(offset * sampleRate);
    const end = Math.min(Math.floor((offset + 10) * sampleRate), buffer.length);

    if (start >= buffer.length || end - start < sampleRate * 2) return { bpm: 0, confidence: 0 };

    const raw = buffer.getChannelData(0).slice(start, end);
    const envelope = this.computeEnergyEnvelope(raw, sampleRate, 0.01);
    const { bpm, confidence } = this.autocorrelationBPM(envelope, 1 / 0.01);

    return { bpm, confidence };
  }

  /**
   * Computes the RMS energy envelope of a signal.
   */
  private computeEnergyEnvelope(samples: Float32Array, sampleRate: number, windowSecs: number): Float32Array {
    const windowSize = Math.floor(sampleRate * windowSecs);
    const envelopeLength = Math.floor(samples.length / windowSize);
    const envelope = new Float32Array(envelopeLength);

    for (let i = 0; i < envelopeLength; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, samples.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += samples[j] * samples[j];
      envelope[i] = Math.sqrt(sum / (end - start));
    }
    return envelope;
  }

  /**
   * Autocorrelation-based BPM detection.
   */
  private autocorrelationBPM(envelope: Float32Array, envelopeRate: number): { bpm: number; confidence: number } {
    const minBPM = 60;
    const maxBPM = 200;
    const minLag = Math.max(1, Math.floor((envelopeRate * 60) / maxBPM));
    const maxLag = Math.floor((envelopeRate * 60) / minBPM);

    if (maxLag >= envelope.length) return { bpm: 0, confidence: 0 };

    const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const centered = envelope.map(v => v - mean);

    // Calculate variance (autocorrelation at lag 0) for proper normalization
    let variance = 0;
    for (let i = 0; i < centered.length; i++) variance += centered[i] * centered[i];
    variance /= centered.length;

    let bestLag = 0;
    let bestVal = -Infinity;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      const count = envelope.length - lag;
      for (let i = 0; i < count; i++) sum += centered[i] * centered[i + lag];
      const autocorr = sum / count;

      if (autocorr > bestVal) {
        bestVal = autocorr;
        bestLag = lag;
      }
    }

    if (bestLag <= 0) return { bpm: 0, confidence: 0 };

    const intervalSecs = bestLag / envelopeRate;
    const bpm = intervalSecs > 0 ? 60 / intervalSecs : 0;

    // Proper confidence: ratio of peak autocorrelation to variance (lag 0)
    const confidence = variance > 0 ? Math.min(1, bestVal / variance) : 0;

    return { bpm, confidence: Math.max(0, Math.min(1, confidence)) };
  }

  /**
   * Detects the best mix point (energy drop or outro) in the track.
   */
  private detectMixPoint(
    buffer: AudioBuffer,
    bpm: number,
    beatOffset: number,
    audibleEndAt: number
  ): { mixPoint: number; rmsAtMixPoint: number; avgRMS: number; localDropRatio: number } {
    const barDuration = bpm > 0 ? (60 / bpm) * 4 : 2;
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const frameSize = Math.max(1, Math.floor(sampleRate * 0.05));
    const totalFrames = Math.floor(channelData.length / frameSize);
    const energyArr = new Float32Array(totalFrames);
    let totalEnergySum = 0;

    for (let f = 0; f < totalFrames; f++) {
      const start = f * frameSize;
      const end = Math.min(start + frameSize, channelData.length);
      let sum = 0;
      for (let i = start; i < end; i++) sum += channelData[i] * channelData[i];
      energyArr[f] = Math.sqrt(sum / Math.max(1, end - start));
      totalEnergySum += energyArr[f];
    }

    const avgRMS = totalEnergySum / Math.max(1, totalFrames);
    const twoBarFrames = Math.max(1, Math.round((barDuration * 2) / 0.05));
    const localFrames = Math.max(1, Math.round((barDuration * 8) / 0.05));

    const windowRMSAt = (t: number): number => {
      const frame = Math.floor(t / 0.05);
      if (frame < 0 || frame + twoBarFrames >= totalFrames) return avgRMS;
      let s = 0;
      for (let f = frame; f < frame + twoBarFrames; f++) s += energyArr[f] * energyArr[f];
      return Math.sqrt(s / twoBarFrames);
    };

    // Local baseline = mean RMS of the preceding 8 bars. A drop from a loud
    // section into a quieter outro is a good exit even if still above global avg.
    const localBaselineAt = (t: number): number => {
      const frame = Math.floor(t / 0.05);
      const start = Math.max(0, frame - localFrames);
      if (frame <= 0 || frame <= start) return avgRMS;
      let s = 0;
      for (let f = start; f < frame; f++) s += energyArr[f];
      return s / (frame - start);
    };

    const endLimit = Math.max(0, audibleEndAt - 4 * barDuration - 0.25);
    const searchStart = Math.max(beatOffset + 8 * barDuration, buffer.duration * 0.60);
    const span = Math.max(0.001, endLimit - searchStart);
    const step = barDuration * 2; // finer 2-bar candidates

    let bestScore = Infinity;
    let bestMixPoint = -1;
    let bestRMS = avgRMS;
    let bestLocalDrop = 1;

    const scoreAt = (t: number) => {
      const wrms = windowRMSAt(t);
      const globalRatio = avgRMS > 0 ? wrms / avgRMS : 1;
      const localBase = localBaselineAt(t);
      const localDrop = localBase > 1e-6 ? wrms / localBase : 1;

      const barsFromOrigin = (t - beatOffset) / barDuration;
      const mod8 = ((barsFromOrigin % 8) + 8) % 8;
      const distToPhrase = Math.min(mod8, 8 - mod8);
      const is8 = distToPhrase < 0.01;
      const is4 = Math.abs(distToPhrase - 4) < 0.01;
      const alignmentPenalty = is8 ? 0 : is4 ? 0.05 : 0.15;

      const latenessPenalty = 0.25 * (1 - (t - searchStart) / span);
      const runwayBars = (audibleEndAt - t) / barDuration;
      const runwayPenalty = Math.max(0, (8 - runwayBars) / 8) * 0.3;

      // Local drop dominates; global ratio is a secondary term.
      const energyTerm = Math.min(localDrop, 1.5) + 0.3 * Math.min(globalRatio, 1.5);
      const score = energyTerm + latenessPenalty + runwayPenalty + alignmentPenalty;
      return { score, wrms, localDrop };
    };

    if (step > 0 && endLimit > searchStart) {
      const first = beatOffset + Math.ceil((searchStart - beatOffset) / step) * step;
      for (let t = first; t <= endLimit; t += step) {
        const { score, wrms, localDrop } = scoreAt(t);
        if (score < bestScore) {
          bestScore = score;
          bestMixPoint = t;
          bestRMS = wrms;
          bestLocalDrop = localDrop;
        }
      }
    }

    if (bestMixPoint < 0) {
      const target = Math.max(beatOffset, audibleEndAt - 8 * barDuration);
      const k = Math.floor((target - beatOffset) / Math.max(0.001, step));
      bestMixPoint = Math.max(0, beatOffset + k * step);
      const r = scoreAt(bestMixPoint);
      bestRMS = r.wrms;
      bestLocalDrop = r.localDrop;
    }

    bestMixPoint = Math.min(bestMixPoint, endLimit);
    return { mixPoint: bestMixPoint, rmsAtMixPoint: bestRMS, avgRMS, localDropRatio: bestLocalDrop };
  }

  /**
   * Detects leading silence, leading low-energy intro, and trailing silence.
   * Used to avoid fading into dead air.
   *
   * Safety rules:
   * - Never skip more than maxIntroSkipSecs.
   * - If detected silence is suspicious, fall back to 0.
   * - Use both RMS and peak so quiet transients are not missed.
   */
  private detectSafeOffsets(buffer: AudioBuffer): {
    safeStartOffset: number;
    introSilenceSecs: number;
    introEnergy: number;
    audibleEndAt: number;
    outroSilenceSecs: number;
  } {
    const frameSecs = 0.05;
    const frameSize = Math.max(1, Math.floor(buffer.sampleRate * frameSecs));
    const channelCount = Math.min(2, buffer.numberOfChannels || 1);

    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) {
      channels.push(buffer.getChannelData(c));
    }

    const length = channels[0]?.length ?? 0;
    const totalFrames = Math.floor(length / frameSize);

    if (!length || totalFrames < 8) {
      return {
        safeStartOffset: 0,
        introSilenceSecs: 0,
        introEnergy: 0,
        audibleEndAt: buffer.duration,
        outroSilenceSecs: 0,
      };
    }

    const rms = new Float32Array(totalFrames);
    const peak = new Float32Array(totalFrames);

    let globalPeak = 0;

    for (let f = 0; f < totalFrames; f++) {
      const start = f * frameSize;
      const end = Math.min(start + frameSize, length);

      let sumSq = 0;
      let framePeak = 0;

      for (let i = start; i < end; i++) {
        let sample = 0;

        for (let c = 0; c < channelCount; c++) {
          sample += channels[c][i];
        }

        sample /= channelCount;

        sumSq += sample * sample;

        const abs = Math.abs(sample);
        if (abs > framePeak) framePeak = abs;
      }

      rms[f] = Math.sqrt(sumSq / Math.max(1, end - start));
      peak[f] = framePeak;

      if (framePeak > globalPeak) {
        globalPeak = framePeak;
      }
    }

    const sortedRms = Array.from(rms).sort((a, b) => a - b);
    const noiseFloor = sortedRms[Math.floor(sortedRms.length * 0.10)] ?? 0;
    const medianRms = sortedRms[Math.floor(sortedRms.length * 0.50)] ?? 0;

    const absoluteFloor = 0.0008;

    let threshold = Math.max(
      noiseFloor * 2.0,
      globalPeak * 0.006,
      medianRms * 0.02,
      absoluteFloor
    );

    // If the threshold is too high relative to the track's median level, lower it.
    if (threshold > medianRms * 0.35 && medianRms > absoluteFloor) {
      threshold = Math.max(absoluteFloor, medianRms * 0.08);
    }

    const minFrames = 2; // 100 ms sustained
    const maxIntroSkipSecs = 12;

    const peakThreshold = Math.max(threshold * 2, globalPeak * 0.015);

    const findFirstAudible = (th: number, pkTh: number): number => {
      let run = 0;

      for (let i = 0; i < totalFrames; i++) {
        const audible = rms[i] > th || peak[i] > pkTh;

        if (audible) {
          run++;
          if (run >= minFrames) {
            return (i - run + 1) * frameSecs;
          }
        } else {
          run = 0;
        }
      }

      return -1;
    };

    let firstAudibleAt = findFirstAudible(threshold, peakThreshold);

    // Retry with a lower threshold if the first result is missing or suspicious.
    const lowerThreshold = Math.max(
      absoluteFloor * 0.5,
      noiseFloor * 1.25,
      globalPeak * 0.0015
    );

    const lowerPeakThreshold = Math.max(lowerThreshold * 2, globalPeak * 0.004);
    const retryAt = findFirstAudible(lowerThreshold, lowerPeakThreshold);

    if (retryAt >= 0 && (firstAudibleAt < 0 || retryAt < firstAudibleAt)) {
      firstAudibleAt = retryAt;
    }

    let introSilenceSecs = 0;
    let safeStartOffset = 0;

    // Only trust silence detection if it finds a small, sensible intro skip.
    if (firstAudibleAt > 0.30 && firstAudibleAt <= maxIntroSkipSecs) {
      introSilenceSecs = firstAudibleAt;
      safeStartOffset = Math.min(buffer.duration, firstAudibleAt + 0.02);
    }

    // Outro detection
    let lastFrame = -1;
    let run = 0;

    for (let i = totalFrames - 1; i >= 0; i--) {
      const audible = rms[i] > threshold || peak[i] > peakThreshold;

      if (audible) {
        run++;
        if (run >= minFrames) {
          lastFrame = i;
          break;
        }
      } else {
        run = 0;
      }
    }

    const audibleEndAt =
      lastFrame >= 0
        ? Math.min(buffer.duration, (lastFrame + 1) * frameSecs + 0.10)
        : buffer.duration;

    const outroSilenceSecs = Math.max(0, buffer.duration - audibleEndAt);

    // Intro energy after safe start
    const startFrame = Math.max(0, Math.floor(safeStartOffset / frameSecs));
    const endFrame = Math.min(totalFrames, startFrame + Math.floor(8 / frameSecs));

    let introSum = 0;
    let introCount = 0;

    for (let i = startFrame; i < endFrame; i++) {
      introSum += rms[i];
      introCount++;
    }

    const introEnergy = introCount > 0 ? introSum / introCount : 0;

    return {
      safeStartOffset,
      introSilenceSecs,
      introEnergy,
      audibleEndAt,
      outroSilenceSecs,
    };
  }

  /**
   * Normalizes a BPM to the 70-140 BPM range.
   */
  normalizeBPM(bpm: number): number {
    if (!bpm || bpm <= 0) return 0;
    let normalized = bpm;
    while (normalized > 140) normalized /= 2;
    while (normalized < 70 && normalized > 0) normalized *= 2;
    return normalized;
  }

  /**
   * Gets the relative bass energy of a deck.
   */
  // @ts-ignore -- kept for future adaptive EQ transitions
  private getBassEnergy(analyser?: AnalyserNode): number {
    if (!analyser) return 0.5;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const nyquist = analyser.context.sampleRate / 2;
    const binSize = nyquist / bufferLength;
    const cutoffBin = Math.max(1, Math.floor(200 / binSize));

    let sum = 0;
    for (let i = 0; i < cutoffBin; i++) {
      const normalized = dataArray[i] / 255.0;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / cutoffBin);
  }

  // ═══════════════════════════════════════
  // TRANSITION PLANNING (Enhanced with Harmonic Mixing)
  // ═══════════════════════════════════════

  /**
   * Harmonic relation between two Camelot keys.
   * Either key unknown OR below the confidence bar => 'unknown', never a match/clash.
   */
  private harmonicRelation(
    keyA: string,
    keyB: string,
    confA: number,
    confB: number
  ): 'compatible' | 'incompatible' | 'unknown' {
    const KEY_CONF_COMPAT = 0.25;
    const KEY_CONF_CLASH = 0.35;

    if (!keyA || !keyB || confA < KEY_CONF_COMPAT || confB < KEY_CONF_COMPAT) return 'unknown';
    if (keyA === keyB) return 'compatible';

    const numA = parseInt(keyA.slice(0, -1));
    const letterA = keyA.slice(-1);
    const numB = parseInt(keyB.slice(0, -1));
    const letterB = keyB.slice(-1);
    if (Number.isNaN(numA) || Number.isNaN(numB)) return 'unknown';

    if (numA === numB && letterA !== letterB) return 'compatible';
    if (letterA === letterB && (Math.abs(numA - numB) === 1 || Math.abs(numA - numB) === 11)) return 'compatible';
    if (letterA !== letterB && (Math.abs(numA - numB) === 1 || Math.abs(numA - numB) === 11)) return 'compatible';

    // Only call a clash when BOTH keys are reasonably confident.
    // Low-conf disagreement is neutral, not a tier penalty.
    return (confA >= KEY_CONF_CLASH && confB >= KEY_CONF_CLASH) ? 'incompatible' : 'unknown';
  }

  private ratioLabel(r: number): string {
    const candidates: [number, string][] = [
      [1, '1:1'], [2, '2:1'], [0.5, '1:2'],
      [1.5, '3:2'], [2 / 3, '2:3'],
      [1.25, '5:4'], [0.8, '4:5'],
      [1.2, '6:5'], [5 / 6, '5:6'],
      [4 / 3, '4:3'], [0.75, '3:4'],
    ];
    for (const [v, label] of candidates) {
      if (Math.abs(r - v) / v <= 0.03) return label;
    }
    return 'free';
  }

  /**
   * Plans a transition between two tracks based on their analysis results.
   */
  planTransition(analysisA: AnalysisResult, analysisB: AnalysisResult, durationA: number): TransitionPlan {
    const bpmReliableA = analysisA.bpmReliable !== false && analysisA.bpm > 0;
    const bpmReliableB = analysisB.bpmReliable !== false && analysisB.bpm > 0;
    const missingBpm = !bpmReliableA || !bpmReliableB;

    const bpmA = analysisA.bpm > 0 ? analysisA.bpm : 120;
    const bpmB = analysisB.bpm > 0 ? analysisB.bpm : 120;

    // Pairwise octave disambiguation. Try {0.5, 1, 2} on both sides, pick the
    // closest plausible pair, with a small penalty for unnecessary octave shifts.
    // Simple ratios like 5:4 / 6:5 are NOT normalized away; they stay real deltas.
    let effectiveBpmA = bpmA;
    let effectiveBpmB = bpmB;
    const octaves = [0.5, 1, 2];
    let bestPairScore = Infinity;
    for (const ma of octaves) {
      for (const mb of octaves) {
        const a = bpmA * ma;
        const b = bpmB * mb;
        if (a < 55 || a > 200 || b < 55 || b > 200) continue;
        const d = Math.abs(a - b);
        const score = d + (ma !== 1 ? 2 : 0) + (mb !== 1 ? 2 : 0);
        if (score < bestPairScore) {
          bestPairScore = score;
          effectiveBpmA = a;
          effectiveBpmB = b;
        }
      }
    }

    const delta = Math.abs(effectiveBpmA - effectiveBpmB);
    const tempoRatio = effectiveBpmB / Math.max(0.001, effectiveBpmA);
    const ratioLabel = this.ratioLabel(tempoRatio);
    const tempoRatioAbs = Math.max(tempoRatio, 1 / Math.max(0.001, tempoRatio));
    const rawRatio = bpmB / Math.max(0.001, bpmA);
    const rawRatioAbs = Math.max(rawRatio, 1 / Math.max(0.001, rawRatio));
    const avgConf = (analysisA.confidence + analysisB.confidence) / 2;
    const energyDiff = Math.abs(analysisA.energy - analysisB.energy) / Math.max(0.001, analysisA.energy, analysisB.energy);
    const bothVariable = analysisA.tempoVariable && analysisB.tempoVariable;
    const maxBpmRange = Math.max(analysisA.bpmRange || 0, analysisB.bpmRange || 0);
    const severelyUnstable =
      bothVariable && (maxBpmRange > 30 || avgConf < 0.35 || delta > 12);

    const keyConfA = analysisA.keyConfidence ?? 0;
    const keyConfB = analysisB.keyConfidence ?? 0;
    const KEY_CONF_KNOWN = 0.30;
    const relation = this.harmonicRelation(analysisA.key, analysisB.key, keyConfA, keyConfB);
    const keyKnownBoth = !!analysisA.key && !!analysisB.key && keyConfA >= KEY_CONF_KNOWN && keyConfB >= KEY_CONF_KNOWN;

    const beatDuration = 60 / effectiveBpmA;
    const barDuration = 4 * beatDuration;
    const effectiveDurationA = Math.min(durationA, analysisA.audibleEndAt ?? durationA);
    const audibleEndA = analysisA.audibleEndAt ?? durationA;

    let mixPointAt = analysisA.mixPointAt || Math.max(0, effectiveDurationA - 16 * barDuration);
    // Snap fade point to A's bar grid anchored at the detected downbeat.
    if (barDuration > 0) {
      const k = Math.round((mixPointAt - analysisA.beatOffset) / barDuration);
      mixPointAt = Math.max(0, analysisA.beatOffset + k * barDuration);
    }

    const outroSecs = Math.max(0, audibleEndA - mixPointAt);
    const mixEnergyRatio = analysisA.avgRMS && analysisA.avgRMS > 0
      ? (analysisA.rmsAtMixPoint ?? analysisA.avgRMS) / analysisA.avgRMS
      : 1;
    const mixLocalRatio = analysisA.mixLocalRatio ?? 1;
    const goodExit = analysisA.mixPointAt != null && outroSecs >= 4 * barDuration &&
      (mixEnergyRatio < 0.90 || mixLocalRatio < 0.75);
    const stable = !analysisA.tempoVariable && !analysisB.tempoVariable;

    const reasons: string[] = [];
    let tier: TransitionTier;

    // ── Safety floor ──
    if (missingBpm) {
      tier = 'XFADE_SHORT'; reasons.push('missingBpm');
    } else if (severelyUnstable) {
      tier = 'XFADE_SHORT'; reasons.push('severelyUnstable');
    } else if (avgConf < 0.20) {
      tier = 'XFADE_SHORT'; reasons.push('avgConf<0.20');
    } else if (energyDiff > 0.85) {
      tier = 'XFADE_SHORT'; reasons.push('energyDiff>0.85');
    } else if (delta > 40 || rawRatioAbs >= 1.45) {
      tier = 'CUT'; reasons.push('cut:rawTempoExtreme');
    } else {
      // ── Compatibility-driven tier. BPM delta NO LONGER forces HARD. ──
      // Delta shapes overlap length below, not the tier label.
      if (relation === 'compatible' && keyKnownBoth && avgConf >= 0.70 && energyDiff < 0.20 && stable && goodExit && rawRatioAbs <= 1.06) {
        tier = 'PERFECT'; reasons.push('perfect');
      } else if (relation !== 'incompatible' && avgConf >= 0.55 && energyDiff < 0.35 && goodExit) {
        tier = 'CLEAN'; reasons.push('clean');
      } else if (avgConf >= 0.30 && energyDiff < 0.60) {
        tier = 'MODERATE'; reasons.push('moderate');
      } else {
        tier = 'HARD'; reasons.push('hardFallback');
      }
    }

    // ── Caps ──
    const tierRank: Record<string, number> = {
      'PERFECT': 4, 'CLEAN': 3, 'MODERATE': 2, 'HARD': 1, 'XFADE_SHORT': 0, 'CUT': -1
    };
    let maxAllowedTier: TransitionTier = 'PERFECT';

    if (bothVariable) { maxAllowedTier = 'MODERATE'; reasons.push('cap:bothVariable'); }
    if (avgConf < 0.35) { maxAllowedTier = 'MODERATE'; reasons.push('cap:avgConf<0.35'); }
    if (energyDiff > 0.60) { maxAllowedTier = 'MODERATE'; reasons.push('cap:energyDiff>0.60'); }
    if (relation === 'incompatible') { maxAllowedTier = 'MODERATE'; reasons.push('cap:harmonicClash'); }
    if (relation === 'unknown' && tierRank[maxAllowedTier] > tierRank['CLEAN']) {
      maxAllowedTier = 'CLEAN'; reasons.push('cap:unknownKey');
    }
    if (!goodExit && tierRank[maxAllowedTier] > tierRank['CLEAN']) {
      maxAllowedTier = 'CLEAN'; reasons.push('cap:weakExit');
    }
    if (delta > 25 && tierRank[maxAllowedTier] > tierRank['CLEAN']) {
      maxAllowedTier = 'CLEAN'; reasons.push('cap:delta>25');
    }

    if (tierRank[tier] > tierRank[maxAllowedTier]) {
      reasons.push(`capped:${tier}->${maxAllowedTier}`);
      tier = maxAllowedTier;
    }

    // ── Overlap safety: fractional bars, ratio-aware, runway-clamped ──
    // With tempo match disabled, high ratios drift multiple beats over long blends.
    // Shorten the blend as the ratio departs from 1; CUT for extreme mismatch.
    let overlapBarsCap: number;

    if (tier === 'CUT') {
      overlapBarsCap = 0.75;
    } else {
      const base = tier === 'PERFECT' ? 16 : tier === 'CLEAN' ? 12 : tier === 'MODERATE' ? 8 : 4;
      let gapFactor: number;
      if (rawRatioAbs <= 1.03) gapFactor = 1;
      else if (rawRatioAbs <= 1.08) gapFactor = 0.85;
      else if (rawRatioAbs <= 1.15) gapFactor = 0.6;
      else if (rawRatioAbs <= 1.25) gapFactor = 0.4;
      else if (rawRatioAbs <= 1.4) gapFactor = 0.25;
      else gapFactor = 0.15;

      overlapBarsCap = base * gapFactor;
      const minBars = (tier === 'XFADE_SHORT' || tier === 'HARD') ? 1.5 : 2;
      overlapBarsCap = Math.max(minBars, overlapBarsCap);
    }

    // Harmonic clash: keep the blend short regardless of tier label.
    if (relation === 'incompatible') overlapBarsCap = Math.min(overlapBarsCap, 3);

    const maxBarsInOutro = outroSecs / barDuration - 0.5;
    if (maxBarsInOutro >= 1) overlapBarsCap = Math.min(overlapBarsCap, maxBarsInOutro);
    else overlapBarsCap = Math.min(overlapBarsCap, 1);

    // Beat-drift time cap: with stretch off, overlap must not accumulate more
    // than ~1.5 beats of drift (0.75 for CUT). Uses real playback BPMs, not
    // octave-halved bar math, so a 60-BPM effective anchor can't stretch a blend.
    const bpmAReal = analysisA.bpm > 0 ? analysisA.bpm : effectiveBpmA;
    const bpmBReal = analysisB.bpm > 0 ? analysisB.bpm : effectiveBpmB;
    const driftBps = Math.abs(bpmAReal - bpmBReal) / 60;
    const maxDriftBeats = tier === 'CUT' ? 0.75 : 1.5;
    const driftCapSecs = maxDriftBeats / Math.max(0.001, driftBps);
    let overlapSecs = Math.max(0.5, Math.min(overlapBarsCap * barDuration, driftCapSecs));
    let fadeOutAt = mixPointAt;
    let fadeInAt = mixPointAt;

    const outroSilenceA = analysisA.outroSilenceSecs ?? 0;
    if (outroSilenceA > 0.75) {
      const latestFadeOut = Math.max(0, audibleEndA - overlapSecs);
      if (fadeOutAt > latestFadeOut) {
        fadeOutAt = latestFadeOut;
        fadeInAt = fadeOutAt;
        reasons.push('clamp:outroSilence');
      }
    }
    if (fadeOutAt > audibleEndA - 0.25) {
      fadeOutAt = Math.max(0, audibleEndA - 0.25);
      fadeInAt = fadeOutAt;
      reasons.push('clamp:audibleEnd');
    }

    // ── Incoming entry aligned to B's bar grid (Step 4) ──
    const barDurationB = 4 * (60 / effectiveBpmB);
    const gridB = analysisB.beatOffset ?? 0;
    const rawEntryB =
      analysisB.safeStartOffset && analysisB.safeStartOffset > 0.30
        ? analysisB.safeStartOffset
        : Math.max(0, gridB);
    let incomingOffset = rawEntryB;
    if (barDurationB > 0) {
      const k = Math.max(0, Math.ceil((rawEntryB - gridB) / barDurationB - 1e-6));
      incomingOffset = Math.max(0, gridB + k * barDurationB);
    }

    // TEMPO MATCH DISABLED (stopgap). Direction was inverted, playbackRate resamples
    // pitch, and rate was never restored. Unity until pitch-preserving stretch exists.
    const stretchRatio = 1.0;

    const gainA = analysisA.normalGain ?? 1;
    const gainB = analysisB.normalGain ?? 1;
    const loudnessDiffDb = Math.abs((analysisA.loudnessDb ?? -16) - (analysisB.loudnessDb ?? -16));

    const decisionInfo = {
      bpmA: analysisA.bpm, bpmB: analysisB.bpm,
      bpmRawA: analysisA.bpmRaw, bpmRawB: analysisB.bpmRaw,
      bpmReliableA, bpmReliableB,
      bpmRangeA: analysisA.bpmRange, bpmRangeB: analysisB.bpmRange,
      tempoVariableA: analysisA.tempoVariable, tempoVariableB: analysisB.tempoVariable,
      bothVariable, delta, avgConf, energyDiff, maxBpmRange,
      effectiveBpmA, effectiveBpmB, tempoRatio, ratioLabel,
      rawRatio, rawRatioAbs, tempoRatioAbs,
      harmonicallyCompatible: relation === 'compatible',
      relation,
      keyA: analysisA.key, keyB: analysisB.key,
      keyConfA, keyConfB, keyKnownBoth,
      bpmConfidenceRawA: analysisA.bpmConfidenceRaw, bpmConfidenceRawB: analysisB.bpmConfidenceRaw,
      bpmAgreementA: analysisA.bpmAgreement, bpmAgreementB: analysisB.bpmAgreement,
      bpmSourceA: analysisA.bpmSource, bpmSourceB: analysisB.bpmSource,
      bpmWindowCountA: analysisA.bpmWindowCount, bpmWindowCountB: analysisB.bpmWindowCount,
      bpmWindowsTotalA: analysisA.bpmWindowsTotal, bpmWindowsTotalB: analysisB.bpmWindowsTotal,
      windowBpmsA: analysisA.windowBpms, windowBpmsB: analysisB.windowBpms,
      mixLocalRatio,
      loudnessDbA: analysisA.loudnessDb, loudnessDbB: analysisB.loudnessDb,
      gainA, gainB, loudnessDiffDb,
      driftBps, driftCapSecs, overlapSecs,
      goodExit, mixEnergyRatio, outroSecs, overlapBarsCap,
      chosenTier: tier, reasons,
      tempoMatchEnabled: false,
      safeStartB: analysisB.safeStartOffset ?? 0,
      introSilenceB: analysisB.introSilenceSecs ?? 0,
      introEnergyB: analysisB.introEnergy ?? 0,
      outroSilenceA: analysisA.outroSilenceSecs ?? 0,
      audibleEndA,
      incomingOffset,
    };

    console.log('[automix] transition decision', decisionInfo);

    const w = window as any;
    w.__automixStats = w.__automixStats || {};
    w.__automixStats[tier] = (w.__automixStats[tier] || 0) + 1;

    w.__automixDecisions = w.__automixDecisions || [];
    w.__automixDecisions.push({ ts: Date.now(), ...decisionInfo });
    if (w.__automixDecisions.length > 100) w.__automixDecisions.shift();

    if (!w.exportAutomixDebug) {
      w.exportAutomixDebug = () => {
        const payload = { stats: w.__automixStats, decisions: w.__automixDecisions };
        const text = JSON.stringify(payload, null, 2);
        console.log(text);
        try { navigator.clipboard.writeText(text); } catch {}
        return text;
      };
    }

    console.table(w.__automixStats);

    return {
      fadeOutAt,
      fadeInAt,
      overlapSecs,
      method: tier,
      stretchRatio,
      barDuration,
      bpmA: effectiveBpmA,
      beatOffsetA: analysisA.beatOffset,
      bpmB: effectiveBpmB,
      beatOffsetB: analysisB.beatOffset ?? 0,
      keyA: analysisA.key,
      keyB: analysisB.key,
      incomingOffset,
      gainA,
      gainB,
    };
  }

  // ═══════════════════════════════════════
  // TRANSITION EXECUTION (The Core of the New Architecture)
  // ═══════════════════════════════════════

  /**
   * Executes a transition plan from one deck to another.
   * Uses native Web Audio API automation for sample-accurate timing.
   */
  execute(plan: TransitionPlan, activeDeck: DeckState, nextDeck: DeckState): void {
    if (!this.context || !activeDeck.audioBuffer || !nextDeck.audioBuffer) return;

    const ctx = this.context;
    const now = ctx.currentTime;

    // fadeOutAt is already phrase/bar-aligned on deck A's grid (planTransition).
    // Start B at the scheduled fade point. The old "wait for next beat" logic
    // pushed the entry up to one beat PAST the downbeat when phase was ~0.
    const startDeckBAt = now;

    const requestedOffset = nextDeck.startOffset || 0;
    const safeOffset = plan.incomingOffset ?? 0; // pre-aligned to B's bar grid in plan

    // Hard safety cap: never skip more than 12s or 25% of the incoming track.
    const maxIntroSkip = Math.min(12, nextDeck.audioBuffer.duration * 0.25);
    const safeOffsetValid =
      safeOffset > 0.30 &&
      safeOffset <= maxIntroSkip &&
      safeOffset < nextDeck.audioBuffer.duration - 1;

    let offsetInB = requestedOffset;
    if (requestedOffset <= 0.25 && safeOffsetValid) {
      offsetInB = safeOffset;
    }
    if (offsetInB >= nextDeck.audioBuffer.duration) {
      offsetInB = 0;
    }

    console.log('[automix] incoming offset check', {
      requestedOffset,
      safeOffset,
      safeOffsetValid,
      maxIntroSkip,
      offsetInB,
      beatOffsetB: plan.beatOffsetB,
      bpmB: plan.bpmB,
    });

    const sourceB = ctx.createBufferSource();
    sourceB.buffer = nextDeck.audioBuffer;
    sourceB.connect(nextDeck.analyser);
    sourceB.start(startDeckBAt, offsetInB);

    // Tempo match disabled (stopgap): unity rate, no pitch resampling.
    // Guard retained for future pitch-preserving re-enable.
    if (plan.stretchRatio !== 1.0) {
      sourceB.playbackRate.setValueAtTime(1.0, startDeckBAt);
      sourceB.playbackRate.linearRampToValueAtTime(plan.stretchRatio, startDeckBAt + 2.0);
    }

    const transitionDuration = plan.overlapSecs;
    const endTime = startDeckBAt + transitionDuration;

    // Clear stale automation before writing new curves (interrupted transitions, seeks).
    for (const d of [activeDeck, nextDeck]) {
      d.gain.gain.cancelScheduledValues(startDeckBAt);
      d.eqHigh.gain.cancelScheduledValues(startDeckBAt);
      d.eqMid.gain.cancelScheduledValues(startDeckBAt);
      d.eqLow.gain.cancelScheduledValues(startDeckBAt);
    }

    // Equal-power crossfade (cos/sin). Linear ramps dip ~3dB at the midpoint.
    const gA = plan.gainA ?? 1;
    const gB = plan.gainB ?? 1;
    const N = 64;
    const fadeOutCurve = new Float32Array(N);
    const fadeInCurve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      fadeOutCurve[i] = Math.cos(t * Math.PI / 2) * gA;
      fadeInCurve[i] = Math.sin(t * Math.PI / 2) * gB;
    }
    fadeOutCurve[N - 1] = 0.0001;
    activeDeck.gain.gain.setValueCurveAtTime(fadeOutCurve, startDeckBAt, transitionDuration);
    nextDeck.gain.gain.setValueCurveAtTime(fadeInCurve, startDeckBAt, transitionDuration);

    // Short drift-capped blends keep A fuller longer; long blends get the full wipe.
    const shortBlend = transitionDuration < 6;
    const hiDepth = shortBlend ? -8 : -12;
    const midDepth = shortBlend ? -6 : -8;
    const lowDepth = shortBlend ? -10 : -12;
    const hiFrac = shortBlend ? 0.5 : 0.3;
    const midFrac = shortBlend ? 0.75 : 0.6;
    const lowFrac = shortBlend ? 0.95 : 0.9;

    // A: High -> Mid -> Low out
    activeDeck.eqHigh.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqHigh.gain.linearRampToValueAtTime(hiDepth, startDeckBAt + transitionDuration * hiFrac);
    activeDeck.eqMid.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqMid.gain.linearRampToValueAtTime(midDepth, startDeckBAt + transitionDuration * midFrac);
    activeDeck.eqLow.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqLow.gain.linearRampToValueAtTime(lowDepth, startDeckBAt + transitionDuration * lowFrac);

    // B: mirror in
    nextDeck.eqHigh.gain.setValueAtTime(hiDepth, startDeckBAt);
    nextDeck.eqHigh.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * hiFrac);
    nextDeck.eqMid.gain.setValueAtTime(midDepth, startDeckBAt);
    nextDeck.eqMid.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * midFrac);
    nextDeck.eqLow.gain.setValueAtTime(lowDepth, startDeckBAt);
    nextDeck.eqLow.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * lowFrac);

    sourceB.onended = () => {
      if (nextDeck.sourceNode === sourceB) {
        nextDeck.isPlaying = false;
        nextDeck.sourceNode = null;
        if (nextDeck.audioBuffer) {
          nextDeck.startOffset = nextDeck.audioBuffer.duration;
        }
        this.onDeckEnded?.(nextDeck);
      }
    };

    nextDeck.sourceNode = sourceB;
    nextDeck.startTime = startDeckBAt;
    nextDeck.startOffset = offsetInB;
    nextDeck.isPlaying = true;

    try {
      activeDeck.sourceNode?.stop(endTime + 0.1);
    } catch {}

    console.log(`[AutoMix] Executing ${plan.method} | Duration=${transitionDuration.toFixed(1)}s | Key=${plan.keyA} -> ${plan.keyB} | offsetB=${offsetInB.toFixed(2)}s`);
  }

  /**
   * Resets a deck's gain and EQ to neutral values, canceling any scheduled automation.
   */
  resetDeck(deck: DeckState): void {
    if (!this.context) return;
    const now = this.context.currentTime;

    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(1.0, now);

    deck.eqLow.gain.cancelScheduledValues(now);
    deck.eqLow.gain.setValueAtTime(0, now);

    deck.eqMid.gain.cancelScheduledValues(now);
    deck.eqMid.gain.setValueAtTime(0, now);

    deck.eqHigh.gain.cancelScheduledValues(now);
    deck.eqHigh.gain.setValueAtTime(0, now);

    deck.filter.frequency.cancelScheduledValues(now);
    deck.filter.frequency.setValueAtTime(20000, now);

    deck.reverbGain.gain.cancelScheduledValues(now);
    deck.reverbGain.gain.setValueAtTime(0, now);
  }

  getAnalyser(): AnalyserNode | null {
    return this.deckA?.analyser || null;
  }
}
