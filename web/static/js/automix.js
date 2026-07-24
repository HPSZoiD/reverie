/**
 * StreamFlow - Web Frontend
 * automix.js - Advanced AutoMix Engine (JS Port of TS Enhancements)
 */

class AutoMixEngine {
    constructor() {
        this.context = null;
        this.deckA = null;
        this.deckB = null;
        this.impulseBuffer = null;
        this.activeTrackStartTime = 0;
        this.sourceMap = new WeakMap();
    }

    normalizeBPM(bpm) {
        if (!bpm || bpm <= 0) return 120;
        let b = bpm;
        while (b > 140) b /= 2;
        while (b < 70) b *= 2;
        return b;
    }

    init(audioA, audioB) {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (!this.impulseBuffer) {
            this.impulseBuffer = this.generateReverbImpulse(1.5);
        }
        if (!this.deckA) {
            this.deckA = this.setupDeck(audioA);
            this.deckB = this.setupDeck(audioB);
        }
    }

    setupDeck(audioElement) {
        let source = this.sourceMap.get(audioElement);
        if (!source) {
            source = this.context.createMediaElementSource(audioElement);
            this.sourceMap.set(audioElement, source);
        }

        const analyser = this.context.createAnalyser();
        analyser.fftSize = 256;

        const gain = this.context.createGain();
        const eqLow = this.context.createBiquadFilter();
        const eqHigh = this.context.createBiquadFilter();
        const filter = this.context.createBiquadFilter();
        const convolver = this.context.createConvolver();
        const reverbGain = this.context.createGain();

        eqLow.type = 'lowshelf';
        eqLow.frequency.value = 200;
        eqLow.gain.value = 0;

        eqHigh.type = 'highshelf';
        eqHigh.frequency.value = 3000;
        eqHigh.gain.value = 0;

        filter.type = 'lowpass';
        filter.frequency.value = 20000;

        convolver.buffer = this.impulseBuffer;
        reverbGain.gain.value = 0;

        source.connect(analyser);
        analyser.connect(eqLow);
        eqLow.connect(eqHigh);
        eqHigh.connect(gain);
        gain.connect(filter);
        filter.connect(this.context.destination);

        filter.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(this.context.destination);

        return { audio: audioElement, source, analyser, eqLow, eqHigh, gain, filter, convolver, reverbGain };
    }

    generateReverbImpulse(durationSecs) {
        const sampleRate = this.context.sampleRate;
        const length = sampleRate * durationSecs;
        const impulse = this.context.createBuffer(2, length, sampleRate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const multiplier = Math.pow(1 - i / length, 3);
            left[i] = (Math.random() * 2 - 1) * multiplier;
            right[i] = (Math.random() * 2 - 1) * multiplier;
        }
        return impulse;
    }

    async analyze(trackData) {
        let bpm = 0;
        let tempoVariable = false;
        let mixPointAt = null;
        let confidence = 0;
        let energy = 0;
        let beatOffset = 0;
        let overlapBars = 8;
        
        console.log(`[AutoMix] High-precision analysis for "${trackData.title}" (4-window BPM + Energy Drop)...`);
        
        const normalizedResults = [];
        const confidenceResults = [];
        let audioBuffer = null;
        
        try {
            const response = await fetch(`/api/stream/${trackData.id}`);
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = await this.context.decodeAudioData(arrayBuffer);
            
            const windows = [10, 60, 90, 120].filter(t => t + 10 < audioBuffer.duration);

            for (const offset of windows) {
                const { bpm: winBPM, confidence: winConf } = this.detectBPMFromBuffer(audioBuffer, offset);
                if (winBPM > 0) {
                    const normalizedWin = this.normalizeBPM(winBPM);
                    normalizedResults.push(normalizedWin);
                    confidenceResults.push(winConf);
                    console.log(`[AutoMix] Window at ${offset}s: ${winBPM.toFixed(2)} (Conf: ${winConf.toFixed(2)})`);
                }
            }

            const channelData = audioBuffer.getChannelData(0);
            const step = Math.floor(channelData.length / 1000);
            let sumSq = 0; let count = 0;
            for (let i = 0; i < channelData.length; i += step) {
                sumSq += channelData[i] * channelData[i];
                count++;
            }
            energy = Math.sqrt(sumSq / count);

            if (normalizedResults.length > 0) {
                const sorted = [...normalizedResults].sort((a, b) => a - b);
                const baseMedian = sorted[Math.floor((sorted.length - 1) / 2)];
                
                const filteredIndices = normalizedResults.map((b, i) => Math.abs(b - baseMedian) < 10 ? i : -1).filter(i => i !== -1);
                const filteredBPMs = filteredIndices.map(i => normalizedResults[i]);
                const filteredConfs = filteredIndices.map(i => confidenceResults[i]);

                const filteredSorted = [...filteredBPMs].sort((a, b) => a - b);
                bpm = filteredSorted[Math.floor(filteredSorted.length / 2)];
                confidence = filteredConfs.reduce((a, b) => a + b, 0) / filteredConfs.length;

                const range = Math.max(...filteredSorted) - Math.min(...filteredSorted);
                if (range > 15) {
                    tempoVariable = true;
                    console.warn(`[AutoMix] Tempo Variable! Range: ${range.toFixed(1)} BPM.`);
                }
                
                console.log(`[AutoMix] Consensus: BPM=${bpm.toFixed(2)} | Conf=${confidence.toFixed(2)} | Energy=${energy.toFixed(3)}`);

                const result = this.detectMixPoint(audioBuffer, bpm);
                mixPointAt = result.mixPoint;
                let rmsAtMixPoint = result.rmsAtMixPoint;
                let avgRMS = result.avgRMS;
                
                this._tempRms = rmsAtMixPoint;
                this._tempAvg = avgRMS;
            }
        } catch (e) {
            console.error('[AutoMix] Analysis failed:', e);
            bpm = trackData.tempo || 120;
            confidence = 0.5;
        }

        bpm = this.normalizeBPM(bpm);
        if (audioBuffer) {
            beatOffset = this.detectBeatOffset(audioBuffer);
        }

        if (mixPointAt !== null && audioBuffer) {
            const barDuration = (60 / bpm) * 4;
            const phraseLength = barDuration * 8;
            
            const phrasesSinceStart = Math.round((mixPointAt - beatOffset) / phraseLength);
            const snappedMixPoint = beatOffset + (phrasesSinceStart * phraseLength);
            
            if (snappedMixPoint > beatOffset && snappedMixPoint < audioBuffer.duration - (barDuration * 4)) {
                console.log(`[AutoMix] Mix Point Snapped: ${mixPointAt.toFixed(2)}s -> ${snappedMixPoint.toFixed(2)}s`);
                mixPointAt = snappedMixPoint;
            }

            overlapBars = Math.min(16, Math.max(4, Math.floor((audioBuffer.duration - mixPointAt) / barDuration)));
        }

        const rmsAtMixPoint = this._tempRms || 0;
        const avgRMS = this._tempAvg || 0;
        
        return { bpm, beats, tempoVariable, mixPointAt, overlapBars, beatOffset, energy, confidence, rmsAtMixPoint, avgRMS };
    }

    detectMixPoint(audioBuffer, bpm) {
        const barDuration = (60 / bpm) * 4;
        const phraseLength = barDuration * 8; // 8-bar phrases
        
        // Bias toward outro (skip vocals/bridge)
        const analysisStart = audioBuffer.duration * 0.85;
        
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;

        const frameSecs = 0.05;
        const frameSize = Math.floor(sampleRate * frameSecs);
        const totalFrames = Math.floor(channelData.length / frameSize);
        const twoBarFrames = Math.round((barDuration * 2) / frameSecs);
        const defaultFallback = audioBuffer.duration - phraseLength;

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

        const endLimit = audioBuffer.duration - barDuration * 4;

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

    detectBeatOffset(audioBuffer) {
        try {
            const sampleRate = audioBuffer.sampleRate;
            const analysisLength = Math.min(audioBuffer.length, sampleRate * 15);
            const data = audioBuffer.getChannelData(0).slice(0, analysisLength);

            const envelope = this.computeEnergyEnvelope(data, sampleRate, 0.01);
            const avgEnergy = envelope.reduce((a, b) => a + b, 0) / envelope.length;
            const threshold = avgEnergy * 1.5;

            for (let i = 1; i < envelope.length - 1; i++) {
                if (envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1]) {
                    return i * 0.01;
                }
            }
            return 0;
        } catch (e) {
            return 0;
        }
    }

    detectBPMFromBuffer(audioBuffer, offset) {
        try {
            const sampleRate = audioBuffer.sampleRate;
            const start = Math.floor(offset * sampleRate);
            const end = Math.min(Math.floor((offset + 10) * sampleRate), audioBuffer.length);

            if (start >= audioBuffer.length || end - start < sampleRate * 2) return { bpm: 0, confidence: 0 };

            const raw = audioBuffer.getChannelData(0).slice(start, end);
            const windowSecs = 0.01;
            const envelope = this.computeEnergyEnvelope(raw, sampleRate, windowSecs);
            
            const envelopeRate = 1 / windowSecs;
            const { bpm, confidence } = this.autocorrelationBPM(envelope, envelopeRate);

            if (confidence < 0.2) return { bpm: 0, confidence: 0 };
            return { bpm, confidence };
        } catch (e) {
            return { bpm: 0, confidence: 0 };
        }
    }

    computeEnergyEnvelope(samples, sampleRate, windowSecs) {
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

    autocorrelationBPM(envelope, envelopeRate) {
        const minBPM = 60;
        const maxBPM = 200;

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

        const intervalSecs = bestLag / envelopeRate;
        let bpm = intervalSecs > 0 ? 60 / intervalSecs : 0;

        if (bpm === 0 || isNaN(bpm) || !isFinite(bpm)) {
            console.error('[AutoMix][BPM] Invalid BPM:', bpm);
            return { bpm: 0, confidence: 0 };
        }

        console.log('[AutoMix][BPM] Raw BPM:', bpm);

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

    planTransition(analysisA, analysisB, durationA) {
        const bpmA = analysisA.bpm || 120;
        const bpmB = analysisB.bpm || 120;

        let effectiveBpmA = bpmA;
        let effectiveBpmB = bpmB;

        if (effectiveBpmA > 130 && Math.abs(effectiveBpmA / 2 - effectiveBpmB) <= 20) {
            effectiveBpmA = effectiveBpmA / 2;
        }
        if (effectiveBpmB > 130 && Math.abs(effectiveBpmB / 2 - effectiveBpmA) <= 20) {
            effectiveBpmB = effectiveBpmB / 2;
        }

        const delta = Math.abs(effectiveBpmA - effectiveBpmB);
        const confA = analysisA.confidence || 0.5;
        const confB = analysisB.confidence || 0.5;
        const avgConf = (confA + confB) / 2;
        
        const energyA = analysisA.energy || 0.1;
        const energyB = analysisB.energy || 0.1;
        const energyDiff = Math.abs(energyA - energyB) / Math.max(0.001, energyA, energyB);
        const bothVariable = analysisA.tempoVariable && analysisB.tempoVariable;

        let tier;
        if (delta > 20 || avgConf < 0.35 || energyDiff > 0.7 || bothVariable) {
            tier = 'XFADE_SHORT';
        } else if (delta <= 2 && avgConf > 0.85 && energyDiff < 0.2 && !analysisA.tempoVariable && !analysisB.tempoVariable) {
            tier = 'PERFECT';
        } else if (delta <= 5 && avgConf > 0.65 && energyDiff < 0.35) {
            tier = 'CLEAN';
        } else if (delta <= 10 && avgConf > 0.5) {
            tier = 'MODERATE';
        } else {
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
        let overlapBarsCap, overlapSecs, fadeOutAt, fadeInAt;

        if (tier === 'XFADE_SHORT') {
            overlapBarsCap = 4;
            overlapSecs = overlapBarsCap * barDuration;
            fadeOutAt = mixPointAt;
            fadeInAt = mixPointAt;
        } else if (tier === 'PERFECT') {
            overlapBarsCap = 16;
            overlapSecs = overlapBarsCap * barDuration;
            fadeOutAt = mixPointAt;
            fadeInAt = mixPointAt + 4 * barDuration;
        } else if (tier === 'HARD') {
            const phraseLength = barDuration * 8;
            let safeMixPoint = mixPointAt;
            
            safeMixPoint = Math.round(safeMixPoint / phraseLength) * phraseLength;
            
            if (analysisA.rmsAtMixPoint && analysisA.avgRMS && analysisA.rmsAtMixPoint > analysisA.avgRMS * 0.7) {
                safeMixPoint += phraseLength;
                console.log('[AutoMix][Safety] HARD tier: Vocal shift +1 phrase applied.');
            }

            overlapBarsCap = Math.min(8, Math.max(4, Math.floor((durationA - safeMixPoint) / barDuration)));
            overlapSecs = overlapBarsCap * barDuration;
            fadeOutAt = safeMixPoint;
            fadeInAt = safeMixPoint;
            
            mixPointAt = safeMixPoint;
        } else {
            const availableBars = Math.floor((durationA - mixPointAt) / barDuration);
            overlapBarsCap = Math.min(12, Math.max(4, availableBars));
            
            if (energyDiff > 0.4) overlapBarsCap = Math.min(overlapBarsCap, 8);
            
            overlapSecs = overlapBarsCap * barDuration;
            fadeOutAt = mixPointAt;
            const barsFromMix = Math.round(overlapBarsCap * 0.4);
            fadeInAt = mixPointAt + barsFromMix * barDuration;
        }

        let stretchRatio = 1.0;
        if (['PERFECT', 'CLEAN', 'MODERATE'].includes(tier)) {
            stretchRatio = effectiveBpmB / effectiveBpmA;
            stretchRatio = Math.max(0.94, Math.min(1.06, stretchRatio));
        }

        console.log(`[AutoMix] Decision: ${tier} | Delta=${delta.toFixed(1)} | EnergyDiff=${(energyDiff * 100).toFixed(0)}%`);

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

    execute(plan, activeStatus, nextStatus) {
        const d_A = this.deckA.audio === activeStatus.audio ? this.deckA : this.deckB;
        const d_B = this.deckA.audio === nextStatus.audio ? this.deckA : this.deckB;

        const now = this.context.currentTime;

        const beatDuration = 60 / (plan.bpmA || 120);
        const timeSinceStart = now - this.activeTrackStartTime - (plan.beatOffsetA || 0);
        const currentBeatPhase = ((timeSinceStart % beatDuration) + beatDuration) % beatDuration;
        const beatSyncDelay = beatDuration - currentBeatPhase;
        const staggerDelay = plan.fadeInAt - plan.fadeOutAt;

        const activeBassLevel = this.getBassEnergy(d_A.analyser);
        const nextBassLevel = this.getBassEnergy(d_B.analyser);
        const bassThreshold = 0.4;
        const bothStrongBass = activeBassLevel > bassThreshold && nextBassLevel > bassThreshold;
        const incomingWeakBass = nextBassLevel < bassThreshold;

        const startTime = now + beatSyncDelay;
        const entryTime = startTime + staggerDelay;
        const transitionDuration = plan.overlapSecs;

        if (this.context.state === 'suspended') this.context.resume();

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

        console.log(`[AutoMix] Executing ${plan.method} | BeatDelay=${(beatSyncDelay*1000).toFixed(0)}ms | Stagger=${staggerDelay.toFixed(1)}s`);
        
        d_B.filter.frequency.setValueAtTime(20000, now);
        d_B.reverbGain.gain.setValueAtTime(0, now);
        d_B.eqLow.gain.setValueAtTime(0, now);
        d_B.eqHigh.gain.setValueAtTime(0, now);
        
        d_B.gain.gain.setValueAtTime(0, now);
        d_B.audio.playbackRate = 1.0;

        if (['PERFECT', 'CLEAN', 'MODERATE'].includes(plan.method)) {
            d_A.audio.preservesPitch = true;
            d_B.audio.preservesPitch = true;

            const endTime = startTime + transitionDuration;

            d_A.audio.playbackRate = 1.0;
            const invertedRatio = 1 / plan.stretchRatio;
            const initialBRate = Math.max(0.94, Math.min(1.06, invertedRatio));
            d_B.audio.playbackRate = initialBRate;

            const tempoRampDuration = transitionDuration * 1.5;
            this.rampPlaybackRate(d_B.audio, initialBRate, 1.0, endTime, endTime + tempoRampDuration);

            console.log('[AutoMix][Tempo]', {
                trackA_rate: d_A.audio.playbackRate,
                trackB_rate: d_B.audio.playbackRate,
                stretchRatio: plan.stretchRatio
            });

            d_A.eqLow.gain.setValueAtTime(0, startTime);
            if (bothStrongBass) {
                d_A.eqLow.gain.linearRampToValueAtTime(-12, startTime + transitionDuration * 0.5);
                d_B.eqLow.gain.setValueAtTime(-12, now);
                d_B.eqLow.gain.setValueAtTime(-12, entryTime);
                d_B.eqLow.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
            } else if (incomingWeakBass) {
                d_A.eqLow.gain.linearRampToValueAtTime(-4, startTime + transitionDuration * 0.8);
                d_B.eqLow.gain.setValueAtTime(-4, now);
                d_B.eqLow.gain.setValueAtTime(-4, entryTime);
                d_B.eqLow.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.7);
            } else {
                d_A.eqLow.gain.linearRampToValueAtTime(-8, startTime + transitionDuration * 0.6);
                d_B.eqLow.gain.setValueAtTime(-8, now);
                d_B.eqLow.gain.setValueAtTime(-8, entryTime);
                d_B.eqLow.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
            }

            d_A.gain.gain.setValueAtTime(1.0, startTime);
            d_A.gain.gain.linearRampToValueAtTime(0.001, endTime);
            
            d_B.gain.gain.setValueAtTime(0, entryTime);
            d_B.gain.gain.linearRampToValueAtTime(1.0, endTime);
        } else if (plan.method === 'HARD') {
            const endTime = startTime + transitionDuration;
            d_A.eqLow.gain.setValueAtTime(0, startTime);
            if (bothStrongBass) {
                d_A.eqLow.gain.linearRampToValueAtTime(-12, startTime + transitionDuration * 0.4);
                d_B.eqLow.gain.setValueAtTime(-12, now);
                d_B.eqLow.gain.setValueAtTime(-12, entryTime);
                d_B.eqLow.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.5);
            } else {
                d_A.eqLow.gain.linearRampToValueAtTime(-6, startTime + transitionDuration * 0.5);
                d_B.eqLow.gain.setValueAtTime(-6, now);
                d_B.eqLow.gain.setValueAtTime(-6, entryTime);
                d_B.eqLow.gain.linearRampToValueAtTime(0, entryTime + transitionDuration * 0.6);
            }

            d_A.gain.gain.setValueAtTime(1.0, startTime);
            d_A.gain.gain.linearRampToValueAtTime(0.001, endTime);
            
            d_B.gain.gain.setValueAtTime(0, entryTime);
            d_B.gain.gain.linearRampToValueAtTime(1.0, endTime);

            d_A.filter.frequency.setValueAtTime(20000, startTime);
            d_A.filter.frequency.exponentialRampToValueAtTime(800, startTime + transitionDuration * 0.3);
        } else if (plan.method === 'XFADE_SHORT') {
            const fadeDuration = plan.overlapSecs;
            d_A.gain.gain.setValueAtTime(1.0, startTime);
            d_A.gain.gain.linearRampToValueAtTime(0, startTime + fadeDuration);
            
            d_B.gain.gain.setValueAtTime(0, startTime);
            d_B.gain.gain.linearRampToValueAtTime(1.0, startTime + fadeDuration);
        }

        d_B.audio.play().catch(console.error);
        console.log(`[AutoMix] ${plan.method}: Track B scheduled and started early (muted)`);
    }

    getBassEnergy(analyser) {
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

    rampPlaybackRate(audio, startRate, endRate, startTime, endTime) {
        const ctx = this.context;
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
                audio.playbackRate = Math.max(0.1, Math.min(2.0, endRate));
                return;
            }
            const progress = (now - startTime) / (endTime - startTime);
            audio.playbackRate = startRate + (endRate - startRate) * progress;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    getAnalyser() {
        return this.deckA ? this.deckA.analyser : null;
    }
}

window.autoMix = new AutoMixEngine();
