/**
 * Sphere Lab.
 * Phase 1: resize and spin with mouse / touch / keyboard, live readouts.
 * Phase 2: hand mode. Pinch the yellow dot to resize, make a fist and move to spin,
 *          pinch an on-board button to press it. Tracking runs in a Web Worker
 *          (see ../lesson/tracker.ts and public/hand-worker.js); video never leaves the device.
 * Phase 3: Fill it. Predict first, then drag the blue water handle; live % full, mL and a graph.
 * Phase 4: Paint it. A coral band sweeps from the top down (drag/pinch the coral brush handle,
 *          or press Paint it!) while a paint can empties; mL used vs mL needed.
 * Phase 5: Cut it. Slide a cutting plane (cross-section area live), cut in half, spin the
 *          hemispheres to see the yellow new faces, then "Paint it again" (+50% paint).
 * Phase 6: the full flow (intro → camera → hand check → lab → wrap-up), the Challenge
 *          (double the radius: water ×8, paint ×4), concept cards, and the recording view.
 */
import katex from 'katex';
import { initSite } from '../site';
import { FEEDBACK_URL } from '../config';
import { countGrab, track, type ModeEvent } from '../analytics';
import { SphereScene } from './scene';
import { CameraError, HandTracker, type CameraErrorKind, type TrackerState } from '../lesson/tracker';
import { drawSkeleton } from '../lesson/gestures';
import { HandGestures, type Gesture } from './hand';
import {
  MAX_RADIUS,
  MIN_RADIUS,
  START_RADIUS,
  clamp,
  fmt1,
  fractionFull,
  snapWater,
  waterVolume,
  fmtRadius,
  paintMl,
  snapRadius,
  sphereSurface,
  sphereVolume,
  zoneArea,
  crossSectionArea,
  cutNewSurface,
  hemisphereSurface,
  hemisphereVolume,
  snapCut,
  surfaceAfterCut,
} from './math';

initSite();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let radius = START_RADIUS;
let scene: SphereScene | null = null;
try {
  scene = new SphereScene($('scene-host'));
} catch {
  $('no-webgl').hidden = false;
}

/* ======================================================================
   Readouts
   ====================================================================== */
function renderTex(el: HTMLElement, tex: string): void {
  katex.render(tex, el, { throwOnError: false, output: 'htmlAndMathml' });
}

const slider = $<HTMLInputElement>('radius');

function setRadius(r: number): void {
  const v = clamp(r, MIN_RADIUS, MAX_RADIUS);
  if (v === radius) return;
  radius = v;
  scene?.setRadius(v);
  updateReadout();
}

function updateReadout(): void {
  const r = radius;
  const V = sphereVolume(r);
  const S = sphereSurface(r);
  const rTxt = fmtRadius(r);
  $('r-radius').textContent = rTxt;
  if (slider.valueAsNumber !== r) slider.value = String(r);
  slider.setAttribute('aria-valuetext', `${rTxt} centimeters`);
  $('r-vol').textContent = fmt1(V);
  $('r-ml').textContent = fmt1(V);
  $('r-area').textContent = fmt1(S);
  $('r-paint').textContent = fmt1(paintMl(S));
  updateFill();
  updatePaint();
  updateCut();
  updateChallenge();
}

/* ======================================================================
   Modes (tabs live on the board so a pinch can reach them)
   ====================================================================== */
type LabMode = 'fill' | 'paint' | 'cut' | 'challenge';
let labMode: LabMode = 'fill';
const MODE_TITLES: Record<LabMode, string> = {
  fill: 'Fill it: how full is the sphere?',
  paint: 'Paint it: how much paint does it take?',
  cut: 'Cut it: what changes when you cut a sphere?',
  challenge: 'Challenge: which grows faster, the paint or the water?',
};
const modeTracked = new Set<LabMode>();

function setLabMode(m: LabMode): void {
  labMode = m;
  document.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((t) => {
    t.setAttribute('aria-selected', String(t.dataset.mode === m));
  });
  $('mode-title').textContent = MODE_TITLES[m];
  $('fill-panel').hidden = m !== 'fill';
  $('paint-panel').hidden = m !== 'paint';
  $('cut-panel').hidden = m !== 'cut';
  $('challenge-panel').hidden = m !== 'challenge';
  $('predict-card').hidden = true;
  $('challenge-card').hidden = true;
  $('celebrate').hidden = !(m === 'challenge' && challengeRevealed);
  document.querySelectorAll<HTMLElement>('#board-actions [data-for]').forEach((g) => {
    g.hidden = g.dataset.for !== m;
  });
  scene?.setWater(m === 'fill' ? waterT : null);
  scene?.setPaint(m === 'paint' ? paintP : null);
  scene?.setCut(m === 'cut' ? cutC : null);
  scene?.setSplit(m === 'cut' ? splitK : 0);
  scene?.setRadiusUi(!(m === 'cut' && splitK > 0));
  if (m !== 'paint') stopPaintAnim();
  if (!modeTracked.has(m)) {
    modeTracked.add(m);
    track(`mode_${m}` as ModeEvent);
  }
  if (m === 'fill' && !fillGuess) $('predict-card').hidden = false;
  if (m === 'challenge' && !challengeGuess) $('challenge-card').hidden = false;
  if (current === 'lab') {
    const card = !$('predict-card').hidden ? 'predict-title' : !$('challenge-card').hidden ? 'challenge-title' : null;
    if (card) $(card).focus({ preventScroll: true });
  }
  updateHint();
  updateProgress();
}

/* ======================================================================
   Steps: intro → camera → hand check → lab (4 modes) → wrap-up
   ====================================================================== */
type Step = 'intro' | 'camera' | 'handcheck' | 'lab' | 'wrap';
let current: Step = 'intro';
const PROGRESS: Record<Step | LabMode, [number, string]> = {
  intro: [1, 'Start'],
  camera: [2, 'Camera'],
  handcheck: [3, 'Hand check'],
  fill: [4, 'Fill it'],
  paint: [5, 'Paint it'],
  cut: [6, 'Cut it'],
  challenge: [7, 'Challenge'],
  lab: [4, 'Explore'],
  wrap: [8, 'Big ideas'],
};

function updateProgress(): void {
  const [n, label] = PROGRESS[current === 'lab' ? labMode : current];
  $('progress').textContent = `Step ${n} of 8 · ${label}`;
}

function go(step: Step): void {
  current = step;
  document.querySelectorAll<HTMLElement>('.step').forEach((el) => {
    el.hidden = el.dataset.step !== step;
  });
  placeCamera();
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (step === 'lab') {
    setLabMode(labMode);
    if ($('predict-card').hidden && $('challenge-card').hidden) $('h-lab').focus({ preventScroll: true });
  } else {
    document.querySelector<HTMLElement>(`[data-step="${step}"] [tabindex="-1"]`)?.focus({ preventScroll: true });
  }
  if (step === 'handcheck') updateHandcheck();
}

$('btn-start').addEventListener('click', () => go('camera'));
$('btn-hc-continue').addEventListener('click', () => go('lab'));
document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) =>
  b.addEventListener('click', () => {
    setLabMode(b.dataset.goto as LabMode);
    board.scrollIntoView({ block: 'nearest' });
  }),
);
$('btn-finish').addEventListener('click', () => go('wrap'));
$('btn-restart').addEventListener('click', () => {
  setRadius(START_RADIUS);
  go('lab');
  setLabMode('fill');
});
document.querySelectorAll<HTMLElement>('[data-tex]').forEach((el) => renderTex(el, el.dataset.tex!));
{
  const fb = $<HTMLAnchorElement>('feedback-link');
  if (FEEDBACK_URL) fb.href = FEEDBACK_URL;
  else fb.hidden = true;
}

/* ======================================================================
   Challenge: double the radius. Water (volume) ×8, paint (surface) ×4.
   ====================================================================== */
const CH_KEY = 'sphere.challengeGuess';
let challengeGuess: string | null = (() => {
  try {
    return localStorage.getItem(CH_KEY);
  } catch {
    return null;
  }
})();
let challengeRevealed = false;
const CH_TEXT: Record<string, string> = {
  paint: 'the paint',
  water: 'the water',
  same: 'that they grow the same',
  unsure: 'not sure',
};

document.querySelectorAll<HTMLButtonElement>('[data-cguess]').forEach((b) =>
  b.addEventListener('click', () => {
    challengeGuess = b.dataset.cguess!;
    try {
      localStorage.setItem(CH_KEY, challengeGuess);
    } catch {
      /* not remembered in private mode */
    }
    $('challenge-card').hidden = true;
    challengeRevealed = false;
    $('ch-reveal').hidden = true;
    setRadius(START_RADIUS);
    updateChallenge();
    board.focus({ preventScroll: true });
  }),
);

function updateChallenge(): void {
  const r = radius;
  const w0 = sphereVolume(START_RADIUS);
  const p0 = paintMl(sphereSurface(START_RADIUS));
  const w1 = sphereVolume(r);
  const p1 = paintMl(sphereSurface(r));
  $('ch-w0').textContent = fmt1(w0);
  $('ch-p0').textContent = fmt1(p0);
  $('ch-w1').textContent = fmt1(w1);
  $('ch-p1').textContent = fmt1(p1);
  const wm = w1 / w0;
  const pm = p1 / p0;
  const fmtX = (x: number) => `×${Math.round(x * 100) / 100}`;
  $('ch-wm').textContent = fmtX(wm);
  $('ch-pm').textContent = fmtX(pm);
  const doubled = r === START_RADIUS * 2;
  $('ch-wm').classList.toggle('hit', doubled);
  $('ch-pm').classList.toggle('hit', doubled);
  if (labMode === 'challenge') $('celebrate').hidden = !doubled;
  if (doubled && labMode === 'challenge' && challengeGuess && !challengeRevealed) {
    challengeRevealed = true;
    const g = challengeGuess;
    $('ch-reveal-guess').textContent =
      g === 'water'
        ? 'You guessed the water. Right!'
        : g === 'unsure'
          ? "You weren't sure. Here's the answer:"
          : `You guessed ${CH_TEXT[g]}. Here's what happened:`;
    renderTex($('ch-f1'), `V: \\; \\tfrac{4}{3}\\pi (2r)^3 = 8 \\cdot \\tfrac{4}{3}\\pi r^3`);
    renderTex($('ch-f2'), `S: \\; 4\\pi (2r)^2 = 4 \\cdot 4\\pi r^2`);
    $('ch-reveal').hidden = false;
    $('ch-nudge').hidden = true;
    $('sr-announce').textContent = 'Radius doubled. The water grew 8 times, the paint grew 4 times. The water grows faster.';
  }
}
document.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((t) =>
  t.addEventListener('click', () => setLabMode(t.dataset.mode as LabMode)),
);

/* ======================================================================
   Fill it
   ====================================================================== */
let waterT = 0;
const waterSlider = $<HTMLInputElement>('water');
const GUESS_KEY = 'sphere.fillGuess';
const GUESS_TEXT: Record<string, string> = {
  less: 'less than half',
  half: 'exactly half',
  more: 'more than half',
  unsure: 'not sure',
};
let fillGuess: string | null = readGuess();
let revealShown = false;

function readGuess(): string | null {
  try {
    return localStorage.getItem(GUESS_KEY);
  } catch {
    return null;
  }
}

function setWater(t: number): void {
  const v = clamp(t, 0, 1);
  if (v === waterT) return;
  waterT = v;
  if (labMode === 'fill') scene?.setWater(v);
  updateFill();
  if (v === 0.5 && fillGuess && !revealShown) showReveal();
}

function updateFill(): void {
  const r = radius;
  const h = 2 * r * waterT;
  const pct = fractionFull(r, h) * 100;
  $('r-pct').textContent = fmt1(pct);
  $('r-water').textContent = fmt1(waterVolume(r, h));
  $('r-cap').textContent = fmt1(sphereVolume(r));
  $('r-h').textContent = fmtRadius(Math.round(h * 10) / 10);
  $('r-2r').textContent = fmtRadius(2 * r);
  const sliderVal = Math.round(waterT * 100);
  if (waterSlider.valueAsNumber !== sliderVal) waterSlider.value = String(sliderVal);
  waterSlider.setAttribute('aria-valuetext', `${sliderVal}% of the height, ${fmt1(pct)}% full`);
  scene?.setWaterLabel(`${Math.round(pct)}%`);
  renderTex(
    $('f-water'),
    `V_{\\text{water}} = \\tfrac{\\pi h^2 (3r - h)}{3} \\approx ${fmt1(waterVolume(r, h)).replace(/,/g, '{,}')}\\text{ mL}`,
  );
  drawGraphDot(waterT, pct / 100);
}

/* Graph: water height (% of sphere height) across, % full up. Same curve for every radius. */
const G = { x0: 34, x1: 240, y0: 140, y1: 12 };
const gx = (t: number) => G.x0 + (G.x1 - G.x0) * t;
const gy = (f: number) => G.y0 - (G.y0 - G.y1) * f;
(function drawGraph() {
  const svg = $('fill-graph');
  const ns = 'http://www.w3.org/2000/svg';
  const grid = svg.querySelector('.grid-lines')!;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    const lx = document.createElementNS(ns, 'line');
    lx.setAttribute('x1', String(gx(v)));
    lx.setAttribute('x2', String(gx(v)));
    lx.setAttribute('y1', String(G.y0));
    lx.setAttribute('y2', String(G.y1));
    const ly = document.createElementNS(ns, 'line');
    ly.setAttribute('x1', String(G.x0));
    ly.setAttribute('x2', String(G.x1));
    ly.setAttribute('y1', String(gy(v)));
    ly.setAttribute('y2', String(gy(v)));
    if (v === 0) {
      lx.setAttribute('class', 'axis');
      ly.setAttribute('class', 'axis');
    }
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', String(gx(v)));
    tx.setAttribute('y', String(G.y0 + 14));
    tx.setAttribute('text-anchor', 'middle');
    tx.textContent = `${v * 100}%`;
    const ty = document.createElementNS(ns, 'text');
    ty.setAttribute('x', String(G.x0 - 5));
    ty.setAttribute('y', String(gy(v) + 3.5));
    ty.setAttribute('text-anchor', 'end');
    ty.textContent = `${v * 100}`;
    grid.append(lx, ly, tx, ty);
  }
  let d = '';
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    d += `${i ? 'L' : 'M'}${gx(t).toFixed(1)},${gy(fractionFull(1, 2 * t)).toFixed(1)}`;
  }
  svg.querySelector('.curve')!.setAttribute('d', d);
})();

function drawGraphDot(t: number, f: number): void {
  const svg = $('fill-graph');
  const x = gx(t);
  const y = gy(f);
  const dot = svg.querySelector('.dot')!;
  dot.setAttribute('cx', x.toFixed(1));
  dot.setAttribute('cy', y.toFixed(1));
  const gxl = svg.querySelector('.guide-x')!;
  gxl.setAttribute('x1', x.toFixed(1));
  gxl.setAttribute('x2', x.toFixed(1));
  gxl.setAttribute('y1', String(G.y0));
  gxl.setAttribute('y2', y.toFixed(1));
  const gyl = svg.querySelector('.guide-y')!;
  gyl.setAttribute('x1', String(G.x0));
  gyl.setAttribute('x2', x.toFixed(1));
  gyl.setAttribute('y1', y.toFixed(1));
  gyl.setAttribute('y2', y.toFixed(1));
}

/* Predict first, then reveal when the water reaches halfway. */
document.querySelectorAll<HTMLButtonElement>('[data-guess]').forEach((b) =>
  b.addEventListener('click', () => {
    fillGuess = b.dataset.guess!;
    try {
      localStorage.setItem(GUESS_KEY, fillGuess);
    } catch {
      /* private mode: the guess just isn't remembered */
    }
    $('predict-card').hidden = true;
    $('fill-nudge').hidden = false;
    if (waterT === 0) setWater(0.1);
    board.focus({ preventScroll: true });
  }),
);

function showReveal(): void {
  revealShown = true;
  $('fill-nudge').hidden = true;
  const g = fillGuess ?? 'unsure';
  $('fill-reveal-guess').textContent =
    g === 'half'
      ? 'You predicted exactly half. Spot on!'
      : g === 'unsure'
        ? "You weren't sure. Here's the answer:"
        : `You predicted ${GUESS_TEXT[g]}. Here's what happens:`;
  $('fill-reveal').hidden = false;
  $('sr-announce').textContent = 'Halfway up: exactly 50 percent full. A quarter of the way up: only 15.6 percent full.';
}
$('show-quarter').addEventListener('click', () => {
  countGrab();
  setWater(0.25);
});
waterSlider.addEventListener('input', () => setWater(snapWater(waterSlider.valueAsNumber / 100)));
waterSlider.addEventListener('change', () => countGrab());
$('water-empty').addEventListener('click', () => setWater(0));

function updateHint(): void {
  const hand = mode === 'hand';
  const resize = hand ? 'Pinch the <span class="hl">yellow dot</span> to resize' : 'Drag the <span class="hl">yellow dot</span> to resize';
  const water = hand ? 'pinch the <span class="hl-water">blue dot</span> to fill' : 'drag the <span class="hl-water">blue dot</span> to fill';
  const paint = hand ? 'pinch the <span class="hl-paint">coral dot</span> to paint' : 'drag the <span class="hl-paint">coral dot</span> to paint';
  const spin = hand ? 'make a <span class="hl">fist</span> to spin' : 'drag anywhere else to spin';
  const cut = hand ? 'pinch the <span class="hl-chalk">white knife dot</span> to move the cut' : 'drag the <span class="hl-chalk">white knife dot</span> to move the cut';
  if (labMode === 'cut' && splitK > 0) {
    $('board-hint').innerHTML = hand
      ? 'Make a <span class="hl">fist</span> and move to spin the halves · see the yellow new faces'
      : 'Drag to spin the halves · see the <span class="hl">yellow</span> new faces';
    return;
  }
  if (labMode === 'challenge') {
    $('board-hint').innerHTML = `${resize} from 5 cm to 10 cm · ${spin}`;
    return;
  }
  const first = labMode === 'fill' ? water : labMode === 'paint' ? paint : labMode === 'cut' ? cut : null;
  const text = first ? `${first} · ${resize.toLowerCase()} · ${spin}` : `${resize} · ${spin}`;
  $('board-hint').innerHTML = text.charAt(0).toUpperCase() + text.slice(1);
}

/* ======================================================================
   Cut it
   ====================================================================== */
/** Cutting plane height as a fraction of r (−1 bottom … 1 top). Starts halfway up. */
let cutC = 0.5;
/** 0 = whole, 1 = halves fully apart. */
let splitK = 0;
/** 0 = new faces bare (yellow), 1 = halves painted. */
let halvesPaint = 0;
let cutAnim = 0;
const cutSlider = $<HTMLInputElement>('cut');

function setCutD(dCm: number): void {
  const c = clamp(dCm / radius, -1, 1);
  if (c === cutC) return;
  cutC = c;
  if (labMode === 'cut') scene?.setCut(c);
  updateCut();
}

function updateCut(): void {
  const r = radius;
  const d = cutC * r;
  const dTxt = fmtRadius(Math.round(Math.abs(d) * 10) / 10);
  $('c-d').textContent = dTxt;
  $('c-dir').textContent = Math.abs(d) < 0.05 ? 'from' : d > 0 ? 'above' : 'below';
  $('c-area').textContent = fmt1(crossSectionArea(r, d));
  $('c-new').textContent = fmt1(cutNewSurface(r, d));
  const sv = Math.round(cutC * 100);
  if (cutSlider.valueAsNumber !== sv) cutSlider.value = String(sv);
  cutSlider.setAttribute('aria-valuetext', `${dTxt} centimeters ${$('c-dir').textContent} the center`);
  renderTex(
    $('f-cut'),
    `\\pi (r^2 - d^2) = \\pi (${fmtRadius(r)}^2 - ${dTxt}^2) \\approx ${fmt1(crossSectionArea(r, d)).replace(/,/g, '{,}')}`,
  );
  // After the cut (always through the center).
  const V = sphereVolume(r);
  const S = sphereSurface(r);
  $('ca-v0').textContent = fmt1(V);
  $('ca-v1').textContent = fmt1(hemisphereVolume(r));
  $('ca-s0').textContent = fmt1(S);
  $('ca-s1').textContent = fmt1(hemisphereSurface(r));
  $('ca-p0').textContent = fmt1(paintMl(S));
  $('ca-p1').textContent = fmt1(paintMl(surfaceAfterCut(r, 0)));
  $('ca-pd').textContent = fmt1(paintMl(cutNewSurface(r, 0)));
  $('ca-new').textContent = fmt1(cutNewSurface(r, 0));
  renderTex(
    $('f-half'),
    `\\underbrace{2\\pi r^2}_{\\text{dome}} + \\underbrace{\\pi r^2}_{\\text{flat face}} = 3\\pi r^2 \\text{ per half}`,
  );
  updateCutLabel();
}

function updateCutLabel(): void {
  const extra = fmt1(paintMl(cutNewSurface(radius, 0)));
  const painted = halvesPaint >= 1;
  scene?.setCutLabel(painted ? `painted: +${extra} mL` : 'new surface that needs paint');
  document.querySelector('.cut-label')?.classList.toggle('painted', painted);
  document.querySelector('.legend')?.classList.toggle('painted', painted);
}

function stopCutAnim(): void {
  cancelAnimationFrame(cutAnim);
  cutAnim = 0;
}

/** Tween a value over `ms` (instant with reduced motion), calling `apply` each frame. */
function tween(from: number, to: number, ms: number, apply: (v: number) => void, done?: () => void): void {
  stopCutAnim();
  if (reducedMotion.matches || ms <= 0) {
    apply(to);
    done?.();
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    apply(from + (to - from) * e);
    if (k < 1) cutAnim = requestAnimationFrame(step);
    else {
      cutAnim = 0;
      done?.();
    }
  };
  cutAnim = requestAnimationFrame(step);
}

function setSplitK(k: number): void {
  splitK = k;
  scene?.setSplit(k);
}

function showCutState(split: boolean): void {
  $('cut-before').hidden = split;
  $('cut-after').hidden = !split;
  $('cut-go').hidden = split;
  $('cut-repaint').hidden = !split;
  $('cut-join').hidden = !split;
  scene?.setRadiusUi(!split);
  updateHint();
}

/** Cut in half: slide the plane to the center, then move the halves apart. */
$('cut-go').addEventListener('click', () => {
  countGrab();
  const fromC = cutC;
  tween(fromC, 0, 500 * Math.abs(fromC), (v) => setCutD(v * radius), () => {
    setCutD(0);
    showCutState(true);
    tween(0, 1, 900, setSplitK, () => {
      updateCutLabel();
      $('sr-announce').textContent =
        `Cut in half. Volume unchanged: 2 halves of ${fmt1(hemisphereVolume(radius))} milliliters. ` +
        `Surface area up 50 percent, to ${fmt1(surfaceAfterCut(radius, 0))} square centimeters. Paint needed: ${fmt1(paintMl(surfaceAfterCut(radius, 0)))} milliliters.`;
    });
  });
});

$('cut-repaint').addEventListener('click', () => {
  countGrab();
  tween(halvesPaint, 1, 1200, (v) => {
    halvesPaint = v;
    scene?.setHalvesPaint(v);
  }, () => {
    updateCutLabel();
    $('cut-note').textContent = `Painting both halves takes ${$('ca-p1').textContent} mL: ${$('ca-pd').textContent} mL more than the whole sphere, just for the two new faces.`;
    $('sr-announce').textContent = $('cut-note').textContent;
  });
});

$('cut-join').addEventListener('click', () => {
  countGrab();
  tween(splitK, 0, 700, setSplitK, () => {
    halvesPaint = 0;
    scene?.setHalvesPaint(0);
    showCutState(false);
    updateCutLabel();
    $('cut-note').innerHTML = 'Spin the halves to see the flat faces. Then press <strong>Paint it again</strong> on the board.';
  });
});

cutSlider.addEventListener('input', () => setCutD(snapCut((cutSlider.valueAsNumber / 100) * radius, radius)));
cutSlider.addEventListener('change', () => countGrab());

/* ======================================================================
   Paint it
   ====================================================================== */
/** How far the paint has swept, from the top (0) to the bottom (1). */
let paintP = 0;
let paintAnim = 0;
const paintSlider = $<HTMLInputElement>('paint');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function setPaint(p: number): void {
  const v = clamp(p, 0, 1);
  if (v === paintP) return;
  paintP = v;
  if (labMode === 'paint') scene?.setPaint(v);
  updatePaint();
}

function updatePaint(): void {
  const r = radius;
  const S = sphereSurface(r);
  const area = zoneArea(r, 2 * r * paintP);
  const total = paintMl(S);
  const used = paintMl(area);
  const pct = Math.round(paintP * 100);
  $('p-used').textContent = fmt1(used);
  $('p-total').textContent = fmt1(total);
  $('p-left').textContent = fmt1(total - used);
  $('p-area').textContent = fmt1(area);
  $('p-surface').textContent = fmt1(S);
  $('p-pct').textContent = String(pct);
  $('can-text').textContent = `${fmt1(total - used)} mL`;
  // The can starts with exactly enough paint, and empties as the band sweeps down.
  const h = 80 * (1 - paintP);
  $('can-paint').setAttribute('y', String(22 + 80 - h));
  $('can-paint').setAttribute('height', String(h));
  if (paintSlider.valueAsNumber !== pct) paintSlider.value = String(pct);
  paintSlider.setAttribute('aria-valuetext', `${pct}% painted, ${fmt1(used)} milliliters of paint`);
  scene?.setPaintLabel(`${fmt1(used)} mL`);
  renderTex(
    $('f-paint'),
    `A_{\\text{painted}} = 2\\pi r d = 2\\pi (${fmtRadius(r)})(${fmtRadius(Math.round(2 * r * paintP * 10) / 10)}) \\approx ${fmt1(area).replace(/,/g, '{,}')}\\text{ cm}^2`,
  );
}

function stopPaintAnim(): void {
  cancelAnimationFrame(paintAnim);
  paintAnim = 0;
}

function announcePaint(): void {
  $('sr-announce').textContent = `${Math.round(paintP * 100)} percent painted. ${$('p-used').textContent} milliliters of paint used out of ${$('p-total').textContent}.`;
}

/** "Paint it!": sweep the band down to the bottom over about 3 seconds. */
$('paint-go').addEventListener('click', () => {
  countGrab();
  stopPaintAnim();
  if (paintP >= 1) setPaint(0);
  if (reducedMotion.matches) {
    setPaint(1);
    announcePaint();
    return;
  }
  const from = paintP;
  const start = performance.now();
  const dur = 3000 * (1 - from);
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / Math.max(1, dur));
    setPaint(from + (1 - from) * k);
    if (k < 1) paintAnim = requestAnimationFrame(step);
    else {
      paintAnim = 0;
      announcePaint();
    }
  };
  paintAnim = requestAnimationFrame(step);
});
$('paint-wipe').addEventListener('click', () => {
  stopPaintAnim();
  setPaint(0);
  announcePaint();
});
paintSlider.addEventListener('input', () => {
  stopPaintAnim();
  setPaint(paintSlider.valueAsNumber / 100);
});
paintSlider.addEventListener('change', () => {
  countGrab();
  announcePaint();
});

function announce(): void {
  const S = sphereSurface(radius);
  $('sr-announce').textContent =
    `Radius ${fmtRadius(radius)} centimeters. Volume ${fmt1(sphereVolume(radius))} milliliters. ` +
    `Surface area ${fmt1(S)} square centimeters. Paint ${fmt1(paintMl(S))} milliliters.`;
}

/* ======================================================================
   Grabbing: shared by mouse, touch and hand
   ====================================================================== */
type Grab =
  | { kind: 'resize'; startR: number; startDist: number; cx: number; cy: number }
  | { kind: 'water' }
  | { kind: 'paint' }
  | { kind: 'cut' }
  | { kind: 'rotate'; x: number; y: number };
let grab: Grab | null = null;
const board = $('board');

function nearHandle(x: number, y: number, loose: boolean): boolean {
  if (!scene || !scene.isRadiusUiOn()) return false;
  const h = scene.handleScreen();
  return Math.hypot(x - h.x, y - h.y) < (loose ? 56 : 34);
}

/** Which mode handle (water or paint) is under the point, if any. */
type TrackKind = 'water' | 'paint' | 'cut';
const TRACK_FOR: Record<LabMode, TrackKind | null> = { fill: 'water', paint: 'paint', cut: 'cut', challenge: null };

function trackAt(x: number, y: number, loose: boolean): TrackKind | null {
  if (!scene) return null;
  const kind = TRACK_FOR[labMode];
  if (!kind) return null;
  const h =
    kind === 'water' ? scene.waterHandleScreen() : kind === 'paint' ? scene.paintHandleScreen() : scene.cutHandleScreen();
  if (!h || Math.hypot(x - h.x, y - h.y) >= (loose ? 56 : 34)) return null;
  return kind;
}

function setTrackHover(kind: TrackKind | null): void {
  scene?.setWaterHover(kind === 'water');
  scene?.setPaintHover(kind === 'paint');
  scene?.setCutHover(kind === 'cut');
}

/** Start whichever grab the point is on: water/paint handle, radius handle, or spin. */
function startAt(x: number, y: number, loose: boolean, allowRotate: boolean): void {
  const t = trackAt(x, y, loose);
  if (t) {
    countGrab();
    if (t === 'paint') stopPaintAnim();
    if (t === 'cut') stopCutAnim();
    grab = { kind: t };
    moveGrab(x, y);
  } else if (nearHandle(x, y, loose)) startResize(x, y);
  else if (allowRotate) startRotate(x, y);
}

function startResize(x: number, y: number): void {
  if (!scene) return;
  countGrab();
  const c = scene.centerScreen();
  grab = { kind: 'resize', startR: radius, startDist: Math.max(24, Math.hypot(x - c.x, y - c.y)), cx: c.x, cy: c.y };
}

function startRotate(x: number, y: number): void {
  if (!scene) return;
  countGrab();
  grab = { kind: 'rotate', x, y };
}

function moveGrab(x: number, y: number): void {
  if (!scene || !grab) return;
  if (grab.kind === 'rotate') {
    scene.rotateBy((x - grab.x) * 0.011, (y - grab.y) * 0.011);
    grab.x = x;
    grab.y = y;
  } else if (grab.kind === 'water') {
    setWater(snapWater(scene.waterTFromScreenY(y)));
  } else if (grab.kind === 'paint') {
    setPaint(snapWater(scene.paintPFromScreenY(y)));
  } else if (grab.kind === 'cut') {
    setCutD(snapCut(scene.cutCFromScreenY(y) * radius, radius));
  } else {
    setRadius(snapRadius((grab.startR * Math.hypot(x - grab.cx, y - grab.cy)) / grab.startDist));
  }
}

function endGrab(): void {
  if (grab?.kind === 'resize') announce();
  if (grab?.kind === 'paint') announcePaint();
  if (grab?.kind === 'cut')
    $('sr-announce').textContent = `Cutting plane ${$('c-d').textContent} centimeters ${$('c-dir').textContent} the center. Cross-section ${$('c-area').textContent} square centimeters.`;
  if (grab?.kind === 'water')
    $('sr-announce').textContent = `Water at ${Math.round(waterT * 100)} percent of the height: ${$('r-pct').textContent} percent full.`;
  grab = null;
}

/* Mouse / touch / pen. Drag the handle to resize, drag anywhere else to spin. */
board.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button, .cam-card, .board-banner')) return;
  const b = board.getBoundingClientRect();
  const x = e.clientX - b.left;
  const y = e.clientY - b.top;
  board.setPointerCapture(e.pointerId);
  startAt(x, y, e.pointerType !== 'mouse', true);
});
board.addEventListener('pointermove', (e) => {
  const b = board.getBoundingClientRect();
  const x = e.clientX - b.left;
  const y = e.clientY - b.top;
  if (grab) moveGrab(x, y);
  else if (e.pointerType === 'mouse') {
    const t = trackAt(x, y, false);
    const near = !t && nearHandle(x, y, false);
    scene?.setHandleHover(near);
    setTrackHover(t);
    board.classList.toggle('over-handle', near);
    board.classList.toggle('over-water', t === 'water');
    board.classList.toggle('over-paint', t === 'paint');
    board.classList.toggle('over-cut', t === 'cut');
  }
});
board.addEventListener('pointerup', endGrab);
board.addEventListener('pointercancel', endGrab);

/* Keyboard and buttons. */
function nudge(d: number): void {
  countGrab();
  setRadius(snapRadius(Math.round((radius + d) * 2) / 2));
  announce();
}

board.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement) !== board) return;
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
      nudge(0.5);
      break;
    case '-':
    case '_':
      nudge(-0.5);
      break;
    case 'PageUp':
    case 'PageDown':
      if (labMode === 'fill') {
        countGrab();
        setWater(snapWater(waterT + (e.key === 'PageUp' ? 0.05 : -0.05)));
        $('sr-announce').textContent = `Water ${Math.round(waterT * 100)} percent of the height, ${$('r-pct').textContent} percent full.`;
      } else if (labMode === 'paint') {
        countGrab();
        stopPaintAnim();
        // Page Down paints further down; Page Up takes paint back off.
        setPaint(snapWater(paintP + (e.key === 'PageDown' ? 0.05 : -0.05)));
        announcePaint();
      } else if (labMode === 'cut' && splitK === 0) {
        countGrab();
        stopCutAnim();
        setCutD(snapCut((cutC + (e.key === 'PageUp' ? 0.1 : -0.1)) * radius, radius));
        $('sr-announce').textContent = `Cutting plane ${$('c-d').textContent} centimeters ${$('c-dir').textContent} the center. Cross-section ${$('c-area').textContent} square centimeters.`;
      } else return;
      break;
    default:
      return;
  }
  e.preventDefault();
});

slider.addEventListener('input', () => setRadius(snapRadius(slider.valueAsNumber)));
slider.addEventListener('change', () => {
  countGrab();
  announce();
});
$('r-plus').addEventListener('click', () => nudge(0.5));
$('r-minus').addEventListener('click', () => nudge(-0.5));
$('r-reset').addEventListener('click', () => {
  setRadius(START_RADIUS);
  announce();
});
$('reset-view').addEventListener('click', () => scene?.resetView());

/* ======================================================================
   Hand mode
   ====================================================================== */
const camView = $('cam-view');
const camVideo = $<HTMLVideoElement>('cam-video');
const camOverlay = $<HTMLCanvasElement>('cam-overlay');
const handCursor = $('hand-cursor');
let mode: 'hand' | 'mouse' = 'mouse';
let cameraAllowedTracked = false;

const tracker = new HandTracker(camVideo, {
  onState: renderCamState,
  onHand: handleHand,
  onBrightness: (b) => {
    brightness = b;
  },
  onFps: (fps) => {
    if (fps < 10 && !slowWarned && mode === 'hand') {
      slowWarned = true;
      if (current === 'handcheck') showHcTip(TIP_SLOW);
      else showBanner(TIP_SLOW);
    }
  },
});

function renderCamState(state: TrackerState): void {
  $('cam-status').dataset.state = state;
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
  // Count "no hand" time from when tracking starts, not from page load.
  if (state === 'on') lastHandAt = performance.now();
  if (state === 'on' && camVideo.videoWidth) {
    camView.style.aspectRatio = `${camVideo.videoWidth} / ${camVideo.videoHeight}`;
    gestures.setAspect(camVideo.videoWidth / camVideo.videoHeight);
  }
  placeCamera();
  if (current === 'handcheck') updateHandcheck();
}

/** One camera view: big in the hand check, picture-in-picture on the board in the lab. */
function placeCamera(): void {
  const mini = $('mini-cam-slot');
  const on = tracker.state !== 'off';
  if (on && current === 'handcheck') {
    $('handcheck-slot').appendChild(camView);
    mini.hidden = true;
  } else if (on && current === 'lab') {
    mini.appendChild(camView);
    mini.hidden = false;
  } else {
    document.body.appendChild(camView);
    mini.hidden = true;
  }
}

function setMode(m: 'hand' | 'mouse'): void {
  mode = m;
  $('mode-hand').setAttribute('aria-pressed', String(m === 'hand'));
  $('mode-mouse').setAttribute('aria-pressed', String(m === 'mouse'));
  updateHint();
  if (m === 'mouse') {
    tracker.stop();
    endHandGrab();
    handCursor.hidden = true;
    $('hold-hint').hidden = true;
  }
}

function useMouse(): void {
  setMode('mouse');
  $('cam-card').hidden = true;
  clearBanner();
  if (current !== 'lab' && current !== 'wrap') go('lab');
}
document.querySelectorAll('[data-action="use-mouse"]').forEach((b) => b.addEventListener('click', useMouse));
$('mode-mouse').addEventListener('click', useMouse);
$('stop-cam').addEventListener('click', useMouse);

$('mode-hand').addEventListener('click', () => {
  if (tracker.isOn) return;
  $('camera-error').hidden = true;
  $('cam-card').hidden = false;
  $('cam-card-title').focus();
});
$('btn-allow').addEventListener('click', () => startCamera('card'));
$('btn-allow-step').addEventListener('click', () => startCamera('step'));
$('btn-retry-step').addEventListener('click', () => startCamera('step'));

const ERRORS: Record<CameraErrorKind, [string, string]> = {
  denied: [
    'The camera is blocked. No problem!',
    "Your browser didn't share the camera, so you can use the mouse instead. To try again, click the camera icon in the address bar, choose Allow, then press Turn on camera.",
  ],
  'no-camera': [
    "We couldn't find a camera",
    "This device doesn't seem to have a webcam, or it's turned off. Mouse and touch mode give you the same sphere.",
  ],
  'in-use': [
    'The camera is busy',
    'Another app or tab might be using the camera. Close it, then press Turn on camera. Or use the mouse instead.',
  ],
  insecure: [
    'The camera needs a secure page',
    'Browsers only share the camera on pages that start with https://. Ask your teacher for the https link, or use the mouse instead.',
  ],
  unsupported: ["This browser can't share the camera", 'Try a recent version of Chrome, or use the mouse instead.'],
  'tracker-failed': [
    "Hand tracking couldn't start",
    'This device might not support the hand tracker. Mouse mode works everywhere and shows exactly the same thing.',
  ],
  'tracker-timeout': [
    'Hand tracking is taking too long to load',
    'Your device or the network may be slow right now. Use the mouse instead, or press Turn on camera to try again.',
  ],
};

/** Start the camera from the camera step (then hand check) or from the card on the board. */
async function startCamera(from: 'step' | 'card'): Promise<void> {
  $('camera-error').hidden = true;
  $('step-camera-error').hidden = true;
  $('cam-card').hidden = true;
  setMode('hand');
  if (from === 'step') go('handcheck');
  try {
    await tracker.start();
  } catch (err) {
    const kind: CameraErrorKind = err instanceof CameraError ? err.kind : 'unsupported';
    setMode('mouse');
    const [title, body] = ERRORS[kind];
    if (from === 'step') {
      go('camera');
      $('step-camera-error-title').textContent = title;
      $('step-camera-error-body').textContent = body;
      $('step-camera-error').hidden = false;
      $('step-camera-error').focus();
    } else {
      $('camera-error-title').textContent = title;
      $('camera-error-body').textContent = body;
      $('camera-error').hidden = false;
      $('cam-card').hidden = false;
      $('camera-error').focus();
    }
  }
}

/* Hand check: hand seen, pinch, fist. */
let hcSeen = false;
let hcPinch = false;
let hcFist = false;
function updateHandcheck(gesture?: Gesture): void {
  $('hc-see').classList.toggle('done', hcSeen);
  $('hc-pinch').classList.toggle('done', hcPinch);
  $('hc-fist').classList.toggle('done', hcFist);
  const st = $('hc-status');
  if (tracker.state === 'starting') st.textContent = 'Waiting for camera permission…';
  else if (tracker.state === 'loading') st.textContent = 'Loading the hand tracker. The first time can take a few seconds…';
  else if (tracker.state === 'off') st.textContent = 'Camera is off.';
  else if (!hcSeen) st.textContent = 'Hold your hand up in good light.';
  else if (gesture === 'pinch') st.textContent = 'Pinch! That is how you grab a handle.';
  else if (gesture === 'fist') st.textContent = 'Fist! That is how you spin the sphere.';
  else if (!hcPinch) st.textContent = 'I see your hand! Now try a pinch.';
  else if (!hcFist) st.textContent = 'Nice pinch. Now make a fist.';
  else st.textContent = "You're ready. Press Continue.";
}
function showHcTip(text: string | null): void {
  $('hc-tip').hidden = !text;
  if (text) $('hc-tip').textContent = text;
}

/* Hand input → cursor, pinch and fist. */
const gestures = new HandGestures();
let lastGesture: Gesture = 'open';
let lastHandAt = 0;
let brightness = 1;
let slowWarned = false;
let pressedButton: HTMLButtonElement | null = null;

function handleHand(points: Float32Array | null): void {
  const now = performance.now();
  if (mode !== 'hand') return;
  if (!points) {
    drawSkeleton(camOverlay, null, false);
    const g = gestures.lost(now / 1000);
    if (g === 'open' && lastGesture !== 'open') {
      endHandGrab();
      lastGesture = 'open';
    }
    if (g === 'open') handCursor.hidden = true;
    return;
  }
  lastHandAt = now;
  $('hold-hint').hidden = true;
  if (bannerTip === TIP_NO_HAND || bannerTip === TIP_DARK) clearBanner();

  const s = gestures.update(points, now / 1000);
  drawSkeleton(camOverlay, s.points, s.gesture === 'pinch');
  if (current === 'handcheck') {
    hcSeen = true;
    if (s.gesture === 'pinch') hcPinch = true;
    if (s.gesture === 'fist') hcFist = true;
    showHcTip(null);
    updateHandcheck(s.gesture);
    lastGesture = s.gesture;
    return;
  }
  if (current !== 'lab') return;
  const x = s.x * board.clientWidth;
  const y = s.y * board.clientHeight;

  if (s.gesture !== lastGesture) {
    endHandGrab();
    if (s.gesture === 'pinch') {
      const btn = buttonAt(x, y);
      if (btn) {
        pressedButton = btn;
        btn.classList.add('pinch-press');
      } else startAt(x, y, true, false);
    } else if (s.gesture === 'fist') startRotate(x, y);
  } else if (grab) moveGrab(x, y);

  const nearT = !grab && s.gesture === 'open' ? trackAt(x, y, true) : null;
  if (!grab && s.gesture === 'open') {
    setTrackHover(nearT);
    scene?.setHandleHover(!nearT && nearHandle(x, y, true));
  }
  lastGesture = s.gesture;

  handCursor.hidden = false;
  handCursor.style.transform = `translate(${x}px, ${y}px)`;
  handCursor.classList.toggle('pinched', s.gesture === 'pinch');
  handCursor.classList.toggle('fist', s.gesture === 'fist');
  handCursor.classList.toggle(
    'near',
    s.gesture !== 'fist' && (grab?.kind === 'resize' || grab?.kind === 'water' || grab?.kind === 'paint' || grab?.kind === 'cut' || (!grab && (!!nearT || nearHandle(x, y, true)))),
  );
}

/** Release whatever the hand was holding. A pinch on a button "clicks" it on release. */
function endHandGrab(): void {
  if (pressedButton) {
    pressedButton.classList.remove('pinch-press');
    pressedButton.click();
    pressedButton = null;
  }
  endGrab();
}

/** An on-board button under the hand cursor, if any (e.g. Reset view, and the mode tabs later). */
function buttonAt(x: number, y: number): HTMLButtonElement | null {
  const b = board.getBoundingClientRect();
  const el = document.elementFromPoint(b.left + x, b.top + y);
  const btn = el?.closest('button');
  return btn && board.contains(btn) && !btn.disabled ? btn : null;
}

/* "Hold your hand up", low light and slow device. The sphere keeps its state meanwhile. */
const TIP_NO_HAND =
  "I can't see your hand. Hold it up with your palm facing the screen, about an arm's length from the camera.";
const TIP_DARK = "It's a bit dark, so your hand is hard to see. Try facing a window or turning on a light.";
const TIP_SLOW = 'Hand tracking is running slowly on this device, so the sphere may lag. Mouse mode will feel smoother.';
let bannerTip: string | null = null;

function showBanner(text: string): void {
  bannerTip = text;
  $('board-banner-text').textContent = text;
  $('board-banner').hidden = false;
}
function clearBanner(): void {
  bannerTip = null;
  $('board-banner').hidden = true;
}
$('banner-dismiss').addEventListener('click', clearBanner);

setInterval(() => {
  if (tracker.state !== 'on' || mode !== 'hand') return;
  const gone = performance.now() - lastHandAt;
  if (current === 'handcheck') {
    if (gone > 5000) showHcTip(brightness < 0.2 ? TIP_DARK : TIP_NO_HAND);
    return;
  }
  if (current !== 'lab') return;
  if (gone > 600) $('hold-hint').hidden = false;
  if (gone > 6000 && !bannerTip) showBanner(brightness < 0.2 ? TIP_DARK : TIP_NO_HAND);
}, 300);

/* ======================================================================
   Recording view: hides extra interface, enlarges the numbers, keeps the webcam PiP.
   ====================================================================== */
$('rec-toggle').addEventListener('click', () => {
  const on = !document.body.classList.contains('recording');
  document.body.classList.toggle('recording', on);
  $('rec-toggle').setAttribute('aria-pressed', String(on));
  if (on && current !== 'lab') go('lab');
});

updateReadout();
setLabMode('fill');
go('intro');
