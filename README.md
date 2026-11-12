# AirLearn

*Hold concepts in your hands.*

A webcam-based geometry prototype. A student pinches a 3D cube with their own hand, stretches the edge from 2 to 4, and watches surface area go 24 → 96 (×4) and volume go 8 → 64 (×8) live. There's a full mouse/touch fallback.

Stack: Vite + TypeScript, Three.js (WebGL renderer), MediaPipe Hand Landmarker in a Web Worker, KaTeX. No backend.

## Setup

Requires Node 18+ (tested with Node 24).

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run dev` and `npm run build` first run `scripts/setup.mjs`, which:

1. copies the MediaPipe runtime (`vision_bundle` + WASM) from `node_modules` into `public/mediapipe/`, and
2. downloads the hand model (~7.8 MB) once into `public/models/hand_landmarker.task`.

Everything is then served from your own domain, so schools that block third-party CDNs still work. Both folders are git-ignored and are rebuilt on deploy.

> The camera only works on `https://` or `localhost`. To test on a Chromebook against your laptop, deploy a preview, or use `npx vite --host` together with an HTTPS tunnel.

### Branding (`brand.config.json`)

The product name, tagline and logo live in one file:

```json
{
  "name": "AirLearn",
  "tagline": "Hold concepts in your hands.",
  "logo": "/brand/logo.svg"
}
```

- **Rename:** change `name`. It updates page titles, the header, the footer and the home page text.
- **New logo:** put the file in `public/brand/` (SVG or a square PNG, at least 64×64) and point `logo` at it, e.g. `"/brand/logo.png"`. It's used in the header and as the browser-tab icon.
- In `npm run dev` the page reloads when you save the file. Production builds pick it up automatically.

### Configuration (`.env`)

| Variable | What it does |
| --- | --- |
| `VITE_FORMSPREE_ID` | Formspree form id for the teacher pilot signup. If empty, the form shows a "not connected yet" message. |
| `VITE_FEEDBACK_URL` | Feedback link at the end of the lesson (e.g. a Google Form). If empty, the button is hidden. |
| `VITE_ANALYTICS_ENDPOINT` | URL that receives anonymous event counts via `navigator.sendBeacon`. If empty, nothing is sent. |

If you set an analytics endpoint, also add its origin to `connect-src` in **both** `public/_headers` and `vercel.json`, or the browser will block it.

### Useful flags

- `lesson.html?delegate=cpu` forces CPU hand tracking (default is GPU, with an automatic CPU fallback).
- `npm run build && npx vite preview` serves the production build **with the production Content-Security-Policy**, so CSP problems show up locally.

## Deploy

All three hosts run `npm run build` and publish `dist/`.

- **Netlify:** connect the repo. `netlify.toml` is included, and headers come from `public/_headers`.
- **Cloudflare Pages:** framework preset "None", build command `npm run build`, output `dist`, env `NODE_VERSION=20`. Headers come from `public/_headers`.
- **Vercel:** import the repo. `vercel.json` sets the build and headers.

Set the `VITE_*` variables in the host's dashboard (they're baked in at build time).

## How it fits together

```
index.html / teachers.html / privacy.html   static pages + src/site.ts (nav, analytics)
lesson.html                                  the lesson flow
src/lesson/main.ts      step flow, mode toggle, error states, readout, guesses
src/lesson/scene.ts     Three.js cube (chalk outlines, dashed hidden edges, shadow, handle)
src/lesson/tracker.ts   camera + worker; frames sent as ImageBitmaps, ~30 fps cap
src/lesson/gestures.ts  moving-average smoothing, pinch with hysteresis, skeleton drawing
public/hand-worker.js   MediaPipe Hand Landmarker (classic worker, see note in file)
src/analytics.ts        4 anonymous counters
```

**Gestures (2D + pinch only, no depth):** the cursor is the midpoint of the thumb tip and index tip, mirrored. A pinch is thumb-to-index distance ÷ hand size (wrist → middle knuckle), so it works at any distance from the camera. It enters below 0.32 and exits above 0.48 so it doesn't flicker. Pinching near the yellow corner resizes the cube, and pinching anywhere else rotates it. Edge values snap to 0.1, with a magnet to whole numbers so 4 is easy to hit. Range is 1 to 5.

**Performance:** frames are downscaled to 320 px wide before tracking, and only one frame is in flight at a time (capped at ~30 fps). The 3D scene renders only when something changes, and pixel ratio is capped at 1.5. A "running slowly" tip appears if tracking drops below 10 updates per second.

## Privacy (enforced in code)

- Hand tracking runs in a Web Worker on the device. Frames are transferred as in-memory `ImageBitmap`s and closed right after use (`public/hand-worker.js`, `src/lesson/tracker.ts`, both with privacy notes at the top).
- No `MediaRecorder`, no `toDataURL`/`toBlob`, and no storage of frames. Only 21 landmark coordinates leave the worker, and they stay in the page.
- The Content-Security-Policy `connect-src` only allows our own origin and Formspree, so the browser blocks any other upload.
- Analytics send only `{event, page, value}` for: `page_open`, `camera_allowed`, `grab` (count), `time_on_page` (seconds). No IDs, cookies or camera data.
- Guess answers live only in `localStorage`.

## What was tested

- Production build with the production CSP, in Chromium: Home, Lesson, Teachers and Privacy all render, with no horizontal scroll at 375 px.
- Lesson in mouse mode end to end: the drag handle takes the edge 2 → 4, the readout shows 24 → 96 (×4) and 8 → 64 (×8) with highlight, then guess before/after, reveal, and recap. Keyboard +/− and arrow keys work too.
- The worker loads MediaPipe under CSP: GPU delegate ≈ 5 ms per frame, CPU ≈ 90 ms per frame when no hand is visible (on this machine).
- Camera-denied error → mouse mode. A synthetic camera stream runs through the whole pipeline: status pill, low-light tip, camera moved into the demo board, and Stop camera ends the track.
- **Not yet tested:** a real hand on a real webcam, and an actual Chromebook. Please try both before a classroom pilot.
