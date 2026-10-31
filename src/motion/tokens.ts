/**
 * Motion tokens for the Lantern window, the level reveal, the rank reveal, the gate intro and the companion's fades.
 * One editable source for the motion timings.
 * Frames are at 60 fps; durations in ms unless the name ends in Sec.
 */

export const FPS = 60;
/** frames -> ms */
export const fr = (n: number) => (n * 1000) / FPS;

export type Bezier = readonly [number, number, number, number];
export const EASE = {
  outExpo: [0.16, 1, 0.3, 1],
  outQuint: [0.22, 1, 0.36, 1],
  outCubic: [0.33, 1, 0.68, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
  inOutSine: [0.37, 0, 0.63, 1],
  inExpo: [0.7, 0, 0.84, 0],
  /** measured window collapse: slow then fast into the bar */
  collapse: [0.5, 0, 0.75, 0],
} as const satisfies Record<string, Bezier>;
export const css = (e: Bezier) => `cubic-bezier(${e.join(', ')})`;

/** UI grid: an animated-on-2s step, 2 frames = 33.3 ms. Macro tempo for the calm rank reveal: 90 BPM. */
export const GRID = { stepFrames: 2, bpm: 90, beatFrames: 40 } as const;

export const WINDOW = {
  /** stepped height open, fraction of the final height per step (measured 23 / 61 / 61 / 100 %) */
  openSteps: [0.06, 0.23, 0.61, 0.61, 1],
  openStepFrames: 2,
  openStepLeadFrames: 0.25,
  lineMinPx: 6,
  /** glitch-in: frames after the panel reaches full height; slices live on the bars and plate edges only */
  glitchFrames: 3,
  glitchBarShiftPx: [5, -3, 0],
  glitchSliceShiftPx: [[-14, -10, 8, 12], [9, 6, -7, -8], [-5, -4, 4, 3]],
  /** cyan wash per glitch frame (+16 % max, decays) */
  washByFrame: [0.16, 0.1, 0.05],
  /** content */
  chipFadeFrames: 2,
  titleCharMs: 25,
  /** the body starts when the title is this far through */
  bodyOverlap: 0.5,
  bodyWordMs: 60,
  bodyLineMs: 100,
  bodyWordModeMax: 20,
  unitFadeFrames: 3,
  actionsDelayFrames: 6,
  actionsFadeMs: 160,
  nextPulseMs: 1100,
  nextPulseLow: 0.3,
  /** close (measured): 1 frame at scale .85 with a soft wash, 167 ms collapse, the bar holds, 140 ms fade */
  closeFlashScale: 0.86,
  closeWash: 0.12,
  closeMs: 167,
  closeEndScale: [0.8, 0.78],
  closeBarHoldMs: 23,
  closeFadeMs: 140,
  tiltDeg: 6,
  /** reduced motion: the finished state, softened */
  reducedFadeMs: 160,
  reducedCloseMs: 180,
} as const;

/** The intro's Safe Zone and Skip: taps land on nothing this long after one is pressed, as under a closing window in the
 *  companion, so the second tap of a double tap never presses what opens in its place. */
export const WAYS = { settleMs: 450 } as const;

/** A skill timer's buzz, in ms on and off: one short, gentle pulse as it starts, a soft double pulse as it ends. */
export const BUZZ = {
  start: [40],
  end: [40, 120, 40],
} as const;
/** ms off between two buzzes that come together (a skip that starts the next timer), so both read */
export const BUZZ_GAP = 200;

export const CALM = {
  fadeMs: 380,
  ease: EASE.outExpo,
} as const;

export const LEVEL = {
  /** hold on the previous number so it reads, then one roll to the new one */
  rollHoldMs: 400,
  rollMs: 300,
  rollEase: EASE.inOutQuart,
  /** light overshoot on the landed number (measured bloom +15.6 %, settle 267 ms) */
  glowOvershoot: 1.156,
  glowSettleMs: 267,
  rowsDelayFrames: 6,
  /** ring cue, seconds after the window opens (rows tick and the resolve plays on the window cues) */
  ringSec: 0.25,
} as const;

export const RANK = {
  letters: ['E', 'D', 'C', 'B', 'A', 'S'] as const,
  /** per tier E..S, then the Night Warden title */
  rings: [1, 1, 2, 2, 3, 3, 3],
  ticks: [false, true, false, true, true, true, true],
  rays: [0, 0, 0, 0, 0, 8, 8],
  igniteMs: [420, 480, 540, 600, 660, 720, 720],
  haloPx: [10, 13, 16, 19, 22, 26, 26],
  igniteEase: EASE.outCubic,
  /** opacity of the extra light layer at the ignite peak (overshoot on light, settles 267 ms) */
  glowPeak: 0.85,
  glowSettleMs: 267,
  /** frames after the panel is full */
  crystalOpenFrames: 0,
  igniteFrames: 10,
  markerFrames: GRID.beatFrames,
  lineFrames: GRID.beatFrames * 2,
  markerMs: 450,
  markerEase: EASE.inOutQuart,
  pipLightMs: 200,
} as const;

export const SCORE = {
  inSec: 3,
  /** Safe Zone in: a click-free ramp to exact silence, shorter than one 60 Hz frame */
  safeOutSec: 0.015,
  /** Safe Zone out: the score fades back in */
  safeBackSec: 3,
} as const;

/**
 * The slow breath Give me a moment's ring and the 3D breathing light share (src/motion/breath.ts), in seconds: in, out,
 * and the settle once a timed moment ends.
 */
export const BREATH = { inSec: 4, outSec: 6, settleSec: 2.4 } as const;

/** The clouds over the tide (src/scene/vignettes/scenes/tide.ts): each crosses in crossSec, the next spaceSec behind */
export const CLOUDS = { crossSec: 32, spaceSec: 13 } as const;

/** Home's sky (src/daily/sky.ts): a slow drift when the hour turns while Home is open, a short fade in and out */
export const SKY = {
  driftMs: 8000,
  fadeMs: 900,
  /** how often an open Home looks at the clock */
  checkMs: 30000,
} as const;

export const GATE = {
  /** cutscene seconds from the start of beat 1 (measured, pacing f0052-f0084) */
  plateFadeAtSec: 1.7,
  plateFadeSec: 0.2,
  airSec: 1.8,
  crackSec: 1.9,
  crackSfxSec: 1.93,
  swellSec: 1.95,
  humSec: 2.3,
  humLevel: 0.5,
  humFadeSec: 1.5,
  musicFadeSec: 1.5,
  holdSec: 6.6,
  dimTo: 0.7,
  dimSec: 0.6,
  /** width progress per 33.3 ms frame over the open (CSS linear()) */
  openCurve: [0, 0.09, 0.17, 0.26, 0.39, 0.54, 0.6, 0.63, 0.68, 0.78, 0.88, 0.93, 0.97, 1],
  openSec: 0.433,
  /** light overshoot after the open (+15.6 %), rise one frame, decay tau */
  overshoot: 0.156,
  overshootRiseSec: 0.033,
  overshootTauSec: 0.11,
  /** the crack front burns hottest through the 54 % hitch */
  hitchFromSec: 0.167,
  hitchToSec: 0.267,
  crackPopTauSec: 0.05,
  /** the top tip creeps up after the open */
  creepFromSec: 0.45,
  creepToSec: 3.5,
  /** effects drawn on 2s */
  effectsFps: 12,
  /** linear dolly-in through the hold */
  dollyFrom: [0, 1.55, 11.5],
  dollyTo: [0, 1.6, 10.0],
  dollySec: 13,
  lookAt: [0, 2.3, -6.5],
  fov: 30,
  handheld: 0.3,
} as const;

/** The small calm 3D scenes in the companion (src/scene/vignettes) and the renderer they share. */
export const SCENE = {
  /** longest the flat picture stays hidden while a scene loads, so a quick load fades straight into 3D */
  waitMs: 900,
  /** a scene fades in over its flat picture once its first frame is on screen */
  fadeMs: 700,
  /** the scenes move slowly, so 30 frames a second is plenty and spares the battery */
  fps: 30,
  /** the shared renderer is kept this long after the last scene leaves, then its context is released */
  idleMs: 15000,
  /** the share of a frame (at fps) a scene may take to draw; slower than this and it draws fewer pixels */
  budget: 0.6,
  /** the page counts as struggling when its frames come further apart than this */
  slowMs: 50,
  /** the fewest device pixels per CSS pixel a scene drops to on a slow device; the scenes are soft, so it barely shows */
  minDpr: 0.75,
} as const;
