// Copies MediaPipe runtime files into /public and downloads the hand model once.
// Runs automatically before `npm run dev` and `npm run build`.
// Everything is served from our own origin, so school networks that block
// third-party CDNs still work, and the worker never talks to anyone else.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mp = resolve(root, 'node_modules/@mediapipe/tasks-vision');
const out = resolve(root, 'public/mediapipe');
mkdirSync(resolve(out, 'wasm'), { recursive: true });

// Copied with a .js extension: importScripts() requires a JavaScript MIME type,
// and some static hosts serve .cjs as application/octet-stream.
cpSync(resolve(mp, 'vision_bundle.cjs'), resolve(out, 'vision_bundle.js'));
cpSync(resolve(mp, 'wasm'), resolve(out, 'wasm'), { recursive: true });
console.log('[setup] MediaPipe runtime copied to public/mediapipe');

const modelDir = resolve(root, 'public/models');
const modelPath = resolve(modelDir, 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

if (!existsSync(modelPath)) {
  mkdirSync(modelDir, { recursive: true });
  console.log('[setup] Downloading hand landmark model (~7.5 MB)…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('[setup] Model saved to public/models/hand_landmarker.task');
}
