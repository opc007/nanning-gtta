/**
 * Shared stylized shading for the sample: a 4-step gradient so MeshToonMaterial
 * reads as soft cartoon bands (Zelda / Animal Crossing) instead of a flat fill.
 */

import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;
let softGradient: THREE.DataTexture | null = null;

/** Softer bands for a textured character, so painted faces are not crushed. */
export function toonGradientSoft(): THREE.DataTexture {
  if (softGradient) return softGradient;
  const data = new Uint8Array([
    168, 168, 168, 255,
    196, 196, 196, 255,
    224, 224, 224, 255,
    242, 242, 242, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 5, 1);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  softGradient = tex;
  return tex;
}

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([
    78, 78, 78, 255,
    150, 150, 150, 255,
    214, 214, 214, 255,
    255, 255, 255, 255,
  ]);
  const tex = new THREE.DataTexture(data, 4, 1);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  gradient = tex;
  return tex;
}

const OUTLINE = new THREE.MeshBasicMaterial({
  color: 0x3a2c24,
  side: THREE.BackSide,
  toneMapped: true,
});

export function toonMat(color: number, opts: { emissive?: number; emissiveIntensity?: number; map?: THREE.Texture | null } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  return m;
}

/** A mesh plus a thin inverted-hull outline so the shape reads at arm's length. */
export function styledMesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  outline = 0.016,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline > 0) {
    const hullGeo = geo.clone();
    const pos = hullGeo.getAttribute('position');
    const nor = hullGeo.getAttribute('normal');
    if (pos && nor) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + nor.getX(i) * outline,
          pos.getY(i) + nor.getY(i) * outline,
          pos.getZ(i) + nor.getZ(i) * outline,
        );
      }
      pos.needsUpdate = true;
    }
    const hull = new THREE.Mesh(hullGeo, OUTLINE);
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.frustumCulled = false;
    mesh.add(hull);
  }
  mesh.frustumCulled = false;
  return mesh;
}

export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}${path.replace(/^\//, '')}`;
}
