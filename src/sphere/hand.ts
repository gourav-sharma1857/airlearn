/**
 * Sphere Lab hand gestures: One Euro smoothing, pinch, and closed fist.
 * Pure logic (no DOM), covered by hand.test.ts.
 * Uses only 2D landmark positions, never hand depth.
 */
import { PinchTracker } from '../lesson/gestures';

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
/** [tip, knuckle (MCP)] for index, middle, ring and pinky. */
const FINGERS: [number, number][] = [
  [8, 5],
  [12, 9],
  [16, 13],
  [20, 17],
];
const PALM = [0, 5, 9, 13, 17];

/* ---------- One Euro filter ---------- */

/**
 * One Euro filter (Casiez et al. 2012): smooths a lot when the hand is still
 * (no jitter) and little when it moves fast (no lag).
 * Values are normalised camera coordinates (0..1), time is in seconds.
 */
export class OneEuroFilter {
  private x: Float32Array | null = null;
  private dx: Float32Array;
  private t = 0;
  readonly out: Float32Array;

  constructor(
    private size = 42,
    private minCutoff = 1.5,
    private beta = 8,
    private dCutoff = 1,
  ) {
    this.dx = new Float32Array(size);
    this.out = new Float32Array(size);
  }

  push(values: Float32Array, tSec: number): Float32Array {
    if (!this.x || tSec <= this.t) {
      this.x = Float32Array.from(values);
      this.dx.fill(0);
      this.t = tSec;
      this.out.set(values);
      return this.out;
    }
    const dt = Math.min(0.5, tSec - this.t);
    this.t = tSec;
    const aD = alpha(this.dCutoff, dt);
    for (let i = 0; i < this.size; i++) {
      const rawDx = (values[i] - this.x[i]) / dt;
      this.dx[i] += aD * (rawDx - this.dx[i]);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx[i]);
      this.x[i] += alpha(cutoff, dt) * (values[i] - this.x[i]);
    }
    this.out.set(this.x);
    return this.out;
  }

  reset(): void {
    this.x = null;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/* ---------- Fist ---------- */

/**
 * How many of the four fingers are curled. A finger is curled when its tip is
 * closer to the wrist than 1.25 × its knuckle is (an open finger is about 2×).
 */
export function curledFingers(p: Float32Array, aspect = 4 / 3): number {
  const d = (a: number, b: number) => Math.hypot((p[a * 2] - p[b * 2]) * aspect, p[a * 2 + 1] - p[b * 2 + 1]);
  let n = 0;
  for (const [tip, mcp] of FINGERS) if (d(tip, WRIST) < 1.25 * d(mcp, WRIST)) n++;
  return n;
}

/* ---------- Combined ---------- */

export type Gesture = 'open' | 'pinch' | 'fist';

export interface HandState {
  gesture: Gesture;
  /** Cursor in board-normalised coordinates (0..1), mirrored for the selfie view. */
  x: number;
  y: number;
  /** Smoothed landmarks, for drawing the skeleton. */
  points: Float32Array;
}

/**
 * Turns raw landmarks into one steady gesture + cursor.
 * - Fist: at least 3 fingers curled for 3 frames in a row (exit after 3 frames with ≤ 1 curled).
 * - Pinch: thumb tip to index tip, with hysteresis, and only while the hand is not a fist,
 *   so closing the hand into a fist never starts a pinch by accident.
 * - The cursor is the thumb–index midpoint, or the palm center during a fist.
 */
export class HandGestures {
  private filter = new OneEuroFilter();
  private pinch: PinchTracker;
  private fist = false;
  private fistRun = 0;
  private lostAt = 0;
  private last: Gesture = 'open';

  constructor(private aspect = 4 / 3) {
    this.pinch = new PinchTracker(aspect);
  }

  setAspect(a: number): void {
    this.aspect = a;
    this.pinch.setAspect(a);
  }

  update(raw: Float32Array, tSec: number): HandState {
    this.lostAt = 0;
    const p = this.filter.push(raw, tSec);
    const curled = curledFingers(p, this.aspect);

    const wantFist = this.fist ? curled > 1 : curled >= 3;
    if (wantFist === this.fist) this.fistRun = 0;
    else if (++this.fistRun >= 3) {
      this.fist = wantFist;
      this.fistRun = 0;
    }

    const pinched = this.pinch.update(p).pinched && !this.fist && curled < 3;
    const gesture: Gesture = this.fist ? 'fist' : pinched ? 'pinch' : 'open';
    this.last = gesture;

    let cx: number;
    let cy: number;
    if (gesture === 'fist') {
      cx = cy = 0;
      for (const i of PALM) {
        cx += p[i * 2] / PALM.length;
        cy += p[i * 2 + 1] / PALM.length;
      }
    } else {
      cx = (p[THUMB_TIP * 2] + p[INDEX_TIP * 2]) / 2;
      cy = (p[THUMB_TIP * 2 + 1] + p[INDEX_TIP * 2 + 1]) / 2;
    }
    // Mirror x, and map the central 80% of the camera frame to the whole board.
    return { gesture, x: clamp01((1 - cx - 0.1) / 0.8), y: clamp01((cy - 0.1) / 0.8), points: p };
  }

  /**
   * No hand this frame. Keeps the current gesture through dropouts shorter than
   * 250 ms so a tracking glitch doesn't drop what the student is holding.
   * Returns the gesture still in effect.
   */
  lost(nowSec: number): Gesture {
    if (!this.lostAt) this.lostAt = nowSec;
    if (nowSec - this.lostAt > 0.25) {
      this.pinch.lost(1);
      this.pinch.lost(1e9); // PinchTracker counts in ms: this forces the pinch to release
      this.fist = false;
      this.fistRun = 0;
      this.filter.reset();
      this.last = 'open';
    }
    return this.last;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
