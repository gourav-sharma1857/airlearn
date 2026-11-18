import { describe, expect, it } from 'vitest';
import { HandGestures, OneEuroFilter, curledFingers } from './hand';

/**
 * Synthetic 21-point hands in normalised camera coordinates (aspect 1 for simplicity).
 * Wrist at (0.5, 0.8), knuckles 0.2 above it.
 */
type Pose = 'open' | 'fist' | 'pinch';
function hand(pose: Pose, dx = 0): Float32Array {
  const p = new Float32Array(42);
  const set = (i: number, x: number, y: number) => {
    p[i * 2] = x + dx;
    p[i * 2 + 1] = y;
  };
  set(0, 0.5, 0.8);
  // thumb 1-4
  set(1, 0.44, 0.74);
  set(2, 0.4, 0.68);
  set(3, 0.38, 0.62);
  set(4, pose === 'pinch' ? 0.43 : 0.36, pose === 'pinch' ? 0.47 : 0.56);
  const xs = [0.44, 0.49, 0.54, 0.59];
  for (let f = 0; f < 4; f++) {
    const mcp = 5 + f * 4;
    const x = xs[f];
    set(mcp, x, 0.6);
    const curled = pose === 'fist' || (pose === 'pinch' && f === 0);
    if (pose === 'pinch' && f === 0) {
      // index bends toward the thumb tip
      set(mcp + 1, x, 0.52);
      set(mcp + 2, 0.435, 0.48);
      set(mcp + 3, 0.435, 0.47);
    } else if (curled) {
      set(mcp + 1, x, 0.55);
      set(mcp + 2, x, 0.6);
      set(mcp + 3, x, 0.66);
    } else {
      set(mcp + 1, x, 0.5);
      set(mcp + 2, x, 0.42);
      set(mcp + 3, x, 0.35);
    }
  }
  return p;
}

describe('curledFingers', () => {
  it('counts 0 for an open hand and 4 for a fist', () => {
    expect(curledFingers(hand('open'), 1)).toBe(0);
    expect(curledFingers(hand('fist'), 1)).toBe(4);
  });
  it('a pinch is not a fist', () => {
    expect(curledFingers(hand('pinch'), 1)).toBeLessThan(3);
  });
});

describe('HandGestures', () => {
  const run = (g: HandGestures, pose: Pose, frames: number, t0: number) => {
    let s = g.update(hand(pose), t0);
    for (let i = 1; i < frames; i++) s = g.update(hand(pose), t0 + i / 30);
    return s;
  };

  it('detects pinch, then fist after 3 frames, then open', () => {
    const g = new HandGestures(1);
    expect(run(g, 'open', 5, 0).gesture).toBe('open');
    expect(run(g, 'pinch', 8, 1).gesture).toBe('pinch');
    const g2 = new HandGestures(1);
    run(g2, 'open', 5, 0);
    expect(g2.update(hand('fist'), 1).gesture).not.toBe('fist');
    expect(run(g2, 'fist', 10, 1.1).gesture).toBe('fist');
    expect(run(g2, 'open', 12, 2).gesture).toBe('open');
  });

  it('never reports a pinch while the hand is a fist', () => {
    const g = new HandGestures(1);
    for (let i = 0; i < 20; i++) expect(g.update(hand('fist'), i / 30).gesture).not.toBe('pinch');
  });

  it('mirrors the cursor: hand moving right in the camera moves the cursor left', () => {
    const g = new HandGestures(1);
    const a = run(g, 'open', 10, 0).x;
    const b = run(g, 'open', 30, 1).x;
    const g2 = new HandGestures(1);
    let s = g2.update(hand('open', 0.1), 0);
    for (let i = 1; i < 30; i++) s = g2.update(hand('open', 0.1), i / 30);
    expect(b).toBeCloseTo(a, 5);
    expect(s.x).toBeLessThan(a);
  });

  it('holds the gesture through a short dropout, then lets go', () => {
    const g = new HandGestures(1);
    run(g, 'fist', 10, 0);
    expect(g.lost(1)).toBe('fist');
    expect(g.lost(1.1)).toBe('fist');
    expect(g.lost(1.4)).toBe('open');
  });
});

describe('OneEuroFilter', () => {
  it('passes a still value through unchanged', () => {
    const f = new OneEuroFilter(1);
    let out = 0;
    for (let i = 0; i < 30; i++) out = f.push(Float32Array.of(0.4), i / 30)[0];
    expect(out).toBeCloseTo(0.4, 6);
  });
  it('reduces jitter on a still hand', () => {
    const f = new OneEuroFilter(1);
    const outs: number[] = [];
    for (let i = 0; i < 60; i++) outs.push(f.push(Float32Array.of(0.5 + (i % 2 ? 0.01 : -0.01)), i / 30)[0]);
    const tail = outs.slice(30);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(0.02 * 0.5);
  });
  it('catches up with a real move within a few frames', () => {
    const f = new OneEuroFilter(1);
    for (let i = 0; i < 10; i++) f.push(Float32Array.of(0.2), i / 30);
    let out = 0;
    for (let i = 10; i < 20; i++) out = f.push(Float32Array.of(0.8), i / 30)[0];
    expect(out).toBeGreaterThan(0.75);
  });
});
