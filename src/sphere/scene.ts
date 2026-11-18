/**
 * The Sphere Lab sphere, drawn like chalk on a board: a see-through fill,
 * faint latitude/longitude lines (dimmer on the back, so rotation reads),
 * an exact silhouette outline, a dashed radius with a yellow handle, and a soft shadow.
 * Fill mode adds water (a clipped inner sphere + a flat surface disc) that stays level
 * while the sphere spins, and a blue water-level handle on a track with ¼ ½ ¾ ticks.
 * Paint mode adds a coral layer (a slightly larger sphere, clipped by a plane that
 * sweeps from the sphere's top down, in the sphere's own frame so the paint turns with it),
 * a "wet edge" ring, and a coral brush handle on a track on the left.
 * Cut mode adds a cutting plane with its yellow cross-section (in the sphere's frame),
 * a cut handle on the right track, and two hemispheres that slide apart with yellow
 * flat faces (the new surface), which "Paint it again" turns coral.
 * Standard WebGL, modest polygon counts, simple transparency, render-on-change.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { MAX_RADIUS, MIN_RADIUS, START_RADIUS, clamp, fmtRadius } from './math';

/** World units per cm. r = 12 cm fills most of the board height. */
const WORLD_PER_CM = 0.2;
const START_TILT = 0.38;
const START_SPIN = -0.5;
/** Handle sits on the outline at this angle (up and to the right). */
const HANDLE_ANGLE = (38 * Math.PI) / 180;
/** Water track sits this far right of the center, in sphere radii. */
const TRACK_X = 1.22;

export interface ScreenPoint {
  x: number;
  y: number;
}

export class SphereScene {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  /** Scaled to the radius and rotated by the student. */
  private ball = new THREE.Group();
  private outline: LineSegments2;
  private radiusLine: LineSegments2;
  private radiusGeo = new LineSegmentsGeometry();
  private handle: THREE.Mesh;
  private shadow: THREE.Mesh;
  private lineMats: LineMaterial[] = [];
  private label: HTMLElement;
  private radius = START_RADIUS;
  private hover = false;
  private dirty = true;
  private raf = 0;
  private ro: ResizeObserver;
  private tmp = new THREE.Vector3();
  private u = new THREE.Vector3();
  private v = new THREE.Vector3();
  /** Water: fraction of the sphere's height (0..1), or null when hidden. */
  private waterT: number | null = null;
  private water = new THREE.Group();
  private waterBody: THREE.Mesh;
  private waterSurface: THREE.Mesh;
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private waterHandle: THREE.Mesh;
  private track: LineSegments2;
  private trackGeo = new LineSegmentsGeometry();
  private waterLabel: HTMLElement;
  private hoverWater = false;
  /** Paint: fraction of the sweep from top (0) to bottom (1), or null when hidden. */
  private paintP: number | null = null;
  private paintBody: THREE.Mesh;
  private paintEdge: LineSegments2;
  private paintLocalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private paintPlane = new THREE.Plane();
  private paintHandle: THREE.Mesh;
  private paintTrack: LineSegments2;
  private paintTrackGeo = new LineSegmentsGeometry();
  private paintLabel: HTMLElement;
  private hoverPaint = false;
  /** Cut: plane height as a fraction of the radius (−1..1), or null when hidden. */
  private cutC: number | null = null;
  /** 0 = whole sphere, 1 = hemispheres fully apart. */
  private split = 0;
  private cutPlaneMesh: THREE.Mesh;
  private cutDisc: THREE.Mesh;
  private cutRing: LineSegments2;
  private cutHandle: THREE.Mesh;
  private hoverCut = false;
  private halves = new THREE.Group();
  private halfTop: THREE.Group;
  private halfBottom: THREE.Group;
  private halfFills: THREE.MeshLambertMaterial[] = [];
  private faceMats: THREE.MeshBasicMaterial[] = [];
  private cutLabel: HTMLElement;
  private radiusUi = true;

  constructor(container: HTMLElement) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 1.1, 12);
    this.camera.lookAt(0, 0, 0);

    const sphereGeo = new THREE.SphereGeometry(1, 48, 32);

    // 1) Depth-only sphere, so grid lines behind it can be drawn dimmer.
    const depth = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    );
    depth.renderOrder = 0;

    // 2) Latitude / longitude lines: brighter in front, faint behind.
    const grid = latLongGeometry();
    const front = new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({ color: 0xc9e2f6, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    front.renderOrder = 3.5;
    const back = new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({
        color: 0xc9e2f6,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        depthFunc: THREE.GreaterDepth,
      }),
    );
    back.renderOrder = 2;

    // 3) See-through chalk-blue fill with simple shading.
    const fill = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshLambertMaterial({ color: 0xc9e2f6, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    fill.renderOrder = 3;

    this.ball.add(depth, front, back, fill);

    // Water: an inner sphere clipped at the water level, plus a flat surface disc.
    // It lives outside `ball`, so it stays level while the sphere spins.
    // depthTest is off so the outer sphere's depth pass doesn't hide it; draw order does the layering.
    this.waterBody = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshLambertMaterial({
        color: 0x2e9fdc,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        depthTest: false,
        clippingPlanes: [this.waterPlane],
      }),
    );
    this.waterBody.scale.setScalar(0.985);
    this.waterBody.renderOrder = 2.5;
    this.waterSurface = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color: 0x9fd4f2,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.waterSurface.rotation.x = -Math.PI / 2;
    this.waterSurface.renderOrder = 2.6;
    this.water.add(this.waterBody, this.waterSurface);
    this.water.visible = false;
    this.scene.add(this.water);

    // Water-level track with ticks at 25%, 50%, 75%, and its handle.
    const trackMat = new LineMaterial({ color: 0xc9e2f6, linewidth: 2, transparent: true, opacity: 0.7, depthTest: false });
    this.lineMats.push(trackMat);
    this.trackGeo.setPositions([0, 0, 0, 0, 1, 0]);
    this.track = new LineSegments2(this.trackGeo, trackMat);
    this.track.renderOrder = 7;
    this.track.visible = false;
    this.scene.add(this.track);
    this.waterHandle = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0x2e9fdc, depthTest: false }),
    );
    this.waterHandle.renderOrder = 10;
    const wRing = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 28),
      new THREE.MeshBasicMaterial({ color: 0xf7faff, depthTest: false }),
    );
    wRing.renderOrder = 9;
    this.waterHandle.add(wRing);
    this.waterHandle.visible = false;
    this.scene.add(this.waterHandle);

    // Paint: a coral shell just outside the sphere, clipped so only the swept part shows.
    // It's a child of `ball`, so it turns with the sphere; the clip plane follows each frame.
    this.paintBody = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshLambertMaterial({
        color: 0xff6b6b,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        clippingPlanes: [this.paintPlane],
      }),
    );
    this.paintBody.scale.setScalar(1.012);
    this.paintBody.renderOrder = 3.2;
    this.paintBody.visible = false;
    const edgeMat = new LineMaterial({ color: 0xd94848, linewidth: 4 });
    this.lineMats.push(edgeMat);
    this.paintEdge = new LineSegments2(circleSegments(72), edgeMat);
    this.paintEdge.rotation.x = Math.PI / 2;
    this.paintEdge.renderOrder = 3.3;
    this.paintEdge.visible = false;
    this.ball.add(this.paintBody, this.paintEdge);

    const pTrackMat = new LineMaterial({ color: 0xc9e2f6, linewidth: 2, transparent: true, opacity: 0.7, depthTest: false });
    this.lineMats.push(pTrackMat);
    this.paintTrackGeo.setPositions([0, 0, 0, 0, 1, 0]);
    this.paintTrack = new LineSegments2(this.paintTrackGeo, pTrackMat);
    this.paintTrack.renderOrder = 7;
    this.paintTrack.visible = false;
    this.scene.add(this.paintTrack);
    this.paintHandle = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b, depthTest: false }),
    );
    this.paintHandle.renderOrder = 10;
    const pRing = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 28),
      new THREE.MeshBasicMaterial({ color: 0xf7faff, depthTest: false }),
    );
    pRing.renderOrder = 9;
    this.paintHandle.add(pRing);
    this.paintHandle.visible = false;
    this.scene.add(this.paintHandle);

    // Cut: a faint plane and the yellow cross-section circle, both in the sphere's frame.
    // depthTest is off so they show through the sphere's front surface; draw order layers them.
    this.cutPlaneMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 2.7),
      new THREE.MeshBasicMaterial({
        color: 0xf7faff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.cutPlaneMesh.rotation.x = -Math.PI / 2;
    this.cutPlaneMesh.renderOrder = 2.7;
    this.cutDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffd54a,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.cutDisc.rotation.x = -Math.PI / 2;
    this.cutDisc.renderOrder = 2.8;
    const cutRingMat = new LineMaterial({ color: 0xffd54a, linewidth: 3, depthTest: false, transparent: true });
    this.lineMats.push(cutRingMat);
    this.cutRing = new LineSegments2(circleSegments(72), cutRingMat);
    this.cutRing.rotation.x = Math.PI / 2;
    this.cutRing.renderOrder = 6;
    this.cutPlaneMesh.visible = this.cutDisc.visible = this.cutRing.visible = false;
    this.ball.add(this.cutPlaneMesh, this.cutDisc, this.cutRing);

    // Chalk-white with a yellow ring and a navy "knife" bar, so it can't be mixed up with the radius dot.
    this.cutHandle = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0xf7faff, depthTest: false }),
    );
    this.cutHandle.renderOrder = 10;
    const cRing = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, depthTest: false }),
    );
    cRing.renderOrder = 9;
    this.cutHandle.add(cRing);
    const bar = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.45),
      new THREE.MeshBasicMaterial({ color: 0x0f2a55, depthTest: false }),
    );
    bar.renderOrder = 11;
    this.cutHandle.add(bar);
    this.cutHandle.visible = false;
    this.scene.add(this.cutHandle);

    // Two hemispheres for after the cut. The bottom one is the top one turned over.
    this.halfTop = this.makeHalf();
    this.halfBottom = this.makeHalf();
    this.halfBottom.rotation.x = Math.PI;
    this.halves.add(this.halfTop, this.halfBottom);
    this.halves.visible = false;
    this.scene.add(this.halves);
    this.ball.rotation.set(START_TILT, START_SPIN, 0);
    this.scene.add(this.ball);

    // Outline: the exact silhouette circle, recomputed for the camera each frame.
    const outlineMat = new LineMaterial({ color: 0xf7faff, linewidth: 3 });
    this.lineMats.push(outlineMat);
    this.outline = new LineSegments2(circleSegments(96), outlineMat);
    this.outline.renderOrder = 4;
    this.scene.add(this.outline);

    // Dashed radius from the center to the handle.
    const radiusMat = new LineMaterial({
      color: 0xffd54a,
      linewidth: 2.5,
      dashed: true,
      dashSize: 0.12,
      gapSize: 0.09,
      depthTest: false,
      transparent: true,
    });
    this.lineMats.push(radiusMat);
    this.radiusGeo.setPositions([0, 0, 0, 1, 0, 0]);
    this.radiusLine = new LineSegments2(this.radiusGeo, radiusMat);
    this.radiusLine.renderOrder = 8;
    this.scene.add(this.radiusLine);

    // Handle: yellow dot with a navy ring, constant on-screen size.
    this.handle = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, depthTest: false }),
    );
    this.handle.renderOrder = 10;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 28),
      new THREE.MeshBasicMaterial({ color: 0x0f2a55, depthTest: false }),
    );
    ring.renderOrder = 9;
    this.handle.add(ring);
    this.scene.add(this.handle);

    // Soft shadow under the sphere.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(8,24,60,0.5)');
    grad.addColorStop(1, 'rgba(8,24,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 5);
    this.scene.add(sun);

    // Radius label ("r = 5 cm"), HTML so it stays crisp.
    this.label = document.createElement('div');
    this.label.className = 'edge-label';
    this.label.setAttribute('aria-hidden', 'true');
    container.appendChild(this.label);
    this.waterLabel = document.createElement('div');
    this.waterLabel.className = 'water-label';
    this.waterLabel.setAttribute('aria-hidden', 'true');
    this.waterLabel.hidden = true;
    container.appendChild(this.waterLabel);
    this.paintLabel = document.createElement('div');
    this.paintLabel.className = 'water-label paint-label';
    this.paintLabel.setAttribute('aria-hidden', 'true');
    this.paintLabel.hidden = true;
    container.appendChild(this.paintLabel);
    this.cutLabel = document.createElement('div');
    this.cutLabel.className = 'cut-label';
    this.cutLabel.setAttribute('aria-hidden', 'true');
    this.cutLabel.hidden = true;
    container.appendChild(this.cutLabel);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.applyRadius();
    this.loop();
  }

  /** Text next to the water handle (set by the page, e.g. "50%"). */
  setWaterLabel(text: string): void {
    if (this.waterLabel.textContent !== text) this.waterLabel.textContent = text;
  }

  getRadius(): number {
    return this.radius;
  }

  setRadius(cm: number): void {
    const r = clamp(cm, MIN_RADIUS, MAX_RADIUS);
    if (r === this.radius) return;
    this.radius = r;
    this.applyRadius();
  }

  rotateBy(dx: number, dy: number): void {
    this.ball.rotation.y += dx;
    this.ball.rotation.x = clamp(this.ball.rotation.x + dy, -1.3, 1.3);
    this.dirty = true;
  }

  resetView(): void {
    this.ball.rotation.set(START_TILT, START_SPIN, 0);
    this.dirty = true;
  }

  /** Show water filled to fraction t of the height (0..1), or hide it with null. */
  setWater(t: number | null): void {
    const v = t === null ? null : clamp(t, 0, 1);
    if (v === this.waterT) return;
    this.waterT = v;
    this.applyWater();
  }

  /** Water handle position in CSS pixels, or null when water is hidden. */
  waterHandleScreen(): ScreenPoint | null {
    if (this.waterT === null) return null;
    return this.toScreen(this.waterHandle.position);
  }

  /** Convert a pointer's y (CSS px) to a water fraction 0..1 along the track. */
  waterTFromScreenY(y: number): number {
    const R = this.radius * WORLD_PER_CM;
    const bottom = this.toScreen(new THREE.Vector3(R * TRACK_X, -R, 0)).y;
    const top = this.toScreen(new THREE.Vector3(R * TRACK_X, R, 0)).y;
    return clamp((bottom - y) / Math.max(1, bottom - top), 0, 1);
  }

  /** Show paint swept fraction p (0..1) of the way from the top down, or hide it with null. */
  setPaint(p: number | null): void {
    const v = p === null ? null : clamp(p, 0, 1);
    if (v === this.paintP) return;
    this.paintP = v;
    this.applyPaint();
  }

  paintHandleScreen(): ScreenPoint | null {
    if (this.paintP === null) return null;
    return this.toScreen(this.paintHandle.position);
  }

  /** Convert a pointer's y (CSS px) to a paint sweep 0 (top) … 1 (bottom). */
  paintPFromScreenY(y: number): number {
    const R = this.radius * WORLD_PER_CM;
    const top = this.toScreen(new THREE.Vector3(-R * TRACK_X, R, 0)).y;
    const bottom = this.toScreen(new THREE.Vector3(-R * TRACK_X, -R, 0)).y;
    return clamp((y - top) / Math.max(1, bottom - top), 0, 1);
  }

  /** Show the cutting plane at c = d / r (−1..1), or hide cut mode with null. */
  setCut(c: number | null): void {
    const v = c === null ? null : clamp(c, -1, 1);
    if (v === this.cutC) return;
    this.cutC = v;
    this.applyCut();
  }

  /** 0 = whole sphere, 1 = hemispheres apart. */
  setSplit(s: number): void {
    const v = clamp(s, 0, 1);
    if (v === this.split) return;
    this.split = v;
    this.applyCut();
  }

  /** 0 = flat faces yellow and domes clear, 1 = both halves painted coral. */
  setHalvesPaint(k: number): void {
    const t = clamp(k, 0, 1);
    const sky = new THREE.Color(0xc9e2f6);
    const coral = new THREE.Color(0xff6b6b);
    const yellow = new THREE.Color(0xffd54a);
    for (const m of this.halfFills) {
      m.color.copy(sky).lerp(coral, t);
      m.opacity = 0.2 + 0.68 * t;
    }
    for (const m of this.faceMats) m.color.copy(yellow).lerp(coral, t);
    this.dirty = true;
  }

  setCutLabel(text: string | null): void {
    this.cutLabel.hidden = text === null || this.cutC === null || this.split === 0;
    if (text !== null && this.cutLabel.textContent !== text) this.cutLabel.textContent = text;
  }

  cutHandleScreen(): ScreenPoint | null {
    if (this.cutC === null || this.split > 0) return null;
    return this.toScreen(this.cutHandle.position);
  }

  /** Pointer y (CSS px) → cut fraction −1 (bottom) … 1 (top), along the right track. */
  cutCFromScreenY(y: number): number {
    return this.waterTFromScreenY(y) * 2 - 1;
  }

  setCutHover(on: boolean): void {
    if (on === this.hoverCut) return;
    this.hoverCut = on;
    this.dirty = true;
  }

  /** Hide the radius handle, line and label (e.g. while the halves are apart). */
  setRadiusUi(on: boolean): void {
    if (on === this.radiusUi) return;
    this.radiusUi = on;
    this.handle.visible = this.radiusLine.visible = on;
    this.label.hidden = !on;
    this.dirty = true;
  }

  isRadiusUiOn(): boolean {
    return this.radiusUi;
  }

  setPaintHover(on: boolean): void {
    if (on === this.hoverPaint) return;
    this.hoverPaint = on;
    this.dirty = true;
  }

  setPaintLabel(text: string): void {
    if (this.paintLabel.textContent !== text) this.paintLabel.textContent = text;
  }

  setWaterHover(on: boolean): void {
    if (on === this.hoverWater) return;
    this.hoverWater = on;
    this.dirty = true;
  }

  setHandleHover(on: boolean): void {
    if (on === this.hover) return;
    this.hover = on;
    this.dirty = true;
  }

  /** Handle position in CSS pixels relative to the container. */
  handleScreen(): ScreenPoint {
    this.updateOverlay();
    return this.toScreen(this.handle.position);
  }

  centerScreen(): ScreenPoint {
    return this.toScreen(this.ball.position);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
  }

  private applyRadius(): void {
    const R = this.radius * WORLD_PER_CM;
    this.ball.scale.setScalar(R);
    this.shadow.position.set(0, -R - 0.3, 0);
    this.shadow.scale.set(R * 2.4, R * 1.6, 1);
    // Track: a vertical line from bottom to top with ticks at ¼, ½, ¾.
    const x = R * TRACK_X;
    const tick = R * 0.09;
    const pts = [x, -R, 0, x, R, 0];
    for (const f of [0.25, 0.5, 0.75]) {
      const y = -R + 2 * R * f;
      pts.push(x - tick, y, 0, x + tick, y, 0);
    }
    this.trackGeo.setPositions(pts);
    this.paintTrackGeo.setPositions(pts.map((v, i) => (i % 3 === 0 ? -v : v)));
    this.applyWater();
    this.applyPaint();
    this.applyCut();
  }

  private applyCut(): void {
    const c = this.cutC;
    const on = c !== null;
    const whole = !on || this.split === 0;
    const R = this.radius * WORLD_PER_CM;
    this.ball.visible = whole;
    this.outline.visible = whole;
    this.halves.visible = !whole;
    const planeOn = on && this.split === 0;
    this.cutPlaneMesh.visible = this.cutHandle.visible = planeOn;
    const discR = on ? Math.sqrt(Math.max(0, 1 - c * c)) : 0;
    this.cutDisc.visible = this.cutRing.visible = planeOn && discR > 0.01;
    if (on) {
      this.cutPlaneMesh.position.y = c;
      this.cutDisc.position.y = c;
      this.cutDisc.scale.setScalar(Math.max(discR, 0.001));
      this.cutRing.position.y = c;
      this.cutRing.scale.setScalar(Math.max(discR, 0.001));
      this.cutHandle.position.set(R * TRACK_X, R * c, 0);
      this.halves.scale.setScalar(R);
      const gap = this.split * 0.45;
      this.halfTop.position.y = gap;
      this.halfBottom.position.y = -gap;
    }
    if (this.cutC === null || this.split === 0) this.cutLabel.hidden = true;
    this.updateTrackVis();
    this.dirty = true;
  }

  private updateTrackVis(): void {
    this.track.visible = this.waterT !== null || (this.cutC !== null && this.split === 0);
  }

  /** One hemisphere (dome up, flat face down at y = 0), in unit size. */
  private makeHalf(): THREE.Group {
    const g = new THREE.Group();
    const dome = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const depth = new THREE.Mesh(
      dome,
      new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    );
    depth.renderOrder = 0;
    const grid = latLongGeometry(true);
    const front = new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({ color: 0xc9e2f6, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    front.renderOrder = 3.5;
    const back = new THREE.LineSegments(
      grid,
      new THREE.LineBasicMaterial({ color: 0xc9e2f6, transparent: true, opacity: 0.16, depthWrite: false, depthFunc: THREE.GreaterDepth }),
    );
    back.renderOrder = 2;
    const fillMat = new THREE.MeshLambertMaterial({ color: 0xc9e2f6, transparent: true, opacity: 0.2, depthWrite: false });
    this.halfFills.push(fillMat);
    const fill = new THREE.Mesh(dome, fillMat);
    fill.renderOrder = 3;
    // The new flat face: solid yellow, so it is the first thing you notice.
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xffd54a, side: THREE.DoubleSide });
    this.faceMats.push(faceMat);
    const face = new THREE.Mesh(new THREE.CircleGeometry(1, 64), faceMat);
    face.rotation.x = Math.PI / 2;
    const rimMat = new LineMaterial({ color: 0xf7faff, linewidth: 3 });
    this.lineMats.push(rimMat);
    const rim = new LineSegments2(circleSegments(72), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.renderOrder = 4;
    g.add(depth, back, fill, front, face, rim);
    return g;
  }

  private applyPaint(): void {
    const p = this.paintP;
    const on = p !== null;
    this.paintTrack.visible = on;
    this.paintHandle.visible = on;
    this.paintLabel.hidden = !on;
    this.paintBody.visible = on && p > 0;
    if (on) {
      const R = this.radius * WORLD_PER_CM;
      const yc = 1 - 2 * p; // local height of the paint edge
      this.paintLocalPlane.constant = -yc * 1.012; // keeps local y ≥ the edge (the shell is 1.012× bigger)
      const ringR = Math.sqrt(Math.max(0, 1 - yc * yc)) * 1.012;
      this.paintEdge.visible = p > 0 && p < 1 && ringR > 0.02;
      this.paintEdge.position.y = yc * 1.012;
      this.paintEdge.scale.setScalar(Math.max(ringR, 0.001));
      this.paintHandle.position.set(-R * TRACK_X, R * yc, 0);
    }
    this.dirty = true;
  }

  private applyWater(): void {
    const t = this.waterT;
    const on = t !== null;
    this.water.visible = on;
    this.updateTrackVis();
    this.waterHandle.visible = on;
    this.waterLabel.hidden = !on;
    if (on) {
      const R = this.radius * WORLD_PER_CM;
      const y = -R + 2 * R * t;
      this.water.scale.setScalar(R);
      this.waterPlane.constant = y; // keeps points with y ≤ level
      this.waterBody.visible = t > 0;
      const discR = Math.sqrt(Math.max(0, 1 - (y / R) ** 2)) * 0.985;
      this.waterSurface.visible = discR > 0.01;
      this.waterSurface.position.y = y / R;
      this.waterSurface.scale.setScalar(Math.max(discR, 0.001));
      this.waterHandle.position.set(R * TRACK_X, y, 0);
    }
    this.dirty = true;
  }

  /** Place the silhouette outline, radius line, handle and label for the current camera. */
  private updateOverlay(): void {
    const R = this.radius * WORLD_PER_CM;
    const center = this.ball.position;
    const D = this.camera.position.distanceTo(center);
    // The silhouette of a sphere seen from distance D is a circle of radius R·√(1 − R²/D²),
    // sitting R²/D in front of the center, facing the camera.
    const toCam = this.tmp.copy(this.camera.position).sub(center).normalize();
    this.outline.position.copy(center).addScaledVector(toCam, (R * R) / D);
    this.outline.lookAt(this.camera.position);
    const silR = R * Math.sqrt(Math.max(0, 1 - (R * R) / (D * D)));
    this.outline.scale.setScalar(silR);
    this.outline.updateMatrixWorld();

    // Handle on the outline, up and to the right.
    this.u.setFromMatrixColumn(this.outline.matrixWorld, 0).normalize();
    this.v.setFromMatrixColumn(this.outline.matrixWorld, 1).normalize();
    this.handle.position
      .copy(this.outline.position)
      .addScaledVector(this.u, Math.cos(HANDLE_ANGLE) * silR)
      .addScaledVector(this.v, Math.sin(HANDLE_ANGLE) * silR);
    const dist = this.camera.position.distanceTo(this.handle.position);
    this.handle.scale.setScalar(dist * 0.011 * (this.hover ? 1.45 : 1));
    this.handle.quaternion.copy(this.camera.quaternion);

    if (this.cutC !== null) {
      if (this.split === 0) {
        const cd = this.camera.position.distanceTo(this.cutHandle.position);
        this.cutHandle.scale.setScalar(cd * 0.011 * (this.hoverCut ? 1.45 : 1));
        this.cutHandle.quaternion.copy(this.camera.quaternion);
      } else {
        // The halves turn with the student, exactly like the whole sphere did.
        this.halves.rotation.copy(this.ball.rotation);
        this.halves.updateMatrixWorld();
        // Label beside the gap, on the right edge of the faces (halves are scaled by R).
        const p = this.toScreen(this.halves.localToWorld(new THREE.Vector3(1.05, 0, 0)));
        // Keep the sticker inside the board on narrow screens.
        const x = Math.max(8, Math.min(p.x + 14, this.el.clientWidth - this.cutLabel.offsetWidth - 8));
        this.cutLabel.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y)}px) translate(0, -50%)`;
      }
    }
    if (this.paintP !== null) {
      const pd = this.camera.position.distanceTo(this.paintHandle.position);
      this.paintHandle.scale.setScalar(pd * 0.011 * (this.hoverPaint ? 1.45 : 1));
      this.paintHandle.quaternion.copy(this.camera.quaternion);
      const ps = this.toScreen(this.paintHandle.position);
      this.paintLabel.style.transform = `translate(${Math.round(ps.x - 18)}px, ${Math.round(ps.y)}px) translate(-100%, -50%)`;
      // The paint clip plane lives in the sphere's own frame.
      this.ball.updateMatrixWorld();
      this.paintPlane.copy(this.paintLocalPlane).applyMatrix4(this.ball.matrixWorld);
    }
    if (this.waterT !== null) {
      const wd = this.camera.position.distanceTo(this.waterHandle.position);
      this.waterHandle.scale.setScalar(wd * 0.011 * (this.hoverWater ? 1.45 : 1));
      this.waterHandle.quaternion.copy(this.camera.quaternion);
      const w = this.toScreen(this.waterHandle.position);
      this.waterLabel.style.transform = `translate(${Math.round(w.x + 18)}px, ${Math.round(w.y)}px) translate(0, -50%)`;
    }

    const h = this.handle.position;
    this.radiusGeo.setPositions([center.x, center.y, center.z, h.x, h.y, h.z]);
    this.radiusLine.computeLineDistances();

    // Label just above the middle of the radius line.
    const a = this.toScreen(center);
    const b = this.toScreen(h);
    const text = `r = ${fmtRadius(this.radius)} cm`;
    if (this.label.textContent !== text) this.label.textContent = text;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // In Paint mode the brush track is on the left, so put the label right of the handle instead.
    this.label.style.transform =
      this.paintP !== null
        ? `translate(${Math.round(b.x + 16)}px, ${Math.round(b.y - 14)}px) translate(0, -50%)`
        : `translate(${Math.round(mx - 8)}px, ${Math.round(my - 18)}px) translate(-100%, -50%)`;
  }

  private toScreen(p: THREE.Vector3): ScreenPoint {
    const q = p.clone().project(this.camera);
    return {
      x: ((q.x + 1) / 2) * this.el.clientWidth,
      y: ((1 - q.y) / 2) * this.el.clientHeight,
    };
  }

  private resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // On narrow boards, pull back so the biggest sphere still fits.
    const z = w / h < 1 ? 12 / Math.max(0.6, w / h) : 12;
    this.camera.position.set(0, 1.1 * (z / 12), z);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.dirty = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.updateOverlay();
    this.renderer.render(this.scene, this.camera);
  };
}

/** Unit-sphere latitude circles every 30° and 12 meridians, as line segments. */
function latLongGeometry(topOnly = false): THREE.BufferGeometry {
  const pts: number[] = [];
  const seg = 64;
  for (const latDeg of topOnly ? [30, 60] : [-60, -30, 0, 30, 60]) {
    const lat = (latDeg * Math.PI) / 180;
    const y = Math.sin(lat);
    const rr = Math.cos(lat);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      pts.push(rr * Math.cos(a0), y, rr * Math.sin(a0), rr * Math.cos(a1), y, rr * Math.sin(a1));
    }
  }
  const mSeg = topOnly ? 16 : 32;
  const t0Start = topOnly ? 0 : -Math.PI / 2;
  const tSpan = topOnly ? Math.PI / 2 : Math.PI;
  for (let m = 0; m < 12; m++) {
    const lon = (m / 12) * Math.PI * 2;
    for (let i = 0; i < mSeg; i++) {
      const t0 = t0Start + (i / mSeg) * tSpan;
      const t1 = t0Start + ((i + 1) / mSeg) * tSpan;
      pts.push(
        Math.cos(t0) * Math.cos(lon), Math.sin(t0), Math.cos(t0) * Math.sin(lon),
        Math.cos(t1) * Math.cos(lon), Math.sin(t1), Math.cos(t1) * Math.sin(lon),
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

/** Unit circle in the XY plane as thick-line segments. */
function circleSegments(n: number): LineSegmentsGeometry {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    pts.push(Math.cos(a0), Math.sin(a0), 0, Math.cos(a1), Math.sin(a1), 0);
  }
  return new LineSegmentsGeometry().setPositions(pts);
}
