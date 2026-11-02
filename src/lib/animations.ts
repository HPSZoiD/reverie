import type { Variants, Transition } from 'framer-motion';

// ── Shared Transitions ─────────────────────────────

export const spring: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
};

export const springBouncy: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 25,
};

export const springStiff: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 40,
};

export const smooth: Transition = {
  duration: 0.35,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

export const smoothFast: Transition = {
  duration: 0.2,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

// ── Page Transitions ───────────────────────────────

export const pageSlideUp: Variants = {
  initial: { y: 40, opacity: 0 },
  animate: { y: 0, opacity: 1, transition: smooth },
  exit: { y: -20, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } },
};

export const pageSlideRight: Variants = {
  initial: { x: 60, opacity: 0 },
  animate: { x: 0, opacity: 1, transition: smooth },
  exit: { x: -30, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } },
};

export const pageNowPlaying: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: spring },
  exit: { y: '100%', transition: { ...spring, stiffness: 400, damping: 35 } },
};

export const backFade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// ── Card / Item Animations ─────────────────────────

export const fadeUp: Variants = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1, transition: smooth },
  exit: { y: -10, opacity: 0, transition: { duration: 0.15 } },
};

export const scaleIn: Variants = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: springBouncy },
  exit: { scale: 0.9, opacity: 0, transition: { duration: 0.15 } },
};

// ── Staggered List ─────────────────────────────────

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1, transition: smoothFast },
};

export const staggerItemFast: Variants = {
  initial: { y: 12, opacity: 0 },
  animate: { y: 0, opacity: 1, transition: { duration: 0.15, ease: 'easeOut' } },
};

// ── Modal / Sheet ──────────────────────────────────

export const modalOverlay: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalCard: Variants = {
  initial: { scale: 0.92, opacity: 0, y: 20 },
  animate: { scale: 1, opacity: 1, y: 0, transition: springBouncy },
  exit: { scale: 0.92, opacity: 0, y: 10, transition: { duration: 0.15 } },
};

export const sheetUp: Variants = {
  initial: { y: '100%' },
  animate: { y: 0, transition: spring },
  exit: { y: '100%', transition: { ...spring, stiffness: 400, damping: 35 } },
};

// ── Micro-interactions ─────────────────────────────

export const tapScale = { whileTap: { scale: 0.93 } };
export const tapScaleSmall = { whileTap: { scale: 0.85 } };
export const hoverLift = { whileHover: { y: -3, transition: { duration: 0.2 } } };
export const hoverGlow = { whileHover: { scale: 1.04, transition: { duration: 0.2 } } };

// ── Shared layout IDs ─────────────────────────────

export const layoutIds = {
  albumArt: (id: string) => `album-art-${id}`,
  trackRow: (id: string) => `track-row-${id}`,
  nowPlayingBg: 'now-playing-bg',
};
