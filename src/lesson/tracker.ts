/**
 * Camera + hand-tracking worker.
 *
 * PRIVACY — must stay true:
 *  - The camera stream is shown in a local <video> element and read into
 *    in-memory ImageBitmaps that are transferred to the Web Worker
 *    (public/hand-worker.js), which closes each one right after use.
 *  - Nothing here records (no MediaRecorder), encodes (no toDataURL/toBlob),
 *    stores, or uploads frames. No fetch/XHR/beacon in this file touches
 *    camera data. Only 21 landmark coordinates come back from the worker.
 *  - stop() ends every camera track, which turns the camera light off.
 */
import { BASE_URL } from '../config';

export type CameraErrorKind = 'denied' | 'no-camera' | 'in-use' | 'insecure' | 'unsupported' | 'tracker-failed' | 'tracker-timeout';

export class CameraError extends Error {
  constructor(public kind: CameraErrorKind, message?: string) {
    super(message || kind);
  }
}

export type TrackerState = 'off' | 'starting' | 'loading' | 'on';

export interface TrackerCallbacks {
  onState(state: TrackerState): void;
  /** Normalised landmarks (x0,y0,x1,y1…, 21 points) or null when no hand. */
  onHand(points: Float32Array | null): void;
  onBrightness(value: number): void;
  /** Detection rate measured over the last ~3 seconds. */
  onFps(fps: number): void;
}

const MODEL_TIMEOUT_MS = 45_000;
const MIN_FRAME_GAP_MS = 30; // ≈ 30 fps cap
const PROCESS_WIDTH = 320; // downscale before tracking: much faster, same accuracy for one hand

export class HandTracker {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady: Promise<void> | null = null;
  private running = false;
  private busy = false;
  private lastSent = 0;
  private raf = 0;
  private resultTimes: number[] = [];
  private lastFpsReport = 0;
  state: TrackerState = 'off';
  delegate = '';

  constructor(video: HTMLVideoElement, private cb: TrackerCallbacks) {
    this.video = video;
  }

  get isOn(): boolean {
    return this.state !== 'off';
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!window.isSecureContext) throw new CameraError('insecure');
    if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
    this.setState('starting');
    // Start downloading the model while the permission prompt is showing.
    this.preload();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (err) {
      this.setState('off');
      throw toCameraError(err);
    }

    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      /* autoplay of a muted local stream is allowed; ignore odd rejections */
    }

    this.setState('loading');
    try {
      await this.ensureWorker();
    } catch (err) {
      this.stop();
      throw err;
    }
    if (!this.stream) return; // stopped while loading
    this.running = true;
    this.resultTimes = [];
    this.setState('on');
    this.pump();
  }

  stop(): void {
    this.running = false;
    this.busy = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.setState('off');
    this.cb.onHand(null);
  }

  /** Start loading the model early (e.g. while the student reads). */
  preload(): void {
    this.ensureWorker().catch(() => {
      /* reported again when start() is called */
      this.workerReady = null;
    });
  }

  private setState(s: TrackerState): void {
    this.state = s;
    this.cb.onState(s);
  }

  private ensureWorker(): Promise<void> {
    if (this.workerReady) return this.workerReady;
    const worker = new Worker(`${BASE_URL}hand-worker.js`);
    this.worker = worker;
    const params = new URLSearchParams(location.search);
    this.workerReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CameraError('tracker-timeout'));
        worker.terminate();
        this.worker = null;
        this.workerReady = null;
      }, MODEL_TIMEOUT_MS);
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.delegate = msg.delegate;
          worker.onmessage = (ev) => this.onWorkerMessage(ev.data);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timer);
          worker.terminate();
          this.worker = null;
          this.workerReady = null;
          reject(new CameraError('tracker-failed', msg.message));
        }
      };
      worker.onerror = (ev) => {
        clearTimeout(timer);
        this.worker = null;
        this.workerReady = null;
        reject(new CameraError('tracker-failed', ev.message));
      };
      worker.postMessage({ type: 'init', base: BASE_URL, delegate: params.get('delegate')?.toUpperCase() });
    });
    return this.workerReady;
  }

  private onWorkerMessage(msg: { type: string; points: Float32Array | null; brightness?: number }): void {
    if (msg.type !== 'result') return;
    this.busy = false;
    if (!this.running) return;
    this.cb.onHand(msg.points);
    if (typeof msg.brightness === 'number') this.cb.onBrightness(msg.brightness);

    const now = performance.now();
    this.resultTimes.push(now);
    while (this.resultTimes.length && now - this.resultTimes[0] > 3000) this.resultTimes.shift();
    if (now - this.lastFpsReport > 1000 && this.resultTimes.length > 1) {
      this.lastFpsReport = now;
      const span = (now - this.resultTimes[0]) / 1000;
      if (span > 2) this.cb.onFps((this.resultTimes.length - 1) / span);
    }
  }

  private pump = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.pump);
    const now = performance.now();
    if (this.busy || now - this.lastSent < MIN_FRAME_GAP_MS) return;
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || !this.worker) return;
    this.busy = true;
    this.lastSent = now;
    const h = Math.round((PROCESS_WIDTH * v.videoHeight) / v.videoWidth);
    createImageBitmap(v, { resizeWidth: PROCESS_WIDTH, resizeHeight: h, resizeQuality: 'low' })
      .then((bitmap) => {
        if (!this.running || !this.worker) {
          bitmap.close();
          this.busy = false;
          return;
        }
        // Transfer (not copy) the frame to the worker; it is closed there after tracking.
        this.worker.postMessage({ type: 'frame', bitmap, ts: performance.now() }, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
  };
}

function toCameraError(err: unknown): CameraError {
  const name = (err as DOMException)?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return new CameraError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return new CameraError('no-camera');
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return new CameraError('in-use');
  return new CameraError('unsupported', String(err));
}
