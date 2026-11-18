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

## Sphere Lab (in progress)

`sphere.html` is the second module: explore a sphere's volume and surface area. It is built in phases.

- **Phase 1 (done):** resize (drag the yellow dot, the slider, +/- buttons or keys) and spin (drag, or arrow keys). Live readouts show radius, volume in cm³ and mL, surface area, and paint needed. Includes a Reset view button.
- **Phase 2 (done):** hand mode. Press **Hand** in the top bar. A card explains the camera before the browser asks for permission. Then:
  - **Pinch** the yellow dot to resize.
  - Make a **fist** and move it to spin.
  - **Pinch** an on-board button (like Reset view) to press it.
  - A small camera picture-in-picture with the hand skeleton sits on the board, and the Stop camera button is always in the top bar.
  - If the hand disappears, the sphere keeps its state and "Hold your hand up" shows. After 6 seconds a tip appears: low light, or no hand. Another tip appears if tracking drops below 10 fps.
- **Phase 3 (done): Fill it.**
  - **Mode tabs:** big buttons on the board, so a pinch can reach them. Paint and Cut are greyed out until their phases.
  - **Predict first:** "When the water is halfway up, how full is the sphere?" The guess is kept only in `localStorage`.
  - **Filling:** drag or pinch the blue dot on the water track. It snaps at ¼, ½ and ¾. You can also use the slider or Page Up / Page Down.
  - **Water in 3D:** the water stays level while the sphere spins. It is drawn as a clipped inner sphere plus a flat surface disc.
  - **Readouts:** % full, water in mL out of the sphere's total, and the water height in cm. A small SVG graph of height against % full has a moving dot. The curve is the same for every radius.
  - **Reveal:** when the water first reaches halfway, the panel shows "exactly 50%", along with "only 15.6% at a quarter, 84.4% at three quarters". A "Show me a quarter" button jumps there.
- **Phase 4 (done): Paint it.**
  - **The paint:** a coral band sweeps from the top of the sphere down. It's a slightly larger tinted sphere revealed by a clipping plane, with a darker "wet edge" ring at the sweep line. It is drawn in the sphere's own frame, so the paint turns with the sphere.
  - **Controls:** drag or pinch the coral dot on the left track (snaps at ¼ ½ ¾), press **Paint it!** (about a 3-second sweep, instant with reduced motion), use the slider, or press Page Down / Page Up.
  - **Gauge:** a paint can that starts with exactly enough paint and empties as you paint. It shows mL used, mL left, and the painted area against the total surface.
  - **The surprise it teaches:** the painted area is 2πr × (distance swept), which is Archimedes' "hat-box" result. Every centimetre of sweep uses the same amount of paint, unlike the S-shaped water curve.
- **Phase 5 (done): Cut it.**
  - **Cutting plane:** slide it with the white "knife" dot on the right track, the slider, or Page Up / Page Down. It snaps to the center. The plane and its yellow cross-section circle sit in the sphere's own frame. The panel shows the cross-section area π(r² − d²) and the new surface a cut there would add, 2π(r² − d²).
  - **Cut in half** (a button on the board): the plane slides to the center and the two hemispheres move apart. Their flat faces are solid yellow, labelled "new surface that needs paint". Spin the halves to see the faces.
  - **Readout:** whole sphere against 2 halves. Volume is unchanged, surface area is +50%, and paint goes from 31.4 to 47.1 mL (+15.7 mL at r = 5).
  - **Paint it again** turns both halves coral and shows the extra paint. **Put it back together** rejoins them.
  - **Hand mode:** the mode's action buttons (Paint it!, Cut in half, Paint it again, Put it back together) now sit on the board, so a pinch can press them.
- **Phase 6 (done):** the full flow, the challenge, concept cards and the recording view.
  - **Flow:** intro → camera permission (explains why, says the video never leaves the device, offers "Use mouse instead") → hand check (preview with skeleton, ticks for hand / pinch / fist, low-light and no-hand tips) → the lab → wrap-up. The top bar shows "Step n of 8".
  - **Challenge** (4th tab): first the guess, "Double the radius. Which grows faster, the paint or the water?", then the student drags 5 → 10 cm. A table shows water and paint at 5 cm against now, with live multipliers. At 10 cm it reveals water ×8 and paint ×4, with the reasoning.
  - **Next buttons:** each panel has one, so the lab runs Fill → Paint → Cut → Challenge → wrap-up. The tabs still let you jump around.
  - **Wrap-up:** four concept cards with KaTeX formulas, the feedback link (hidden if `VITE_FEEDBACK_URL` is empty), and Explore again.
  - **Recording view** (top bar toggle): hides the site header and footer, notes, sliders, formulas and the hint. It makes the board taller and the numbers larger, and keeps the webcam picture-in-picture with the skeleton.
  - **Error states, each with a path to mouse mode:**
    - camera denied, no camera, camera busy, not https, unsupported browser, tracker failed, and tracker timeout;
    - no hand or low light (a tip after about 5–6 s), and "Hold your hand up" while the hand is lost;
    - a slow device (a tip when tracking drops below 10 fps).

### Sphere Lab: things I was unsure about

1. **Fist detection** has only been tested with synthetic landmarks. It is likely weaker when the palm faces sideways or the fingers point at the camera. Mouse and touch rotation always work.
2. **Performance on a real Chromebook** hasn't been measured yet. The scene renders only on change, but Paint it! and Cut in half animate every frame for 1–3 seconds.
3. **The paint and cut handles always move straight up and down**, while the paint band and the cutting plane turn with the sphere. After spinning, Reset view lines them up again.
4. **Cut in half always cuts through the center**, as the spec describes. Off-center positions show the cross-section but don't split into unequal pieces.
5. **The "Did you notice?" note** about Archimedes' hat-box theorem in Paint it is my addition. It is true, but remove it if it's beyond the brief.
6. **Radius range** is 1–12 cm, starting at 5 cm. The spec didn't give one.
7. **Saved guesses:** the predict and challenge guesses are kept in `localStorage`, so each card shows once per browser. On a shared classroom computer, the next student won't see the cards unless the site data is cleared.
8. **Analytics:** "mode used" is counted as `mode_fill`, `mode_paint`, `mode_cut` and `mode_challenge`. The challenge event was added in Phase 6.

**Gestures in detail (`src/sphere/hand.ts`, tested in `hand.test.ts`):**
- **Smoothing:** landmarks go through a One Euro filter. It smooths strongly when the hand is still and lightly when it moves fast.
- **Pinch:** uses the same hysteresis as the cube lesson.
- **Fist:** at least 3 of the 4 fingers are curled, meaning the fingertip is closer to the wrist than 1.25× its knuckle. It has to hold for 3 frames to start and 3 frames to stop. A pinch can't start while the hand looks like a fist, so closing your hand never resizes by accident.
- **Only 2D:** no gesture uses depth.

**How reliable is the fist?** It has only been tested with synthetic landmarks so far, not a real webcam. It is likely to be weaker when the palm faces sideways, or when the fingers point at the camera, because curled and straight fingers then look alike in 2D. Mouse and touch rotation always keep working.

All the math lives in `src/sphere/math.ts` and is tested in `src/sphere/math.test.ts` against the spec values (r = 5 and r = 10, water at 0.5r / r / 1.5r / 2r, and the center cut). Run the tests with:

```bash
npm test
```

Paint uses **1 mL per 10 cm²**, a teaching constant, not real paint data. The water model assumes an ideal thin-walled sphere.

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
