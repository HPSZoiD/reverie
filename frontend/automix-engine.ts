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

export type TransitionTier = 'PERFECT' | 'CLEAN' | 'MODERATE' | 'HARD' | 'XFADE_SHORT';

export interface DeckState {
  audioBuffer: AudioBuffer | null;
  sourceNode: AudioBufferSourceNode | null;
  startTime: number;          // ctx.currentTime when source started
  startOffset: number;        // Buffer offset in seconds
  isPlaying: boolean;

  // Audio nodes
  gain: GainNode;
  eqLow: BiquadFilterNode;    // Lowshelf at ~200Hz
  eqMid: BiquadFilterNode;    // Peaking at ~1000Hz (NEW)
  eqHigh: BiquadFilterNode;   // Highshelf at ~3000Hz
  filter: BiquadFilterNode;   // Lowpass (bypassed by default)
  convolver: ConvolverNode;
  reverbGain: GainNode;
  analyser: AnalyserNode;

  // Analysis cache
  analysis?: AnalysisResult;
}

export interface AnalysisResult {
  bpm: number;
  tempoVariable: boolean;
  mixPointAt: number | null;
  overlapBars: number;
  beatOffset: number;
  energy: number;
  confidence: number;
  key: string;              // Camelot code, e.g., "8B" (NEW)
  rmsAtMixPoint?: number;
  avgRMS?: number;
}

export interface TransitionPlan {
  fadeOutAt: number;
  fadeInAt: number;
  overlapSecs: number;
  method: TransitionTier;
  stretchRatio: number;
  barDuration: number;
  bpmA: number;
  beatOffsetA: number;
  keyA?: string;            // NEW: For harmonic awareness
  keyB?: string;            // NEW: For harmonic awareness
}

export class AutoMixEngine {
  context: AudioContext | null = null;
  deckA: DeckState | null = null;
  deckB: DeckState | null = null;
  private impulseBuffer: AudioBuffer | null = null;

  // ═══════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════

  /**
   * Initializes the engine with two audio URLs.
   * Fetches, decodes, and sets up both decks.
   */
  async init(urlA: string, urlB: string): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    if (!this.impulseBuffer) {
      this.impulseBuffer = this.generateReverbImpulse(1.5);
    }

    const bufferA = await this.loadAudioBuffer(urlA);
    const bufferB = await this.loadAudioBuffer(urlB);

    if (!this.deckA) {
      this.deckA = this.setupDeck(bufferA);
    } else {
      if (this.deckA.isPlaying) this.pause(this.deckA);
      this.deckA.audioBuffer = bufferA;
      this.deckA.startOffset = 0;
      this.deckA.isPlaying = false;
    }

    if (!this.deckB) {
      this.deckB = this.setupDeck(bufferB);
    } else {
      if (this.deckB.isPlaying) this.pause(this.deckB);
      this.deckB.audioBuffer = bufferB;
      this.deckB.startOffset = 0;
      this.deckB.isPlaying = false;
    }
  }

  /**
   * Loads a new track into a specified deck.
   */
  async loadTrack(deck: 'A' | 'B', url: string): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
    }

    const buffer = await this.loadAudioBuffer(url);
    const deckState = deck === 'A' ? this.deckA : this.deckB;

    if (deckState) {
      if (deckState.isPlaying) this.pause(deckState);
      deckState.audioBuffer = buffer;
      deckState.startOffset = 0;
      deckState.isPlaying = false;
      deckState.analysis = await this.analyze(buffer);
    }
  }

  /**
   * Fetches and decodes an audio file into an AudioBuffer.
   */
  private async loadAudioBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return await this.context!.decodeAudioData(arrayBuffer);
  }

  /**
   * Creates the audio node chain for a deck.
   * Routing: Source → Analyser → EQ Low → EQ Mid → EQ High → Gain → Filter → Destination
   *          Filter → Convolver → ReverbGain → Destination (parallel reverb)
   */
  private setupDeck(buffer: AudioBuffer): DeckState {
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
    filter.connect(ctx.destination);

    // Parallel reverb path
    filter.connect(convolver);
    convolver.connect(reverbGain);
    reverbGain.connect(ctx.destination);

    return {
      audioBuffer: buffer,
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

    // Create new source
    const source = this.context.createBufferSource();
    source.buffer = deck.audioBuffer;
    source.connect(deck.analyser);

    // Set up end handler
    source.onended = () => {
      if (deck.sourceNode === source) {
        deck.isPlaying = false;
        deck.sourceNode = null;
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

    const elapsed = this.context.currentTime - deck.startTime;
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
    return deck.startOffset + (this.context.currentTime - deck.startTime);
  }

  // ═══════════════════════════════════════
  // ANALYSIS
  // ═══════════════════════════════════════

  /**
   * Analyzes an audio buffer and returns the analysis result.
   * Includes BPM detection, key detection, mix point detection, and energy analysis.
   */
  async analyze(buffer: AudioBuffer): Promise<AnalysisResult> {
    let bpm = 0;
    let tempoVariable = false;
    let mixPointAt: number | null = null;
    let confidence = 0;
    let energy = 0;
    let key = '8B'; // Default: C Major
    let rmsAtMixPoint = 0;
    let avgRMS = 0;

    console.log(`[AutoMix] High-precision analysis (4-window BPM + Key detection + Energy Drop)...`);

    const normalizedResults: number[] = [];
    const confidenceResults: number[] = [];

    try {
      // ═══ BPM Detection (4-window consensus) ═══
      const windows = [10, 60, 90, 120].filter((t) => t + 10 < buffer.duration);

      for (const offset of windows) {
        const { bpm: winBPM, confidence: winConf } = this.detectBPMFromBuffer(buffer, offset);
        if (winBPM > 0) {
          const normalized = this.normalizeBPM(winBPM);
          normalizedResults.push(normalized);
          confidenceResults.push(winConf);

          console.log(
            `[AutoMix] Window at ${offset}s: ${winBPM.toFixed(2)} BPM (Conf: ${winConf.toFixed(2)}, StartSample: ${Math.floor(offset * buffer.sampleRate)})`
          );
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

      if (normalizedResults.length > 0) {
        // 1. Calculate base median
        const sorted = [...normalizedResults].sort((a, b) => a - b);
        const baseMedian = sorted[Math.floor((sorted.length - 1) / 2)];

        // 2. Filter out outliers (median ±10 BPM)
        const filteredIndices = normalizedResults
          .map((b, i) => (Math.abs(b - baseMedian) < 10 ? i : -1))
          .filter((i) => i !== -1);

        const filteredBPMs = filteredIndices.map((i) => normalizedResults[i]);
        const filteredConfs = filteredIndices.map((i) => confidenceResults[i]);

        // 3. Final BPM and Confidence
        const filteredSorted = [...filteredBPMs].sort((a, b) => a - b);
        bpm = filteredSorted[Math.floor(filteredSorted.length / 2)];
        confidence = filteredConfs.reduce((a, b) => a + b, 0) / filteredConfs.length;

        // 4. Tempo Variable Check
        const range = Math.max(...filteredSorted) - Math.min(...filteredSorted);
        if (range > 15) {
          tempoVariable = true;
          console.warn(`[AutoMix] Tempo Variable! Filtered Range: ${range.toFixed(1)} BPM.`);
        }

        console.log(
          `[AutoMix] Consensus: BPM=${bpm.toFixed(2)} | Conf=${confidence.toFixed(2)} | Energy=${energy.toFixed(3)}`
        );

        // ═══ Mix Point Detection ═══
        const result = this.detectMixPoint(buffer, bpm);
        mixPointAt = result.mixPoint;
        rmsAtMixPoint = result.rmsAtMixPoint;
        avgRMS = result.avgRMS;

        console.log(`[AutoMix] Mix point (Energy Drop) at: ${mixPointAt.toFixed(2)}s`);
      }

      // ═══ Key Detection (NEW: Camelot Wheel) ═══
      key = await this.detectKey(buffer);
      console.log(`[AutoMix] Key: ${key} (Harmonic Compatibility)`);
    } catch (e) {
      console.error('[AutoMix] Analysis failed:', e);
      bpm = 120;
      confidence = 0.5;
      key = '8B';
    }

    bpm = this.normalizeBPM(bpm);
    const beatOffset = this.detectBeatOffset(buffer);

    // Snap mix point to 8-bar phrase boundary
    if (mixPointAt !== null) {
      const barDuration = (60 / bpm) * 4;
      const phraseLength = barDuration * 8;

      const phrasesSinceStart = Math.round((mixPointAt - beatOffset) / phraseLength);
      const snappedMixPoint = beatOffset + phrasesSinceStart * phraseLength;

      if (snappedMixPoint > beatOffset && snappedMixPoint < buffer.duration - barDuration * 4) {
        console.log(`[AutoMix] Mix Point Snapped: ${mixPointAt.toFixed(2)}s -> ${snappedMixPoint.toFixed(2)}s`);
        mixPointAt = snappedMixPoint;
      }
    }

    const barDuration = (60 / bpm) * 4;
    const overlapBars = mixPointAt
      ? Math.min(16, Math.max(4, Math.floor((buffer.duration - mixPointAt) / barDuration)))
      : 8;

    return {
      bpm,
      tempoVariable,
      mixPointAt,
      overlapBars,
      beatOffset,
      energy,
      confidence,
      key,
      rmsAtMixPoint,
      avgRMS,
    };
  }

  /**
   * Detects the musical key of a track using a Goertzel-based chroma vector.
   * Maps the result to a Camelot Wheel code (e.g., "8B" for C Major).
   */
  private async detectKey(buffer: AudioBuffer): Promise<string> {
    // Use the first 30 seconds for key detection (usually the most harmonically stable)
    const sampleRate = buffer.sampleRate;
    const duration = Math.min(30, buffer.duration);
    const length = Math.floor(duration * sampleRate);
    const channelData = buffer.getChannelData(0).slice(0, length);

    // Chroma vector (12 semitones)
    const chroma = new Array(12).fill(0);
    const noteFrequencies = [
      261.63, 277.18, 293.66, 311.13, 329.63, 349.23,
      369.99, 392.00, 415.30, 440.00, 466.16, 493.88 // C4 to B4
    ];

    // Calculate energy for each pitch class using a simplified Goertzel filter
    // We analyze in 1-second windows to smooth out transients
    const windowSize = sampleRate;
    const numWindows = Math.floor(length / windowSize);

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      const end = start + windowSize;
      const windowData = channelData.slice(start, end);

      for (let oct = 0; oct < 3; oct++) { // Check 3 octaves
        for (let note = 0; note < 12; note++) {
          const freq = noteFrequencies[note] * Math.pow(2, oct - 1); // Down 1 octave, up 1
          const energy = this.goertzelEnergy(windowData, sampleRate, freq);
          chroma[note] += energy;
        }
      }
    }

    // Normalize chroma vector
    const maxChroma = Math.max(...chroma);
    if (maxChroma > 0) {
      for (let i = 0; i < 12; i++) chroma[i] /= maxChroma;
    }

    // Find the dominant note
    const dominantNote = chroma.indexOf(Math.max(...chroma));
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Determine Major/Minor (simplified: check if the 3rd or minor 3rd is stronger)
    // Major 3rd is +4 semitones, Minor 3rd is +3 semitones
    const major3rd = chroma[(dominantNote + 4) % 12];
    const minor3rd = chroma[(dominantNote + 3) % 12];
    const mode = major3rd > minor3rd ? 'major' : 'minor';

    // Map to Camelot Wheel
    return this.noteToCamelot(noteNames[dominantNote], mode);
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

    return camelotMap[note]?.[mode] || '8B';
  }

  /**
   * Detects the first strong downbeat in the track.
   */
  private detectBeatOffset(buffer: AudioBuffer): number {
    const sampleRate = buffer.sampleRate;
    const analysisLength = Math.min(buffer.length, sampleRate * 15);
    const data = buffer.getChannelData(0).slice(0, analysisLength);

    const envelope = this.computeEnergyEnvelope(data, sampleRate, 0.01);
    const avgEnergy = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const threshold = avgEnergy * 1.5;

    for (let i = 1; i < envelope.length - 1; i++) {
      if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
        return i * 0.01;
      }
    }
    return 0;
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
    const confidence = bestVal > 0 ? Math.min(1, bestVal / (Math.abs(mean) + 1e-6)) : 0;

    return { bpm, confidence: Math.max(0, Math.min(1, confidence)) };
  }

  /**
   * Detects the best mix point (energy drop or outro) in the track.
   */
  private detectMixPoint(buffer: AudioBuffer, bpm: number): { mixPoint: number; rmsAtMixPoint: number; avgRMS: number } {
    const barDuration = (60 / bpm) * 4;
    const phraseLength = barDuration * 8;
    const analysisStart = buffer.duration * 0.85;
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const frameSize = Math.floor(sampleRate * 0.05);
    const totalFrames = Math.floor(channelData.length / frameSize);
    const energy = new Float32Array(totalFrames);
    let totalEnergySum = 0;

    for (let f = 0; f < totalFrames; f++) {
      const start = f * frameSize;
      const end = Math.min(start + frameSize, channelData.length);
      let sum = 0;
      for (let i = start; i < end; i++) sum += channelData[i] * channelData[i];
      energy[f] = Math.sqrt(sum / (end - start));
      totalEnergySum += energy[f];
    }

    const avgRMS = totalEnergySum / totalFrames;
    const twoBarFrames = Math.round((barDuration * 2) / 0.05);
    const defaultFallback = buffer.duration - phraseLength;

    let bestScore = Infinity;
    let bestMixPoint = defaultFallback;
    let bestRMS = avgRMS;
    const endLimit = buffer.duration - barDuration * 4;

    for (let t = analysisStart; t < endLimit; t += barDuration) {
      const frame = Math.floor(t / 0.05);
      if (frame + twoBarFrames >= totalFrames) break;

      let windowRMS = 0;
      for (let f = frame; f < frame + twoBarFrames; f++) windowRMS += energy[f] * energy[f];
      windowRMS = Math.sqrt(windowRMS / twoBarFrames);

      // Avoid vocal regions (high energy)
      if (windowRMS > avgRMS * 0.8) continue;

      const nearestPhrase = Math.round(t / phraseLength) * phraseLength;
      const penalty = Math.abs(t - nearestPhrase) / phraseLength;
      const score = windowRMS + penalty;

      if (score < bestScore) {
        bestScore = score;
        bestMixPoint = t;
        bestRMS = windowRMS;
      }
    }

    // Snap to phrase boundary
    const snappedMixPoint = Math.round(bestMixPoint / phraseLength) * phraseLength;
    if (Math.abs(snappedMixPoint - bestMixPoint) <= phraseLength) {
      bestMixPoint = snappedMixPoint;
    }

    return { mixPoint: bestMixPoint, rmsAtMixPoint: bestRMS, avgRMS };
  }

  /**
   * Normalizes a BPM to the 70-140 BPM range.
   */
  private normalizeBPM(bpm: number): number {
    if (!bpm || bpm <= 0) return 120;
    while (bpm > 140) bpm /= 2;
    while (bpm < 70) bpm *= 2;
    return bpm;
  }

  /**
   * Gets the relative bass energy of a deck.
   */
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
   * Determines if two Camelot keys are harmonically compatible.
   */
  private isHarmonicallyCompatible(keyA: string, keyB: string): boolean {
    if (keyA === keyB) return true; // Perfect match

    const numA = parseInt(keyA.slice(0, -1));
    const letterA = keyA.slice(-1);
    const numB = parseInt(keyB.slice(0, -1));
    const letterB = keyB.slice(-1);

    // Rule 1: Relative major/minor (same number, different letter)
    if (numA === numB && letterA !== letterB) return true;

    // Rule 2: Adjacent on the wheel (same letter, ±1 number, wrapping around at 12)
    if (letterA === letterB && (Math.abs(numA - numB) === 1 || Math.abs(numA - numB) === 11)) {
      return true;
    }

    // Rule 3: Energy boost (different letter, ±1 number)
    if (letterA !== letterB && (Math.abs(numA - numB) === 1 || Math.abs(numA - numB) === 11)) {
      return true;
    }

    return false;
  }

  /**
   * Plans a transition between two tracks based on their analysis results.
   */
  planTransition(analysisA: AnalysisResult, analysisB: AnalysisResult, durationA: number): TransitionPlan {
    const bpmA = analysisA.bpm || 120;
    const bpmB = analysisB.bpm || 120;

    let effectiveBpmA = bpmA;
    let effectiveBpmB = bpmB;

    // Double-time correction
    if (effectiveBpmA > 130 && Math.abs(effectiveBpmA / 2 - effectiveBpmB) <= 20) effectiveBpmA /= 2;
    if (effectiveBpmB > 130 && Math.abs(effectiveBpmB / 2 - effectiveBpmA) <= 20) effectiveBpmB /= 2;

    const delta = Math.abs(effectiveBpmA - effectiveBpmB);
    const avgConf = (analysisA.confidence + analysisB.confidence) / 2;
    const energyDiff = Math.abs(analysisA.energy - analysisB.energy) / Math.max(0.001, analysisA.energy, analysisB.energy);
    const bothVariable = analysisA.tempoVariable && analysisB.tempoVariable;
    const harmonicallyCompatible = this.isHarmonicallyCompatible(analysisA.key, analysisB.key);

    let tier: TransitionTier;

    if (delta > 20 || avgConf < 0.35 || energyDiff > 0.7 || bothVariable) {
      tier = 'XFADE_SHORT';
    } else if (delta <= 2 && avgConf > 0.85 && energyDiff < 0.2 && !analysisA.tempoVariable && !analysisB.tempoVariable && harmonicallyCompatible) {
      tier = 'PERFECT'; // Golden transition candidate (now requires harmonic compatibility)
    } else if (delta <= 5 && avgConf > 0.65 && energyDiff < 0.35) {
      tier = 'CLEAN';
    } else if (delta <= 10 && avgConf > 0.5) {
      tier = 'MODERATE';
    } else {
      tier = 'HARD';
    }

    // Harmonic penalty: If keys clash, downgrade the transition
    if (!harmonicallyCompatible && tier !== 'XFADE_SHORT' && tier !== 'HARD') {
      console.warn(`[AutoMix] Harmonic clash: ${analysisA.key} -> ${analysisB.key}. Downgrading transition.`);
      tier = 'HARD';
    }

    console.log(`[AutoMix] Decision: ${tier} | Delta=${delta.toFixed(1)} | Conf=${avgConf.toFixed(2)} | Key=${analysisA.key} -> ${analysisB.key} (${harmonicallyCompatible ? 'Compatible' : 'Clash'})`);

    const beatDuration = 60 / effectiveBpmA;
    const barDuration = 4 * beatDuration;
    const mixPointAt = analysisA.mixPointAt || durationA - 16 * barDuration;

    let overlapBarsCap = 8;
    let overlapSecs = 8 * barDuration;

    if (tier === 'XFADE_SHORT') {
      overlapBarsCap = 4;
    } else if (tier === 'PERFECT') {
      overlapBarsCap = 16; // Reward perfection with a longer, cinematic blend
    } else if (tier === 'HARD') {
      overlapBarsCap = 4;
    } else {
      overlapBarsCap = 12;
    }

    overlapSecs = overlapBarsCap * barDuration;
    const fadeOutAt = mixPointAt;
    const fadeInAt = mixPointAt; // Both tracks start fading at the same time, but EQ wiping creates the stagger effect

    let stretchRatio = 1.0;
    if (['PERFECT', 'CLEAN', 'MODERATE'].includes(tier)) {
      stretchRatio = effectiveBpmB / effectiveBpmA;
      stretchRatio = Math.max(0.94, Math.min(1.06, stretchRatio)); // Max 6% stretch
    }

    return {
      fadeOutAt,
      fadeInAt,
      overlapSecs,
      method: tier,
      stretchRatio,
      barDuration,
      bpmA: effectiveBpmA,
      beatOffsetA: analysisA.beatOffset,
      keyA: analysisA.key,
      keyB: analysisB.key,
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

    // ═══ 1. Calculate Beat Sync Delay (FIXED) ═══
    const beatDuration = 60 / plan.bpmA;
    const timeSinceStart = this.getCurrentPlaybackTime(activeDeck) - plan.beatOffsetA;
    const currentBeatPhase = ((timeSinceStart % beatDuration) + beatDuration) % beatDuration;
    const beatSyncDelay = beatDuration - currentBeatPhase;

    // ═══ 2. Schedule Next Deck Playback ═══
    const startDeckBAt = now + beatSyncDelay;
    const offsetInB = nextDeck.startOffset; // Start from current position (or 0 if loaded fresh)

    // Create new source for Deck B
    const sourceB = ctx.createBufferSource();
    sourceB.buffer = nextDeck.audioBuffer;
    sourceB.connect(nextDeck.analyser);
    sourceB.start(startDeckBAt, offsetInB);

    // ═══ 3. Native playbackRate Automation (NO MORE requestAnimationFrame HACKS) ═══
    if (plan.stretchRatio !== 1.0) {
      sourceB.playbackRate.setValueAtTime(1.0, startDeckBAt);
      sourceB.playbackRate.linearRampToValueAtTime(plan.stretchRatio, startDeckBAt + 2.0); // Ramp over 2 seconds
    }

    // ═══ 4. 3-Band Dynamic EQ Wipe (NEW) ═══
    const transitionDuration = plan.overlapSecs;
    const endTime = startDeckBAt + transitionDuration;

    // Active deck (A) fades out, EQs cut sequentially (High -> Mid -> Low)
    activeDeck.gain.gain.setValueAtTime(1.0, startDeckBAt);
    activeDeck.gain.gain.linearRampToValueAtTime(0.001, endTime);

    activeDeck.eqHigh.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqHigh.gain.linearRampToValueAtTime(-12, startDeckBAt + transitionDuration * 0.3);

    activeDeck.eqMid.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqMid.gain.linearRampToValueAtTime(-8, startDeckBAt + transitionDuration * 0.6);

    activeDeck.eqLow.gain.setValueAtTime(0, startDeckBAt);
    activeDeck.eqLow.gain.linearRampToValueAtTime(-12, startDeckBAt + transitionDuration * 0.9); // Bass last

    // Next deck (B) fades in, EQs boost sequentially (High -> Mid -> Low)
    nextDeck.gain.gain.setValueAtTime(0.001, startDeckBAt);
    nextDeck.gain.gain.linearRampToValueAtTime(1.0, endTime);

    nextDeck.eqHigh.gain.setValueAtTime(-12, startDeckBAt);
    nextDeck.eqHigh.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * 0.3);

    nextDeck.eqMid.gain.setValueAtTime(-8, startDeckBAt);
    nextDeck.eqMid.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * 0.6);

    nextDeck.eqLow.gain.setValueAtTime(-12, startDeckBAt);
    nextDeck.eqLow.gain.linearRampToValueAtTime(0, startDeckBAt + transitionDuration * 0.9);

    // ═══ 5. Update Deck State ═══
    nextDeck.sourceNode = sourceB;
    nextDeck.startTime = startDeckBAt;
    nextDeck.startOffset = offsetInB;
    nextDeck.isPlaying = true;

    // Stop active deck after transition
    try {
      activeDeck.sourceNode?.stop(endTime + 0.1);
    } catch {}

    console.log(`[AutoMix] Executing ${plan.method} | BeatDelay=${(beatSyncDelay * 1000).toFixed(0)}ms | Duration=${transitionDuration.toFixed(1)}s | Key=${plan.keyA} -> ${plan.keyB}`);
  }
}
