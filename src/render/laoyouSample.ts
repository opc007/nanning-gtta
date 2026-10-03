/**
 * Visual sample for 复记老友粉 only: a warm qilou front, the street in front of
 * it, and a dressed interior. The rest of the street keeps the existing
 * district meshes. Furniture is CC0 KayKit restaurant / city bits; the arcade,
 * sign, lanterns, steam and chopsticks are modeled to match that palette.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NanningBuilding, NanningCity, ShopUnit } from '../nanning/layout';
import { buildInterior, type InteriorLayout, type ShopShell } from '../nanning/interiors';
import type { ModernDistrict } from './modernCity';
import { assetUrl, styledMesh, toonGradient, toonMat } from './toon';

const SHOP_ID = 'fuji';

export interface LaoyouSample {
  readonly group: THREE.Group;
  readonly ready: Promise<void>;
  update(dt: number): void;
}

interface OmitVisual {
  omitVisual(shopId: string): void;
}

interface Prep {
  scene: THREE.Object3D;
  /** Unscaled height, metres in the source file. */
  height: number;
  /** Unscaled max axis. */
  maxAxis: number;
  /** World y needed to sit the unscaled model on y=0. */
  lift: number;
}

const bucket = new Map<string, { mat: THREE.Material; parts: THREE.BufferGeometry[] }>();

function put(name: string, color: number, geo: THREE.BufferGeometry, emissive = 0, emissiveIntensity = 0): void {
  let slot = bucket.get(name);
  if (!slot) {
    const mat = emissive
      ? toonMat(color, { emissive, emissiveIntensity })
      : toonMat(color);
    slot = { mat, parts: [] };
    bucket.set(name, slot);
  }
  slot.parts.push(geo);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cyl(r: number, h: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y, z);
  return g;
}

export function mountLaoyouSample(
  scene: THREE.Scene,
  city: NanningCity,
  district: ModernDistrict,
  interiors: OmitVisual,
): LaoyouSample | null {
  const unit = city.shops.find((s) => s.def.id === SHOP_ID && !s.nightOnly);
  if (!unit) return null;
  const building = city.buildings[unit.building] as NanningBuilding | undefined;
  if (!building) return null;

  interiors.omitVisual(unit.id);
  bucket.clear();

  const group = new THREE.Group();
  group.name = 'laoyou-sample';
  scene.add(group);

  const W = building.width;
  const D = building.depth;
  const cx = building.cx;
  const cz = building.cz;
  const front = cx + D / 2;
  const back = cx - D / 2;
  const z0 = cz - W / 2;
  const z1 = cz + W / 2;
  const floorY = 0.15;

  buildShell(front, back, z0, z1, cz, building.height);
  const sign = hangSign(unit, front, cz, W, district);
  group.add(sign);

  const shell: ShopShell = {
    id: unit.id,
    kind: unit.def.kind,
    x: unit.x,
    z: unit.z,
    nx: unit.nx,
    nz: unit.nz,
    cx,
    cz,
    depth: D,
    width: W,
  };
  const layout = buildInterior(shell);
  buildInteriorShell(shell, layout);

  for (const slot of bucket.values()) {
    if (!slot.parts.length) continue;
    const geo = slot.parts.length === 1 ? slot.parts[0] : mergeGeometries(slot.parts);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, slot.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const lights = addLights(group, front, cz, back);
  const steam: THREE.Sprite[] = [];
  const potAnchor = layout.props.find((p) => p.prop === 'grill') ?? layout.props.find((p) => p.prop === 'counter');
  if (potAnchor) {
    const tex = steamTexture();
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        color: 0xfff6ea,
        opacity: 0.35,
      }));
      s.position.set(potAnchor.x + (i - 3) * 0.05, floorY + 1.05, potAnchor.z);
      s.scale.setScalar(0.28 + (i % 3) * 0.06);
      s.userData.seed = i * 0.7;
      group.add(s);
      steam.push(s);
    }
  }

  const ready = dressProps(group, layout, front, back, cz, z0, z1, floorY).catch((err) => {
    console.warn('laoyou props failed', err);
  });

  return {
    group,
    ready,
    update(dt: number): void {
      const t = performance.now() * 0.001;
      for (const s of steam) {
        const seed = s.userData.seed as number;
        const k = (t * 0.35 + seed) % 1;
        s.position.y = (potAnchor ? floorY + 0.95 : 1) + k * 0.7;
        const mat = s.material as THREE.SpriteMaterial;
        mat.opacity = 0.45 * (1 - k);
      }
      for (const light of lights) {
        light.intensity = light.userData.base * (0.92 + Math.sin(t * 2.2 + light.userData.phase) * 0.08);
      }
      void dt;
    },
  };
}

function buildShell(front: number, back: number, z0: number, z1: number, cz: number, _height: number): void {
  const plaster = 'plaster';
  const wood = 'wood';
  const woodDk = 'woodDk';
  const stone = 'stone';
  const tile = 'tile';
  const trim = 'trim';
  const spanZ = z1 - z0;
  const midX = (front + back) / 2;
  const depth = front - back;

  // Two-storey qilou. Ground floor is an open arcade; the upper floor sits on it.
  const wallH = 7.4;
  put(plaster, 0xf4e6d0, box(0.28, wallH, spanZ, back + 0.14, wallH / 2, cz));
  put(plaster, 0xf4e6d0, box(depth, wallH, 0.28, midX, wallH / 2, z0 + 0.14));
  put(plaster, 0xf4e6d0, box(depth, wallH, 0.28, midX, wallH / 2, z1 - 0.14));
  // Upper floor mass, set just behind the arcade line so the walkway stays open.
  put(plaster, 0xf7ecda, box(depth - 0.4, 3.6, spanZ - 0.5, midX - 0.15, 5.3, cz));
  // Street piers flanking the opening.
  for (const z of [cz - 2.4, cz + 2.4]) {
    put(stone, 0xe7dccb, box(0.42, 3.15, 0.46, front - 0.2, 1.58, z));
  }
  // Cornice, parapet, red roof edge.
  put(wood, 0x8d5a34, box(depth + 0.7, 0.28, spanZ + 0.5, midX, 7.55, cz));
  put(trim, 0xb4332a, box(depth + 0.9, 0.12, spanZ + 0.7, midX, 7.75, cz));
  put(tile, 0xc4533c, box(depth + 0.3, 0.45, spanZ + 0.2, midX, 8.05, cz));
  put(woodDk, 0x5c3a22, box(depth + 0.15, 0.7, 0.18, midX, 8.45, z0 + 0.2));
  put(woodDk, 0x5c3a22, box(depth + 0.15, 0.7, 0.18, midX, 8.45, z1 - 0.2));

  // Arcade soffit and beams, covering the generic grey slab under this shop only.
  const soffitX = (front + (front + 2.35)) / 2;
  put(wood, 0xa56b3c, box(2.45, 0.1, spanZ - 0.2, soffitX, 2.98, cz));
  for (let i = 0; i < 6; i++) {
    const z = z0 + 0.8 + ((spanZ - 1.6) * i) / 5;
    put(woodDk, 0x6b4428, box(2.3, 0.08, 0.1, soffitX, 2.9, z));
  }

  // Round columns on the existing column line (x = -4.5) so they swallow the boxes.
  const colX = front + 2.4;
  for (let z = -148.8; z <= z1 - 0.3; z += 4.4) {
    if (z < z0 + 0.2 || z > z1 - 0.2) continue;
    if (Math.abs(z - cz) < 1.15) continue;
    put(stone, 0xefe4d4, cyl(0.2, 2.85, colX, 1.5, z));
    put(stone, 0xd9cebc, cyl(0.28, 0.16, colX, 0.12, z));
    put(wood, 0x8d5a34, box(0.55, 0.16, 0.55, colX, 2.95, z));
  }

  // Upper windows: wood grid, coloured panes.
  const winColors = [0xc4483a, 0xe0b15a, 0x3d7a62, 0x2f5f98];
  const winY = 5.15;
  const winZ0 = cz - 3.2;
  for (let i = 0; i < 4; i++) {
    const z = winZ0 + i * 2.15;
    put(woodDk, 0x4e3424, box(0.12, 1.35, 1.15, front - 0.02, winY, z));
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const pane = new THREE.PlaneGeometry(0.42, 0.48);
        pane.rotateY(Math.PI / 2);
        pane.translate(front + 0.02, winY - 0.28 + r * 0.55, z - 0.26 + c * 0.52);
        put(`pane${i}${r}${c}`, winColors[(i + r + c) % winColors.length], pane, winColors[(i + r + c) % winColors.length], 0.35);
      }
    }
  }

  // Door threshold and a red step so the opening reads from the street.
  put(wood, 0x9a6240, box(1.1, 0.06, 2.4, front + 0.3, 0.18, cz));
  put(trim, 0xa32e28, box(0.18, 0.08, 2.6, front + 0.05, 0.22, cz));

  // Noren in the doorway, and a rail so the arcade reads as a qilou and not a slab.
  const norenColors = [0xf4efe4, 0xa32e28, 0xf4efe4, 0xa32e28, 0xf4efe4];
  norenColors.forEach((color, i) => {
    const z = cz - 1.15 + i * 0.58;
    put(i % 2 ? 'norenRed' : 'noren', color, box(0.025, 0.85, 0.42, front + 0.08, 2.35, z));
  });
  put(woodDk, 0x4e3424, box(0.08, 0.08, 3.2, front + 0.08, 2.8, cz));
  put(wood, 0x8d5a34, box(2.5, 0.08, 0.08, soffitX, 3.15, z0 + 0.35));
  put(wood, 0x8d5a34, box(2.5, 0.08, 0.08, soffitX, 3.15, z1 - 0.35));
  // Warm bulbs along the soffit. They are emissive so bloom picks them up.
  for (let i = 0; i < 7; i++) {
    const z = z0 + 0.9 + ((spanZ - 1.8) * i) / 6;
    const bulb = new THREE.SphereGeometry(0.06, 8, 6);
    bulb.translate(soffitX, 2.78, z);
    put(`bulb${i}`, 0xffe1a8, bulb, 0xffc56a, 0.9);
  }
}

function hangSign(
  unit: ShopUnit,
  front: number,
  cz: number,
  width: number,
  district: ModernDistrict,
): THREE.Group {
  const g = new THREE.Group();
  const boardW = Math.min(6.4, width * 0.42);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 1.15, boardW),
    toonMat(0x6b3a22),
  );
  board.position.set(front + 0.35, 3.55, cz);
  board.castShadow = true;
  g.add(board);

  const neonMat = new THREE.MeshBasicMaterial({
    color: unit.def.signColor,
    toneMapped: false,
    transparent: true,
    opacity: 0.95,
  });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.2, 0.08), neonMat);
  neon.position.set(front + 0.43, 3.05, cz);
  neon.rotation.y = Math.PI / 2;
  g.add(neon);

  // Painted name. The shop system swaps this material's map when the front is smashed.
  const signMat = new THREE.MeshBasicMaterial({ map: heroSignTexture(unit.def.name), toneMapped: false });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(boardW - 0.36, 0.78), signMat);
  sign.position.set(front + 0.43, 3.55, cz);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);

  const glass = new THREE.MeshStandardMaterial({ color: 0xfff1dc, emissive: 0xffb060, emissiveIntensity: 0.4, roughness: 0.4 });
  district.shopMeshes.set(unit.building, {
    sign,
    signMat,
    neon: neonMat,
    glass,
    litMats: [neonMat, signMat],
  });
  district.glowMats.push(neonMat, signMat);
  district.windowMats.push(glass);

  // Chains.
  for (const z of [-boardW * 0.32, boardW * 0.32]) {
    g.add(styledMesh(box(0.03, 0.45, 0.03, front + 0.35, 4.2, cz + z), toonMat(0x3a3a3a), 0));
  }
  return g;
}

function heroSignTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6e2b8';
  g.fillRect(0, 0, 1024, 320);
  g.strokeStyle = '#7a3b22';
  g.lineWidth = 18;
  g.strokeRect(16, 16, 992, 288);
  g.fillStyle = '#8c2f24';
  g.font = '700 132px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 512, 150);
  g.font = '500 42px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  g.fillStyle = '#6a4a32';
  g.fillText('中山路  ·  老友粉', 512, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function menuTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 768;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f8efdc';
  g.fillRect(0, 0, 512, 768);
  g.strokeStyle = '#8c3a28';
  g.lineWidth = 16;
  g.strokeRect(12, 12, 488, 744);
  g.fillStyle = '#9a2e24';
  g.font = '700 64px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  g.textAlign = 'center';
  g.fillText('复记', 256, 100);
  g.font = '600 36px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  g.fillText('今日粉单', 256, 160);
  const rows = [
    ['老友粉', '12'],
    ['猪杂粉', '15'],
    ['老友面', '12'],
    ['加蛋', '2'],
  ];
  g.textAlign = 'left';
  g.font = '500 40px "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif';
  rows.forEach((row, i) => {
    const y = 260 + i * 100;
    g.fillStyle = '#3a2a22';
    g.fillText(row[0], 70, y);
    g.textAlign = 'right';
    g.fillText(`¥${row[1]}`, 440, y);
    g.textAlign = 'left';
    g.strokeStyle = '#e4d2b4';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(70, y + 24);
    g.lineTo(440, y + 24);
    g.stroke();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildInteriorShell(shell: ShopShell, layout: InteriorLayout): void {
  const b = layout.bounds;
  const y = 0.16;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX - 0.7;
  const d = b.maxZ - b.minZ - 0.7;
  // Floor planks.
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const zz = b.minZ + 0.45 + ((d - 0.2) * (i + 0.5)) / planks;
    const colorName = i % 2 === 0 ? 'floorA' : 'floorB';
    put(colorName, i % 2 === 0 ? 0xc4894e : 0xb37842, box(w, 0.05, d / planks - 0.02, cx, y, zz));
  }
  // Wainscot and a red chair rail. Street face stays open.
  const h = 2.55;
  const backX = shell.nx > 0 ? b.minX + 0.28 : b.maxX - 0.28;
  put('wall', 0xf7efe2, box(0.08, h, d, backX, y + h / 2, cz));
  put('wain', 0xd7b07a, box(0.1, 1.05, d, backX + shell.nx * 0.02, y + 0.52, cz));
  put('rail', 0xa32e28, box(0.12, 0.06, d, backX + shell.nx * 0.04, y + 1.08, cz));
  for (const z of [b.minZ + 0.28, b.maxZ - 0.28]) {
    put('wall', 0xf7efe2, box(w, h, 0.08, cx, y + h / 2, z));
    put('wain', 0xd7b07a, box(w, 1.05, 0.1, cx, y + 0.52, z));
    put('rail', 0xa32e28, box(w, 0.06, 0.12, cx, y + 1.08, z));
  }
  put('ceil', 0xf3e6cf, box(w - 0.2, 0.06, d - 0.2, cx, y + 2.7, cz));
  // Open shelf on the back wall: bowls and jars land on it once the props load.
  put('shelf', 0x8a4e2e, box(0.34, 0.06, Math.min(d - 0.4, 3.2), backX + shell.nx * 0.28, y + 1.45, cz));
  put('shelf', 0x6e3e24, box(0.06, 0.7, Math.min(d - 0.4, 3.2), backX + shell.nx * 0.12, y + 1.15, cz));

  // Menu boards on the side walls.
  const tex = menuTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  // Stored later by the caller via the scene graph — menus are separate meshes
  // because they carry a unique texture. Hang them from a well-known group name.
  const boards = new THREE.Group();
  boards.name = 'laoyou-menus';
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.7), mat);
    m.position.set(cx - 1.2, y + 1.55, cz + side * (d / 2 - 0.08));
    m.rotation.y = side > 0 ? Math.PI : 0;
    boards.add(m);
    const frame = styledMesh(box(1.25, 1.82, 0.06, 0, 0, 0), toonMat(0x6b3f28), 0.01);
    frame.position.copy(m.position);
    frame.position.z += side * -0.02;
    boards.add(frame);
  }
  // The group is parented by mount() after the shell flush; stash it.
  menuHolder = boards;

  // Counter along the back, independent of the GLB load so the room is never empty.
  const counter = layout.props.find((p) => p.prop === 'counter');
  if (counter) {
    put('counter', 0x8a4e2e, box(counter.w, 0.92, counter.d, counter.x, y + 0.46, counter.z));
    put('counterTop', 0xe7d3b0, box(counter.w + 0.08, 0.06, counter.d + 0.08, counter.x, y + 0.95, counter.z));
    put('counter', 0x6e3e24, box(0.08, 0.9, counter.d, counter.x, y + 0.45, counter.z));
  }
}

let menuHolder: THREE.Group | null = null;

function addLights(group: THREE.Group, front: number, cz: number, back: number): THREE.PointLight[] {
  const spots: [number, number, number][] = [
    [front + 1.3, 2.7, cz - 1.6],
    [front + 1.3, 2.7, cz + 1.6],
    [front + 1.6, 2.55, cz],
    [(front + back) / 2, 2.4, cz - 1.2],
    [(front + back) / 2, 2.4, cz + 1.2],
    [back + 1.3, 2.15, cz],
  ];
  const lights: THREE.PointLight[] = [];
  spots.forEach(([x, y, z], i) => {
    const light = new THREE.PointLight(0xffb067, 28, 9.5, 1.6);
    light.position.set(x, y, z);
    light.userData.base = 26 + (i % 3) * 6;
    light.userData.phase = i;
    light.intensity = light.userData.base;
    group.add(light);
    lights.push(light);
    // Lantern body.
    const lathe = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.03, 0),
        new THREE.Vector2(0.16, 0.08),
        new THREE.Vector2(0.26, 0.26),
        new THREE.Vector2(0.24, 0.48),
        new THREE.Vector2(0.08, 0.62),
      ],
      12,
    );
    const lantern = new THREE.Mesh(
      lathe,
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xfff0c8 : 0xffb3a0, toneMapped: false }),
    );
    lantern.position.set(x, y - 0.15, z);
    group.add(lantern);
    group.add(styledMesh(box(0.08, 0.05, 0.08, x, y + 0.22, z), toonMat(0x5c3a22), 0));
  });
  return lights;
}

function steamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  rad.addColorStop(0, 'rgba(255,255,255,0.7)');
  rad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PROP_FILES = [
  'table_round_A_small',
  'chair_stool',
  'bowl',
  'bowl_small',
  'stew_bowl',
  'pot_A_stew',
  'stew_pot',
  'crate',
  'plate',
  'jar_A_small',
  'cuttingboard',
  'menu',
  'bush',
] as const;

async function dressProps(
  group: THREE.Group,
  layout: InteriorLayout,
  front: number,
  back: number,
  cz: number,
  z0: number,
  z1: number,
  floorY: number,
): Promise<void> {
  if (menuHolder) group.add(menuHolder);
  const loader = new GLTFLoader();
  const preps = new Map<string, Prep>();
  await Promise.all(PROP_FILES.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(assetUrl(`assets/props/${name}.gltf`));
      stylize(gltf.scene);
      preps.set(name, measure(gltf.scene));
    } catch (err) {
      console.warn('missing prop', name, err);
    }
  }));

  const place = (name: string, x: number, y: number, z: number, rot = 0, fit?: number): void => {
    const prep = preps.get(name);
    if (!prep) return;
    const obj = prep.scene.clone(true);
    const s = fit ?? 1;
    obj.scale.setScalar(s);
    obj.position.set(x, y + prep.lift * s, z);
    obj.rotation.y = rot;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    group.add(obj);
  };

  for (const p of layout.props) {
    if (p.prop === 'table-square' || p.prop === 'table-round') {
      place('table_round_A_small', p.x, floorY, p.z, p.rot, fitHeight(preps.get('table_round_A_small'), 0.76));
      place('stew_bowl', p.x, floorY + 0.76, p.z, 0.4, fitHeight(preps.get('stew_bowl'), 0.09));
      place('bowl_small', p.x + 0.18, floorY + 0.76, p.z + 0.12, 1.2, fitHeight(preps.get('bowl_small'), 0.06));
      chopsticks(group, p.x + 0.05, floorY + 0.8, p.z - 0.12);
      place('plate', p.x - 0.16, floorY + 0.76, p.z + 0.08, 0.2, fitMax(preps.get('plate'), 0.22));
    } else if (p.prop === 'stool') {
      place('chair_stool', p.x, floorY, p.z, p.rot, fitHeight(preps.get('chair_stool'), 0.5));
    } else if (p.prop === 'counter' || p.prop === 'grill') {
      place('pot_A_stew', p.x, floorY + (p.prop === 'counter' ? 0.98 : 0.9), p.z, 0.3, fitHeight(preps.get('pot_A_stew'), 0.32));
      place('bowl', p.x + 0.35, floorY + 0.98, p.z + 0.2, 0, fitHeight(preps.get('bowl'), 0.08));
      place('jar_A_small', p.x - 0.4, floorY + 0.98, p.z - 0.15, 0.5, fitHeight(preps.get('jar_A_small'), 0.2));
      place('cuttingboard', p.x + 0.15, floorY + 0.98, p.z - 0.25, 0.8, fitMax(preps.get('cuttingboard'), 0.38));
      place('menu', p.x - 0.1, floorY + 0.98, p.z + 0.35, 0.2, fitHeight(preps.get('menu'), 0.28));
    }
  }

  // Street clutter directly in front of this shop, not the rest of the run.
  const colX = front + 1.5;
  place('crate', colX, floorY, cz - 2.3, 0.4, fitHeight(preps.get('crate'), 0.42));
  place('crate', colX, floorY + 0.42, cz - 2.3, 0.9, fitHeight(preps.get('crate'), 0.42));
  place('crate', colX + 0.15, floorY, cz + 2.15, 0.2, fitHeight(preps.get('crate'), 0.45));
  place('bush', front + 2.55, 0, cz - 3.1, 0.5, fitHeight(preps.get('bush'), 0.7));
  place('bush', front + 2.55, 0, cz + 3.05, 1.1, fitHeight(preps.get('bush'), 0.65));
  place('bush', -3.1, 0, cz - 1.4, 0.3, fitHeight(preps.get('bush'), 0.55));
  place('bush', -3.1, 0, cz + 1.6, 0.8, fitHeight(preps.get('bush'), 0.6));
  place('bush', front + 2.2, 0, cz - 1.7, 0.2, fitHeight(preps.get('bush'), 0.48));
  place('bush', front + 2.2, 0, cz + 1.75, 1.4, fitHeight(preps.get('bush'), 0.5));
  // Shelf still-life: jars, bowls, a spare pot. Back wall is the -X side.
  const shelfX = back + 0.85;
  place('jar_A_small', shelfX, floorY + 1.35, cz - 0.7, 0.4, fitHeight(preps.get('jar_A_small'), 0.22));
  place('jar_A_small', shelfX, floorY + 1.35, cz - 0.25, 1.1, fitHeight(preps.get('jar_A_small'), 0.26));
  place('bowl', shelfX, floorY + 1.35, cz + 0.25, 0.3, fitHeight(preps.get('bowl'), 0.09));
  place('bowl_small', shelfX, floorY + 1.35, cz + 0.55, 0.8, fitHeight(preps.get('bowl_small'), 0.07));
  place('stew_pot', shelfX, floorY + 1.35, cz + 0.95, 0.6, fitHeight(preps.get('stew_pot'), 0.16));
  place('crate', back + 1.15, floorY, cz - 2.4, 0.5, fitHeight(preps.get('crate'), 0.38));
  place('plate', shelfX + 0.02, floorY + 1.35, cz + 0.05, 0.2, fitMax(preps.get('plate'), 0.2));
  // Pots under the bushes on the arcade.
  for (const z of [cz - 3.1, cz + 3.05]) {
    group.add(styledMesh(cyl(0.22, 0.28, front + 2.55, 0.16, z), toonMat(0xc4553a), 0.008));
    group.add(styledMesh(cyl(0.26, 0.06, front + 2.55, 0.32, z), toonMat(0xe7d3b0), 0));
  }
  void z0;
  void z1;
}

function chopsticks(group: THREE.Group, x: number, y: number, z: number): void {
  const mat = toonMat(0xd8b07a);
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.004, 0.003, 0.24, 5);
    g.rotateZ(0.7);
    g.rotateX(0.4 * s);
    g.translate(x + s * 0.02, y, z);
    group.add(styledMesh(g, mat, 0));
  }
}

function stylize(root: THREE.Object3D): void {
  const cache = new Map<THREE.Texture | null, THREE.MeshToonMaterial>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const prev = mesh.material as THREE.MeshStandardMaterial;
    const map = (prev && prev.map) || null;
    let mat = cache.get(map);
    if (!mat) {
      mat = new THREE.MeshToonMaterial({
        map,
        color: 0xffffff,
        gradientMap: toonGradient(),
      });
      cache.set(map, mat);
    }
    mesh.material = mat;
  });
}

function measure(scene: THREE.Object3D): Prep {
  scene.position.set(0, 0, 0);
  scene.scale.set(1, 1, 1);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  return {
    scene,
    height: Math.max(size.y, 0.001),
    maxAxis: Math.max(size.x, size.y, size.z, 0.001),
    lift: -box.min.y,
  };
}

function fitHeight(prep: Prep | undefined, target: number): number {
  if (!prep) return 1;
  return target / prep.height;
}

function fitMax(prep: Prep | undefined, target: number): number {
  if (!prep) return 1;
  return target / prep.maxAxis;
}
