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
  tempoVariable: boolean;
  mixPointAt: number | null;
  overlapBars: number;
  beatOffset: number;
  energy: number;
  confidence: number;
  key: string;              // Camelot code, e.g., "8B"
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
  keyA?: string;
  keyB?: string;
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
