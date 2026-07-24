// ═══════════════════════════════════════════
// REVERIE — AutoMix Engine (TypeScript Port)
// Ported from automix.js — ZERO DOM dependencies
// Only Web Audio API: AudioContext, GainNode, BiquadFilterNode, etc.
//
// Bug fixes applied:
//   #7: Correct startSample offsets per window
//   #8: Outlier filter with median ±10, threshold 15 BPM
//   #9: MediaElementAudioSourceNode created ONCE per element
// ═══════════════════════════════════════════

import type { AnalysisResult, TransitionPlan, TransitionTier, DeckState } from './types';

export class AutoMixEngine {
  context: AudioContext | null = null;
  deckA: DeckState | null = null;
  deckB: DeckState | null = null;
  private impulseBuffer: AudioBuffer | null = null;
  activeTrackStartTime: number = 0;

  // Bug #9: Track which elements already have source nodes
  private sourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

  normalizeBPM(bpm: number): number {
    if (!bpm || bpm <= 0) return 120;
    let b = bpm;
    while (b > 140) b /= 2;
    while (b < 70) b *= 2;
    return b;
  }

  init(audioA: HTMLAudioElement, audioB: HTMLAudioElement): void {
    if (!this.context) {
      this.context = new AudioContext();
    }
    if (!this.impulseBuffer) {
      this.impulseBuffer = this.generateReverbImpulse(1.5);
    }
    if (!this.deckA) {
      this.deckA = this.setupDeck(audioA);
      this.deckB = this.setupDeck(audioB);
    }
  }

  private setupDeck(audioElement: HTMLAudioElement): DeckState {
    const ctx = this.context!;

    // Bug #9: Create MediaElementSource ONCE per element, store ref
    let source = this.sourceMap.get(audioElement);
    if (!source) {
      source = ctx.createMediaElementSource(audioElement);
      this.sourceMap.set(audioElement, source);
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    const gain = ctx.createGain();
    const eqLow = ctx.createBiquadFilter();
    const eqHigh = ctx.createBiquadFilter();
    const filter = ctx.createBiquadFilter();
    const convolver = ctx.createConvolver();
    const reverbGain = ctx.createGain();

    // Configure EQ
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 200;
    eqLow.gain.value = 0;

    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 3000;
    eqHigh.gain.value = 0;

    // Lowpass filter (bypassed by default)
    filter.type = 'lowpass';
    filter.frequency.value = 20000;

    // Reverb
    convolver.buffer = this.impulseBuffer;
    reverbGain.gain.value = 0;

    // Routing: Source → Analyser → EQ Low → EQ High → Gain → Filter → Destination
    source.connect(analyser);
    analyser.connect(eqLow);
    eqLow.connect(eqHigh);
    eqHigh.connect(gain);
    gain.connect(filter);
    filter.connect(ctx.destination);

    // Parallel reverb path
    filter.connect(convolver);
    convolver.connect(reverbGain);
    reverbGain.connect(ctx.destination);

    return { audio: audioElement, source, analyser, eqLow, eqHigh, gain, filter, convolver, reverbGain };
  }

  private generateReverbImpulse(durationSecs: number): AudioBuffer {
    const ctx = this.context!;
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSecs;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const multiplier = Math.pow(1 - i / length, 3);
      left[i] = (Math.random() * 2 - 1) * multiplier;
      right[i] = (Math.random() * 2 - 1) * multiplier;
    }
    return impulse;
  }

  // ═══════════════════════════════════════
  // ANALYSIS — BPM Detection + Mix Point
  // ═══════════════════════════════════════

  async analyze(buffer: AudioBuffer): Promise<AnalysisResult> {
    let bpm = 0;
    let tempoVariable = false;
    let mixPointAt: number | null = null;
    let confidence = 0;
    let energy = 0;

    console.log(`[AutoMix] High-precision analysis (4-window BPM + Energy Drop)...`);

    const normalizedResults: number[] = [];
    const confidenceResults: number[] = [];

    try {
      const windows = [10, 60, 90, 120].filter((t) => t + 10 < buffer.duration);

      for (const offset of windows) {
        const { bpm: winBPM, confidence: winConf } = this.detectBPMFromBuffer(buffer, offset);
        if (winBPM > 0) {
          const normalized = this.normalizeBPM(winBPM);
          normalizedResults.push(normalized);
          confidenceResults.push(winConf);
          
          console.log(
            `[AutoMix] Window at ${offset}s: ${winBPM.toFixed(2)} (Conf: ${winConf.toFixed(2)}, StartSample: ${Math.floor(offset * buffer.sampleRate)})`
          );
        }
      }

      // Calculate global energy (lightweight RMS)
      const channelData = buffer.getChannelData(0);
      const step = Math.floor(channelData.length / 1000); // Sample 1000 points
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

        // 2. Filter out outliers
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

        // Energy Drop Detection
        const result = this.detectMixPoint(buffer, bpm);
        mixPointAt = result.mixPoint;
        let rmsAtMixPoint = result.rmsAtMixPoint;
        let avgRMS = result.avgRMS;

        // Attach for later TransitionBrain safety
        Object.assign(this, { _tempRms: rmsAtMixPoint, _tempAvg: avgRMS });
        console.log(`[AutoMix] Mix point (Energy Drop) at: ${mixPointAt.toFixed(2)}s`);
      }
    } catch (e) {
      console.error('[AutoMix] Analysis failed:', e);
      bpm = 120;
      confidence = 0.5;
    }

    bpm = this.normalizeBPM(bpm);
    const beatOffset = this.detectBeatOffset(buffer);

    // Snap mixPointAt to the nearest 8-bar musical phrase boundary
    if (mixPointAt !== null) {
      const barDuration = (60 / bpm) * 4;
      const phraseLength = barDuration * 8; // standard 8-bar musical phrase
      
      const phrasesSinceStart = Math.round((mixPointAt - beatOffset) / phraseLength);
      const snappedMixPoint = beatOffset + (phrasesSinceStart * phraseLength);
      
      // Ensure the snapped point still leaves room to mix (min 4 bars from end)
      if (snappedMixPoint > beatOffset && snappedMixPoint < buffer.duration - (barDuration * 4)) {
        console.log(`[AutoMix] Mix Point Snapped: ${mixPointAt.toFixed(2)}s -> ${snappedMixPoint.toFixed(2)}s (Shift: ${(snappedMixPoint - mixPointAt).toFixed(2)}s)`);
        mixPointAt = snappedMixPoint;
      }
    }

    const barDuration = (60 / bpm) * 4;
    const overlapBars = mixPointAt
      ? Math.min(16, Math.max(4, Math.floor((buffer.duration - mixPointAt) / barDuration)))
      : 8;

    console.log(
      `[AutoMix] analyze() completed — BPM: ${bpm.toFixed(2)}${tempoVariable ? ' [VARIABLE]' : ''} | Conf: ${confidence.toFixed(2)} | Energy: ${energy.toFixed(3)}`
    );

    const rmsAtMixPoint = (this as any)._tempRms || 0;
    const avgRMS = (this as any)._tempAvg || 0;

    return { bpm, tempoVariable, mixPointAt, overlapBars, beatOffset, energy, confidence, rmsAtMixPoint, avgRMS };
  }

  private detectMixPoint(buffer: AudioBuffer, bpm: number): { mixPoint: number, rmsAtMixPoint: number, avgRMS: number } {
    const barDuration = (60 / bpm) * 4;
    const phraseLength = barDuration * 8; // 8-bar phrases
    
    // Bias toward outro (skip vocals/bridge)
    const analysisStart = buffer.duration * 0.85;
    
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const frameSecs = 0.05;
    const frameSize = Math.floor(sampleRate * frameSecs);
    const totalFrames = Math.floor(channelData.length / frameSize);
    const twoBarFrames = Math.round((barDuration * 2) / frameSecs);
    const defaultFallback = buffer.duration - phraseLength;

    const energy = new Float32Array(totalFrames);
    let totalEnergySum = 0;
    
    for (let f = 0; f < totalFrames; f++) {
      const start = f * frameSize;
      const end = Math.min(start + frameSize, channelData.length);
      let sum = 0;
      for (let i = start; i < end; i++) sum += channelData[i] * channelData[i];
      const rms = Math.sqrt(sum / (end - start));
      energy[f] = rms;
      totalEnergySum += rms;
    }
    
    const avgRMS = totalEnergySum / totalFrames;

    let bestScore = Infinity; // Seeking lowest cost
    let bestMixPoint = defaultFallback;
    let bestRMS = avgRMS;

    const endLimit = buffer.duration - barDuration * 4;

    for (let t = analysisStart; t < endLimit; t += barDuration) {
      const frame = Math.floor(t / frameSecs);
      if (frame + twoBarFrames >= totalFrames) break;

      let rmsSum = 0;
      for (let f = frame; f < frame + twoBarFrames; f++) rmsSum += energy[f] * energy[f];
      const windowRMS = Math.sqrt(rmsSum / twoBarFrames);

      // Avoid Vocal Regions
      if (windowRMS > avgRMS * 0.8) {
        continue; // Skip candidates with high energy (likely vocals/drop)
      }

      // Phrase Alignment Penalty (normalized to 0 - 1.0)
      const nearestPhrase = Math.round(t / phraseLength) * phraseLength;
      const phraseAlignmentPenalty = Math.abs(t - nearestPhrase) / phraseLength;
      
      const score = windowRMS + phraseAlignmentPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestMixPoint = t;
        bestRMS = windowRMS;
        console.log('[AutoMix][MixPoint] RMS:', { time: t, rms: windowRMS, score, penalty: phraseAlignmentPenalty });
      }
    }

    // PhraseSync Snapping
    const originalMixPoint = bestMixPoint;
    const snappedMixPoint = Math.round(bestMixPoint / phraseLength) * phraseLength;
    
    // Constraint: Do NOT shift more than 1 phrase away
    if (Math.abs(snappedMixPoint - originalMixPoint) <= phraseLength) {
      bestMixPoint = snappedMixPoint;
    }

    console.log('[AutoMix][Phrase]', { 
      originalMixPoint, 
      snappedMixPoint, 
      phraseLength 
    });
    console.log('[AutoMix][MixPoint] Selected:', bestMixPoint);

    return { mixPoint: bestMixPoint, rmsAtMixPoint: bestRMS, avgRMS };
  }

  /**
   * Detects the first strong beat (downbeat) in the first 15 seconds.
   */
  private detectBeatOffset(buffer: AudioBuffer): number {
    try {
      const sampleRate = buffer.sampleRate;
      const analysisLength = Math.min(buffer.length, sampleRate * 15);
      const data = buffer.getChannelData(0).slice(0, analysisLength);

      // 10ms windows for energy envelope
      const envelope = this.computeEnergyEnvelope(data, sampleRate, 0.01);

      // Find global average for thresholding
      const avgEnergy = envelope.reduce((a, b) => a + b, 0) / envelope.length;
      const threshold = avgEnergy * 1.5;

      // Find the first peak that significantly exceeds the average
      for (let i = 1; i < envelope.length - 1; i++) {
        if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
          return i * 0.01; // Beat offset in seconds
        }
      }

      return 0; // Fallback
    } catch {
      return 0;
    }
  }

  private detectBPMFromBuffer(buffer: AudioBuffer, offset: number): { bpm: number; confidence: number } {
    try {
      const sampleRate = buffer.sampleRate;
      const start = Math.floor(offset * sampleRate);
      const end = Math.min(Math.floor((offset + 10) * sampleRate), buffer.length);

      if (start >= buffer.length || end - start < sampleRate * 2) return { bpm: 0, confidence: 0 };

      const raw = buffer.getChannelData(0).slice(start, end);

      // Simple energy envelope (10ms windows)
      const windowSecs = 0.01;
      const envelope = this.computeEnergyEnvelope(raw, sampleRate, windowSecs);

      // Autocorrelation-based BPM
      const envelopeRate = 1 / windowSecs;
      const { bpm, confidence } = this.autocorrelationBPM(envelope, envelopeRate);

      if (confidence < 0.2) return { bpm: 0, confidence: 0 };

      return { bpm, confidence };
    } catch {
      return { bpm: 0, confidence: 0 };
    }
  }

  private computeEnergyEnvelope(
    samples: Float32Array,
    sampleRate: number,
    windowSecs: number
  ): Float32Array {
    const windowSize = Math.floor(sampleRate * windowSecs);
    const envelopeLength = Math.floor(samples.length / windowSize);
    const envelope = new Float32Array(envelopeLength);

    for (let i = 0; i < envelopeLength; i++) {
      const start = i * windowSize;
      const end = Math.min(start + windowSize, samples.length);
      let sum = 0;
      for (let j = start; j < end; j++) {
        sum += samples[j] * samples[j];
      }
      envelope[i] = Math.sqrt(sum / (end - start));
    }

    return envelope;
  }

  private autocorrelationBPM(
    envelope: Float32Array,
    envelopeRate: number
  ): { bpm: number; confidence: number } {
    const minBPM = 60;
    const maxBPM = 200;

    // Correct lag calculation: lag = envelopeRate * (60 / bpm)
    const minLag = Math.max(1, Math.floor((envelopeRate * 60) / maxBPM));
    const maxLag = Math.floor((envelopeRate * 60) / minBPM);

    console.log('[AutoMix][BPM] Lag Range:', { minLag, maxLag });

    if (maxLag >= envelope.length) return { bpm: 0, confidence: 0 };

    const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    const centered = envelope.map(v => v - mean);

    const autocorr = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      const count = envelope.length - lag;
      for (let i = 0; i < count; i++) {
        sum += centered[i] * centered[i + lag];
      }
      autocorr[lag] = sum / count;
    }

    // Peak search
    let bestLag = 0;
    let bestVal = -Infinity;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (autocorr[lag] > autocorr[lag - 1] && autocorr[lag] > autocorr[lag + 1]) {
        if (autocorr[lag] > bestVal) {
          bestVal = autocorr[lag];
          bestLag = lag;
        }
      }
    }

    if (bestLag <= 0) {
      console.error('[AutoMix][BPM] Invalid bestLag detected');
      return { bpm: 0, confidence: 0 };
    }

    console.log('[AutoMix][BPM] Best Lag:', bestLag);

    // Prevent division by zero and infinite loops
    const intervalSecs = bestLag / envelopeRate;
    let bpm = intervalSecs > 0 ? 60 / intervalSecs : 0;

    if (bpm === 0 || isNaN(bpm) || !isFinite(bpm)) {
      console.error('[AutoMix][BPM] Invalid BPM:', bpm);
      return { bpm: 0, confidence: 0 };
    }

    console.log('[AutoMix][BPM] Raw BPM:', bpm);

    // Normalize safely to 70–140 BPM range
    while (bpm > 140) bpm /= 2;
    while (bpm < 70) bpm *= 2;

    console.log('[AutoMix][BPM] Final BPM:', bpm);

    const zeroLagVal = centered.reduce((a, v) => a + v * v, 0) / envelope.length;
    const confidence = zeroLagVal > 0 ? bestVal / zeroLagVal : 0;

    if (confidence < 0.2) {
      console.warn('[AutoMix][BPM] Rejected BPM (low confidence or invalid)');
    }

    return { bpm, confidence: Math.max(0, Math.min(1, confidence)) };
  }

  // ═══════════════════════════════════════
  // TRANSITION PLANNING
  // ═══════════════════════════════════════

  planTransition(analysisA: AnalysisResult, analysisB: AnalysisResult, durationA: number): TransitionPlan {
    const bpmA = analysisA.bpm || 120;
    const bpmB = analysisB.bpm || 120;

    let effectiveBpmA = bpmA;
    let effectiveBpmB = bpmB;

    // Double-time correction
    if (effectiveBpmA > 130 && Math.abs(effectiveBpmA / 2 - effectiveBpmB) <= 20) {
      effectiveBpmA = effectiveBpmA / 2;
    }
    if (effectiveBpmB > 130 && Math.abs(effectiveBpmB / 2 - effectiveBpmA) <= 20) {
      effectiveBpmB = effectiveBpmB / 2;
    }

    const delta = Math.abs(effectiveBpmA - effectiveBpmB);
    const avgConf = (analysisA.confidence + analysisB.confidence) / 2;
    const energyDiff = Math.abs(analysisA.energy - analysisB.energy) / Math.max(0.001, analysisA.energy, analysisB.energy);
    const bothVariable = analysisA.tempoVariable && analysisB.tempoVariable;

    // Tier classification — Smarter musical decision tree
    let tier: TransitionTier;

    if (delta > 20 || avgConf < 0.35 || energyDiff > 0.7 || bothVariable) {
      // Too risky for a long beat-match blend
      tier = 'XFADE_SHORT';
    } else if (delta <= 2 && avgConf > 0.85 && energyDiff < 0.2 && !analysisA.tempoVariable && !analysisB.tempoVariable) {
      // Golden transition candidate
      tier = 'PERFECT';
    } else if (delta <= 5 && avgConf > 0.65 && energyDiff < 0.35) {
      tier = 'CLEAN';
    } else if (delta <= 10 && avgConf > 0.5) {
      tier = 'MODERATE';
    } else {
      // Fallback for tricky scenarios
      tier = 'HARD';
    }

    console.log('[AutoMix][Transition] BPM:', {
      bpmA,
      bpmB,
      effectiveBpmA,
      effectiveBpmB,
      delta
    });
    console.log('[AutoMix][Transition] Tier:', tier);

    const beatDuration = 60 / effectiveBpmA;
    const barDuration = 4 * beatDuration;

    let mixPointAt = analysisA.mixPointAt || durationA - 16 * barDuration;
    let overlapBarsCap: number;
    let overlapSecs: number;
    let fadeOutAt: number;
    let fadeInAt: number;

    if (tier === 'XFADE_SHORT') {
      overlapBarsCap = 4;
      overlapSecs = overlapBarsCap * barDuration;
      fadeOutAt = mixPointAt;
      fadeInAt = mixPointAt;
    } else if (tier === 'PERFECT') {
      // Reward perfection with a longer, cinematic blend
      overlapBarsCap = 16;
      overlapSecs = overlapBarsCap * barDuration;
      fadeOutAt = mixPointAt;
      fadeInAt = mixPointAt + 4 * barDuration; // wait 4 bars before bringing in B
    } else if (tier === 'HARD') {
      // Better Fix: HARD tier phrase shifting safety
      let safeMixPoint = mixPointAt;
      
      const phraseLength = barDuration * 8;
      safeMixPoint = Math.round(safeMixPoint / phraseLength) * phraseLength;
      
      if (analysisA.rmsAtMixPoint && analysisA.avgRMS && analysisA.rmsAtMixPoint > analysisA.avgRMS * 0.7) {
        safeMixPoint += phraseLength;
        console.log('[AutoMix][Safety] HARD tier: Vocal shift +1 phrase applied.');
      }

      // Quick fix: No offsets, no shifts for HARD
      overlapBarsCap = Math.min(8, Math.max(4, Math.floor((durationA - safeMixPoint) / barDuration)));
      overlapSecs = overlapBarsCap * barDuration;
      fadeOutAt = safeMixPoint;
      fadeInAt = safeMixPoint;
      
      mixPointAt = safeMixPoint; // Ensure future use observes shift
    } else {
      const availableBars = Math.floor((durationA - mixPointAt) / barDuration);
      overlapBarsCap = Math.min(12, Math.max(4, availableBars));
      
      // If energy difference is high, shorten the blend to avoid noise
      if (energyDiff > 0.4) overlapBarsCap = Math.min(overlapBarsCap, 8);
      
      overlapSecs = overlapBarsCap * barDuration;
      fadeOutAt = mixPointAt;
      const barsFromMix = Math.round(overlapBarsCap * 0.4);
      fadeInAt = mixPointAt + barsFromMix * barDuration;
    }

    // Stretch ratio (max 6%)
    let stretchRatio = 1.0;
    if (['PERFECT', 'CLEAN', 'MODERATE'].includes(tier)) {
      stretchRatio = effectiveBpmB / effectiveBpmA;
      stretchRatio = Math.max(0.94, Math.min(1.06, stretchRatio));
    }

    console.log(
      `[AutoMix] Decision: ${tier} | Delta=${delta.toFixed(1)} | Conf=${avgConf.toFixed(2)} | EnergyDiff=${(energyDiff * 100).toFixed(0)}%`
    );
    console.log(
      `[AutoMix] Plan: ${tier} | Overlap=${overlapSecs.toFixed(1)}s | FadeOut=${fadeOutAt.toFixed(2)}s | FadeIn=${fadeInAt.toFixed(2)}s`
    );

    return {
      fadeOutAt,
      fadeInAt,
      overlapSecs,
      method: tier,
      stretchRatio,
      barDuration,
      bpmA: effectiveBpmA,
      beatOffsetA: analysisA.beatOffset || 0,
    };
  }

  // ═══════════════════════════════════════
  // TRANSITION EXECUTION
  // ═══════════════════════════════════════

  execute(plan: TransitionPlan, activeDeck: DeckState, nextDeck: DeckState): void {
    const ctx = this.context!;
    const now = ctx.currentTime;

    // Beat Phase Alignment (Accounting for Beat Offset)
    const beatDuration = 60 / (plan.bpmA || 120);
    const timeSinceStart = now - this.activeTrackStartTime - (plan.beatOffsetA || 0);
    const currentBeatPhase = ((timeSinceStart % beatDuration) + beatDuration) % beatDuration;
    const beatSyncDelay = beatDuration - currentBeatPhase;
    const staggerDelay = plan.fadeInAt - plan.fadeOutAt;

    // Bass Detection for Adaptive EQ
    const activeBassLevel = this.getBassEnergy(activeDeck.analyser);
    const nextBassLevel = this.getBassEnergy(nextDeck.analyser);
    const bassThreshold = 0.4; // 40% energy threshold
    const bothStrongBass = activeBassLevel > bassThreshold && nextBassLevel > bassThreshold;
    const incomingWeakBass = nextBassLevel < bassThreshold;

    const startTime = now + beatSyncDelay;
    const entryTime = startTime + staggerDelay;
    const transitionDuration = plan.overlapSecs;

    if (ctx.state === 'suspended') ctx.resume();

    console.log('[AutoMix][Sync]', {
      now,
      timeSinceStart,
      beatDuration,
      currentBeatPhase,
      beatSyncDelay
    });

    console.log('[AutoMix][Sync] Schedule:', {
      startTime,
      entryTime,
      transitionDuration
    });

    console.log(`[AutoMix] Executing ${plan.method} | BeatDelay=${(beatSyncDelay * 1000).toFixed(0)}ms | Stagger=${staggerDelay.toFixed(1)}s`);
    console.log(`[AutoMix] Adaptive EQ -> Bass(A): ${activeBassLevel.toFixed(2)}, Bass(B): ${nextBassLevel.toFixed(2)}`);

    // Pre-schedule Reset for Deck B
    if (nextDeck.filter) nextDeck.filter.frequency.setValueAtTime(20000, now);
    if (nextDeck.reverbGain) nextDeck.reverbGain.gain.setValueAtTime(0, now);
    if (nextDeck.eqLow) nextDeck.eqLow.gain.setValueAtTime(0, now);
    if (nextDeck.eqHigh) nextDeck.eqHigh.gain.setValueAtTime(0, now);
    
    // Lock Deck B gain to 0 instantly so it remains absolutely silent until scheduled entry
    nextDeck.gain!.gain.setValueAtTime(0, now);
    nextDeck.audio.playbackRate = 1.0;

    // Execute per tier
    if (['PERFECT', 'CLEAN', 'MODERATE'].includes(plan.method)) {
      activeDeck.audio.preservesPitch = true;
      nextDeck.audio.preservesPitch = true;

      const endTime = startTime + transitionDuration;

      // Track A remains pristine at 1.0.
      activeDeck.audio.playbackRate = 1.0;

      // Track B is adjusted to match Track A during the transition.
      // plan.stretchRatio = (BPM_B / BPM_A), so Track B needs (BPM_A / BPM_B) = 1 / plan.stretchRatio.
      const invertedRatio = 1 / plan.stretchRatio;
      const initialBRate = Math.max(0.94, Math.min(1.06, invertedRatio));
      
      nextDeck.audio.playbackRate = initialBRate;

      // Gradual tempo return: Unnoticed by dancers, Track B slowly slides back to its original tempo (1.0)
      // AFTER Track A has completely faded out (endTime), preserving perfect phase alignment during the mix.
      const tempoRampDuration = transitionDuration * 1.5; 
      this.rampPlaybackRate(nextDeck.audio, initialBRate, 1.0, endTime, endTime + tempoRampDuration);

      console.log('[AutoMix][Tempo]', {
        trackA_rate: activeDeck.audio.playbackRate,
        trackB_rate: nextDeck.audio.playbackRate,
        stretchRatio: plan.stretchRatio
      });

      // Adaptive EQ Bass Swap
      activeDeck.eqLow!.gain.setValueAtTime(0, startTime);
      if (bothStrongBass) {
        // Deep cut for strong bass clash
        activeDeck.eqLow!.gain.linearRampToValueAtTime(-12, startTime + transitionDuration * 0.5);
        nextDeck.eqLow!.gain.setValueAtTime(-12, now);
        nextDeck.eqLow!.gain.setValueAtTime(-12, entryTime);
        nextDeck.eqLow!.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
      } else if (incomingWeakBass) {
        // Graceful blend to fill the low end
        activeDeck.eqLow!.gain.linearRampToValueAtTime(-4, startTime + transitionDuration * 0.8);
        nextDeck.eqLow!.gain.setValueAtTime(-4, now);
        nextDeck.eqLow!.gain.setValueAtTime(-4, entryTime);
        nextDeck.eqLow!.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.7);
      } else {
        // Moderate swap
        activeDeck.eqLow!.gain.linearRampToValueAtTime(-8, startTime + transitionDuration * 0.6);
        nextDeck.eqLow!.gain.setValueAtTime(-8, now);
        nextDeck.eqLow!.gain.setValueAtTime(-8, entryTime);
        nextDeck.eqLow!.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
      }

      // Volume ramps
      activeDeck.gain!.gain.setValueAtTime(1.0, startTime);
      activeDeck.gain!.gain.linearRampToValueAtTime(0.001, endTime);
      
      // Sample-accurate unmute
      nextDeck.gain!.gain.setValueAtTime(0, entryTime);
      nextDeck.gain!.gain.linearRampToValueAtTime(1.0, endTime);
      
    } else if (plan.method === 'HARD') {
      const endTime = startTime + transitionDuration;

      activeDeck.eqLow!.gain.setValueAtTime(0, startTime);
      if (bothStrongBass) {
        activeDeck.eqLow!.gain.linearRampToValueAtTime(-12, startTime + transitionDuration * 0.4);
        nextDeck.eqLow!.gain.setValueAtTime(-12, now);
        nextDeck.eqLow!.gain.setValueAtTime(-12, entryTime);
        nextDeck.eqLow!.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.5);
      } else {
        activeDeck.eqLow!.gain.linearRampToValueAtTime(-6, startTime + transitionDuration * 0.5);
        nextDeck.eqLow!.gain.setValueAtTime(-6, now);
        nextDeck.eqLow!.gain.setValueAtTime(-6, entryTime);
        nextDeck.eqLow!.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
      }

      activeDeck.gain!.gain.setValueAtTime(1.0, startTime);
      activeDeck.gain!.gain.linearRampToValueAtTime(0.001, endTime);
      
      nextDeck.gain!.gain.setValueAtTime(0, entryTime);
      nextDeck.gain!.gain.linearRampToValueAtTime(1.0, endTime);

      // 800Hz lowpass sweep on A
      activeDeck.filter!.frequency.setValueAtTime(20000, startTime);
      activeDeck.filter!.frequency.exponentialRampToValueAtTime(800, startTime + transitionDuration * 0.3);
      
    } else if (plan.method === 'XFADE_SHORT') {
      const fadeDuration = plan.overlapSecs;

      activeDeck.gain!.gain.setValueAtTime(1.0, startTime);
      activeDeck.gain!.gain.linearRampToValueAtTime(0, startTime + fadeDuration);
      
      nextDeck.gain!.gain.setValueAtTime(0, startTime);
      nextDeck.gain!.gain.linearRampToValueAtTime(1.0, startTime + fadeDuration);
    }

    // Start playback immediately.
    // The Web Audio API gain automation guarantees it remains 100% silent 
    // and sample-accurate until the precise entryTime beat threshold.
    nextDeck.audio.play().catch(console.error);
    console.log(`[AutoMix] ${plan.method}: Track B scheduled and started early (muted)`);
  }

  /**
   * Calculates the relative low-frequency (<200Hz) energy of the running track.
   */
  private getBassEnergy(analyser?: AnalyserNode): number {
    if (!analyser) return 0.5; // fallback
    
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

  /**
   * Smoothly interpolates the playbackRate of an HTMLMediaElement since it does not support AudioParam automations.
   * Leverages requestAnimationFrame and aligns timing with the precise AudioContext clock.
   */
  private rampPlaybackRate(
    audio: HTMLAudioElement,
    startRate: number,
    endRate: number,
    startTime: number,
    endTime: number
  ) {
    const ctx = this.context!;
    const tick = () => {
      if (ctx.state === 'suspended') {
        requestAnimationFrame(tick);
        return;
      }
      
      const now = ctx.currentTime;
      if (now < startTime) {
        requestAnimationFrame(tick);
        return;
      }
      
      if (now >= endTime) {
        audio.playbackRate = Math.max(0.1, Math.min(2.0, endRate)); // final clamp safety
        return;
      }
      
      const progress = (now - startTime) / (endTime - startTime);
      audio.playbackRate = startRate + (endRate - startRate) * progress;
      requestAnimationFrame(tick);
    };
    
    // Start timeline tracking
    requestAnimationFrame(tick);
  }

  getAnalyser(): AnalyserNode | null {
    return this.deckA?.analyser || null;
  }
}


