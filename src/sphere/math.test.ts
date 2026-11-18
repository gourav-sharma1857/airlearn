import { describe, expect, it } from 'vitest';
import {
  crossSectionArea,
  cutNewSurface,
  fmt1,
  fractionFull,
  hemisphereSurface,
  hemisphereVolume,
  paintMl,
  snapCut,
  snapWater,
  snapRadius,
  sphereSurface,
  sphereVolume,
  surfaceAfterCut,
  waterVolume,
  zoneArea,
} from './math';

/** Compare at one decimal place, the precision the readouts show. */
const r1 = (n: number) => Math.round(n * 10) / 10;

describe('sphere, r = 5 cm', () => {
  const r = 5;
  it('volume is 523.6 cm³ (523.6 mL)', () => expect(r1(sphereVolume(r))).toBe(523.6));
  it('surface is 314.2 cm², 31.4 mL of paint', () => {
    expect(r1(sphereSurface(r))).toBe(314.2);
    expect(r1(paintMl(sphereSurface(r)))).toBe(31.4);
  });
  it('each hemisphere is 261.8 mL and 235.6 cm²', () => {
    expect(r1(hemisphereVolume(r))).toBe(261.8);
    expect(r1(hemisphereSurface(r))).toBe(235.6);
  });
  it('a center cut gives 471.2 cm² total, 47.1 mL of paint (+15.7 mL)', () => {
    const after = surfaceAfterCut(r, 0);
    expect(r1(after)).toBe(471.2);
    expect(r1(paintMl(after))).toBe(47.1);
    expect(r1(paintMl(after) - paintMl(sphereSurface(r)))).toBe(15.7);
  });
  it('a center cut adds exactly 50% surface and keeps the volume', () => {
    expect(surfaceAfterCut(r, 0) / sphereSurface(r)).toBeCloseTo(1.5, 12);
    expect(2 * hemisphereSurface(r)).toBeCloseTo(surfaceAfterCut(r, 0), 9);
    expect(2 * hemisphereVolume(r)).toBeCloseTo(sphereVolume(r), 9);
  });
});

describe('sphere, r = 10 cm (radius doubled)', () => {
  it('volume is 4188.8 mL, ×8', () => {
    expect(r1(sphereVolume(10))).toBe(4188.8);
    expect(sphereVolume(10) / sphereVolume(5)).toBeCloseTo(8, 12);
  });
  it('surface is 1256.6 cm², 125.7 mL of paint, ×4', () => {
    expect(r1(sphereSurface(10))).toBe(1256.6);
    expect(r1(paintMl(sphereSurface(10)))).toBe(125.7);
    expect(sphereSurface(10) / sphereSurface(5)).toBeCloseTo(4, 12);
  });
});

describe('water', () => {
  for (const r of [5, 10, 3.7]) {
    it(`r = ${r}: 15.6% at h = 0.5r, 50% at h = r, 84.4% at h = 1.5r, 100% at h = 2r`, () => {
      expect(r1(fractionFull(r, 0.5 * r) * 100)).toBe(15.6);
      expect(fractionFull(r, r)).toBeCloseTo(0.5, 12);
      expect(r1(fractionFull(r, 1.5 * r) * 100)).toBe(84.4);
      expect(fractionFull(r, 2 * r)).toBeCloseTo(1, 12);
    });
  }
  it('is empty at h = 0 and clamps outside 0…2r', () => {
    expect(waterVolume(5, 0)).toBe(0);
    expect(waterVolume(5, -1)).toBe(0);
    expect(waterVolume(5, 99)).toBeCloseTo(sphereVolume(5), 9);
  });
});

describe('paint sweep (zone area)', () => {
  it('a full sweep covers the whole surface, half a sweep covers half', () => {
    expect(zoneArea(5, 10)).toBeCloseTo(sphereSurface(5), 9);
    expect(zoneArea(5, 5)).toBeCloseTo(sphereSurface(5) / 2, 9);
  });
  it('grows linearly: each cm of sweep adds the same area', () => {
    expect(zoneArea(5, 2) - zoneArea(5, 1)).toBeCloseTo(zoneArea(5, 9) - zoneArea(5, 8), 9);
  });
  it('r = 5, painted halfway: 157.1 cm², 15.7 mL', () => {
    expect(r1(zoneArea(5, 5))).toBe(157.1);
    expect(r1(paintMl(zoneArea(5, 5)))).toBe(15.7);
  });
  it('clamps outside 0…2r', () => {
    expect(zoneArea(5, -1)).toBe(0);
    expect(zoneArea(5, 50)).toBeCloseTo(sphereSurface(5), 9);
  });
});

describe('cross-section', () => {
  it('is π·r² through the center and shrinks toward the edge', () => {
    expect(crossSectionArea(5, 0)).toBeCloseTo(Math.PI * 25, 12);
    expect(crossSectionArea(5, 3)).toBeCloseTo(Math.PI * 16, 12);
    expect(crossSectionArea(5, -3)).toBeCloseTo(Math.PI * 16, 12);
    expect(crossSectionArea(5, 5)).toBe(0);
    expect(crossSectionArea(5, 6)).toBe(0);
  });
  it('r = 5, cut 3 cm from the center: 50.3 cm² face, 100.5 cm² new surface', () => {
    expect(r1(crossSectionArea(5, 3))).toBe(50.3);
    expect(r1(cutNewSurface(5, 3))).toBe(100.5);
  });
  it('a cut adds two faces: 2·π·(r² − d²)', () => {
    expect(cutNewSurface(5, 3)).toBeCloseTo(2 * Math.PI * 16, 12);
  });
});

describe('helpers', () => {
  it('snapRadius rounds to 0.1, pulls to whole numbers, and clamps', () => {
    expect(snapRadius(4.87)).toBe(5);
    expect(snapRadius(4.74)).toBe(4.7);
    expect(snapRadius(0.2)).toBe(1);
    expect(snapRadius(40)).toBe(12);
  });
  it('snapWater snaps to ¼ ½ ¾ within 3%, else rounds to 1%', () => {
    expect(snapWater(0.48)).toBe(0.5);
    expect(snapWater(0.27)).toBe(0.25);
    expect(snapWater(0.774)).toBe(0.75);
    expect(snapWater(0.6)).toBe(0.6);
    expect(snapWater(0.123)).toBe(0.12);
    expect(snapWater(1.2)).toBe(1);
  });
  it('snapCut snaps to the center, rounds to 0.1 cm, and clamps to ±r', () => {
    expect(snapCut(0.2, 5)).toBe(0);
    expect(snapCut(-0.24, 5)).toBe(0);
    expect(snapCut(3.04, 5)).toBe(3);
    expect(snapCut(-2.66, 5)).toBe(-2.7);
    expect(snapCut(9, 5)).toBe(5);
  });
  it('fmt1 shows one decimal with separators', () => {
    expect(fmt1(4188.7902)).toBe('4,188.8');
    expect(fmt1(50)).toBe('50.0');
  });
});
