/**
 * Sphere Lab math. Pure functions, no DOM, covered by math.test.ts.
 *
 * Units: lengths in cm, areas in cm², volumes in cm³ (1 cm³ = 1 mL).
 * The water model assumes an ideal thin-walled sphere (the wall takes no space).
 */

/** A teaching constant, not real paint data: 1 mL of paint covers 10 cm². */
export const PAINT_CM2_PER_ML = 10;

export const MIN_RADIUS = 1;
export const MAX_RADIUS = 12;
export const START_RADIUS = 5;

/** V = (4/3)·π·r³ */
export function sphereVolume(r: number): number {
  return (4 / 3) * Math.PI * r ** 3;
}

/** S = 4·π·r² */
export function sphereSurface(r: number): number {
  return 4 * Math.PI * r ** 2;
}

/** Volume of water (a spherical cap) at height h from the bottom, 0 ≤ h ≤ 2r: π·h²·(3r − h) / 3 */
export function waterVolume(r: number, h: number): number {
  const hh = clamp(h, 0, 2 * r);
  return (Math.PI * hh * hh * (3 * r - hh)) / 3;
}

/** Fraction of the sphere filled (0 to 1) at water height h. */
export function fractionFull(r: number, h: number): number {
  if (r <= 0) return 0;
  return waterVolume(r, h) / sphereVolume(r);
}

/** Area of the circle made by a flat cut at distance d from the center: π·(r² − d²). 0 if the plane misses. */
export function crossSectionArea(r: number, d: number): number {
  const dd = Math.abs(d);
  return dd >= r ? 0 : Math.PI * (r * r - dd * dd);
}

/** New surface created by one cut at distance d: two flat faces, 2·π·(r² − d²) in total. */
export function cutNewSurface(r: number, d: number): number {
  return 2 * crossSectionArea(r, d);
}

/** Total surface of both pieces after one cut at distance d. */
export function surfaceAfterCut(r: number, d: number): number {
  return sphereSurface(r) + cutNewSurface(r, d);
}

/** Volume of each half after a cut through the center: (2/3)·π·r³ */
export function hemisphereVolume(r: number): number {
  return (2 / 3) * Math.PI * r ** 3;
}

/** Surface of one hemisphere including its flat face: 2πr² + πr² = 3·π·r² */
export function hemisphereSurface(r: number): number {
  return 3 * Math.PI * r ** 2;
}

/**
 * Painted area when paint has swept a distance d down from the top (0 ≤ d ≤ 2r).
 * Archimedes' "hat-box" result: a sphere zone between two parallel planes has area 2·π·r·d,
 * so every centimetre of sweep covers the same area.
 */
export function zoneArea(r: number, d: number): number {
  return 2 * Math.PI * r * clamp(d, 0, 2 * r);
}

/** mL of paint for an area in cm², using the teaching constant. */
export function paintMl(areaCm2: number): number {
  return areaCm2 / PAINT_CM2_PER_ML;
}

/** Round to the 0.1 cm grid, with a magnet to whole numbers so 5 and 10 are easy to hit. */
export function snapRadius(raw: number): number {
  const whole = Math.round(raw);
  const v = Math.abs(raw - whole) < 0.2 ? whole : Math.round(raw * 10) / 10;
  return clamp(v, MIN_RADIUS, MAX_RADIUS);
}

/** Water snap points, as fractions of the sphere's height. */
export const WATER_SNAPS = [0.25, 0.5, 0.75];

/** Round a water fraction to 1%, snapping to ¼, ½, ¾ when within 3%. */
export function snapWater(t: number): number {
  for (const s of WATER_SNAPS) if (Math.abs(t - s) < 0.03) return s;
  return clamp(Math.round(t * 100) / 100, 0, 1);
}

/** Cut distance from the center (cm): rounds to 0.1 cm, snaps to the center within 5% of r, clamps to ±r. */
export function snapCut(d: number, r: number): number {
  if (Math.abs(d) < 0.05 * r) return 0;
  return clamp(Math.round(d * 10) / 10, -r, r);
}

/** One decimal place with thousands separators: 4188.79 → "4,188.8". */
export function fmt1(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Radius label: whole numbers without ".0". */
export function fmtRadius(r: number): string {
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
