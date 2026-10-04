import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { carveTriangles, openCoatFront, paintLegs } from './glbBody';

/** A flat XZ quad grid standing in for a skinned mesh, in character space. */
function quadGrid(cols: number, rows: number, x0: number, z0: number, dx: number, dz: number, y0: number, dy: number): {
  mesh: THREE.Mesh;
  world: Float32Array;
} {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) pos.push(x0 + c * dx, y0 + r * dy, z0 + c * dz);
  }
  const w = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * w + c;
      idx.push(i, i + w, i + 1, i + 1, i + w, i + w + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.updateWorldMatrix(true, true);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const world = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    world[i * 3] = p.getX(i);
    world[i * 3 + 1] = p.getY(i);
    world[i * 3 + 2] = p.getZ(i);
  }
  return { mesh, world };
}

const triCount = (m: THREE.Mesh): number => (m.geometry.getIndex()!.count / 3);

describe('carveTriangles', () => {
  it('removes whole triangles and carries every vertex attribute across', () => {
    const { mesh, world } = quadGrid(2, 2, 0, 0, 1, 0, 0, 1);
    // A weight attribute would be dropped by a naive rebuild; a skinned mesh
    // would then lose its skinning and the model would collapse.
    const w = new Float32Array(mesh.geometry.getAttribute('position').count * 2).fill(0.5);
    mesh.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(w, 2));

    const removed = carveTriangles(mesh, world, (a, b, c) => a.y > 0.5 && b.y > 0.5 && c.y > 0.5);
    expect(removed).toBeGreaterThan(0);
    expect(triCount(mesh)).toBe(8 - removed);
    expect(mesh.geometry.getAttribute('skinWeight')).toBeDefined();
    expect(mesh.geometry.getAttribute('position').count).toBe((8 - removed) * 3);
  });

  it('drops every triangle when the test matches all of them', () => {
    const { mesh, world } = quadGrid(1, 1, 0, 0, 1, 0, 0, 1);
    expect(carveTriangles(mesh, world, () => true)).toBe(2);
    expect(triCount(mesh)).toBe(0);
  });
});

describe('openCoatFront', () => {
  it('opens a slot down the front only, keeping the back and the shoulders', () => {
    // Torso standing 0.9..1.5 high, facing +X, centre line at z = 0.
    const { mesh, world } = quadGrid(4, 4, 0, 0, 0.1, 0.1, 0.9, 0.15);
    // Push z across -0.2..0.2 by rebuilding the grid along the second axis.
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, -0.2 + (i % 5) * 0.1);
    pos.needsUpdate = true;
    for (let i = 0; i < world.length; i += 3) {
      world[i + 1] = pos.getY(i / 3);
      world[i + 2] = pos.getZ(i / 3);
    }

    const before = triCount(mesh);
    // A grid triangle spans two adjacent z columns, so the half-width has to
    // be at least one column wider than the centre line or nothing qualifies.
    const half = 0.11;
    const removed = openCoatFront(mesh, world, { hipY: 0.9, neckY: 1.5, halfWidth: half });
    expect(removed).toBeGreaterThan(0);
    expect(triCount(mesh)).toBe(before - removed);

    // The cut follows whole triangles, so the guarantee is "no triangle
    // remains fully inside the slot" — vertices on the slot's rim belong to
    // triangles that straddle it and are deliberately kept.
    const out = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = mesh.geometry.getIndex()!;
    const inSlot = (i: number): boolean =>
      out.getX(i) > 0 && Math.abs(out.getZ(i)) < half && out.getY(i) > 0.9 && out.getY(i) < 1.5;
    for (let t = 0; t < triCount(mesh); t++) {
      const a = idx.getX(t * 3);
      const b = idx.getX(t * 3 + 1);
      const c = idx.getX(t * 3 + 2);
      expect(inSlot(a) && inSlot(b) && inSlot(c)).toBe(false);
    }
    // The back of the torso must be completely untouched.
    for (let i = 0; i < out.count; i++) {
      if (out.getX(i) < 0) expect(Math.abs(out.getZ(i)) < half).toBe(false);
    }
  });
});

describe('paintLegs', () => {
  it('splits the leg into shorts and bare shin at the knee', () => {
    const { mesh, world } = quadGrid(2, 4, 0, 0, 0.1, 0, 0.1, 0.2);
    const shorts = new THREE.Color(0x878a8d);
    const skin = new THREE.Color(0xd2b49a);
    const res = paintLegs(mesh, world, shorts, skin);

    expect(res.shorts).toBeGreaterThan(0);
    expect(res.shin).toBeGreaterThan(0);
    expect(res.kneeY).toBeGreaterThan(0.1);
    expect(res.kneeY).toBeLessThan(0.9);

    // A shin vertex must actually be skin-coloured, or the "shorts" are just
    // long trousers and the silhouette never changes.
    const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let sawSkin = false;
    let sawShort = false;
    for (let i = 0; i < pos.count; i++) {
      // The attribute round-trips through a Float32Array, so comparing
      // against the float64 channel values fails by ~1e-8.
      const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
      const isSkin = near(col.getX(i), skin.r) && near(col.getY(i), skin.g) && near(col.getZ(i), skin.b);
      if (pos.getY(i) < res.kneeY) expect(isSkin).toBe(true);
      else { expect(isSkin).toBe(false); sawShort = true; }
      if (isSkin) sawSkin = true;
    }
    expect(sawSkin).toBe(true);
    expect(sawShort).toBe(true);
  });
});
