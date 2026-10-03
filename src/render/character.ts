/**
 * The protagonist: a man in a black three-piece suit.
 *
 * Built to a specific reference — side-parted slicked hair, black jacket with
 * notch lapels, charcoal waistcoat, white collar, dark tie, tailored trousers
 * with a pressed crease, black oxfords. He stands straight; the suit is the
 * silhouette, and the silhouette is what reads at GTA distances.
 *
 * The three details that stop this looking like a mannequin:
 *   1. LAPELS — the notched V from shoulder to waist. Nothing else on a suit
 *      carries the read; a black box torso reads as a body, a lapelled torso
 *      reads as a man in a suit.
 *   2. WAIST SUPPRESSION — the jacket is widest at the chest, nipped at the
 *      natural waist, then flares into tails past the hip. A straight tube
 *      reads as a sack.
 *   3. TROUSER CREASE — a single raised ridge down each leg. It catches the
 *      light and is the difference between "leg" and "trouser".
 *
 * No skinning, no GLTF, no downloaded assets: a plain Object3D rig driven by
 * procedural animation, so it works offline and costs one draw call per limb.
 */

import * as THREE from 'three';

export interface CharacterStyle {
  skin: number;
  hair: number;
  jacket: number;
  waistcoat: number;
  shirt: number;
  tie: number;
  trousers: number;
  shoes: number;
  height: number;
}

/** The player: black three-piece, the reference look. */
export const PLAYER_STYLE: CharacterStyle = {
  skin: 0xd7ac84,
  hair: 0x12100e,
  jacket: 0x16171a,
  waistcoat: 0x242529,
  shirt: 0xf2f0ea,
  tie: 0x1a1a1d,
  trousers: 0x191a1e,
  shoes: 0x0d0d0f,
  height: 1.03,
};

/** 街坊 neighbours: same tailoring language, different cloth. */
const STREET: CharacterStyle[] = [
  { skin: 0xd9b189, hair: 0x14120f, jacket: 0x2b3038, waistcoat: 0x353b45, shirt: 0xdfe3e8, tie: 0x5a3a2a, trousers: 0x23272e, shoes: 0x1a1613, height: 0.97 },
  { skin: 0xe3c49c, hair: 0x1a1410, jacket: 0x3b4450, waistcoat: 0x46505d, shirt: 0xe8ebef, tie: 0x2a3a5a, trousers: 0x2b3038, shoes: 0x20190f, height: 1.04 },
  { skin: 0xc99a70, hair: 0x100e0c, jacket: 0x3d3630, waistcoat: 0x494036, shirt: 0xd8d2c6, tie: 0x7a4a2a, trousers: 0x2a2620, shoes: 0x17120e, height: 0.94 },
  { skin: 0xe0bb92, hair: 0x201811, jacket: 0x243a2c, waistcoat: 0x2c4634, shirt: 0xe4e8ea, tie: 0x1d3a2a, trousers: 0x1e2a22, shoes: 0x141512, height: 1.0 },
  { skin: 0xcf9f74, hair: 0x0e0c0a, jacket: 0x3a2a2c, waistcoat: 0x473335, shirt: 0xe0dad2, tie: 0x3a2a4a, trousers: 0x2a1f21, shoes: 0x120f10, height: 0.92 },
  { skin: 0xe6c9a4, hair: 0x241a12, jacket: 0x2a2e36, waistcoat: 0x343943, shirt: 0xf0f2f4, tie: 0x4a3a2a, trousers: 0x22252b, shoes: 0x181512, height: 1.02 },
  { skin: 0xc08f66, hair: 0x0b0a09, jacket: 0x1f2a2c, waistcoat: 0x273436, shirt: 0xd6dadc, tie: 0x2a4a4a, trousers: 0x1a2224, shoes: 0x101312, height: 0.96 },
  { skin: 0xdcb892, hair: 0x171310, jacket: 0x322a34, waistcoat: 0x3d3440, shirt: 0xe8e2da, tie: 0x5a3a5a, trousers: 0x241d26, shoes: 0x141015, height: 1.06 },
];

export function streetStyle(i: number): CharacterStyle {
  return STREET[Math.abs(i) % STREET.length];
}

// ── Rig ─────────────────────────────────────────────────────────────────────

export interface CharacterRig {
  group: THREE.Group;
  hips: THREE.Object3D;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  foreL: THREE.Object3D;
  foreR: THREE.Object3D;
  thighL: THREE.Object3D;
  thighR: THREE.Object3D;
  shinL: THREE.Object3D;
  shinR: THREE.Object3D;
  footL: THREE.Object3D;
  footR: THREE.Object3D;
  phase: number;
}

const M = (c: number, rough = 0.86, metal = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

/** Satin: low roughness, so a lapel catches a highlight the way cloth does. */
const SATIN = (c: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.66, metalness: 0.04 });


/**
 * A horizontal superellipse section of the torso.
 * Stacking these in Y and skinning them gives the jacket its tailoring: wide
 * across the shoulders, drawn in at the natural waist, flared a little at the
 * hem. A cylinder cannot do that, and neither can a stack of spheres.
 */
function bodyShell(
  levels: { y: number; w: number; d: number; k?: number }[],
  seg = 16,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = seg + 1;
  for (const L of levels) {
    for (let i = 0; i < ring; i++) {
      const t = (i / seg) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const k = L.k ?? 3.2;
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / k) * L.w;
      const z = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / k) * L.d;
      pos.push(x, L.y, z);
    }
  }
  for (let si = 0; si < levels.length - 1; si++) {
    for (let i = 0; i < seg; i++) {
      const a = si * ring + i;
      idx.push(a, a + 1, (si + 1) * ring + i + 1, a, (si + 1) * ring + i + 1, (si + 1) * ring + i);
    }
  }
  // Close the top (shoulders) and bottom (hem) with fans.
  for (const [end, flip] of [[0, false], [levels.length - 1, true]] as const) {
    const L = levels[end];
    const c = pos.length / 3;
    pos.push(0, L.y, 0);
    const base = end * ring;
    for (let i = 0; i < seg; i++) {
      if (flip) idx.push(c, base + i, base + i + 1);
      else idx.push(c, base + i + 1, base + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A flared cone shell used for jacket tails and trouser legs. Open at the
 * bottom, so from above you see into an empty coat — which is correct.
 */
function shell(rTop: number, rBot: number, h: number, seg = 12, open = true): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
}

export function makeHumanoid(opts: Partial<CharacterStyle> = {}): CharacterRig {
  const s: CharacterStyle = { ...PLAYER_STYLE, ...opts };
  const group = new THREE.Group();
  const skin = M(s.skin, 0.78);
  const skinDark = M(new THREE.Color(s.skin).multiplyScalar(0.82).getHex(), 0.8);
  const cloth = SATIN(s.jacket);
  const vest = SATIN(s.waistcoat);
  const shirtM = M(s.shirt, 0.78);
  const trous = SATIN(s.trousers);
  const shoeM = M(s.shoes, 0.3, 0.25); // polished leather
  const hairM = M(s.hair, 0.5);

  // ── Hips ────────────────────────────────────────────────────────────────
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  group.add(hips);

  // ── Jacket ─────────────────────────────────────────────────────────────
  // Tailored, not padded: shoulder 0.215 half-width, chest 0.185, waist drawn
  // to 0.15, hem flared to 0.175. The waist suppression is the single thing
  // that separates "man in a suit" from "black tube with a head on it".
  const torso = new THREE.Group();
  hips.add(torso);
  const jacketGeo = bodyShell([
    { y: -0.315, w: 0.155, d: 0.112, k: 3.0 }, // hem rolls under
    { y: -0.30, w: 0.172, d: 0.124, k: 3.0 },  // hem, just past the hip
    { y: -0.16, w: 0.162, d: 0.115, k: 3.2 },
    { y: 0.02, w: 0.150, d: 0.108, k: 3.4 },  // natural waist
    { y: 0.20, w: 0.172, d: 0.118, k: 3.4 },  // ribcage
    { y: 0.40, w: 0.186, d: 0.124, k: 3.2 },  // chest
    { y: 0.54, w: 0.198, d: 0.126, k: 3.0 },
    { y: 0.585, w: 0.186, d: 0.112, k: 2.8 }, // shoulder line
    { y: 0.6, w: 0.17, d: 0.1, k: 2.6 },     // it tucks back in at the top
  ]);
  const jacket = new THREE.Mesh(jacketGeo, cloth);
  jacket.castShadow = true;
  jacket.receiveShadow = true;
  torso.add(jacket);

  // Shoulder cap: shallow, not a sphere. A sphere here reads as shoulder pads.
  const yoke = new THREE.Mesh(new THREE.SphereGeometry(0.182, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), cloth);
  yoke.position.y = 0.585;
  yoke.scale.set(1.0, 0.3, 0.6);
  yoke.castShadow = true;
  torso.add(yoke);

  // ── Lapels: the notch lapel, as a fold that lies ON the chest ──────────
  // Not plates sticking out. Each is a thin wedge angled back toward the
  // shoulder, so from the front you read a V and from the side a fold line.
  for (const sx of [-1, 1]) {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.46, 0.028), cloth);
    lapel.position.set(sx * 0.055, 0.33, 0.113);
    lapel.rotation.set(-0.13, sx * 0.16, sx * 0.1);
    lapel.castShadow = true;
    torso.add(lapel);
    // The notch: a small step where the lapel meets the shoulder seam.
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.042, 0.022), cloth);
    notch.position.set(sx * 0.072, 0.528, 0.1);
    notch.rotation.set(-0.14, sx * 0.34, sx * 0.42);
    torso.add(notch);
    // Shoulder seam, a crease across the top of the arm.
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.012, 0.09), cloth);
    seam.position.set(sx * 0.085, 0.578, 0.02);
    seam.rotation.set(0, 0, sx * 0.55);
    torso.add(seam);
    // Jetted hip pocket — a small line that says "tailored".
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.014, 0.02), cloth);
    pocket.position.set(sx * 0.115, 0.03, 0.108);
    pocket.rotation.z = sx * 0.22;
    torso.add(pocket);
  }
  // Front closure: two buttons on the jacket, and the vent at the hem.
  for (let i = 0; i < 2; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.007, 8), M(0x0a0a0c, 0.38, 0.3));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0.035, 0.1 - i * 0.1, 0.116);
    torso.add(btn);
  }
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.02), M(0x08080a, 0.9));
  vent.position.set(0, -0.2, -0.11);
  torso.add(vent);

  // ── Waistcoat + shirt, seen in the V between the lapels ────────────────
  const wc = new THREE.Mesh(
    bodyShell([
      { y: 0.06, w: 0.142, d: 0.096, k: 3.4 },
      { y: 0.3, w: 0.15, d: 0.1, k: 3.4 },
      { y: 0.52, w: 0.152, d: 0.1, k: 3.2 },
    ], 14),
    vest,
  );
  wc.position.z = 0.018;
  torso.add(wc);
  for (let i = 0; i < 3; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.006, 8), M(0x9a9a9e, 0.32, 0.45));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, 0.44 - i * 0.1, 0.118);
    torso.add(btn);
  }
  // The shirt is a narrow strip of white between the lapels, not a bib.
  const shirt = new THREE.Mesh(
    bodyShell([
      { y: 0.1, w: 0.062, d: 0.03, k: 3.0 },
      { y: 0.34, w: 0.072, d: 0.032, k: 3.0 },
      { y: 0.56, w: 0.07, d: 0.03, k: 3.0 },
    ], 10),
    shirtM,
  );
  shirt.position.z = 0.062;
  torso.add(shirt);

  // ── Collar + tie ────────────────────────────────────────────────────────
  const neck = new THREE.Group();
  neck.position.y = 0.572;
  torso.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.058, 0.055, 8), skin);
  neckMesh.position.y = 0.026;
  neck.add(neckMesh);
  // Turn-down collar: two small plates either side of the knot, laid back.
  for (const sx of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.03, 0.014), shirtM);
    c.position.set(sx * 0.038, 0.07, 0.04);
    c.rotation.set(0.34, sx * 0.32, sx * 0.72);
    neck.add(c);
  }
  // Knot
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.026), M(s.tie, 0.5));
  knot.position.set(0, 0.058, 0.05);
  knot.rotation.x = -0.12;
  neck.add(knot);
  // Blade, tapering to a point, sitting proud of the shirt.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.3, 0.014), M(s.tie, 0.5));
  blade.position.set(0, 0.33, 0.101);
  torso.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.023, 0.06, 4), M(s.tie, 0.5));
  tip.position.set(0, 0.16, 0.101);
  tip.rotation.set(Math.PI, Math.PI / 4, 0);
  torso.add(tip);

  // ── Head ───────────────────────────────────────────────────────────────
  // A face is a blank unless there is SHADOW somewhere: eye sockets, under the
  // brow, beside the nose. Those recesses are what make a low-poly head read as
  // a face instead of a tan egg, and they cost three small dark boxes.
  const head = new THREE.Group();
  head.position.y = 0.072;
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.111, 18, 14), skin);
  skull.scale.set(0.92, 1.1, 0.98);
  skull.castShadow = true;
  head.add(skull);
  // Cheekbone mass and a tapered jaw — without these the face is an egg.
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 9), skin);
    cheek.position.set(sx * 0.043, -0.026, 0.058);
    cheek.scale.set(0.9, 0.62, 0.62);
    head.add(cheek);
  }
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.084, 14, 10), skin);
  jaw.position.set(0, -0.056, 0.012);
  jaw.scale.set(0.86, 0.84, 0.98);
  head.add(jaw);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), skin);
  chin.position.set(0, -0.09, 0.062);
  chin.scale.set(1, 0.8, 0.85);
  head.add(chin);
  // Brow ridge: the shelf the eyes sit under. Casts the shadow that sells it.
  const browRidge = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.02, 0.028), skin);
  browRidge.position.set(0, 0.048, 0.084);
  head.add(browRidge);
  // Recessed sockets, in shadow, so the eyes have somewhere to sit.
  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.03, 0.02), M(0x8a6446, 0.95));
    socket.position.set(sx * 0.037, 0.012, 0.084);
    head.add(socket);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 12, 9), M(0xf6f4f0, 0.24));
    ball.position.set(sx * 0.037, 0.012, 0.088);
    ball.scale.set(1, 0.85, 0.6);
    head.add(ball);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 8, 6), M(0x231a12, 0.2));
    iris.position.set(sx * 0.037, 0.012, 0.096);
    head.add(iris);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.016), hairM);
    brow.position.set(sx * 0.038, 0.049, 0.092);
    brow.rotation.z = -sx * 0.14;
    head.add(brow);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.027, 10, 8), skin);
    ear.position.set(sx * 0.101, -0.008, -0.004);
    ear.scale.set(0.38, 1.05, 0.8);
    head.add(ear);
  }
  // Nose: a wedge with a defined bridge, not a cone spike.
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.028), skin);
  bridge.position.set(0, -0.008, 0.092);
  bridge.rotation.x = 0.18;
  head.add(bridge);
  const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skin);
  noseTip.position.set(0, -0.036, 0.1);
  noseTip.scale.set(1, 0.8, 1.1);
  head.add(noseTip);
  for (const sx of [-1, 1]) {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 5), M(0x7a5638, 0.9));
    nostril.position.set(sx * 0.011, -0.04, 0.108);
    head.add(nostril);
  }
  // Mouth: a shallow crease with a slightly fuller lower lip.
  const lip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.012, 0.014), M(0xa2685c, 0.72));
  lip.position.set(0, -0.062, 0.09);
  head.add(lip);
  const underLip = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), skin);
  underLip.position.set(0, -0.075, 0.086);
  underLip.scale.set(1.1, 0.55, 0.7);
  head.add(underLip);

  // ── Hair: a groomed side part ───────────────────────────────────────────
  // Matte (roughness 0.92). A glossy dark dome reads as a motorcycle helmet,
  // which is exactly what the previous version looked like.
  const hairM2 = M(s.hair, 0.92);
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), hairM2);
  capTop.position.set(0, 0.012, -0.008);
  capTop.scale.set(0.96, 1.0, 1.0);
  capTop.castShadow = true;
  head.add(capTop);
  // Swept volume off the forehead — the reference has real height on top.
  const quiff = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), hairM2);
  quiff.position.set(0.02, 0.068, -0.03);
  quiff.scale.set(1.3, 0.68, 1.2);
  quiff.rotation.z = -0.2;
  quiff.castShadow = true;
  head.add(quiff);
  // The part: a RECESSED groove, cut by placing a thin dark wedge slightly
  // inside the cap rather than on top of it.
  const part = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.13), M(0x050505, 0.95));
  part.position.set(-0.036, 0.096, 0.02);
  part.rotation.set(0.35, 0.22, 0);
  head.add(part);
  // Nape, cut square at the collar, and sideburns.
  const nape = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), hairM2);
  nape.position.set(0, -0.03, -0.052);
  nape.scale.set(0.98, 1.0, 0.66);
  head.add(nape);
  for (const sx of [-1, 1]) {
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.05, 0.03), hairM2);
    sb.position.set(sx * 0.094, 0.024, 0.026);
    head.add(sb);
  }

  // ── Arms ────────────────────────────────────────────────────────────────
  const mkArm = (sx: number): { shoulder: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D } => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.172, 0.535, 0);
    torso.add(shoulder);
    // The deltoid is a small cap that follows the shoulder line — a large
    // sphere here is what makes a low-poly character look like an action figure.
    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 9), cloth);
    delt.scale.set(0.92, 0.68, 0.92);
    delt.castShadow = true;
    shoulder.add(delt);
    const upper = new THREE.Mesh(shell(0.05, 0.042, 0.28, 10), cloth);
    upper.position.y = -0.14;
    upper.castShadow = true;
    shoulder.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.28;
    shoulder.add(fore);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.043, 10, 8), cloth);
    fore.add(elbow);
    const fm = new THREE.Mesh(shell(0.043, 0.036, 0.25, 10), cloth);
    fm.position.y = -0.125;
    fm.castShadow = true;
    fore.add(fm);
    // French cuff, then the shirt cuff showing at the wrist.
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.032, 8), shirtM);
    cuff.position.y = -0.243;
    fore.add(cuff);
    const hand = new THREE.Group();
    hand.position.y = -0.265;
    fore.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.037, 10, 8), skinDark);
    palm.scale.set(0.6, 1.2, 0.44);
    palm.position.y = -0.036;
    palm.castShadow = true;
    hand.add(palm);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), skinDark);
    thumb.position.set(sx * 0.024, -0.018, 0.008);
    hand.add(thumb);
    return { shoulder, fore, hand };
  };
  const L = mkArm(-1);
  const R = mkArm(1);

  // ── Legs: tapered trouser with a pressed crease ─────────────────────────
  const mkLeg = (sx: number): { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D } => {
    const thigh = new THREE.Group();
    thigh.position.set(sx * 0.092, -0.02, 0);
    hips.add(thigh);
    const tm = new THREE.Mesh(shell(0.093, 0.072, 0.44, 10), trous);
    tm.position.y = -0.22;
    tm.castShadow = true;
    thigh.add(tm);
    const hipCap = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), trous);
    hipCap.scale.set(1, 0.85, 0.9);
    thigh.add(hipCap);
    const shin = new THREE.Group();
    shin.position.y = -0.44;
    thigh.add(shin);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.066, 12, 9), trous);
    knee.scale.set(1, 0.85, 1);
    shin.add(knee);
    const sm = new THREE.Mesh(shell(0.072, 0.055, 0.42, 10), trous);
    sm.position.y = -0.21;
    sm.castShadow = true;
    shin.add(sm);
    // Pressed crease down the shin — catches a highlight, reads as tailoring.
    const crease = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.4, 0.02), M(s.trousers, 0.5));
    crease.position.set(0, -0.21, 0.058);
    shin.add(crease);
    const foot = new THREE.Group();
    foot.position.y = -0.42;
    shin.add(foot);
    // Oxford: a squared toe box, a heel, and a low stacked heel.
    const vamp = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.06, 0.2), shoeM);
    vamp.position.set(0, -0.03, 0.05);
    vamp.castShadow = true;
    foot.add(vamp);
    const toe = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.09, 10), shoeM);
    toe.rotation.x = Math.PI / 2;
    toe.position.set(0, -0.03, 0.15);
    toe.scale.set(1, 1, 1.1);
    foot.add(toe);
    const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.035, 10), M(0x0a0a0b, 0.6));
    heel.position.set(0, -0.06, -0.03);
    foot.add(heel);
    return { thigh, shin, foot };
  };
  const LL = mkLeg(-1);
  const LR = mkLeg(1);

  group.scale.setScalar(s.height);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  return {
    group, hips, torso, head,
    armL: L.shoulder, armR: R.shoulder, foreL: L.fore, foreR: R.fore,
    thighL: LL.thigh, thighR: LR.thigh, shinL: LL.shin, shinR: LR.shin,
    footL: LL.foot, footR: LR.foot,
    phase: Math.random() * Math.PI * 2,
  };
}

// ── Procedural animation ────────────────────────────────────────────────────

export interface GaitOpts {
  strafe?: number;
  /** 0 = on the ground, 1 = at the apex. */
  air?: number;
  /** Vertical velocity sign: -1 rising, +1 falling. */
  vy?: number;
  /** Seconds since the jump started, for the tuck-and-extend. */
  airTime?: number;
  /** True when seated in a vehicle. */
  sitting?: boolean;
  /** Punch: 0..1, drives a short right-arm hook. */
  punch?: number;
}

/**
 * Drive a rig from speed + a phase. No keyframes: the walk is a sum of sines
 * with the shoulders counter-rotating the hips, which is the cue the eye uses
 * to distinguish walking from sliding.
 */
export function animateHumanoid(r: CharacterRig, dt: number, speed: number, opts: GaitOpts = {}): void {
  const s = Math.abs(speed);
  const running = s > 4.4 && !opts.air;
  const stride = running ? 1.42 : 0.8;
  const cadence = s < 0.05 ? 0 : (s / stride) * Math.PI;
  r.phase += cadence * dt;
  if (r.phase > Math.PI * 2) r.phase -= Math.PI * 2;
  const p = r.phase;
  const moving = s > 0.05;
  const amp = moving ? (running ? 0.95 : 0.6) : 0;

  // ── Legs ────────────────────────────────────────────────────────────────
  r.thighL.rotation.x = Math.sin(p) * amp;
  r.thighR.rotation.x = -Math.sin(p) * amp;
  // Knees only bend backward.
  r.shinL.rotation.x = -Math.max(0, -Math.sin(p - 0.5)) * amp * (running ? 1.5 : 0.95);
  r.shinR.rotation.x = -Math.max(0, -Math.sin(p + Math.PI - 0.5)) * amp * (running ? 1.5 : 0.95);
  r.footL.rotation.x = -Math.sin(p) * amp * 0.3;
  r.footR.rotation.x = Math.sin(p) * amp * 0.3;

  // ── Arms counter-swing ──────────────────────────────────────────────────
  const armSwing = Math.sin(p + Math.PI) * amp * (running ? 0.95 : 0.68);
  r.armL.rotation.set(armSwing, 0, 0.1);
  r.armR.rotation.set(-armSwing, 0, -0.1);
  r.foreL.rotation.x = -Math.max(0, armSwing) * 0.85 - 0.26;
  r.foreR.rotation.x = -Math.max(0, -armSwing) * 0.85 - 0.26;

  // ── Hips / torso / head ─────────────────────────────────────────────────
  const bob = moving ? Math.abs(Math.sin(p)) * (running ? 0.08 : 0.042) : 0;
  const breathe = Math.sin(p * 0.2) * 0.008;
  r.hips.position.y = 0.95 + bob;
  r.hips.rotation.y = Math.sin(p) * 0.1;
  r.hips.rotation.z = Math.sin(p * 2) * 0.028;
  r.torso.rotation.y = -Math.sin(p) * 0.13;
  r.torso.rotation.x = (running ? 0.22 + s * 0.011 : moving ? 0.05 : 0.008) + breathe;
  // The head stays level: a man in a suit does not bob his head when he walks.
  r.head.rotation.x = -r.torso.rotation.x * 0.78;
  r.head.rotation.y = Math.sin(p) * 0.045;

  if (opts.strafe) {
    r.hips.rotation.z += opts.strafe * 0.13;
    r.torso.rotation.z += opts.strafe * 0.09;
    r.head.rotation.z = -opts.strafe * 0.1;
  }

  // ── Jump: crouch on the way up, reach on the way down ────────────────────
  if (opts.air) {
    const rising = (opts.vy ?? 0) > 0;
    const t = Math.min(1, (opts.airTime ?? 0) / 0.34);
    // Crouch: knees tuck hard and the torso pitches forward.
    const tuck = rising ? 0.35 + 0.65 * Math.sin(t * Math.PI * 0.5) : 0.4;
    r.thighL.rotation.x = 1.05 * tuck;
    r.thighR.rotation.x = 1.0 * tuck;
    r.shinL.rotation.x = -1.5 * tuck;
    r.shinR.rotation.x = -1.45 * tuck;
    r.footL.rotation.x = -0.35 * tuck;
    r.footR.rotation.x = -0.32 * tuck;
    // Arms come up and out, like clearing a kerb.
    r.armL.rotation.set(-0.9 * tuck, 0, 0.55);
    r.armR.rotation.set(-0.85 * tuck, 0, -0.55);
    r.foreL.rotation.x = -0.6 * tuck;
    r.foreR.rotation.x = -0.55 * tuck;
    r.hips.rotation.x = -0.12 * tuck;
    r.torso.rotation.x = 0.3 * tuck;
    r.head.rotation.x = -0.24 * tuck;
    if (!rising) {
      // Absorb on the way down: arms drop, knees prepare to take it.
      const f = Math.min(1, (opts.airTime ?? 0) / 0.12);
      r.armL.rotation.x = -0.9 * tuck * (1 - f * 0.7);
      r.armR.rotation.x = -0.85 * tuck * (1 - f * 0.7);
    }
  }

  // ── Punch: a short right hook, shoulder-driven ──────────────────────────
  if (opts.punch && opts.punch > 0) {
    const k = Math.sin(Math.min(1, opts.punch) * Math.PI); // 0 → 1 → 0
    r.armR.rotation.x = -1.5 * k + r.armR.rotation.x * (1 - k);
    r.armR.rotation.z = -0.35 * k - 0.1;
    r.foreR.rotation.x = -0.4 + 0.9 * k;
    r.torso.rotation.y += 0.42 * k; // hips follow the punch
    r.hips.rotation.y += 0.2 * k;
    r.head.rotation.y -= 0.1 * k;
  }

  if (opts.sitting) {
    r.thighL.rotation.x = 1.5;
    r.thighR.rotation.x = 1.5;
    r.shinL.rotation.x = -1.55;
    r.shinR.rotation.x = -1.55;
    r.armL.rotation.set(-0.75, 0, 0.16);
    r.armR.rotation.set(-0.75, 0, -0.16);
    r.hips.position.y = 0.74;
    r.torso.rotation.x = 0.05;
  }
}
