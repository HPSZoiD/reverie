// ═══════════════════════════════════════════
// REVERIE — Shared Type Definitions
// ═══════════════════════════════════════════

export interface Track {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  duration?: number;
  bpm?: number;
  source?: 'youtube' | 'local';
  audio_url?: string;
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
}

export interface DeckState {
  audio: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
  analyser?: AnalyserNode;
  eqLow?: BiquadFilterNode;
  eqHigh?: BiquadFilterNode;
  gain?: GainNode;
  filter?: BiquadFilterNode;
  convolver?: ConvolverNode;
  reverbGain?: GainNode;
}
