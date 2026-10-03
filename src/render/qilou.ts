/**
 * 骑楼 (Lingnan qilou) mesh builder — the visual signature of 中山路.
 *
 * Anatomy, from the street up:
 *   • 骑楼底 colonnade  — square columns on the frontage line, open arcade behind
 *   • 骑楼 overhang      — the slab the columns carry; second and third floors
 *                          sit on it, so the walkway is genuinely covered
 *   • 满洲窗            — the coloured-glass window grids that give a qilou
 *                          its face; emissive at night, the main night glow
 *   • 封檐板 + 女儿墙   — carved timber cornice and parapet
 *   • 招牌              — vertical or horizontal shop sign, drawn from a canvas
 *                          so the shop name is legible from the street
 *
 * Everything static merges into one vertex-coloured geometry per building, so
 * a 60-unit street costs a handful of draw calls rather than a few hundred.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NanningBuilding } from '../nanning/layout';
import type { ShopDef } from '../nanning/data';

const C = {
  brick: 0x8d9299,
  brickDark: 0x6f747b,
  stone: 0xa8a49c,
  timber: 0x5e4130,
  timberLight: 0x7a5a41,
  rail: 0xd9d3c5,
  column: 0x9c968b,
  ground: 0x54524e,
  roof: 0x4a4844,
};

function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts) as THREE.BufferGeometry;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
};

/**
 * Procedural 满洲窗: a wooden frame filled with a grid of coloured panes.
 * Classic full-height panel proportions, drawn at 128×192.
 */
export function makeManzhouWindowTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d')!;
  const palette = ['#c8342b', '#2e7d5b', '#2a5fa8', '#d9902b', '#7a3f9e', '#c8a33a'];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  g.fillStyle = '#4a3524';
  g.fillRect(0, 0, 128, 192);
  const cols = 3;
  const rows = 4;
  const m = 5; // frame margin
  const cw = (128 - m * 2) / cols;
  const ch = (192 - m * 2) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const col = palette[Math.floor(rnd() * palette.length)];
      g.fillStyle = col;
      g.globalAlpha = 0.55 + rnd() * 0.45;
      g.fillRect(m + i * cw + 1.5, m + j * ch + 1.5, cw - 3, ch - 3);
      // A small motif in the middle of each pane so it doesn't read as flat blocks.
      g.globalAlpha = 0.35;
      g.fillStyle = '#f2e2b8';
      const cx = m + i * cw + cw / 2;
      const cy = m + j * ch + ch / 2;
      g.beginPath();
      g.ellipse(cx, cy, cw * 0.18, ch * 0.26, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  // Muntin grid on top.
  g.strokeStyle = '#3a2a1c';
  g.lineWidth = 3;
  for (let i = 0; i <= cols; i++) {
    g.beginPath();
    g.moveTo(m + i * cw, 0);
    g.lineTo(m + i * cw, 192);
    g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    g.beginPath();
    g.moveTo(0, m + j * ch);
    g.lineTo(128, m + j * ch);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A shop signboard drawn to canvas: the shop's name in Chinese on its brand colour. */
export function makeSignTexture(shop: ShopDef, broken = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(shop.signColor);

  if (broken) {
    g.fillStyle = '#1a1614';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#3a2a22';
    g.lineWidth = 3;
    // Cracks radiating from the middle.
    let s = 7;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.moveTo(256, 64);
      g.lineTo(256 + (rnd() - 0.5) * 460, 64 + (rnd() - 0.5) * 220);
      g.stroke();
    }
    g.fillStyle = '#5c4b40';
    g.font = 'bold 60px "PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('砸 烂 咗', 256, 68);
  } else {
    // Board
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, `#${col.clone().multiplyScalar(1.25).getHexString()}`);
    grad.addColorStop(1, `#${col.clone().multiplyScalar(0.55).getHexString()}`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 128);
    // Bevel
    g.strokeStyle = 'rgba(255,235,190,0.85)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 506, 122);
    // Text — auto-shrink until it fits the board.
    let size = 76;
    g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    while (g.measureText(shop.name).width > 460 && size > 24) {
      size -= 3;
      g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff6e0';
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 8;
    g.fillText(shop.name, 256, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface QilouMesh {
  group: THREE.Group;
  /** Signboard mesh, so the shop system can swap in the "砸烂咗" texture. */
  sign: THREE.Mesh | null;
  signMat: THREE.MeshBasicMaterial | null;
  /** 满洲窗 material — dims as damage climbs, looks like the glass is out. */
  windowMat: THREE.MeshStandardMaterial;
  /** Neon accent strip along the first floor, driven by the shop's brand colour. */
  neonMat: THREE.MeshBasicMaterial | null;
  /** World-space doorway anchor (where the player presses E). */
  door: THREE.Vector3;
}

const ARCADE_H = 3.3; // clear height under the overhang
const SLAB = 0.35; // overhang slab thickness
const COL = 0.55; // column side

/**
 * Build one qilou unit. Local space: X is depth (0 = street face, +X = inland),
 * Z is frontage, Y is up. The caller rotates/positions it.
 */
export function makeQilou(b: NanningBuilding, idx: number, shop: ShopDef | undefined): QilouMesh {
  const group = new THREE.Group();
  const W = b.depth; // frontage along the street (stored in Building.depth)
  const D = b.width; // depth inland
  const H = b.height;
  const halfW = W / 2;

  const parts: THREE.BufferGeometry[] = [];
  const tint = new THREE.Color(b.color);
  const brick = tint.getHex();
  const brickLo = tint.clone().multiplyScalar(0.82).getHex();

  // ── Arcade: ground floor, open to the street ────────────────────────────
  // Floor slab (bluestone under the colonnade) and a ceiling for the overhang.
  parts.push(box(D, 0.2, W, D / 2, -0.1, 0, C.ground));
  parts.push(box(D, SLAB, W, D / 2, ARCADE_H + SLAB / 2, 0, brick));
  // Rear wall of the arcade hall — stops you seeing daylight through the building.
  parts.push(box(0.3, ARCADE_H, W, D - 0.15, ARCADE_H / 2, 0, brickLo));

  // Columns on the frontage line, at both frontage edges.
  for (const sz of [-1, 1]) {
    parts.push(box(COL, ARCADE_H, COL, COL / 2, ARCADE_H / 2, sz * (halfW - COL / 2), C.column));
    // Bracket capital (a very 岭南 detail) where the column meets the slab.
    parts.push(box(COL + 0.35, 0.3, COL + 0.35, COL / 2, ARCADE_H - 0.15, sz * (halfW - COL / 2), C.stone));
  }
  // A mid column on wider units.
  if (W > 8) parts.push(box(COL, ARCADE_H, COL, COL / 2, ARCADE_H / 2, 0, C.column));

  // ── Upper mass ──────────────────────────────────────────────────────────
  const upperH = H - (ARCADE_H + SLAB);
  const upperY = ARCADE_H + SLAB;
  parts.push(box(D, upperH, W, D / 2, upperY + upperH / 2, 0, brick));

  // Floor string courses between storeys.
  const floors = Math.max(1, b.floors ?? 2);
  for (let f = 1; f < floors; f++) {
    const y = upperY + (upperH * f) / floors;
    parts.push(box(D + 0.16, 0.22, W + 0.16, D / 2, y, 0, C.stone));
  }

  // ── Balconies on the first upper floor ──────────────────────────────────
  const balcY = upperY;
  const balcH = 0.95;
  parts.push(box(1.5, 0.16, W, 0.75, balcY + 0.08, 0, C.stone)); // balcony slab
  // Railing: bottom rail, top rail, balusters. Cream, as most qilou are.
  parts.push(box(1.5, 0.1, W, 0.75, balcY + balcH, 0, C.rail));
  parts.push(box(1.45, 0.08, W, 0.75, balcY + 0.2, 0, C.rail));
  const bal = Math.max(4, Math.floor(W / 0.5));
  for (let i = 0; i <= bal; i++) {
    const z = -halfW + (i * W) / bal;
    parts.push(box(1.4, balcH, 0.08, 0.75, balcY + balcH / 2, z, C.rail));
  }

  // ── 封檐板 + 女儿墙 ────────────────────────────────────────────────────
  parts.push(box(D + 0.5, 0.42, W + 0.5, D / 2, H - 0.21, 0, C.timber)); // cornice
  parts.push(box(D + 0.3, 0.16, W + 0.3, D / 2, H - 0.5, 0, C.timberLight)); // carved board
  parts.push(box(D, 0.85, W, D / 2, H + 0.42, 0, brick)); // parapet
  parts.push(box(D + 0.36, 0.2, W + 0.36, D / 2, H + 0.9, 0, C.stone)); // coping

  const massGeo = merge(parts);
  const mass = new THREE.Mesh(
    massGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 }),
  );
  mass.castShadow = true;
  mass.receiveShadow = true;
  group.add(mass);

  // ── 满洲窗 on the first upper floor, facing the street ──────────────────
  const winTex = makeManzhouWindowTexture(idx * 7919 + 13);
  const windowMat = new THREE.MeshStandardMaterial({
    map: winTex,
    emissiveMap: winTex,
    emissive: 0xffffff,
    emissiveIntensity: 1.0,
    roughness: 0.25,
    metalness: 0.1,
  });
  const winW = Math.min(W - 1.0, 3.2);
  const winGeo = new THREE.PlaneGeometry(winW, 1.5);
  for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(winGeo, windowMat);
    w.position.set(-0.02, upperY + 1.55, sz * (W * 0.25));
    w.rotation.y = -Math.PI / 2;
    group.add(w);
  }

  // ── Signboard + neon strip ─────────────────────────────────────────────
  let sign: THREE.Mesh | null = null;
  let signMat: THREE.MeshBasicMaterial | null = null;
  let neonMat: THREE.MeshBasicMaterial | null = null;
  const door = new THREE.Vector3(1.2, 0, 0);

  if (shop) {
    signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(shop), toneMapped: false });
    const signGeo = new THREE.PlaneGeometry(Math.min(W - 0.8, 5.4), Math.min(W - 0.8, 5.4) * 0.25);
    sign = new THREE.Mesh(signGeo, signMat);
    // Above the balcony, hanging off the facade — the classic qilou sign position.
    sign.position.set(-0.06, upperY + 1.5, 0);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);

    // Neon strip washing the shopfront under the arcade.
    const neonGeo = new THREE.PlaneGeometry(W - 0.6, 0.16);
    neonMat = new THREE.MeshBasicMaterial({ color: shop.signColor, toneMapped: false, transparent: true, opacity: 0.92 });
    const neon = new THREE.Mesh(neonGeo, neonMat);
    neon.position.set(-0.05, ARCADE_H - 0.35, 0);
    neon.rotation.y = -Math.PI / 2;
    group.add(neon);

    // Doorway glow in the arcade so the shop is findable at night.
    const doorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.6, 0.1),
      new THREE.MeshBasicMaterial({ color: shop.signColor, toneMapped: false, transparent: true, opacity: 0.6 }),
    );
    doorGlow.rotation.x = -Math.PI / 2;
    doorGlow.position.set(D * 0.4, 0.03, 0);
    group.add(doorGlow);
  }

  // Orient: local +X points inland, so the street face (local x=0) must land on
  // the building's `face` normal, flipped to point at the street.
  const side = Math.sign(b.cx) || 1;
  group.position.set(b.cx, 0, b.cz);
  // For a west-side unit (cx<0) the building is at -X and the street is at 0,
  // so local +X (inland) points toward -X → rotate 180° about Y.
  group.rotation.y = side < 0 ? Math.PI : 0;

  return { group, sign, signMat, windowMat, neonMat, door };
}

/** A plain rectangular block building for the back-lot skyline fill. */
export function makeBlock(b: NanningBuilding): THREE.Group {
  const geo = new THREE.BoxGeometry(b.width, b.height, b.depth);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.9, metalness: 0.05 }),
  );
  mesh.position.set(b.cx, b.height / 2, b.cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // A darker parapet cap so the skyline isn't a row of flat-topped slabs.
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(b.width + 0.4, 0.7, b.depth + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.95 }),
  );
  cap.position.set(b.cx, b.height + 0.35, b.cz);
  const g = new THREE.Group();
  g.add(mesh, cap);
  return g;
}

/** 钟鼓楼 — the plaza landmark, rebuilt from parts so it reads as 城楼 not a box. */
export function makeZhonggulou(b: NanningBuilding): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const w = b.width;
  const d = b.depth;
  // Stone plinth
  parts.push(box(w + 4, 1.1, d + 4, 0, 0.55, 0, C.stone));
  parts.push(box(w + 2.6, 0.5, d + 2.6, 0, 1.3, 0, 0x8f8b83));
  // Ground storey: solid wall with an arched opening suggested by a dark recess.
  const bodyH = 7.2;
  parts.push(box(w, bodyH, d, 0, 1.55 + bodyH / 2, 0, 0xa8a094));
  parts.push(box(w - 3.2, 4.4, 0.5, 0, 4.2, -d / 2 + 0.3, 0x241a14)); // doorway
  // Second storey (the tower) with open balcony on all sides.
  const tY = 1.55 + bodyH;
  parts.push(box(w - 1.2, 0.4, d - 1.2, 0, tY + 0.2, 0, 0x9c9488));
  // Balustrade on the tower base.
  parts.push(box(w - 1.2, 0.9, 0.3, 0, tY + 0.85, -(d - 1.2) / 2, C.rail));
  parts.push(box(w - 1.2, 0.9, 0.3, 0, tY + 0.85, (d - 1.2) / 2, C.rail));
  parts.push(box(0.3, 0.9, d - 1.2, -(w - 1.2) / 2, tY + 0.85, 0, C.rail));
  parts.push(box(0.3, 0.9, d - 1.2, (w - 1.2) / 2, tY + 0.85, 0, C.rail));
  // Upper roof: a hipped tile roof approximated by two stacked tapering boxes.
  const rY = tY + 1.35;
  parts.push(box(w, 0.3, d, 0, rY, 0, C.roof));
  const r1 = new THREE.BoxGeometry(w - 1.0, 1.5, d - 1.0);
  r1.translate(0, rY + 0.9, 0);
  parts.push(paint(r1, 0x54514c));
  const r2 = new THREE.BoxGeometry(w - 2.6, 1.2, d - 2.6);
  r2.translate(0, rY + 2.2, 0);
  parts.push(paint(r2, 0x4e4b46));
  const finial = new THREE.ConeGeometry(0.5, 1.4, 8);
  finial.translate(0, rY + 3.4, 0);
  parts.push(paint(finial, 0xb8912f));

  const mesh = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);

  // The drum under the tower — glowing at night, it's the thing you hear.
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 1.0, 14),
    new THREE.MeshStandardMaterial({ color: 0x8a2a1e, emissive: 0xff4a22, emissiveIntensity: 0.4, roughness: 0.6 }),
  );
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, tY + 0.75, 0);
  g.add(drum);

  g.position.set(b.cx, 0, b.cz);
  return g;
}
