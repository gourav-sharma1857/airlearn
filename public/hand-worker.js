/*
 * Hand-tracking Web Worker (classic worker, plain JS).
 *
 * PRIVACY — this must stay true:
 *  - Camera frames arrive here as in-memory ImageBitmaps from the main thread.
 *  - Each frame is analysed and then closed (freed) right away. Frames are never
 *    stored, encoded, recorded or sent anywhere.
 *  - The only network requests this worker makes are at startup, to load the
 *    MediaPipe runtime and the model file from our own site. No request ever
 *    carries camera data.
 *  - Only 21 hand-landmark coordinates (numbers) are posted back to the page.
 *
 * Why a classic (non-module) worker: MediaPipe's loader uses importScripts(),
 * which is unavailable in module workers. Keeping this file in /public means it
 * behaves identically in `vite dev` and in the production build.
 */
'use strict';

let landmarker = null;
let frameCount = 0;
let lumaCanvas = null;
let lumaCtx = null;

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') init(msg.base, msg.delegate);
  else if (msg.type === 'frame') onFrame(msg.bitmap, msg.ts);
};

async function init(base, preferredDelegate) {
  try {
    // Load the CommonJS build of @mediapipe/tasks-vision with a tiny shim.
    self.exports = {};
    self.module = { exports: self.exports };
    importScripts(base + 'mediapipe/vision_bundle.js');
    const vision = self.module.exports;
    // Remove the shim so the WASM loader script defines a global ModuleFactory.
    delete self.module;
    delete self.exports;

    const fileset = await vision.FilesetResolver.forVisionTasks(base + 'mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: base + 'models/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    let delegate = preferredDelegate === 'CPU' ? 'CPU' : 'GPU';
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options(delegate));
    } catch (gpuError) {
      if (delegate === 'CPU') throw gpuError;
      delegate = 'CPU';
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options(delegate));
    }
    self.postMessage({ type: 'ready', delegate });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
}

function onFrame(bitmap, ts) {
  if (!landmarker) {
    bitmap.close();
    self.postMessage({ type: 'result', points: null });
    return;
  }
  const t0 = performance.now();
  let result;
  try {
    result = landmarker.detectForVideo(bitmap, ts);
  } catch (err) {
    bitmap.close();
    self.postMessage({ type: 'result', points: null, error: String(err) });
    return;
  }

  // Every ~half second, measure average brightness on a 16x12 thumbnail so we
  // can suggest better lighting. Only a single number leaves this function.
  let brightness;
  if (frameCount++ % 15 === 0) brightness = measureBrightness(bitmap);
  bitmap.close(); // free the frame immediately

  let points = null;
  const hand = result.landmarks && result.landmarks[0];
  if (hand) {
    points = new Float32Array(42);
    for (let i = 0; i < 21; i++) {
      points[i * 2] = hand[i].x;
      points[i * 2 + 1] = hand[i].y;
    }
  }
  const msg = { type: 'result', points, brightness, inferMs: performance.now() - t0 };
  self.postMessage(msg, points ? [points.buffer] : []);
}

function measureBrightness(bitmap) {
  try {
    if (!lumaCanvas) {
      lumaCanvas = new OffscreenCanvas(16, 12);
      lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
    }
    lumaCtx.drawImage(bitmap, 0, 0, 16, 12);
    const data = lumaCtx.getImageData(0, 0, 16, 12).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }
    return sum / (data.length / 4) / 255;
  } catch {
    return undefined;
  }
}
