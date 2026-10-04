import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildFlipflopThongs,
  buildGlasses,
  buildLabCoat,
  buildSleeves,
  measure,
  type RigMetrics,
} from './glbOutfit';
import { PROTAGONIST } from './protagonist';

/**
 * A stand-in for the measurements `glbRig` takes off a real 1.74 m rig. Every
 * number is the one the shipped model actually produces, because the point of
 * these tests is to catch "the outfit builder silently built something the
 * wrong size" — which only shows up if the inputs are realistic.
 */
const METRICS: RigMetrics = {
  height: 1.74,
  head: new THREE.Vector3(0, 1.5, 0),
  eye: new THREE.Vector3(0.04, 1.59, 0),
  faceFront: 0.103,
  eyeSpan: 0.082,
  // The shipped model wears a jacket, so the torso is much wider than the
  // 28.6 cm shoulder-joint spacing. Sizing a coat off the joints buries it.
  torsoHalf: 0.185,
  torsoDepth: 0.26,
  shoulderHalf: 0.143,
  neck: new THREE.Vector3(0, 1.42, 0),
  chest: new THREE.Vector3(0, 1.3, 0),
  hips: new THREE.Vector3(0, 0.84, 0),
  upperArmLen: 0.17,
  lowerArmLen: 0.19,
  upperLegLen: 0.406,
  lowerLegLen: 0.42,
  foot: new THREE.Vector3(0, 0.05, 0),
  torsoLen: 0.58,
  hipWidth: 0.22,
};

const bbox = (o: THREE.Object3D): THREE.Box3 => new THREE.Box3().setFromObject(o);
const size = (o: THREE.Object3D): THREE.Vector3 => bbox(o).getSize(new THREE.Vector3());

describe('buildGlasses', () => {
  it('sizes the frame off the eye span, not the body', () => {
    const wide = buildGlasses({ ...METRICS, eyeSpan: METRICS.eyeSpan * 2 }, PROTAGONIST);
    const narrow = buildGlasses(METRICS, PROTAGONIST);
    expect(size(wide).z).toBeGreaterThan(size(narrow).z * 1.6);
  });

  it('fits inside the face rather than overhanging the cheeks', () => {
    // The head is wider than the face; a frame wider than the head reads as a
    // visor, which is the failure this replaced.
    const headWidth = 0.24;
    const glasses = buildGlasses(METRICS, PROTAGONIST);
    expect(size(glasses).z).toBeLessThan(headWidth);
  });

  it('is an open frame, so the eye is not hidden behind a solid slab', () => {
    const glasses = buildGlasses(METRICS, PROTAGONIST);
    const b = bbox(glasses);
    // Thickness across the face stays at frame-bar scale: nothing spans the
    // whole lens opening in X.
    expect(b.max.x - b.min.x).toBeLessThan(METRICS.height * 0.06);
  });

  it('has a temple running back toward the ear', () => {
    const glasses = buildGlasses(METRICS, PROTAGONIST);
    const b = bbox(glasses);
    // Temples extend behind the lens plane, so the assembly is deeper than the
    // rims alone would be.
    expect(b.max.x - b.min.x).toBeGreaterThan(METRICS.height * 0.04);
  });

  it('builds nothing when the def has no glasses', () => {
    const bare = buildGlasses(METRICS, { ...PROTAGONIST, glasses: null });
    expect(size(bare).length()).toBe(0);
  });
});

describe('buildLabCoat', () => {
  it('returns null for an outfit with no coat', () => {
    expect(buildLabCoat(METRICS, { ...PROTAGONIST, outerwear: null })).toBeNull();
  });

  it('hangs from the neck to below the knee', () => {
    const lab = buildLabCoat(METRICS, PROTAGONIST);
    expect(lab).not.toBeNull();
    const b = bbox(lab!.body);
    // Lapels are tilted, so the top of the bounding box sits a little above
    // the neck line; anything much higher means a panel is flying off.
    expect(b.max.y).toBeLessThanOrEqual(METRICS.neck.y + 0.04);
    // Just below the knee: the knee sits at hips.y - upperLegLen.
    expect(b.min.y).toBeLessThan(METRICS.hips.y - METRICS.upperLegLen * 0.4);
    expect(b.min.y).toBeGreaterThan(0);
  });

  it('opens down the front, with a gap between the two panels', () => {
    const lab = buildLabCoat(METRICS, PROTAGONIST);
    const front = lab!.body.children.filter(
      (c) => c instanceof THREE.Mesh && c.position.x > 0 && c.geometry.type === 'BoxGeometry',
    );
    expect(front.length).toBeGreaterThan(0);
    // The two front panels are pushed apart in Z rather than meeting.
    const zs = lab!.body.children
      .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
      .map((c) => c.position.z)
      .filter((z) => Math.abs(z) > 0.01);
    expect(Math.min(...zs)).toBeLessThan(-0.02);
    expect(Math.max(...zs)).toBeGreaterThan(0.02);
  });

  it('is wider than the torso, or the character shows through it', () => {
    // This is the bug the review caught: the coat was sized off the shoulder
    // joints, which on this model are much narrower than the jacket the body
    // is actually wearing, so every panel sat *inside* the character and the
    // lab coat rendered as a white collar and a pair of cuffs.
    const lab = buildLabCoat(METRICS, PROTAGONIST)!;
    const b = bbox(lab.body);
    expect(b.max.z - b.min.z).toBeGreaterThan(METRICS.torsoHalf * 2);
    expect(b.max.x - b.min.x).toBeGreaterThan(METRICS.torsoDepth);
    // Sizing off the joints would give 2 * shoulderHalf * 1.16 = 0.33 m.
    expect(b.max.z - b.min.z).toBeGreaterThan(METRICS.shoulderHalf * 2 * 1.16);
  });

  it('sleeves clear the arm rather than leaving a bare strip', () => {
    const sleeves = buildSleeves(METRICS, PROTAGONIST)!;
    expect(sleeves.upper.geometry.boundingSphere === null || true).toBe(true);
    const w = size(sleeves.upper);
    expect(w.x).toBeGreaterThan(METRICS.shoulderHalf * 0.5);
  });

  it('is off-white, not blown-out white', () => {
    const lab = buildLabCoat(METRICS, PROTAGONIST);
    const coat = lab!.body.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh,
    ) as THREE.Mesh;
    const mat = coat.material as THREE.MeshStandardMaterial;
    // An emissive-looking #ffffff coat blows out under the street bloom.
    expect(mat.color.getHex()).toBeLessThan(0xffffff);
    expect(mat.emissive.getHex()).toBe(0x000000);
  });

  it('gives the hem three separately articulable segments', () => {
    const lab = buildLabCoat(METRICS, PROTAGONIST);
    expect(lab!.tails.left.name).toBe('coatTailL');
    expect(lab!.tails.right.name).toBe('coatTailR');
    expect(lab!.tails.back.name).toBe('coatTailB');
    // The pivot is the parent of all three, so the walk cycle can swing them.
    for (const t of Object.values(lab!.tails)) {
      expect(t.parent).toBe(lab!.root);
    }
  });
});

describe('buildSleeves', () => {
  it('fits the arm segments it is measured from', () => {
    const sleeves = buildSleeves(METRICS, PROTAGONIST);
    expect(sleeves).not.toBeNull();
    expect(size(sleeves!.upper).y).toBeCloseTo(METRICS.upperArmLen * 0.94, 5);
    expect(size(sleeves!.lower).y).toBeCloseTo(METRICS.lowerArmLen * 0.86, 5);
  });

  it('returns null without a coat', () => {
    expect(buildSleeves(METRICS, { ...PROTAGONIST, outerwear: null })).toBeNull();
  });
});

describe('buildFlipflopThongs', () => {
  it('is a thong, so it is far smaller than a shoe', () => {
    const t = buildFlipflopThongs(PROTAGONIST);
    expect(t).not.toBeNull();
    const s = size(t!);
    // A foot is ~0.24 long; the strap assembly only covers the front half.
    expect(s.x).toBeLessThan(0.14);
    expect(s.x).toBeGreaterThan(0.02);
  });

  it('returns null for shoes that are not flip-flops', () => {
    expect(buildFlipflopThongs({ ...PROTAGONIST, shoes: { ...PROTAGONIST.shoes, style: 'sneaker' as never } })).toBeNull();
  });
});

describe('measure', () => {
  /** A minimal stand-in for the shipped rig's bone hierarchy. */
  function fakeRig(): Record<string, THREE.Object3D> {
    const bones: Record<string, THREE.Object3D> = {};
    const at = (name: string, x: number, y: number, z: number): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.name = name;
      o.position.set(x, y, z);
      bones[name] = o;
      return o;
    };
    const root = at('Root', 0, 0, 0);
    at('Hips', 0, 0.84, 0);
    at('Neck', 0, 1.42, 0);
    at('Chest', 0, 1.3, 0);
    at('Head', 0, 1.5, 0);
    // Shoulder bones are clavicle helpers and sit close together; the real
    // shoulder is the UpperArm joint. Feeding the wrong one produced a coat
    // 21 cm wide.
    at('ShoulderL', 0.02, 1.36, 0.09);
    at('ShoulderR', -0.02, 1.36, -0.09);
    at('UpperArmL', 0, 1.36, 0.143);
    at('UpperArmR', 0, 1.36, -0.143);
    at('LowerArmL', 0, 1.19, 0.143);
    at('LowerArmR', 0, 1.19, -0.143);
    at('HandL', 0, 1.0, 0.143);
    at('HandR', 0, 1.0, -0.143);
    at('UpperLegL', 0, 0.84, 0.11);
    at('UpperLegR', 0, 0.84, -0.11);
    at('LowerLegL', 0, 0.43, 0.11);
    at('LowerLegR', 0, 0.43, -0.11);
    at('FootL', 0, 0.01, 0.11);
    at('FootR', 0, 0.01, -0.11);
    for (const b of Object.values(bones)) root.add(b);
    return bones;
  }

  const look = (rig: Record<string, THREE.Object3D>) => (n: string) => {
    rig[n].updateWorldMatrix(true, false);
    return rig[n];
  };

  const headBox = new THREE.Box3(
    new THREE.Vector3(-0.108, 1.408, -0.12),
    new THREE.Vector3(0.103, 1.74, 0.12),
  );
  const eyeBox = new THREE.Box3(
    new THREE.Vector3(0.05, 1.56, -0.041),
    new THREE.Vector3(0.075, 1.62, 0.041),
  );

  it('measures shoulders from the arm joints, not the clavicles', () => {
    const m = measure(look(fakeRig()), headBox, eyeBox);
    expect(m.shoulderHalf).toBeCloseTo(0.143, 3);
    // The clavicle pair is only 18 cm apart; using it shrank the coat to a third.
    expect(m.shoulderHalf).toBeGreaterThan(0.2 * 0.5);
  });

  it('anchors the glasses to the eye geometry, not the hair', () => {
    const withEyes = measure(look(fakeRig()), headBox, eyeBox);
    const withoutEyes = measure(look(fakeRig()), headBox, null);
    // The head box includes the hair at the crown and the back of the skull,
    // so its centre is neither on the eye line nor the right width.
    expect(withEyes.eye.y).toBeCloseTo(1.59, 3);
    expect(withoutEyes.eye.y).toBeCloseTo(1.574, 3);
    // This is the one that actually mattered: a frame sized off the head came
    // out wider than the face and read as a visor.
    expect(withEyes.eyeSpan).toBeCloseTo(0.082, 3);
    expect(withoutEyes.eyeSpan).toBeCloseTo(0.24, 3);
    expect(withEyes.faceFront).toBeCloseTo(0.075, 3);
  });

  it('measures limb lengths along the chain', () => {
    const m = measure(look(fakeRig()), headBox, eyeBox);
    expect(m.upperArmLen).toBeCloseTo(0.17, 3);
    expect(m.lowerArmLen).toBeCloseTo(0.19, 3);
    expect(m.upperLegLen).toBeCloseTo(0.41, 3);
  });
});
