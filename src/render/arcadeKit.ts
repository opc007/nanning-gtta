/**
 * The 骑楼 colonnade, rebuilt from the Kenney Building Kit.
 *
 * The district geometry is merged per material — eighty buildings cost about
 * eight draw calls, not four hundred — so the kit's parts cannot simply be
 * dropped in as individual meshes along the frontage. They are loaded once,
 * their geometry is merged into a single buffer per part type, and instances of
 * that buffer are positioned along the arcade.
 *
 * The Kit's `colormap.png` is shared, and the brief's one hard rule about it:
 * do not tint `material.color` to recolour a wall. The colormap is an atlas,
 * so multiplying shifts every surface in the pack at once and it goes muddy.
 * Recolouring means copying the texture, editing that one texel band, and
 * swapping the map — `recolorWall` below.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = `${import.meta.env.BASE_URL}assets/kenney/building/Models/GLB%20format/`;

function url(file: string): string {
  return BASE + file;
}

export interface ArcadeParts {
  column: THREE.BufferGeometry;
  columnBase: THREE.BufferGeometry;
  window: THREE.BufferGeometry;
  wall: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Metres per kit unit, so callers can size against the real dimensions. */
  unit: number;
}

const cache = new Map<string, Promise<THREE.Object3D>>();

function load(file: string): Promise<THREE.Object3D> {
  const hit = cache.get(file);
  if (hit) return hit;
  const p = new Promise<THREE.Object3D>((resolve) => {
    new GLTFLoader().load(url(file), (g) => resolve(g.scene), undefined, () => resolve(new THREE.Object3D()));
  });
  cache.set(file, p);
  return p;
}

/**
 * Pull one geometry out of a kit part, baked to world units and with its
 * material's texture left in place — merging across parts that share the
 * colormap only works if the UVs survive, and they do, because the atlas is
 * one texture for the whole pack.
 */
async function partGeometry(file: string): Promise<THREE.BufferGeometry | null> {
  const scene = await load(file);
  let geo: THREE.BufferGeometry | null = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (geo || !m.isMesh || !m.geometry?.getAttribute('position')) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // Merging needs matching attribute sets; the kit's parts carry UVs and
    // normals, which is all the atlas needs.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geo = g;
  });
  return geo;
}

/**
 * Copy a texture and repaint one horizontal band of it.
 *
 * The colormap is an atlas, so a wall is a range of v rather than a flat
 * colour. `v0..v1` is that range; the rest is left exactly as it was.
 */
export function recolorWall(
  src: THREE.Texture,
  v0: number,
  v1: number,
  rgb: [number, number, number],
): THREE.Texture {
  const img = src.image as HTMLImageElement;
  if (!img) return src;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const y0 = Math.floor((1 - v1) * img.height);
  const y1 = Math.ceil((1 - v0) * img.height);
  const data = g.getImageData(0, y0, img.width, Math.max(1, y1 - y0));
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
  }
  g.putImageData(data, 0, y0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Load the colonnade kit pieces and merge each into one buffer.
 * Returns null until the pack has arrived, so the caller can keep the old
 * geometry for a frame rather than popping in empty space.
 */
export async function loadArcadeParts(): Promise<ArcadeParts | null> {
  const [column, columnBase, win, wall] = await Promise.all([
    partGeometry('column-thin.glb'),
    partGeometry('wall-corner-column.glb'),
    partGeometry('wall-window-wide-square-detailed.glb'),
    partGeometry('wall-low.glb'),
  ]);
  if (!column) return null;
  const colScene = await load('column-thin.glb');
  let material: THREE.MeshStandardMaterial | null = null;
  colScene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!material && m.isMesh) material = m.material as THREE.MeshStandardMaterial;
  });
  const box = new THREE.Box3().setFromObject(colScene);
  const unit = box.max.y - box.min.y;
  return {
    column: column!,
    columnBase: columnBase ?? column!,
    window: win ?? column!,
    wall: wall ?? column!,
    material: material ?? new THREE.MeshStandardMaterial(),
    unit,
  };
}

/**
 * Lay a colonnade along a straight run.
 *
 * `axis` is the direction the frontage runs; columns alternate sides of the
 * walkway. One merged mesh for the whole run, so a 140 m street is one draw
 * call for its columns rather than one per column.
 */
export function buildColonnade(
  parts: ArcadeParts,
  opts: { from: THREE.Vector3; to: THREE.Vector3; spacing: number; height: number; girth?: number; flip?: boolean },
): THREE.Mesh | null {
  const dir = new THREE.Vector3().subVectors(opts.to, opts.from);
  const len = dir.length();
  if (len < 1) return null;
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(opts.flip ? -1 : 1);
  const colH = opts.height / parts.unit;
  // The kit's column is authored a full kit unit wide, so scaling only Y
  // leaves a one-metre slab standing 4.2 m tall. X and Z have to come down
  // with it or the colonnade reads as a wall, not a row of columns.
  const girth = opts.girth ?? 0.34;
  const parts2: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yaw = Math.atan2(dir.x, dir.z);
  const n = Math.max(2, Math.floor(len / opts.spacing));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * len;
    const p = new THREE.Vector3().copy(opts.from).addScaledVector(dir, t);
    // A column every other bay sits on the wall side; this keeps the
    // alternating rhythm a 骑楼 actually has.
    p.addScaledVector(side, (i % 2 === 0 ? 0.5 : -0.5) * 0.15);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(p, q, new THREE.Vector3(girth, colH, girth));
    parts2.push(parts.column.clone().applyMatrix4(m));
  }
  if (!parts2.length) return null;
  const merged = mergeGeometries(parts2);
  const mesh = new THREE.Mesh(merged, parts.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
