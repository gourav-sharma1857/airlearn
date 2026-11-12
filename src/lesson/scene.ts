/**
 * The cube, drawn like chalk on a board: light outlines, dashed hidden edges,
 * a faint fill, a soft shadow, and a yellow "stretch" handle on a corner.
 * Renders only when something changed, to keep Chromebooks cool.
 */
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export const MIN_EDGE = 1;
export const MAX_EDGE = 5;
const WORLD_PER_UNIT = 0.62;

export interface ScreenPoint {
  x: number;
  y: number;
}

export class CubeScene {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private cube = new THREE.Group();
  private handle: THREE.Mesh;
  private shadow: THREE.Mesh;
  private lineMats: LineMaterial[] = [];
  private label: HTMLElement;
  private edge = 2;
  private dirty = true;
  private raf = 0;
  private hover = false;
  private handleCorner = new THREE.Vector3(1, 1, 1);
  private ro: ResizeObserver;
  private tmp = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.el = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 2.4, 12);
    this.camera.lookAt(0, -0.2, 0);

    // 1) Invisible depth-only box so back edges can be drawn dashed.
    const box = new THREE.BoxGeometry(1, 1, 1);
    const depthMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const depthMesh = new THREE.Mesh(box, depthMat);
    depthMesh.renderOrder = 0;

    // 2) Faint chalk-blue fill with simple shading so faces read as 3D.
    const fillMat = new THREE.MeshLambertMaterial({
      color: 0xc9e2f6,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const fill = new THREE.Mesh(box, fillMat);
    fill.renderOrder = 3;

    // 3) Edges: solid where visible, dashed where hidden behind the cube.
    const edges = new THREE.EdgesGeometry(box);
    const segGeo = new LineSegmentsGeometry().fromEdgesGeometry(edges);
    const visibleMat = new LineMaterial({ color: 0xf7faff, linewidth: 3, worldUnits: false });
    const hiddenMat = new LineMaterial({
      color: 0xc9e2f6,
      linewidth: 2,
      dashed: true,
      dashSize: 0.06,
      gapSize: 0.06,
      transparent: true,
      opacity: 0.55,
      depthFunc: THREE.GreaterDepth,
      depthWrite: false,
    });
    this.lineMats.push(visibleMat, hiddenMat);
    const visible = new LineSegments2(segGeo, visibleMat);
    visible.renderOrder = 1;
    const hidden = new LineSegments2(segGeo, hiddenMat);
    hidden.computeLineDistances();
    hidden.renderOrder = 2;

    this.cube.add(depthMesh, visible, hidden, fill);
    this.cube.rotation.set(-0.38, 0.62, 0);
    this.scene.add(this.cube);

    // Handle: stays a constant on-screen size, placed on the most top-right corner.
    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffd54a, depthTest: false }),
    );
    this.handle.renderOrder = 10;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.35, 28),
      new THREE.MeshBasicMaterial({ color: 0x0f2a55, depthTest: false, side: THREE.DoubleSide }),
    );
    ring.renderOrder = 9;
    this.handle.add(ring);
    this.scene.add(this.handle);

    // Soft shadow: radial-gradient sprite under the cube.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(8,24,60,0.55)');
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

    // Edge label ("a = 2"), an HTML element so it stays crisp and readable.
    this.label = document.createElement('div');
    this.label.className = 'edge-label';
    this.label.setAttribute('aria-hidden', 'true');
    container.appendChild(this.label);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.applyEdge();
    this.loop();
  }

  getEdge(): number {
    return this.edge;
  }

  setEdge(a: number): void {
    const clamped = Math.min(MAX_EDGE, Math.max(MIN_EDGE, a));
    if (clamped === this.edge) return;
    this.edge = clamped;
    this.applyEdge();
  }

  rotateBy(dx: number, dy: number): void {
    this.cube.rotation.y += dx;
    this.cube.rotation.x = Math.max(-1.2, Math.min(1.2, this.cube.rotation.x + dy));
    this.dirty = true;
  }

  resetRotation(): void {
    this.cube.rotation.set(-0.38, 0.62, 0);
    this.dirty = true;
  }

  setHandleHover(on: boolean): void {
    if (on === this.hover) return;
    this.hover = on;
    this.dirty = true;
  }

  /** Handle position in CSS pixels relative to the container. */
  handleScreen(): ScreenPoint {
    this.updateHandle();
    return this.toScreen(this.handle.position);
  }

  centerScreen(): ScreenPoint {
    return this.toScreen(this.cube.position);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.renderer.dispose();
  }

  private applyEdge(): void {
    const s = this.edge * WORLD_PER_UNIT;
    this.cube.scale.setScalar(s);
    // keep the cube "sitting" at the same floor height
    const floor = -1.4;
    this.cube.position.y = floor + s * 0.62;
    this.shadow.position.set(0, floor - 0.02, 0);
    this.shadow.scale.setScalar(s * 2.1);
    this.dirty = true;
  }

  private toScreen(v: THREE.Vector3): ScreenPoint {
    this.tmp.copy(v).project(this.camera);
    return {
      x: ((this.tmp.x + 1) / 2) * this.el.clientWidth,
      y: ((1 - this.tmp.y) / 2) * this.el.clientHeight,
    };
  }

  /** Pick the corner that is furthest up-and-right on screen. */
  private updateHandle(): void {
    this.cube.updateMatrixWorld();
    let best = -Infinity;
    for (const x of [-0.5, 0.5])
      for (const y of [-0.5, 0.5])
        for (const z of [-0.5, 0.5]) {
          const p = this.tmp.set(x, y, z).applyMatrix4(this.cube.matrixWorld).project(this.camera);
          const score = p.x + p.y - p.z * 0.2;
          if (score > best) {
            best = score;
            this.handleCorner.set(x, y, z);
          }
        }
    this.handle.position.copy(this.handleCorner).applyMatrix4(this.cube.matrixWorld);
    const dist = this.camera.position.distanceTo(this.handle.position);
    const r = dist * 0.011 * (this.hover ? 1.45 : 1);
    this.handle.scale.setScalar(r);
    this.handle.quaternion.copy(this.camera.quaternion);
  }

  private updateLabel(): void {
    // Midpoint of the bottom-front edge that faces the camera most.
    this.cube.updateMatrixWorld();
    let bestZ = -Infinity;
    const mid = new THREE.Vector3();
    const candidates: [number, number, number][] = [
      [0, -0.5, 0.5],
      [0, -0.5, -0.5],
      [0.5, -0.5, 0],
      [-0.5, -0.5, 0],
    ];
    for (const [x, y, z] of candidates) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(this.cube.matrixWorld);
      const towardCam = p.z + p.y * 0.1;
      if (towardCam > bestZ) {
        bestZ = towardCam;
        mid.copy(p);
      }
    }
    const s = this.toScreen(mid);
    const text = `a = ${formatEdge(this.edge)}`;
    if (this.label.textContent !== text) this.label.textContent = text;
    this.label.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y + 14)}px) translate(-50%, 0)`;
  }

  private resize(): void {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // On narrow/tall boards, pull back so a big cube still fits.
    this.camera.position.z = w / h < 1 ? 12 / Math.max(0.62, w / h) : 12;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w, h);
    this.dirty = true;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.updateHandle();
    this.renderer.render(this.scene, this.camera);
    this.updateLabel();
  };
}

export function formatEdge(a: number): string {
  return Number.isInteger(a) ? String(a) : a.toFixed(1);
}
