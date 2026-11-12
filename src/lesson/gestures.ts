/**
 * Turning raw hand landmarks into a steady cursor + pinch.
 * Gestures use only 2D position and pinch (thumb tip to index tip), never depth.
 */

export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

/** Simple moving average over the last N landmark frames. */
export class LandmarkSmoother {
  private frames: Float32Array[] = [];
  private out = new Float32Array(42);
  constructor(private size = 4) {}

  push(points: Float32Array): Float32Array {
    this.frames.push(points);
    if (this.frames.length > this.size) this.frames.shift();
    const n = this.frames.length;
    this.out.fill(0);
    for (const f of this.frames) for (let i = 0; i < 42; i++) this.out[i] += f[i];
    for (let i = 0; i < 42; i++) this.out[i] /= n;
    return this.out;
  }

  reset(): void {
    this.frames = [];
  }
}

export interface HandFrame {
  /** Cursor in board-normalised coordinates (0..1), already mirrored. */
  x: number;
  y: number;
  pinched: boolean;
  /** Pinch openness: ~0 when touching, ~1 when wide open. Useful for UI. */
  pinchRatio: number;
}

/**
 * Pinch with hysteresis so it doesn't flicker at the threshold.
 * Distances are divided by hand size (wrist→middle knuckle), so it works
 * whether the hand is near or far from the camera.
 */
export class PinchTracker {
  private pinched = false;
  private lostAt = 0;
  constructor(
    private aspect = 4 / 3,
    private enter = 0.32,
    private exit = 0.48,
  ) {}

  setAspect(a: number): void {
    this.aspect = a;
  }

  update(p: Float32Array): HandFrame {
    const d = (a: number, b: number) =>
      Math.hypot((p[a * 2] - p[b * 2]) * this.aspect, p[a * 2 + 1] - p[b * 2 + 1]);
    const handSize = Math.max(1e-4, d(WRIST, MIDDLE_MCP));
    const ratio = d(THUMB_TIP, INDEX_TIP) / handSize;
    if (this.pinched ? ratio > this.exit : ratio < this.enter) this.pinched = !this.pinched;
    this.lostAt = 0;

    // Cursor = midpoint of thumb and index tips. Mirror x (selfie view), and
    // use the central 80% of the camera frame so the edges are easy to reach.
    const mx = (p[THUMB_TIP * 2] + p[INDEX_TIP * 2]) / 2;
    const my = (p[THUMB_TIP * 2 + 1] + p[INDEX_TIP * 2 + 1]) / 2;
    return {
      x: clamp01(((1 - mx) - 0.1) / 0.8),
      y: clamp01((my - 0.1) / 0.8),
      pinched: this.pinched,
      pinchRatio: Math.min(1, ratio / 1.2),
    };
  }

  /**
   * Hand not visible this frame. Keep a grab alive through very short dropouts
   * (≈ 250 ms) so a quick tracking glitch doesn't drop the cube.
   */
  lost(now: number): boolean {
    if (!this.lostAt) this.lostAt = now;
    if (now - this.lostAt > 250) this.pinched = false;
    return this.pinched;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hand skeleton connections (MediaPipe 21-point hand model). */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export function drawSkeleton(
  canvas: HTMLCanvasElement,
  points: Float32Array | null,
  pinched: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!points) return;
  const lw = Math.max(2, w / 160);
  ctx.lineCap = 'round';
  ctx.lineWidth = lw + 2;
  ctx.strokeStyle = 'rgba(15,42,85,0.8)';
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(points[a * 2] * w, points[a * 2 + 1] * h);
    ctx.lineTo(points[b * 2] * w, points[b * 2 + 1] * h);
  }
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#F7FAFF';
  ctx.stroke();
  for (let i = 0; i < 21; i++) {
    const tip = i === THUMB_TIP || i === INDEX_TIP;
    ctx.beginPath();
    ctx.arc(points[i * 2] * w, points[i * 2 + 1] * h, tip ? lw * 2.4 : lw * 1.3, 0, Math.PI * 2);
    ctx.fillStyle = tip ? (pinched ? '#FFD54A' : '#2E9FDC') : '#F7FAFF';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0F2A55';
    ctx.stroke();
  }
}
