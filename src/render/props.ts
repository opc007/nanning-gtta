/**
 * Nanning street furniture + rooftop clutter.
 *
 * This is the "细腻" layer. A building box with a texture on it is a texture on
 * a box. What makes a Chinese city block read as *a specific Chinese city block*
 * is the junk on it: 空调外机 bolted to every facade, 不锈钢水塔 on every roof,
 * laundry drying on poles, 防盗网 cages over the ground floor, 落水管 running
 * down the corner, glowing 竖招牌 hanging off the frontage, e-bikes rank and
 * file on the pavement. All of it is here, all of it is instanced.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pbr } from './materials';

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(parts) as THREE.BufferGeometry;

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

const bx = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
};

export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Facade details ──────────────────────────────────────────────────────────

/**
 * 空调外机 — a wall-mounted condenser. Every Chinese apartment and shop has
 * three or four of these, and their absence is the fastest way to make a
 * building read as generic.
 */
export function acUnitGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Housing
  parts.push(paint(new THREE.BoxGeometry(0.78, 0.56, 0.34), 0xd6d2c8));
  // Fan grille (a recessed dark disc)
  const grille = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12);
  grille.rotateX(Math.PI / 2);
  grille.translate(0, 0.0, 0.18);
  parts.push(paint(grille, 0x2a2c30));
  // Louvre slats
  for (let i = 0; i < 4; i++) parts.push(bx(0.7, 0.025, 0.02, 0, 0.2 - i * 0.12, 0.175, 0x8d8a82));
  // Wall brackets
  parts.push(bx(0.06, 0.5, 0.12, -0.36, -0.02, -0.2, 0x55575c));
  parts.push(bx(0.06, 0.5, 0.12, 0.36, -0.02, -0.2, 0x55575c));
  // Condensate pipe
  const pipe = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5);
  pipe.translate(0.3, -0.6, 0.02);
  parts.push(paint(pipe, 0x9a978f));
  return merge(parts);
}

/** 不锈钢水塔 — the rooftop water tank. A Nanning rooftop is never empty without one. */
export function waterTankGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 12);
  body.translate(0, 1.15, 0);
  parts.push(paint(body, 0xb9bfc4));
  const lid = new THREE.CylinderGeometry(0.8, 0.8, 0.1, 12);
  lid.translate(0, 1.84, 0);
  parts.push(paint(lid, 0x8f959a));
  // Bands
  for (const y of [0.75, 1.55]) {
    const band = new THREE.CylinderGeometry(0.78, 0.78, 0.07, 12);
    band.translate(0, y, 0);
    parts.push(paint(band, 0x7d8388));
  }
  // Legs
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    parts.push(bx(0.08, 0.55, 0.08, Math.cos(a) * 0.5, 0.27, Math.sin(a) * 0.5, 0x6a6e72));
  }
  // Down pipe
  const dp = new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6);
  dp.translate(0.7, 0.28, 0.1);
  parts.push(paint(dp, 0x8b9095));
  return merge(parts);
}

/** 防盗网 — the security cage bolted over a ground-floor window. */
export function securityGrilleGeometry(w: number, h: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bars = Math.max(4, Math.floor(w / 0.22));
  for (let i = 0; i <= bars; i++) {
    parts.push(bx(0.035, h, 0.035, -w / 2 + (i * w) / bars, h / 2, 0, 0x50545a));
  }
  for (let j = 0; j <= 5; j++) {
    parts.push(bx(w, 0.035, 0.035, 0, (j * h) / 5, 0, 0x50545a));
  }
  parts.push(bx(w + 0.1, 0.07, 0.07, 0, h, 0, 0x5a5e64));
  return merge(parts);
}

/** 落水管 — the rainwater downpipe on a building corner. */
export function downpipeGeometry(h: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(bx(0.13, h, 0.13, 0, h / 2, 0, 0xb0aca2));
  for (let y = 1.2; y < h - 0.4; y += 2.4) {
    const clamp = new THREE.BoxGeometry(0.2, 0.1, 0.2);
    clamp.translate(0, y, 0);
    parts.push(paint(clamp, 0x7d7a73));
  }
  // Elbow at the bottom
  const elbow = new THREE.CylinderGeometry(0.13, 0.13, 0.4, 6);
  elbow.rotateX(Math.PI / 2.2);
  elbow.translate(0, 0.25, 0.18);
  parts.push(paint(elbow, 0xb0aca2));
  return merge(parts);
}

// ── Street furniture ────────────────────────────────────────────────────────

/**
 * 电瓶车 — the e-bike. In Nanning these outnumber cars roughly 50:1 and they are
 * parked in ranked rows on every pavement in the photos. This is also the
 * player's ride once we swap it in.
 */
export function ebikeGeometry(color = 0x3a3f45): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();

  const paintMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.85 });

  // Step-through frame: floorboard + tank + seat + front shield
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.08, 0.3), dark);
  floor.position.set(0, 0.42, 0);
  body.add(floor);
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.32), paintMat);
  tank.position.set(0.16, 0.56, 0);
  body.add(tank);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.13, 0.3), dark);
  seat.position.set(-0.26, 0.75, 0);
  body.add(seat);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.34), paintMat);
  shield.position.set(0.5, 0.62, 0);
  body.add(shield);
  // Handlebar
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6), dark);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.46, 0.92, 0);
  body.add(bar);
  // Headlight
  const hl = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xffe9b0, emissiveIntensity: 1.4 }),
  );
  hl.position.set(0.56, 0.78, 0);
  body.add(hl);

  // Wheels
  const wheelGeo = new THREE.TorusGeometry(0.27, 0.075, 6, 16);
  wheelGeo.rotateY(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  for (const wx of [0.56, -0.52]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, 0.28, 0);
    body.add(w);
  }

  g.add(body);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}

/** 护栏 / bollard — pavement edge protection, universally present, never noticed. */
export function bollardGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(0.07, 0.08, 0.85, 8);
  post.translate(0, 0.42, 0);
  parts.push(paint(post, 0xc8c2b6));
  const cap = new THREE.SphereGeometry(0.075, 8, 6);
  cap.translate(0, 0.86, 0);
  parts.push(paint(cap, 0xd8d2c6));
  const band = new THREE.CylinderGeometry(0.078, 0.078, 0.1, 8);
  band.translate(0, 0.66, 0);
  parts.push(paint(band, 0xd8a017));
  return merge(parts);
}

/** 垃圾桶 — public bin. */
export function binGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(0.26, 0.22, 0.72, 10);
  body.translate(0, 0.36, 0);
  parts.push(paint(body, 0x4a5560));
  const lid = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10);
  lid.translate(0, 0.76, 0);
  parts.push(paint(lid, 0x39424b));
  const slot = new THREE.BoxGeometry(0.34, 0.1, 0.14);
  slot.translate(0, 0.74, 0);
  parts.push(paint(slot, 0x14171a));
  return merge(parts);
}

/** 花池 — the concrete planter that separates pavement from road on every 街. */
export function planterGeometry(): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.52, 0.8),
    pbr('concrete', { color: 0xb0aa9e, seed: 21, scale: 0.55, normalScale: 0.8 }),
  );
  shell.position.y = 0.26;
  shell.castShadow = true;
  shell.receiveShadow = true;
  g.add(shell);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.06, 0.66), new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 1 }));
  soil.position.y = 0.5;
  g.add(soil);
  // Shrubs: three offset icosahedra, flat-shaded, which reads as foliage at distance.
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b39, roughness: 0.95, flatShading: true });
  const leaf2 = new THREE.MeshStandardMaterial({ color: 0x4e7d42, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 3; i++) {
    const s = 0.3 + (i % 2) * 0.12;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), i % 2 ? leaf : leaf2);
    m.position.set(-0.42 + i * 0.42, 0.56 + s * 0.5, (i % 2 ? 1 : -1) * 0.1);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** 交通锥 — traffic cone. */
export function coneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.BoxGeometry(0.34, 0.04, 0.34);
  base.translate(0, 0.02, 0);
  parts.push(paint(base, 0x2a2a2a));
  const c = new THREE.ConeGeometry(0.13, 0.5, 8);
  c.translate(0, 0.28, 0);
  parts.push(paint(c, 0xe8581f));
  const band = new THREE.CylinderGeometry(0.095, 0.105, 0.09, 8);
  band.translate(0, 0.3, 0);
  parts.push(paint(band, 0xf0f0ee));
  return merge(parts);
}

/** 路灯 — a modern LED street lamp on a slim pole, with an arm and a lit head. */
export function streetLamp(): THREE.Group {
  const g = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.55 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 7.2, 8), poleMat);
  pole.position.y = 3.6;
  pole.castShadow = true;
  g.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.4, 8), poleMat);
  base.position.y = 0.2;
  g.add(base);
  // Arm
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.9, 6), poleMat);
  arm.rotation.z = Math.PI / 2.2;
  arm.position.set(0.72, 7.2, 0);
  g.add(arm);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.6, metalness: 0.5 }),
  );
  head.position.set(1.5, 7.5, 0);
  g.add(head);
  // The lit lens: emissive, so bloom does the rest.
  const lens = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xffe0a8, toneMapped: false }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.set(1.5, 7.4, 0);
  g.add(lens);
  return g;
}

/** 招牌旗杆 — a vertical hanging signboard. The single most "中国商业街" object there is. */
export function verticalSign(colors: number[], w = 0.9, h = 3.2): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(1, colors.length);
  const cell = h / n;
  // Frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.7, metalness: 0.4 }),
  );
  frame.castShadow = true;
  g.add(frame);
  for (let i = 0; i < n; i++) {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, cell - 0.06),
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length], toneMapped: false }),
    );
    panel.position.z = 0.07;
    panel.position.y = h / 2 - cell * (i + 0.5);
    g.add(panel);
    const back = panel.clone();
    back.position.z = -0.07;
    back.rotation.y = Math.PI;
    g.add(back);
  }
  // Hanging bracket
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.07, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.7 }),
  );
  arm.position.set(-0.35, h / 2 + 0.12, 0);
  g.add(arm);
  return g;
}

// ── Rooftop kit ─────────────────────────────────────────────────────────────

/** 晾衣架 — a drying pole with laundry. Instantly reads as "this is a home". */
export function laundryGeometry(rnd: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6);
  pole.rotateZ(Math.PI / 2);
  pole.translate(0, 2.6, 0);
  parts.push(paint(pole, 0x9a968d));
  for (const x of [-1.5, 1.5]) {
    parts.push(bx(0.06, 2.6, 0.06, x, 1.3, 0, 0x8a867e));
  }
  const cloth = [0xd8d2c4, 0x6a8fb5, 0xc4685a, 0xe0d0a0, 0x7d9a7a, 0xb0a4c0];
  for (let i = 0; i < 5; i++) {
    const w = 0.28 + rnd() * 0.24;
    const h = 0.5 + rnd() * 0.6;
    parts.push(bx(0.04, h, w, -1.2 + i * 0.6, 2.6 - h / 2, 0, cloth[Math.floor(rnd() * cloth.length)]));
  }
  return merge(parts);
}

/** 天线 — a rooftop TV aerial cluster. */
export function antennaGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mast = new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6);
  mast.translate(0, 1.3, 0);
  parts.push(paint(mast, 0x6e7278));
  for (let i = 0; i < 5; i++) {
    const y = 1.6 + i * 0.2;
    const len = 0.8 - i * 0.1;
    parts.push(bx(len, 0.03, 0.03, 0, y, 0, 0x8a8e94));
  }
  return merge(parts);
}

// ── Rooftop + facade clutter scatterer ──────────────────────────────────────

export interface ClutterTarget {
  /** Building centre. */
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Which way the street is — -1 or +1 on X, or 0 for E/W frontage. */
  nx: number;
  nz: number;
}

const CLUTTER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.15 });

/**
 * Scatters rooftop and facade clutter over a set of buildings. Returns the
 * number of objects placed so the caller can log a budget.
 */
export function addClutter(scene: THREE.Scene, targets: ClutterTarget[], seed = 3): number {
  const rnd = rngFrom(seed);
  let count = 0;

  // ── Rooftop ──────────────────────────────────────────────────────────────
  const acGeo = acUnitGeometry();
  const tankGeo = waterTankGeometry();
  const laundryGeoCache: THREE.BufferGeometry[] = [];
  const antennaGeo = antennaGeometry();

  for (const t of targets) {
    const w = Math.abs(t.nx) > 0.5 ? t.depth : t.width; // frontage length
    const d = Math.abs(t.nx) > 0.5 ? t.width : t.depth; // depth
    const top = t.height;
    const wI = new THREE.InstancedMesh(acGeo, CLUTTER_MAT, 40);
    const tankI = new THREE.InstancedMesh(tankGeo, CLUTTER_MAT, 8);
    const antI = new THREE.InstancedMesh(antennaGeo, CLUTTER_MAT, 10);
    const dummy = new THREE.Object3D();
    let nAc = 0;
    let nTank = 0;
    let nAnt = 0;

    // 1–3 water tanks
    const tanks = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < tanks && nTank < 8; i++) {
      dummy.position.set(
        t.x + (rnd() - 0.5) * Math.max(2, d - 3),
        top,
        t.z + (rnd() - 0.5) * Math.max(2, w - 3),
      );
      dummy.rotation.set(0, rnd() * Math.PI, 0);
      dummy.scale.setScalar(0.9 + rnd() * 0.5);
      dummy.updateMatrix();
      tankI.setMatrixAt(nTank++, dummy.matrix);
      count++;
    }
    // 2–6 AC condensers on the roof, on their side brackets
    for (let i = 0; i < 2 + Math.floor(rnd() * 5) && nAc < 40; i++) {
      dummy.position.set(
        t.x + (rnd() - 0.5) * Math.max(2, d - 2),
        top + 0.4,
        t.z + (rnd() - 0.5) * Math.max(2, w - 2),
      );
      dummy.rotation.set(0, Math.floor(rnd() * 4) * (Math.PI / 2), 0);
      dummy.scale.setScalar(0.9 + rnd() * 0.3);
      dummy.updateMatrix();
      wI.setMatrixAt(nAc++, dummy.matrix);
      count++;
    }
    // 0–2 antennas
    for (let i = 0; i < Math.floor(rnd() * 3) && nAnt < 10; i++) {
      dummy.position.set(t.x + (rnd() - 0.5) * d * 0.6, top, t.z + (rnd() - 0.5) * w * 0.6);
      dummy.rotation.set(0, rnd() * 3, 0);
      dummy.scale.setScalar(0.8 + rnd() * 0.6);
      dummy.updateMatrix();
      antI.setMatrixAt(nAnt++, dummy.matrix);
      count++;
    }

    wI.count = nAc;
    tankI.count = nTank;
    antI.count = nAnt;
    wI.instanceMatrix.needsUpdate = true;
    tankI.instanceMatrix.needsUpdate = true;
    antI.instanceMatrix.needsUpdate = true;
    wI.castShadow = tankI.castShadow = true;
    scene.add(wI, tankI, antI);

    // 1–2 laundry lines, built as one-off meshes (they're varied and few)
    const lines = Math.floor(rnd() * 3);
    for (let i = 0; i < lines; i++) {
      const g = laundryGeometry(rnd);
      const m = new THREE.Mesh(g, CLUTTER_MAT);
      m.castShadow = true;
      m.position.set(
        t.x + (rnd() - 0.5) * Math.max(2, d - 4),
        top,
        t.z + (rnd() - 0.5) * Math.max(2, w - 4),
      );
      m.rotation.y = rnd() * Math.PI;
      scene.add(m);
      count++;
      void laundryGeoCache;
    }
  }

  return count;
}

/** Facade-mounted clutter: AC units, downpipes, grilles. Placed per building. */
export function addFacadeClutter(scene: THREE.Scene, targets: ClutterTarget[], seed = 7): number {
  const rnd = rngFrom(seed);
  let count = 0;
  const acGeo = acUnitGeometry();
  const total = targets.reduce((n, t) => n + Math.min(24, Math.floor(t.width / 1.4) + Math.floor(t.height / 3)), 0);
  const acI = new THREE.InstancedMesh(acGeo, CLUTTER_MAT, Math.max(1, total));
  const dummy = new THREE.Object3D();
  let n = 0;
  const pipeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

  for (const t of targets) {
    const front = Math.abs(t.nx) > 0.5;
    const along = front ? t.width : t.depth; // frontage run
    const floorH = t.height / Math.max(2, Math.floor(t.height / 3.2));
    const off = (front ? t.depth : t.width) / 2 + 0.24;

    // AC units, one or two per floor, staggered — never in a neat grid.
    for (let f = 1; f * floorH < t.height - 1; f++) {
      const perFloor = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < perFloor && n < acI.count - 1; k++) {
        const a = (rnd() - 0.5) * along * 0.8;
        dummy.position.set(
          front ? t.x - t.nx * off : t.x + a,
          f * floorH + 0.6,
          front ? t.z + a : t.z - t.nz * off,
        );
        dummy.rotation.set(0, front ? (t.nx > 0 ? Math.PI / 2 : -Math.PI / 2) : t.nz > 0 ? 0 : Math.PI, 0);
        dummy.scale.setScalar(0.9 + rnd() * 0.25);
        dummy.updateMatrix();
        acI.setMatrixAt(n++, dummy.matrix);
        count++;
      }
    }

    // Downpipe on one corner.
    const pipe = new THREE.Mesh(downpipeGeometry(t.height - 0.3), pipeMat);
    const ca = (rnd() < 0.5 ? -1 : 1) * along * 0.46;
    pipe.position.set(front ? t.x - t.nx * (off - 0.06) : t.x + ca, 0, front ? t.z + ca : t.z - t.nz * (off - 0.06));
    pipe.castShadow = true;
    scene.add(pipe);
    count++;
  }
  acI.count = n;
  acI.instanceMatrix.needsUpdate = true;
  acI.castShadow = true;
  scene.add(acI);
  return count;
}
