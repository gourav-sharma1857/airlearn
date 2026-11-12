import katex from 'katex';
import { initSite } from '../site';
import { FEEDBACK_URL } from '../config';
import { countGrab, track } from '../analytics';
import { CubeScene, MAX_EDGE, MIN_EDGE, formatEdge } from './scene';
import { CameraError, HandTracker, type CameraErrorKind, type TrackerState } from './tracker';
import { LandmarkSmoother, PinchTracker, drawSkeleton } from './gestures';

initSite();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ======================================================================
   Steps
   ====================================================================== */
const STEPS = ['intro', 'camera', 'handcheck', 'concept', 'guess1', 'demo', 'guess2', 'wrap'] as const;
type Step = (typeof STEPS)[number];
const STEP_LABELS: Record<Step, string> = {
  intro: 'Start',
  camera: 'Camera',
  handcheck: 'Hand check',
  concept: 'The idea',
  guess1: 'Your guess',
  demo: 'Explore',
  guess2: 'Guess again',
  wrap: 'Recap',
};

let current: Step = 'intro';
let mode: 'hand' | 'mouse' = 'mouse';
/** Where to go after the hand check, if the student switched to hand mode mid-lesson. */
let returnTo: Step | null = null;

function go(step: Step): void {
  if (step === current) return;
  const leaving = current;
  current = step;
  document.querySelectorAll<HTMLElement>('.step').forEach((s) => {
    s.hidden = s.dataset.step !== step;
  });
  const n = STEPS.indexOf(step) + 1;
  $('progress').textContent = `Step ${n} of ${STEPS.length} · ${STEP_LABELS[step]}`;
  const heading = document.querySelector<HTMLElement>(`[data-step="${step}"] [tabindex="-1"]`);
  heading?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });

  if (step === 'handcheck') placeCamera('handcheck');
  if (step === 'demo') enterDemo();
  if (leaving === 'demo') clearBanner();
  if (step !== 'handcheck' && step !== 'demo') placeCamera(null);
  if (step === 'demo') placeCamera(tracker.isOn ? 'demo' : null);
}

function nextStep(): void {
  const order: Step[] = ['intro', 'camera', 'handcheck', 'concept', 'guess1', 'demo', 'guess2', 'wrap'];
  const i = order.indexOf(current);
  go(order[Math.min(order.length - 1, i + 1)]);
}

document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', nextStep));
$('btn-start').addEventListener('click', () => go(mode === 'mouse' && cameraDeclined ? 'concept' : 'camera'));

/* ======================================================================
   KaTeX
   ====================================================================== */
function renderTex(el: HTMLElement, tex: string): void {
  katex.render(tex, el, { throwOnError: false, output: 'htmlAndMathml' });
}
document.querySelectorAll<HTMLElement>('[data-tex]').forEach((el) => renderTex(el, el.dataset.tex!));

/* ======================================================================
   Camera + mode
   ====================================================================== */
const camView = $('cam-view');
const camVideo = $<HTMLVideoElement>('cam-video');
const camOverlay = $<HTMLCanvasElement>('cam-overlay');
let cameraDeclined = false;
let cameraAllowedTracked = false;

const tracker = new HandTracker(camVideo, {
  onState: renderCamState,
  onHand: handleHand,
  onBrightness: (b) => {
    brightness = b;
  },
  onFps: handleFps,
});

function renderCamState(state: TrackerState): void {
  const el = $('cam-status');
  el.dataset.state = state;
  $('cam-text').textContent = {
    off: 'Camera off',
    starting: 'Camera: waiting for permission…',
    loading: 'Camera on · loading hand tracker…',
    on: 'Camera on · video stays on this device',
  }[state];
  $('stop-cam').hidden = state === 'off';
  if (state === 'loading' && !cameraAllowedTracked) {
    cameraAllowedTracked = true;
    track('camera_allowed');
  }
  if (state === 'on' && camVideo.videoWidth) {
    camView.style.aspectRatio = `${camVideo.videoWidth} / ${camVideo.videoHeight}`;
    pinch.setAspect(camVideo.videoWidth / camVideo.videoHeight);
  }
  if (current === 'handcheck') updateHandcheckStatus();
  if (current === 'demo') placeCamera(state === 'off' ? null : 'demo');
}

function setMode(m: 'hand' | 'mouse'): void {
  mode = m;
  $('mode-hand').setAttribute('aria-pressed', String(m === 'hand'));
  $('mode-mouse').setAttribute('aria-pressed', String(m === 'mouse'));
  $('board-hint').innerHTML =
    m === 'hand'
      ? 'Pinch the <span class="hl">yellow corner</span> to stretch · pinch anywhere else to spin'
      : 'Drag the <span class="hl">yellow corner</span> to stretch · drag anywhere else to spin';
  if (m === 'mouse') {
    tracker.stop();
    hideHandCursor();
  }
}

function useMouse(): void {
  cameraDeclined = true;
  setMode('mouse');
  clearBanner();
  if (current === 'camera' || current === 'handcheck') go(returnTo ?? 'concept');
  returnTo = null;
}
document.querySelectorAll('[data-action="use-mouse"]').forEach((b) => b.addEventListener('click', useMouse));
$('mode-mouse').addEventListener('click', useMouse);
$('stop-cam').addEventListener('click', useMouse);

$('mode-hand').addEventListener('click', () => {
  if (tracker.isOn) return;
  if (current === 'intro' || current === 'camera') {
    go('camera');
    return;
  }
  if (current === 'handcheck') {
    startCamera();
    return;
  }
  // Mid-lesson: show the camera explanation first, then come back here.
  returnTo = current;
  go('camera');
});

$('btn-allow').addEventListener('click', startCamera);
$('btn-retry').addEventListener('click', startCamera);
$('btn-hc-continue').addEventListener('click', () => {
  const back = returnTo;
  returnTo = null;
  go(back ?? 'concept');
});

const ERRORS: Record<CameraErrorKind, [string, string]> = {
  denied: [
    'The camera is blocked. No problem!',
    "Your browser didn't share the camera. You can use the mouse instead. To try the camera again, click the camera icon in the address bar, choose Allow, then press Try again.",
  ],
  'no-camera': [
    "We couldn't find a camera",
    "This device doesn't seem to have a webcam, or it's turned off. Mouse and touch mode give you the same cube.",
  ],
  'in-use': [
    'The camera is busy',
    'Another app or browser tab might be using the camera. Close it, then press Try again. Or use the mouse instead.',
  ],
  insecure: [
    'The camera needs a secure page',
    'Browsers only share the camera on pages that start with https://. Ask your teacher for the https link, or use the mouse instead.',
  ],
  unsupported: [
    "This browser can't share the camera",
    'Try a recent version of Chrome, or use the mouse instead.',
  ],
  'tracker-failed': [
    "Hand tracking couldn't start",
    "This device might not support the hand tracker. Mouse mode works everywhere and shows exactly the same thing.",
  ],
  'tracker-timeout': [
    'Hand tracking is taking too long to load',
    'Your device or the network may be slow right now. Use the mouse instead, or press Try again.',
  ],
};

async function startCamera(): Promise<void> {
  $('camera-error').hidden = true;
  setMode('hand');
  cameraDeclined = false;
  const startedFrom = current;
  if (current === 'camera') go('handcheck');
  try {
    await tracker.start();
  } catch (err) {
    const kind: CameraErrorKind = err instanceof CameraError ? err.kind : 'unsupported';
    if (mode === 'hand') setMode('mouse');
    const [title, body] = ERRORS[kind];
    if (current === 'handcheck' || current === 'camera' || startedFrom === 'camera') {
      go('camera');
      $('camera-error-title').textContent = title;
      $('camera-error-body').textContent = body;
      $('camera-error').hidden = false;
      $('camera-error').focus();
    } else {
      showBanner(`${title}. ${body}`);
    }
  }
}

/* Moves the single camera view between the hand-check step and the demo board. */
function placeCamera(where: 'handcheck' | 'demo' | null): void {
  const mini = $('mini-cam-slot');
  if (where === 'handcheck') {
    $('handcheck-slot').appendChild(camView);
    mini.hidden = true;
  } else if (where === 'demo') {
    mini.appendChild(camView);
    mini.hidden = false;
  } else {
    document.body.appendChild(camView);
    mini.hidden = true;
  }
}

/* ======================================================================
   Hand input → hand check + demo
   ====================================================================== */
const smoother = new LandmarkSmoother(4);
const pinch = new PinchTracker();
let wasPinched = false;
let lastHandAt = 0;
let brightness = 1;
let handSeenOnce = false;
let pinchSeenOnce = false;
let slowWarned = false;

function handleHand(points: Float32Array | null): void {
  const now = performance.now();
  if (!points) {
    smoother.reset();
    drawSkeleton(camOverlay, null, false);
    const stillPinched = pinch.lost(now);
    if (wasPinched && !stillPinched) {
      wasPinched = false;
      if (current === 'demo') pointerUp();
    }
    if (!stillPinched) hideHandCursor();
    return;
  }
  lastHandAt = now;
  const smooth = smoother.push(points);
  const f = pinch.update(smooth);
  drawSkeleton(camOverlay, smooth, f.pinched);

  if (current === 'handcheck') {
    handSeenOnce = true;
    if (f.pinched) pinchSeenOnce = true;
    updateHandcheckStatus(f.pinched);
  }
  if (current === 'demo' && mode === 'hand') {
    const board = $('board');
    const x = f.x * board.clientWidth;
    const y = f.y * board.clientHeight;
    if (f.pinched && !wasPinched) pointerDown(x, y, 'hand');
    else if (f.pinched) pointerMove(x, y);
    else if (!f.pinched && wasPinched) pointerUp();
    else hover(x, y, 'hand');
    showHandCursor(x, y, f.pinched);
  }
  wasPinched = f.pinched;
  if (tipShown === 'no-hand' || tipShown === 'dark') clearTip();
}

function updateHandcheckStatus(pinchedNow = false): void {
  const status = $('hc-status');
  $('hc-see').classList.toggle('done', handSeenOnce);
  $('hc-pinch').classList.toggle('done', pinchSeenOnce);
  if (tracker.state === 'starting') status.textContent = 'Waiting for camera permission…';
  else if (tracker.state === 'loading')
    status.textContent = 'Loading the hand tracker. The first time can take a few seconds…';
  else if (tracker.state === 'off') status.textContent = 'Camera is off.';
  else if (!handSeenOnce) status.textContent = 'Hold your hand up in good light.';
  else if (pinchedNow) status.textContent = 'Pinch! That is how you grab the cube.';
  else if (!pinchSeenOnce) status.textContent = 'I see your hand! Now try a pinch.';
  else status.textContent = "You're ready. Press Continue.";
}

/* Friendly tips for low light, no hand, slow device. */
type Tip = 'no-hand' | 'dark' | 'slow' | null;
let tipShown: Tip = null;
const TIP_TEXT: Record<Exclude<Tip, null>, string> = {
  'no-hand': "I can't see your hand. Hold it up with your palm facing the screen, about an arm's length from the camera.",
  dark: "It's a bit dark, so your hand is hard to see. Try facing a window or turning on a light.",
  slow: 'Hand tracking is running slowly on this device, so the cube may lag. Mouse mode will feel smoother.',
};

function showTip(t: Exclude<Tip, null>): void {
  if (tipShown === t) return;
  tipShown = t;
  if (current === 'handcheck') {
    $('hc-tip').textContent = TIP_TEXT[t];
    $('hc-tip').hidden = false;
  } else if (current === 'demo') {
    showBanner(TIP_TEXT[t]);
  }
}
function clearTip(): void {
  tipShown = null;
  $('hc-tip').hidden = true;
  if (current === 'demo') clearBanner();
}

setInterval(() => {
  if (tracker.state !== 'on' || (current !== 'handcheck' && current !== 'demo')) return;
  if (performance.now() - lastHandAt > 5000) showTip(brightness < 0.2 ? 'dark' : 'no-hand');
}, 1000);

function handleFps(fps: number): void {
  if (fps < 10 && !slowWarned && (current === 'handcheck' || current === 'demo')) {
    slowWarned = true;
    showTip('slow');
  }
}

/* ======================================================================
   Demo
   ====================================================================== */
const BASE_EDGE = 2;
let scene: CubeScene | null = null;
let edge = BASE_EDGE;
type Grab =
  | { kind: 'rotate'; x: number; y: number }
  | { kind: 'resize'; startEdge: number; startDist: number; cx: number; cy: number }
  | null;
let grab: Grab = null;
let doubledShown = false;

function enterDemo(): void {
  if (!scene) {
    try {
      scene = new CubeScene($('scene-host'));
    } catch {
      $('no-webgl').hidden = false;
    }
  }
  updateReadout();
}

function nearHandle(x: number, y: number, source: 'hand' | 'mouse'): boolean {
  if (!scene) return false;
  const h = scene.handleScreen();
  return Math.hypot(x - h.x, y - h.y) < (source === 'hand' ? 56 : 34);
}

function pointerDown(x: number, y: number, source: 'hand' | 'mouse'): void {
  if (!scene) return;
  countGrab();
  if (nearHandle(x, y, source)) {
    const c = scene.centerScreen();
    grab = { kind: 'resize', startEdge: edge, startDist: Math.max(24, Math.hypot(x - c.x, y - c.y)), cx: c.x, cy: c.y };
  } else {
    grab = { kind: 'rotate', x, y };
  }
}

function pointerMove(x: number, y: number): void {
  if (!scene || !grab) return;
  if (grab.kind === 'rotate') {
    scene.rotateBy((x - grab.x) * 0.011, (y - grab.y) * 0.011);
    grab.x = x;
    grab.y = y;
  } else {
    const raw = (grab.startEdge * Math.hypot(x - grab.cx, y - grab.cy)) / grab.startDist;
    setEdge(snapEdge(raw));
  }
}

function pointerUp(): void {
  if (grab?.kind === 'resize') announce();
  grab = null;
}

function hover(x: number, y: number, source: 'hand' | 'mouse'): void {
  const near = nearHandle(x, y, source);
  scene?.setHandleHover(near);
  $('board').classList.toggle('over-handle', near && source === 'mouse');
  $('hand-cursor').classList.toggle('near', near);
}

/** Round to 0.1, with a gentle "magnet" to whole numbers so 4 is easy to hit. */
function snapEdge(raw: number): number {
  const whole = Math.round(raw);
  const v = Math.abs(raw - whole) < 0.15 ? whole : Math.round(raw * 10) / 10;
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, v));
}

function setEdge(a: number): void {
  if (a === edge) return;
  edge = a;
  scene?.setEdge(a);
  updateReadout();
}

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
}
function approx(n: number): string {
  return Math.abs(n - Math.round(n * 100) / 100) > 1e-9 ? '\\approx' : '=';
}

function updateReadout(): void {
  const a = edge;
  const S = 6 * a * a;
  const V = a * a * a;
  const sMult = (a / BASE_EDGE) ** 2;
  const vMult = (a / BASE_EDGE) ** 3;
  const aTxt = formatEdge(a);
  $('r-edge').textContent = aTxt;
  renderTex($('r-s'), `S = 6a^2 = 6(${aTxt})^2 ${approx(S)} ${fmt(S)}`);
  renderTex($('r-v'), `V = a^3 = (${aTxt})^3 ${approx(V)} ${fmt(V)}`);
  $('r-s-now').textContent = fmt(S);
  $('r-v-now').textContent = fmt(V);
  $('r-s-mult').textContent = `×${fmt(sMult)}`;
  $('r-v-mult').textContent = `×${fmt(vMult)}`;
  const doubled = a === BASE_EDGE * 2;
  $('r-s-mult').classList.toggle('hit', doubled);
  $('r-v-mult').classList.toggle('hit', doubled);
  $('celebrate').hidden = !doubled;
  if (doubled && !doubledShown) {
    doubledShown = true;
    $('demo-done').classList.add('btn-yellow');
  }
}

function announce(): void {
  const a = edge;
  let msg = `Edge ${formatEdge(a)}. Surface area ${fmt(6 * a * a)}. Volume ${fmt(a ** 3)}.`;
  if (a === BASE_EDGE * 2) msg += ' Edge doubled: surface area is 4 times as big, volume is 8 times as big.';
  $('sr-announce').textContent = msg;
}

/* Mouse / touch / pen on the board. */
const board = $('board');
board.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  const r = board.getBoundingClientRect();
  board.setPointerCapture(e.pointerId);
  const src = 'mouse';
  // touch is less precise than a mouse: treat it like the hand radius
  pointerDown(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 'hand' : src);
});
board.addEventListener('pointermove', (e) => {
  const r = board.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (grab) pointerMove(x, y);
  else if (e.pointerType === 'mouse') hover(x, y, 'mouse');
});
const endPointer = () => pointerUp();
board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);

/* Keyboard. */
board.addEventListener('keydown', (e) => {
  if (!scene && !['+', '=', '-', '_'].includes(e.key)) return;
  const step = 0.12;
  switch (e.key) {
    case 'ArrowLeft':
      scene?.rotateBy(-step, 0);
      break;
    case 'ArrowRight':
      scene?.rotateBy(step, 0);
      break;
    case 'ArrowUp':
      scene?.rotateBy(0, -step);
      break;
    case 'ArrowDown':
      scene?.rotateBy(0, step);
      break;
    case '+':
    case '=':
      nudgeEdge(0.5);
      break;
    case '-':
    case '_':
      nudgeEdge(-0.5);
      break;
    default:
      return;
  }
  e.preventDefault();
});

function nudgeEdge(d: number): void {
  countGrab();
  setEdge(snapEdge(Math.round((edge + d) * 2) / 2));
  announce();
}
$('edge-plus').addEventListener('click', () => nudgeEdge(0.5));
$('edge-minus').addEventListener('click', () => nudgeEdge(-0.5));
$('edge-reset').addEventListener('click', () => {
  setEdge(BASE_EDGE);
  scene?.resetRotation();
  announce();
});

/* Hand cursor on the board. */
const handCursor = $('hand-cursor');
function showHandCursor(x: number, y: number, pinched: boolean): void {
  handCursor.hidden = false;
  handCursor.style.transform = `translate(${x}px, ${y}px)`;
  handCursor.classList.toggle('pinched', pinched);
}
function hideHandCursor(): void {
  handCursor.hidden = true;
  scene?.setHandleHover(false);
}

/* Banner on the board (errors and tips during the demo). */
function showBanner(text: string): void {
  $('board-banner-text').textContent = text;
  $('board-banner').hidden = false;
}
function clearBanner(): void {
  $('board-banner').hidden = true;
}
$('banner-dismiss').addEventListener('click', () => {
  clearBanner();
  board.focus();
});

/* ======================================================================
   Guesses (stored only in this browser)
   ====================================================================== */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`hos.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(`hos.${k}`, v);
    } catch {
      /* private mode etc. */
    }
  },
};
let guessBefore: string | null = null;

function choiceText(v: string | null): string {
  if (!v) return 'no answer';
  return v === 'unsure' ? '"not sure"' : `×${v}`;
}

$<HTMLFormElement>('guess1-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = new FormData(e.target as HTMLFormElement).get('g') as string | null;
  guessBefore = v;
  if (v) store.set('guessBefore', v);
  go('demo');
});

$<HTMLFormElement>('guess2-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = new FormData(e.target as HTMLFormElement).get('g') as string | null;
  if (!v) {
    $('reveal-compare').textContent = 'Pick an answer first, even if it is "not sure".';
    $('reveal').hidden = false;
    return;
  }
  store.set('guessAfter', v);
  const before = guessBefore ?? store.get('guessBefore');
  const right = v === '8';
  $('reveal-compare').innerHTML = '';
  const p = $('reveal-compare');
  const strong = document.createElement('strong');
  strong.textContent = right ? 'Yes: ×8!' : 'Not quite. The answer is ×8.';
  p.append(strong, ` Before the demo you said ${choiceText(before)}. Now you said ${choiceText(v)}.`);
  $('reveal').hidden = false;
  $('reveal').focus();
});

/* ======================================================================
   Wrap-up
   ====================================================================== */
const feedback = $<HTMLAnchorElement>('feedback-link');
if (FEEDBACK_URL) feedback.href = FEEDBACK_URL;
else feedback.hidden = true;

$('btn-restart').addEventListener('click', () => {
  setEdge(BASE_EDGE);
  scene?.resetRotation();
  doubledShown = false;
  $('demo-done').classList.remove('btn-yellow');
  (['guess1-form', 'guess2-form'] as const).forEach((id) => $<HTMLFormElement>(id).reset());
  $('reveal').hidden = true;
  go('concept');
});

/* Initial state */
setMode('mouse');
renderCamState('off');
updateReadout();
