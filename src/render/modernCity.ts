/**
 * The modern Nanning block.
 *
 * Architecture comes from the photo reference set — 桂花公社's white render and
 * Roman pilasters, the 机械厂 sheds' black steel and safety yellow, the 八中
 * mosaic-tile institutional blocks. The point is a *contemporary* Nanning:
 * commercial ground floors, flats and studios above, rooftop water tanks and
 * laundry, vertical shop signs hanging off the frontage, e-bikes on the
 * pavement. Not a period piece.
 *
 * Performance note: this does NOT emit one Mesh per building. Every part is
 * accumulated into per-material buckets across the whole district and merged
 * once at the end, so 80 buildings cost ~8 draw calls instead of 400. The
 * emissive bits (signs, window glow, vertical signs) stay separate because they
 * need to animate and to survive the daylight ramp.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pbr, scaleBoxUv, type MaterialKey } from './materials';
import type { NanningBuilding, ShopUnit } from '../nanning/layout';
import { makeSignTexture, makeManzhouWindowTexture } from './nnArch';
import { acUnitGeometry, waterTankGeometry, antennaGeometry, laundryGeometry, downpipeGeometry, securityGrilleGeometry, rngFrom, type ClutterTarget } from './props';

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  parts.length === 1 ? parts[0] : (mergeGeometries(parts) as THREE.BufferGeometry);

const F = 0.15; // floors are ~3.4 m; F is the ground-floor shopfront multiplier

type FacadeStyle = 'plaster' | 'redBrick' | 'concrete';

interface Bucket {
  key: MaterialKey;
  color: number;
  parts: THREE.BufferGeometry[];
  metalness: number;
  seed: number;
  normalScale: number;
}

/** One box, UV-scaled to metres so the texture doesn't stretch per building. */
function slab(
  b: Bucket,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  perMetre: number,
): void {
  const g = new THREE.BoxGeometry(w, h, d);
  scaleBoxUv(g, w, h, d, perMetre);
  g.translate(x, y, z);
  b.parts.push(g);
}

export interface ShopVisual {
  sign: THREE.Mesh;
  signMat: THREE.MeshBasicMaterial;
  neon: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
  litMats: THREE.MeshBasicMaterial[];
}

export interface ModernDistrict {
  group: THREE.Group;
  /** Per-shop meshes the shop system drives (sign texture, neon, glass). */
  shopMeshes: Map<number, ShopVisual>;
  /** Everything that should glow after dark. */
  glowMats: THREE.MeshBasicMaterial[];
  clutterTargets: ClutterTarget[];
  /** Shared window/glass materials, so the daylight ramp touches 3 not 1400. */
  windowMats: THREE.MeshStandardMaterial[];
}

export function buildModernDistrict(
  buildings: NanningBuilding[],
  shops: ShopUnit[],
  seed = 1945,
): ModernDistrict {
  const rnd = rngFrom(seed);
  const shopBy = new Map<number, ShopUnit>();
  for (const s of shops) shopBy.set(s.building, s);

  const buckets = new Map<string, Bucket>();
  const bucket = (key: MaterialKey, color: number, metalness = 0, sd = 1, ns = 1): Bucket => {
    const id = `${key}:${color}:${sd}`;
    let bk = buckets.get(id);
    if (!bk) {
      bk = { key, color, parts: [], metalness, seed: sd, normalScale: ns };
      buckets.set(id, bk);
    }
    return bk;
  };

  const group = new THREE.Group();
  const shopMeshes = new Map<number, ShopVisual>();
  const glowMats: THREE.MeshBasicMaterial[] = [];
  const clutterTargets: ClutterTarget[] = [];
  const districtMats: THREE.MeshStandardMaterial[] = [];

  // ── Transparent geometry, batched ──────────────────────────────────────
  // One Mesh per building for its glazing and its window bands cost ~1900 draw
  // calls and ~1400 materials on this map — measured at 4 fps under swiftshader
  // before this was fixed. All of it shares two materials and merges into two
  // meshes. Signs stay per-building because each has its own texture.
  const shopGlassMat = new THREE.MeshStandardMaterial({
    color: 0x1b2228,
    emissive: 0xffb768,
    emissiveIntensity: 0,
    roughness: 0.12,
    metalness: 0.75,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x232a31,
    emissive: 0xffc98a,
    emissiveIntensity: 0,
    roughness: 0.18,
    metalness: 0.7,
  });
  const grilleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.5 });
  const shopGlassGeo: THREE.BufferGeometry[] = [];
  const bandGeo: THREE.BufferGeometry[] = [];
  const grilleGeo: THREE.BufferGeometry[] = [];
  const mzTex = makeManzhouWindowTexture(4711);
  const mzMat = new THREE.MeshStandardMaterial({
    map: mzTex,
    emissiveMap: mzTex,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.3,
    metalness: 0.2,
  });
  const mzGeo: THREE.BufferGeometry[] = [];


  /**
   * Put a box on a facade. `a` is the offset ALONG the frontage (so the caller
   * never has to work out the X/Z rotation), `proj` is how far it stands proud
   * of the wall, and `wide` means it spans the whole frontage (ignoring `a`).
   */
  const place = (
    b: Bucket,
    isEW: boolean,
    w: number, h: number, d: number,
    fx: number, fy: number, fz: number,
    a: number,
    proj: number,
    yaw: number,
    wide = false,
  ): void => {
    const g = new THREE.BoxGeometry(
      isEW ? d : wide ? w : w,
      h,
      isEW ? wide ? w : w : d,
    );
    scaleBoxUv(g, w, h, d, 0.5);
    if (isEW) g.rotateY(Math.PI / 2);
    g.translate(fx + faceNXAt(yaw) * proj, fy, fz + faceNZAt(yaw) * proj);
    if (isEW) g.translate(0, 0, a);
    else g.translate(a, 0, 0);
    b.parts.push(g);
  };
  // Facing unit normals for a yaw, matching faceYaw()'s convention.
  const faceNXAt = (yaw: number): number => (yaw === 0 ? 0 : yaw === Math.PI ? 0 : yaw > 0 ? 1 : -1);
  const faceNZAt = (yaw: number): number => (yaw === 0 ? 1 : yaw === Math.PI ? -1 : 0);

  /** A quad already oriented to face `yaw`, pushed into a merge bucket. */
  const quad = (
    into: THREE.BufferGeometry[],
    w: number, h: number,
    x: number, y: number, z: number,
    yaw: number,
  ): void => {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(yaw);
    g.translate(x, y, z);
    into.push(g);
  };
  const faceYaw = (isEW: boolean, sign: number): number =>
    isEW ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;

  const STEEL = 0x1e2126;
  // A restrained palette. Six saturated accents scattered over a facade reads as
  // confetti; three, assigned per building, reads as a building with a colour.
  const ACCENTS = [0xd8d2c4, 0xc9a227, 0x9c3a34, 0x44586b, 0x4d6b57, 0x6b4a6e];

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (b.kind !== 'modern' && b.kind !== 'shophouse' && b.kind !== 'arcade') continue;

    const W = b.width; // frontage (along the street)
    const D = b.depth; // depth
    const H = b.height;
    const cx = b.cx;
    const cz = b.cz;
    const style: FacadeStyle = (b as NanningBuilding & { facade?: FacadeStyle }).facade ?? (b.color === 0x8e3d30 ? 'redBrick' : rnd() < 0.45 ? 'concrete' : 'plaster');
    const floors = Math.max(1, Math.floor((H - F) / 3.4));
    const faceNX = b.face?.x ?? 0;
    const faceNZ = b.face?.z ?? -1;
    const isEW = Math.abs(faceNX) > 0.5;
    const sign = Math.sign(isEW ? faceNX : faceNZ) || 1;
    // Outward distance from the building centre to the street face.
    const out = (isEW ? D : W) / 2;
    const facadeCol = style === 'redBrick' ? 0xffffff : style === 'concrete' ? 0xb8b4ab : 0xffffff;
    const sd = 1 + (i * 7) % 5;

    const bFacade = bucket(style === 'plaster' ? 'plaster' : style === 'redBrick' ? 'redBrick' : 'concrete', facadeCol, 0, sd);
    const bSteel = bucket('steel', STEEL, 0.6, 3);
    const bStone = bucket('concrete', 0x8e8a80, 0, 9, 0.7);
    // Most buildings are off-white; a few carry a colour. Every building being a
    // different hue is what made the street look like a paint chart.
    const accentRoll = rnd();
    const accent = accentRoll < 0.55 ? 0xd8d2c4 : ACCENTS[Math.floor(rnd() * ACCENTS.length)];
    const bAccent = bucket('plaster', accent, 0, 4);
    // 复记老友粉 is a dressed sample (laoyouSample). Same RNG consumption, no mass.
    if (shopBy.get(i)?.def.id === 'fuji') continue;

    const fx = cx + faceNX * out; // the street-facing face centre
    const fz = cz + faceNZ * out;
    const across = isEW ? W : D; // the run length of the frontage
    const pm = 0.5; // texture repeats per metre

    // ── Plinth + main volume ────────────────────────────────────────────
    slab(bStone, isEW ? D : W, 0.45, isEW ? W : D, cx, 0.22, cz, pm);
    const bodyH = H - 0.45;
    slab(bFacade, isEW ? D : W, bodyH, isEW ? W : D, cx, 0.45 + bodyH / 2, cz, pm);

    // ── Ground floor: recessed, dark, glazed ─────────────────────────────
    const gH = Math.min(4.4, H * 0.36);
    const inset = 0.45;
    slab(bSteel, isEW ? D - inset * 2 : W - inset * 2, gH, isEW ? W - inset * 2 : D - inset * 2, cx, gH / 2, cz, pm);

    // Shopfront glazing: full-height, warm, reflective.
    const glassYaw = faceYaw(isEW, sign);
    quad(shopGlassGeo, across - 0.8, gH - 0.7, fx + faceNX * 0.02, gH / 2, fz + faceNZ * 0.02, glassYaw);

    // Mullions across the glazing — reads as a shopfront, not a mirror.
    const bays = Math.max(2, Math.floor(across / 1.6));
    for (let k = 0; k <= bays; k++) {
      const a = -across / 2 + 0.4 + ((across - 0.8) * k) / bays;
      const m = new THREE.BoxGeometry(0.1, gH - 0.7, 0.16);
      m.translate(0, 0, 0);
      if (isEW) {
        m.rotateY(Math.PI / 2);
        m.translate(fx + faceNX * 0.06, gH / 2, fz + a);
      } else {
        m.translate(fx + a, gH / 2, fz + faceNZ * 0.06);
      }
      bSteel.parts.push(m);
    }

    // ── Upper floors: real window openings ─────────────────────────────────
    // A window drawn as a coloured rectangle on a flat wall is a sticker. What
    // makes it a window is RELIEF: a reveal set back into the facade, a sill
    // that projects and throws a shadow, a lintel over it, and mullions that
    // stand proud. Four thin boxes per opening, and the wall stops being flat.
    const REVEAL = 0.22; // how far the glass sits behind the facade plane
    const SILL = 0.1; // how far the sill projects — just enough to cast a line
    for (let f = 0; f < floors; f++) {
      const y0 = gH + 0.45 + f * 3.4;
      if (y0 + 3.0 > H) break;
      const winH = 1.85;
      const winY = y0 + winH / 2 + 0.3;
      const bays = Math.max(2, Math.round(across / 2.6));
      const pitch = (across - 1.2) / bays;
      const winW = Math.min(1.65, pitch * 0.62);

      for (let k = 0; k < bays; k++) {
        const a = -(across - 1.2) / 2 + pitch * (k + 0.5);
        // Where the opening sits, in world space.
        const ox = fx + faceNX * (REVEAL * 0.5);
        const oz = fz + faceNZ * (REVEAL * 0.5);
        const yaw = glassYaw;
        // Glass, set back into the reveal.
        quad(
          bandGeo,
          winW, winH,
          fx + faceNX * REVEAL + (isEW ? 0 : 0), winY, fz + faceNZ * REVEAL,
          yaw,
        );
        void ox; void oz;
        // Sill: projects, and is the piece that actually catches the sun.
        place(bAccent, isEW, winW + 0.5, 0.14, 0.34, fx, winY - winH / 2 - 0.1, fz, a, SILL, yaw);
        // Head trim: flush with the wall, not another shelf.
        place(bAccent, isEW, winW + 0.3, 0.16, 0.16, fx, winY + winH / 2 + 0.08, fz, a, 0.05, yaw);
        // Reveal jambs: two thin returns that make the opening read as a hole.
        for (const sj of [-1, 1]) {
          place(bFacade, isEW, 0.1, winH, 0.28, fx, winY, fz, a + sj * (winW / 2 + 0.04), REVEAL, yaw);
        }
        // Mullion, flush with the reveal.
        place(bSteel, isEW, 0.06, winH - 0.05, 0.09, fx, winY, fz, a, 0.05, yaw);
      }

      // Floor line between storeys: a single thin band. Two of these stacked up
      // the facade is most of what reads as "building" rather than "box".
      place(bAccent, isEW, across, 0.2, 0.3, fx, y0 - 0.16, fz, 0, 0.16, glassYaw, true);
    }

    // Pilasters: steel columns standing proud of the wall, not painted on.
    const pil = Math.max(1, Math.floor(across / 4.5));
    for (let k = 0; k <= pil; k++) {
      const a = -across / 2 + (across * k) / pil;
      place(bSteel, isEW, 0.3, H - 1.0, 0.26, fx, 0.5 + (H - 1.0) / 2, fz, a, 0.18, glassYaw, true);
      // A capital and a base, so the column has a top and a bottom.
      place(bAccent, isEW, 0.44, 0.14, 0.34, fx, H - 0.55, fz, a, 0.24, glassYaw, true);
      place(bAccent, isEW, 0.42, 0.18, 0.32, fx, 0.66, fz, a, 0.22, glassYaw, true);
    }

    // ── Parapet + roof slab ──────────────────────────────────────────────
    const parH = 0.95;
    slab(bAccent, isEW ? D + 0.5 : W + 0.5, parH, isEW ? W + 0.5 : D + 0.5, cx, H + parH / 2, cz, 0.9);
    slab(bStone, isEW ? D : W, 0.3, isEW ? W : D, cx, H + 0.15, cz, pm);

    clutterTargets.push({ x: cx, z: cz, width: W, depth: D, height: H, nx: faceNX, nz: faceNZ });

    // ── 防盗网 over the ground floor, on shop units ──────────────────────
    const shop = shopBy.get(i);
    if (shop) {
      const grille = securityGrilleGeometry(Math.min(2.4, across - 1.2), gH - 1.1);
      grille.rotateY(glassYaw);
      grille.translate(fx + faceNX * 0.16, 0.8, fz + faceNZ * 0.16);
      grilleGeo.push(grille);

      // Fascia sign board above the shopfront.
      const signMat = new THREE.MeshBasicMaterial({ map: makeSignTexture(shop.def), toneMapped: false });
      const sw = Math.min(across - 0.6, 6.5);
      const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw * 0.25), signMat);
      signMesh.position.set(fx + faceNX * 0.3, gH + 0.95, fz + faceNZ * 0.3);
      signMesh.rotation.y = isEW ? (sign > 0 ? Math.PI / 2 : -Math.PI / 2) : sign > 0 ? 0 : Math.PI;
      group.add(signMesh);
      glowMats.push(signMat);

      // Neon underline.
      const neonMat = new THREE.MeshBasicMaterial({ color: shop.def.signColor, toneMapped: false, transparent: true, opacity: 0.9 });
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(across - 0.8, 0.13), neonMat);
      neon.position.set(fx + faceNX * 0.22, gH + 0.2, fz + faceNZ * 0.22);
      neon.rotation.y = signMesh.rotation.y;
      group.add(neon);
      glowMats.push(neonMat);

      // Doorway floor glow.
      const dg = new THREE.Mesh(
        new THREE.PlaneGeometry(across * 0.7, 2.4),
        new THREE.MeshBasicMaterial({ color: shop.def.signColor, toneMapped: false, transparent: true, opacity: 0.22, depthWrite: false }),
      );
      dg.rotation.x = -Math.PI / 2;
      dg.position.set(fx - faceNX * 1.6, 0.06, fz - faceNZ * 1.6);
      group.add(dg);
      glowMats.push(dg.material as THREE.MeshBasicMaterial);

      shopMeshes.set(i, { sign: signMesh, signMat, neon: neonMat, glass: shopGlassMat, litMats: [neonMat] });
    } else {
      // No shop: a plain 满洲窗-style panel band so the upper facade still reads.
      quad(mzGeo, Math.min(across - 2, 4.2), 1.3, fx + faceNX * 0.05, gH + 2.2, fz + faceNZ * 0.05, glassYaw);
    }
  }

  // ── Flush every material bucket into one mesh ───────────────────────────
  for (const bk of buckets.values()) {
    if (!bk.parts.length) continue;
    const mat = pbr(bk.key, { color: bk.color, seed: bk.seed, scale: 0.5, normalScale: bk.normalScale, metalness: bk.metalness });
    const mesh = new THREE.Mesh(merge(bk.parts), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Flush the transparent buckets.
  if (shopGlassGeo.length) group.add(new THREE.Mesh(merge(shopGlassGeo), shopGlassMat));
  if (bandGeo.length) group.add(new THREE.Mesh(merge(bandGeo), bandMat));
  if (grilleGeo.length) group.add(new THREE.Mesh(merge(grilleGeo), grilleMat));
  if (mzGeo.length) group.add(new THREE.Mesh(merge(mzGeo), mzMat));
  districtMats.push(shopGlassMat, bandMat, mzMat);

  void bucket;
  return { group, shopMeshes, glowMats, clutterTargets, windowMats: districtMats };
}

// ── Rooftop + facade clutter, one pass over the whole district ──────────────

export function addDistrictClutter(scene: THREE.Scene, targets: ClutterTarget[], seed = 11): number {
  const rnd = rngFrom(seed);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.12 });
  const acGeo = acUnitGeometry();
  const tankGeo = waterTankGeometry();
  const antGeo = antennaGeometry();

  let acN = 0;
  let tankN = 0;
  let antN = 0;
  const acCap = targets.length * 14;
  const tankCap = targets.length * 3;
  const antCap = targets.length * 2;
  const acI = new THREE.InstancedMesh(acGeo, mat, Math.max(1, acCap));
  const tankI = new THREE.InstancedMesh(tankGeo, mat, Math.max(1, tankCap));
  const antI = new THREE.InstancedMesh(antGeo, mat, Math.max(1, antCap));
  const d = new THREE.Object3D();
  let count = 0;

  for (const t of targets) {
    const roofY = t.height + 1.1;
    const alongX = Math.abs(t.nx) > 0.5;
    const run = alongX ? t.width : t.depth;
    const thick = alongX ? t.depth : t.width;

    for (let i = 0; i < 1 + Math.floor(rnd() * 3) && tankN < tankCap; i++) {
      d.position.set(t.x + (rnd() - 0.5) * (thick - 3), roofY, t.z + (rnd() - 0.5) * (run - 3));
      d.rotation.set(0, rnd() * Math.PI, 0);
      d.scale.setScalar(0.9 + rnd() * 0.6);
      d.updateMatrix();
      tankI.setMatrixAt(tankN++, d.matrix);
      count++;
    }
    for (let i = 0; i < 2 + Math.floor(rnd() * 5) && acN < acCap; i++) {
      d.position.set(t.x + (rnd() - 0.5) * (thick - 2.4), roofY + 0.35, t.z + (rnd() - 0.5) * (run - 2.4));
      d.rotation.set(0, Math.floor(rnd() * 4) * (Math.PI / 2), 0);
      d.scale.setScalar(0.9 + rnd() * 0.3);
      d.updateMatrix();
      acI.setMatrixAt(acN++, d.matrix);
      count++;
    }
    for (let i = 0; i < Math.floor(rnd() * 3) && antN < antCap; i++) {
      d.position.set(t.x + (rnd() - 0.5) * thick * 0.5, roofY, t.z + (rnd() - 0.5) * run * 0.5);
      d.rotation.set(0, rnd() * 3, 0);
      d.scale.setScalar(0.8 + rnd() * 0.7);
      d.updateMatrix();
      antI.setMatrixAt(antN++, d.matrix);
      count++;
    }
    // Laundry — a one-off mesh, few enough that it doesn't need instancing.
    if (rnd() < 0.55) {
      const m = new THREE.Mesh(laundryGeometry(rnd), mat);
      m.position.set(t.x + (rnd() - 0.5) * (thick - 5), roofY, t.z + (rnd() - 0.5) * (run - 5));
      m.rotation.y = rnd() * Math.PI;
      m.castShadow = true;
      scene.add(m);
      count++;
    }
    // Downpipe down one corner.
    const pipe = new THREE.Mesh(downpipeGeometry(t.height - 0.6), mat);
    const a = (rnd() < 0.5 ? -1 : 1) * run * 0.44;
    const off = thick / 2 + 0.08;
    pipe.position.set(
      alongX ? t.x - t.nx * off : t.x + a,
      0.2,
      alongX ? t.z + a : t.z - t.nz * off,
    );
    pipe.castShadow = true;
    scene.add(pipe);
    count++;
  }

  acI.count = acN;
  tankI.count = tankN;
  antI.count = antN;
  acI.instanceMatrix.needsUpdate = true;
  tankI.instanceMatrix.needsUpdate = true;
  antI.instanceMatrix.needsUpdate = true;
  acI.castShadow = tankI.castShadow = true;
  scene.add(acI, tankI, antI);
  return count;
}

/**
 * Background massing + the 机械厂 sheds.
 *
 * These are the `block` and `factory` kinds the modern builder skips: skyline
 * filler behind the commercial street, and the red-brick sawtooth sheds east of
 * 朝阳路. Same batching rule — one mesh per material for the whole district.
 */
export function addBackgroundBuildings(scene: THREE.Scene, buildings: NanningBuilding[], seed = 23): void {
  const rnd = rngFrom(seed);
  const fac: THREE.BufferGeometry[] = [];
  const conc: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  const tile: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];
  const brick: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const rnd2 = rngFrom(seed + 99);

  for (const b of buildings) {
    const { cx, cz, width: W, depth: D, height: H } = b;

    if (b.kind === 'block') {
      const m = rnd() < 0.5 ? conc : fac;
      const g = new THREE.BoxGeometry(W, H, D);
      scaleBoxUv(g, W, H, D, 0.4);
      g.translate(cx, H / 2, cz);
      m.push(g);
      // Parapet cap so the skyline isn't a row of flat slabs.
      const cap = new THREE.BoxGeometry(W + 0.5, 0.8, D + 0.5);
      cap.translate(cx, H + 0.4, cz);
      conc.push(cap);
      // A roof box or two — mechanical plant on every real building.
      if (rnd2() < 0.6) {
        const rw = W * 0.3;
        const rh = 1.6 + rnd2() * 2;
        const r = new THREE.BoxGeometry(rw, rh, D * 0.28);
        r.translate(cx + (rnd2() - 0.5) * W * 0.3, H + rh / 2 + 0.4, cz + (rnd2() - 0.5) * D * 0.3);
        conc.push(r);
      }
      continue;
    }

    if (b.kind === 'factory') {
      const g = new THREE.BoxGeometry(W, H, D);
      scaleBoxUv(g, W, H, D, 0.45);
      g.translate(cx, H / 2 + 0.5, cz);
      brick.push(g);
      const plinth = new THREE.BoxGeometry(W + 0.5, 0.5, D + 0.5);
      plinth.translate(cx, 0.25, cz);
      conc.push(plinth);
      // Sawtooth roof: north-light sheds, the silhouette from the reference.
      const teeth = Math.max(2, Math.floor(D / 7));
      for (let i = 0; i < teeth; i++) {
        const z0 = cz - D / 2 + (i * D) / teeth;
        const td = D / teeth;
        const slope = new THREE.BoxGeometry(td * 0.95, 0.3, W);
        slope.rotateX(-0.55);
        slope.translate(cx, H + 2.1, z0 + td / 2);
        tile.push(slope);
        const face = new THREE.BoxGeometry(0.25, 1.9, W - 0.5);
        face.translate(cx - D / 2 + 0.2, H + 1.4, z0 + td / 2);
        glass.push(face);
      }
      // Steel pilasters.
      const bays = Math.max(2, Math.floor(W / 5));
      for (let i = 0; i <= bays; i++) {
        const pz = cz - W / 2 + (i * W) / bays;
        const p = new THREE.BoxGeometry(0.4, H, 0.5);
        p.translate(cx - D / 2 + 0.1, H / 2 + 0.5, pz);
        steel.push(p);
      }
      // 安全黄 external staircase — the loudest colour on the block.
      for (let i = 0; i < 3; i++) {
        const f = new THREE.BoxGeometry(2.2, 0.16, 1.6);
        f.rotateX(-0.72);
        f.translate(cx - D / 2 - 1.1, 1.4 + i * 2.5, cz + W / 2 - 3 - i * 3);
        yellow.push(f);
        const r = new THREE.BoxGeometry(0.09, 0.09, 3.4);
        r.rotateX(-0.72);
        r.translate(cx - D / 2 - 2.0, 2.3 + i * 2.5, cz + W / 2 - 3 - i * 3);
        yellow.push(r);
      }
    }
  }

  const flush = (parts: THREE.BufferGeometry[], mat: THREE.MeshStandardMaterial): void => {
    if (!parts.length) return;
    const m = new THREE.Mesh(merge(parts), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  flush(fac, pbr('plaster', { color: 0xcfcabf, seed: 31, scale: 0.4 }));
  flush(conc, pbr('concrete', { color: 0x9d9a92, seed: 32, scale: 0.4, normalScale: 0.7 }));
  flush(steel, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.65 }));
  flush(tile, new THREE.MeshStandardMaterial({ color: 0x35373a, roughness: 0.92 }));
  flush(yellow, new THREE.MeshStandardMaterial({ color: 0xe8a317, roughness: 0.62, metalness: 0.25 }));
  flush(brick, pbr('redBrick', { color: 0xffffff, seed: 33, scale: 0.45 }));
  flush(
    glass,
    new THREE.MeshStandardMaterial({ color: 0x46505a, emissive: 0xffc27a, emissiveIntensity: 0.12, roughness: 0.3, metalness: 0.6 }),
  );
}
