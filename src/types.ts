// ═══════════════════════════════════════════
// REVERIE — Shared Type Definitions
// Updated for AudioBufferSourceNode architecture
// ═══════════════════════════════════════════

export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  bpm: number | null;
  audio_url: string | null;
  duration?: number;
  source?: 'youtube' | 'local';
  key?: string | null;
  keyConfidence?: number | null;
  energy?: number | null;
  loudnessDb?: number | null;
}

export type TransitionTier =
  | 'IDLE'
  | 'ANALYZING'
  | 'PERFECT'
  | 'CLEAN'
  | 'MODERATE'
  | 'HARD'
  | 'XFADE_SHORT'
  | 'CUT';

export interface AnalysisResult {
  bpm: number;
  bpmRaw?: number;   // consensus BPM before final 70-140 normalize
  tempoVariable: boolean;
  mixPointAt: number | null;
  overlapBars: number;
  beatOffset: number;
  energy: number;
  confidence: number;
  key: string;              // Camelot code, e.g. "8B"; '' = unknown
  keyConfidence?: number;                 // 0..1, 0 = unknown
  bpmConfidenceRaw?: number;              // mean raw autocorrelation confidence, pre-agreement
  bpmAgreement?: number;                  // 0..1 cross-window agreement
  bpmSource?: 'detector' | 'metadata' | 'none';
  bpmWindowCount?: number;      // surviving windows after octave-fold + outlier filter
  bpmWindowsTotal?: number;     // total windows that produced a BPM
  windowBpms?: number[];        // folded BPMs of surviving windows
  mixLocalRatio?: number;       // mix-point RMS / local preceding baseline
  loudnessDb?: number;          // 20*log10(global RMS), dBFS
  normalGain?: number;          // gain toward -16 dBFS RMS target, clamped
  rmsAtMixPoint?: number;
  avgRMS?: number;
  bpmReliable: boolean;
  bpmRange: number;
  analysisFallback?: boolean;

  safeStartOffset?: number;
  introSilenceSecs?: number;
  introEnergy?: number;
  audibleEndAt?: number;
  outroSilenceSecs?: number;
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
  bpmB: number;
  beatOffsetB: number;
  keyA?: string;
  keyB?: string;
  incomingOffset?: number;
  gainA?: number;
  gainB?: number;
}

export interface DeckState {
  audioBuffer: AudioBuffer | null;
  sourceNode: AudioBufferSourceNode | null;
  startTime: number;          // ctx.currentTime when source started
  startOffset: number;        // Buffer offset in seconds
  isPlaying: boolean;

  // Audio nodes
  gain: GainNode;
  eqLow: BiquadFilterNode;    // Lowshelf at ~200Hz
  eqMid: BiquadFilterNode;    // Peaking at ~1000Hz
  eqHigh: BiquadFilterNode;   // Highshelf at ~3000Hz
  filter: BiquadFilterNode;   // Lowpass (bypassed by default)
  convolver: ConvolverNode;
  reverbGain: GainNode;
  analyser: AnalyserNode;

  // Analysis cache
  analysis?: AnalysisResult;
}
