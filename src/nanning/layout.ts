/**
 * Hand-authored 邕州古城 block layout: 中山路骑楼步行街, the 金狮/银狮 lanes,
 * 水街 along 邕江, the 南宁大桥 crossing, plus 朝阳路 as the drivable arterial.
 *
 * The gta7 base generates a procedural grid; Nanning needs a *composed* street
 * because the whole point is the qilou rhythm — a continuous covered arcade on
 * both sides of one pedestrian street. So this module keeps the same `City`
 * output shape (buildings / colliders / lanes / streetlights / props) and fills
 * it from explicit geometry. Every downstream system (collision, streaming,
 * vehicles, pedestrians, minimap) is unchanged.
 *
 * Units are metres. +X east, +Z south. Origin sits on 中山路 at the
 * 钟鼓楼 plaza, which is where the player spawns.
 */

import type { City, Building, Lane, Streetlight, Prop, ParkingSpot } from '../world/City';
import { SpatialGrid } from '../systems/SpatialGrid';
import type { Aabb } from '../systems/Collision';
import { SHOPS, type ShopDef } from './data';

// ── Street axis constants ────────────────────────────────────────────────────
export const STREET_HALF_W = 9; // 中山路 paved width is 18 m
export const QILOU_FACE = 12; // column line: upper floor starts here
export const QILOU_DEPTH = 14; // how far the upper floor extends back
export const ARCADE_INNER = 9.2; // walkable covered walkway inner edge

export const RIVER_Z = 120; // water starts here
export const BRIDGE_Z0 = 118;
export const BRIDGE_Z1 = 244;

export const PLAZA_Z0 = -148;
export const PLAZA_Z1 = -112;
export const QILOU_N0 = -110; // north end of the qilou run
export const QILOU_N1 = 100; // south end of the qilou run
export const NIGHTMARKET_Z0 = -44;
export const NIGHTMARKET_Z1 = 18;

export const MAP_HALF = 280;

/** Road definitions — the drivable network. */
interface RoadDef {
  axis: 'x' | 'z';
  fixed: number;
  from: number;
  to: number;
  width: number;
  /** one-way travel dir along `axis`, or 0 for two-way. */
  dir: 0 | 1 | -1;
}

export const ROADS: RoadDef[] = [
  { axis: 'z', fixed: 72, from: -178, to: 116, width: 16, dir: 0 }, // 朝阳路
  { axis: 'x', fixed: -62, from: 6, to: 72, width: 14, dir: -1 }, // 兴宁路
  { axis: 'x', fixed: 112, from: 0, to: 72, width: 12, dir: -1 }, // 水街路
  { axis: 'z', fixed: 0, from: 118, to: 244, width: 20, dir: 0 }, // 南宁大桥
];

export type BuildingKind = 'modern' | 'arcade' | 'factory' | 'block' | 'shophouse' | 'landmark';

export interface NanningBuilding extends Building {
  kind: BuildingKind;
  /** Street-facing normal for qilou/shophouse rows, so the arcade faces the street. */
  face?: { x: number; z: number };
  floors?: number;
  /** Shop id occupying the ground floor, if any. */
  shopId?: string;
  /** Which storefront slot within the parent building, for per-shop damage meshes. */
  slot?: { index: number; offset: number; width: number };
}

export interface ShopUnit {
  id: string;
  def: ShopDef;
  /** World position of the signboard / doorway. */
  x: number;
  z: number;
  /** Outward normal toward the street. */
  nx: number;
  nz: number;
  /** Yaw for the storefront so it faces the street. */
  rot: number;
  width: number;
  building: number;
  slot: number;
}

export interface Stall {
  x: number;
  z: number;
  rot: number;
  hue: number;
}

export interface AreaZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface NanningCity extends City {
  buildings: NanningBuilding[];
  shops: ShopUnit[];
  stalls: Stall[];
  zones: AreaZone[];
  /** Ground plane patches so the pedestrian street reads as bluestone, not asphalt. */
  surfaceQuads: { x: number; z: number; w: number; d: number; kind: 'bluestone' | 'asphalt' | 'plaza' | 'riverside' }[];
}

const rnd = (seed: number) => {
  let s = seed >>> 0;
  return (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

function rect(cx: number, cz: number, w: number, d: number): Aabb {
  return { minX: cx - w / 2, minZ: cz - d / 2, maxX: cx + w / 2, maxZ: cz + d / 2 };
}

/** True if (x,z) is inside any collider, padded by `pad`. */
function blocked(x: number, z: number, cols: Aabb[], pad: number): boolean {
  for (const c of cols) {
    if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
  }
  return false;
}

export function generateNanningCity(seed = 1945): NanningCity {
  const rand = rnd(seed);
  const buildings: NanningBuilding[] = [];
  const colliders: Aabb[] = [];
  const props: Prop[] = [];
  const streetlights: Streetlight[] = [];
  const parkingSpots: ParkingSpot[] = [];
  const stalls: Stall[] = [];
  const shops: ShopUnit[] = [];
  const surfaceQuads: NanningCity['surfaceQuads'] = [];

  // ── Ground surfaces ───────────────────────────────────────────────────────
  surfaceQuads.push({ x: 0, z: (QILOU_N0 + QILOU_N1) / 2, w: 18, d: QILOU_N1 - QILOU_N0, kind: 'asphalt' });
  surfaceQuads.push({ x: 0, z: (PLAZA_Z0 + PLAZA_Z1) / 2, w: 46, d: PLAZA_Z1 - PLAZA_Z0, kind: 'plaza' });
  surfaceQuads.push({ x: 0, z: 100, w: 40, d: 40, kind: 'riverside' });
  for (const r of ROADS) {
    const along = r.to - r.from;
    const mid = (r.to + r.from) / 2;
    surfaceQuads.push(
      r.axis === 'z'
        ? { x: r.fixed, z: mid, w: r.width, d: along, kind: 'asphalt' }
        : { x: mid, z: r.fixed, w: along, d: r.width, kind: 'asphalt' },
    );
  }

  // ── 朝阳商圈: the modern commercial street, and the main axis ───────────
  // Wide asphalt, modern blocks, e-bike ranks on the pavement. This is present-
  // day Nanning, not a period set.
  const SLOT = 8.4; // shopfront frontage, metres
  let shopCursor = 0;
  const addModernRun = (side: -1 | 1, z0: number, z1: number): void => {
    const nx = -side;
    const length = z1 - z0;
    const slots = Math.max(1, Math.round(length / SLOT));
    const slotW = length / slots;
    for (let i = 0; i < slots; i++) {
      const zc = z0 + (i + 0.5) * slotW;
      const depth = QILOU_DEPTH + 4;
      const cx = side * (QILOU_FACE + depth / 2);
      const floors = 4 + Math.floor(rand() * 3);
      const height = 4.6 + floors * 3.4;
      // 奶茶/酸嘢 always get a unit in the prime stretch; elsewhere most units rent.
      const wantShop =
        zc > NIGHTMARKET_Z0 - 30 && zc < NIGHTMARKET_Z1 + 30 ? rand() < 0.82 : rand() < 0.4;
      const shop = wantShop ? SHOPS[shopCursor++ % SHOPS.length] : undefined;
      const b: NanningBuilding = {
        cx,
        cz: zc,
        width: depth,
        depth: slotW,
        height,
        color: 0xffffff,
        style: 'concrete',
        kind: 'modern',
        face: { x: nx, z: 0 },
        floors,
        shopId: shop?.id,
        slot: { index: i, offset: 0, width: slotW },
      };
      (b as NanningBuilding & { facade?: string }).facade =
        rand() < 0.28 ? 'redBrick' : rand() < 0.4 ? 'concrete' : 'plaster';
      buildings.push(b);
      colliders.push(rect(cx, zc, depth, slotW));
      if (shop) {
        shops.push({
          id: `${side < 0 ? 'w' : 'e'}-${i}`,
          def: shop,
          x: side * (QILOU_FACE + 1.6),
          z: zc,
          nx,
          nz: 0,
          rot: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          width: slotW * 0.86,
          building: buildings.length - 1,
          slot: i,
        });
      }
    }
  };

  addModernRun(-1, QILOU_N0, NIGHTMARKET_Z0);
  addModernRun(-1, NIGHTMARKET_Z1, QILOU_N1);
  addModernRun(1, QILOU_N0, NIGHTMARKET_Z0);
  addModernRun(1, NIGHTMARKET_Z1, QILOU_N1);

  // ── 三街两巷 old-town pocket: kept, but small. Two narrow arcade rows so the
  //    map still has somewhere that feels like the reference photos.
  {
    const lanes = [
      { z: -70, len: 46, ax: -14 },
      { z: -98, len: 40, ax: -14 },
    ];
    for (const ln of lanes) {
      for (let x = ln.ax; x > ln.ax - ln.len; x -= 6.5) {
        for (const s of [-1, 1] as const) {
          const cz = ln.z + s * 3.4;
          const floors = 2 + (rand() < 0.5 ? 1 : 0);
          const b: NanningBuilding = {
            cx: x,
            cz,
            width: 6,
            depth: 5.6,
            height: 3.8 + floors * 3.2,
            color: 0xffffff,
            style: 'brick',
            kind: 'arcade',
            face: { x: 0, z: -s },
            floors,
          };
          buildings.push(b);
          colliders.push(rect(x, cz, 6, 5.6));
        }
      }
    }
  }
  // Paving for the old-town pocket: bluestone, as in the reference photos.
  surfaceQuads.push({ x: -34, z: -84, w: 46, d: 40, kind: 'bluestone' });

  // ── 夜市 stalls down the middle of the street ─────────────────────────────
  for (let z = NIGHTMARKET_Z0 + 2; z < NIGHTMARKET_Z1; z += 5.5) {
    for (const side of [-1, 1] as const) {
      if (rand() < 0.25) continue;
      const x = side * (STREET_HALF_W - 2.6);
      if (blocked(x, z, colliders, 1.5)) continue;
      stalls.push({ x, z, rot: side < 0 ? 0 : Math.PI, hue: rand() });
      colliders.push(rect(x, z, 2.6, 2.4));
    }
  }

  // ── 三街两巷: 金狮巷 / 银狮巷, narrow lanes running west off 中山路 ───────
  const addLane = (z: number, depth: number): void => {
    for (let x = -QILOU_FACE - 2; x > -70; x -= 5.5) {
      for (const s of [-1, 1] as const) {
        const cz = z + s * (depth / 2 + 1.8);
        const cx = x;
        // Ming/Qing vernacular houses: lower, darker, tiled roofs — reads clearly
        // as "not the 1920s qilou" so the two areas feel different.
        const floors = rand() < 0.7 ? 2 : 1;
        const height = 3.2 + floors * 2.9;
        buildings.push({
          cx,
          cz,
          width: 5.2,
          depth,
          height,
          color: 0x6e6a63,
          style: 'brick',
          kind: 'shophouse',
          face: { x: 0, z: -s },
          floors,
        });
        colliders.push(rect(cx, cz, 5.2, depth));
      }
    }
  };
  addLane(-70, 5.2); // 银狮巷
  addLane(-96, 5.2); // 金狮巷

  // ── 钟鼓楼广场: the landmark that anchors the north end ───────────────────
  buildings.push({
    cx: 0,
    cz: -131,
    width: 11,
    depth: 11,
    height: 17,
    color: 0x9c8a70,
    style: 'brick',
    kind: 'landmark',
    floors: 2,
  });
  colliders.push(rect(0, -131, 11, 11));
  // Plinth — a low stepped base, walkable-looking but solid.
  colliders.push(rect(0, -131, 15, 15));

  // ── Back-lot fill: generic blocks behind the qilou, so the skyline isn't a
  //    single flat wall. Two rows deep on each side.
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < 2; row++) {
      const x0 = side * (QILOU_FACE + QILOU_DEPTH + 2 + row * 24);
      for (let z = -150; z < 100; z += 20) {
        if (rand() < 0.18) continue;
        const w = 18 + rand() * 5;
        const d = 14 + rand() * 4;
        const h = 10 + rand() * 26;
        const cx = x0 + (rand() - 0.5) * 4;
        const cz = z + rand() * 6;
        // Don't drop a block on top of a lane.
        if (cz > -102 && cz < -60 && x0 < 0) continue;
        buildings.push({ cx, cz, width: w, depth: d, height: h, color: 0x8a9099, style: 'concrete', kind: 'block', floors: Math.floor(h / 3.2) });
        colliders.push(rect(cx, cz, w, d));
      }
    }
  }

  // ── 朝阳路 frontage: shops facing the drivable arterial ───────────────────
  for (let z = -170; z < 112; z += 16) {
    for (const side of [-1, 1] as const) {
      const cx = 72 + side * (8 + 9);
      if (czOverlap(z, 116)) {
        buildings.push({ cx, cz: z, width: 18, depth: 15, height: 22 + rand() * 20, color: 0x7f858f, style: 'concrete', kind: 'block', floors: 8 });
        colliders.push(rect(cx, z, 18, 15));
      }
    }
  }


  // ── 机械厂文创园: red-brick sawtooth sheds, safety-yellow stairs. Placed east
  //    of 朝阳路 so the map has two opposed architectural languages instead of one
  //    long grey-brick street.
  const FACTORY = { x0: 112, x1: 190, z0: -70, z1: 66 };
  {
    // Yard slab
    surfaceQuads.push({
      x: (FACTORY.x0 + FACTORY.x1) / 2,
      z: (FACTORY.z0 + FACTORY.z1) / 2,
      w: FACTORY.x1 - FACTORY.x0,
      d: FACTORY.z1 - FACTORY.z0,
      kind: 'asphalt',
    });
    // Main access road linking 朝阳路 into the yard
    const ROADS_F: RoadDef[] = [{ axis: 'x', fixed: -2, from: 80, to: 150, width: 12, dir: 0 }];
    ROADS.push(...ROADS_F);
    for (const r of ROADS_F) {
      surfaceQuads.push({ x: (r.from + r.to) / 2, z: r.fixed, w: r.to - r.from, d: r.width, kind: 'asphalt' });
    }
    // Three long sheds facing west onto the yard, with a gap for the tower.
    for (let i = 0; i < 3; i++) {
      const cz = -46 + i * 46;
      const w = 26 + rand() * 10;
      const d = 20 + rand() * 6;
      const h = 12 + rand() * 5;
      const cx = FACTORY.x0 + w / 2 + 2;
      buildings.push({
        cx, cz, width: w, depth: d, height: h,
        color: rand() < 0.5 ? 0x8e3d30 : 0x6e2e25,
        style: 'brick', kind: 'factory', floors: 1,
      });
      colliders.push(rect(cx, cz, w, d));
    }
    // The red water tower — the vertical anchor of the whole yard.
    buildings.push({
      cx: FACTORY.x1 - 18, cz: 48, width: 9, depth: 9, height: 26,
      color: 0xa83b3b, style: 'brick', kind: 'factory', floors: 1,
    });
    colliders.push(rect(FACTORY.x1 - 18, 48, 9, 9));
    // Street trees + e-bike parking inside the yard
    for (let i = 0; i < 12; i++) {
      const x = FACTORY.x0 + 6 + rand() * (FACTORY.x1 - FACTORY.x0 - 12);
      const z = FACTORY.z0 + 6 + rand() * (FACTORY.z1 - FACTORY.z0 - 12);
      if (blocked(x, z, colliders, 4)) continue;
      props.push({ x, z, type: 'tree', rot: rand() * Math.PI * 2 });
    }
    for (let i = 0; i < 14; i++) {
      const x = FACTORY.x0 + 4 + rand() * (FACTORY.x1 - FACTORY.x0 - 8);
      const z = 60 + rand() * 22;
      if (blocked(x, z, colliders, 2)) continue;
      parkingSpots.push({ x, z, heading: rand() < 0.5 ? 0 : Math.PI });
    }
  }

  // ── 邕江 + 南宁大桥 ──────────────────────────────────────────────────────
  // Water is a plane; the bridge is a deck with railings. Neither needs a
  // collider below deck level, so only the bridge deck is solid.

  // ── Banyan trees: 半城绿树半城楼. Placed in the sidewalk strip between the
  //    arcade inner edge and the street, plus the plaza.
  for (let z = QILOU_N0 + 6; z < QILOU_N1; z += 13) {
    for (const side of [-1, 1] as const) {
      const x = side * (STREET_HALF_W + 1.4);
      if (blocked(x, z, colliders, 1.4)) continue;
      props.push({ x, z, type: 'tree', rot: rand() * Math.PI * 2 });
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = (rand() - 0.5) * 44;
    const z = PLAZA_Z0 + 4 + rand() * (PLAZA_Z1 - PLAZA_Z0 - 8);
    if (blocked(x, z, colliders, 2)) continue;
    // Keep the opening shot clear: nothing within 14 m of the spawn point, or the
    // chase camera parks itself inside a canopy on frame one.
    if (Math.hypot(x - 0, z - (-104)) < 12) continue;
    props.push({ x, z, type: 'tree', rot: rand() * Math.PI * 2 });
  }
  for (let i = 0; i < 20; i++) {
    const x = -18 + rand() * 36;
    const z = 84 + rand() * 34;
    if (blocked(x, z, colliders, 2)) continue;
    props.push({ x, z, type: 'tree', rot: rand() * Math.PI * 2 });
  }

  // ── Streetlights: sparse on the pedestrian street (the qilou arcade provides
  //    most of the light), dense along 朝阳路.
  for (let z = QILOU_N0; z < QILOU_N1; z += 30) {
    streetlights.push({ x: -STREET_HALF_W - 0.6, z });
    streetlights.push({ x: STREET_HALF_W + 0.6, z });
  }
  for (let z = -176; z < 116; z += 26) streetlights.push({ x: 80, z });
  for (let z = 124; z < 244; z += 30) streetlights.push({ x: -12.5, z });

  // ── Lanes for ambient traffic ─────────────────────────────────────────────
  const lanes: Lane[] = [];
  for (const r of ROADS) {
    const off = r.width / 4;
    if (r.axis === 'z') {
      if (r.dir === 0) {
        lanes.push({ axis: 'z', fixed: r.fixed - off, dir: 1 });
        lanes.push({ axis: 'z', fixed: r.fixed + off, dir: -1 });
      } else {
        lanes.push({ axis: 'z', fixed: r.fixed, dir: r.dir });
      }
    } else {
      if (r.dir === 0) {
        lanes.push({ axis: 'x', fixed: r.fixed - off, dir: 1 });
        lanes.push({ axis: 'x', fixed: r.fixed + off, dir: -1 });
      } else {
        lanes.push({ axis: 'x', fixed: r.fixed, dir: r.dir });
      }
    }
  }

  // The factory-yard access road's lanes, joined with the main network.
  for (const r of ROADS) {
    if (r.fixed !== -2) continue;
    const off = r.width / 4;
    lanes.push({ axis: 'x', fixed: r.fixed - off, dir: 1 });
    lanes.push({ axis: 'x', fixed: r.fixed + off, dir: -1 });
  }

  // ── Parking: e-bike spots along 朝阳路 curb, a few on the bridge approach ──
  for (let z = -168; z < 112; z += 9) {
    for (const s of [-1, 1] as const) {
      if (rand() < 0.45) continue;
      const x = 72 + s * 9.5;
      if (blocked(x, z, colliders, 2)) continue;
      parkingSpots.push({ x, z, heading: s < 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }

  // ── Bridge deck collider + railings (rails are visual; deck is solid) ──────
  colliders.push(rect(0, (BRIDGE_Z0 + BRIDGE_Z1) / 2, 20, BRIDGE_Z1 - BRIDGE_Z0));

  const zones: AreaZone[] = [
    { id: 'zhonggulou', minX: -26, maxX: 26, minZ: PLAZA_Z0, maxZ: PLAZA_Z1 },
    { id: 'zhongshan', minX: -28, maxX: 28, minZ: PLAZA_Z1, maxZ: NIGHTMARKET_Z0 },
    { id: 'yeshi', minX: -28, maxX: 28, minZ: NIGHTMARKET_Z0, maxZ: NIGHTMARKET_Z1 },
    { id: 'zhongshan', minX: -28, maxX: 28, minZ: NIGHTMARKET_Z1, maxZ: 88 },
    { id: 'xiang', minX: -72, maxX: -10, minZ: -102, maxZ: -58 },
    { id: 'shuijie', minX: -30, maxX: 30, minZ: 88, maxZ: 122 },
    { id: 'yongjiang', minX: -MAP_HALF, maxX: MAP_HALF, minZ: 122, maxZ: 300 },
    { id: 'daqiao', minX: -12, maxX: 12, minZ: BRIDGE_Z0, maxZ: BRIDGE_Z1 },
    { id: 'chaoyang', minX: 62, maxX: 96, minZ: -180, maxZ: 122 },
    { id: 'jixiechang', minX: 104, maxX: 200, minZ: -80, maxZ: 88 },
  ];

  return {
    config: {
      seed,
      grid: 1,
      blockSize: QILOU_DEPTH,
      roadWidth: 18,
      chunkBlocks: 1,
    },
    cell: 60,
    extent: MAP_HALF * 2,
    half: MAP_HALF,
    roadCenters: [72],
    laneOffset: 4,
    buildings,
    colliders,
    grid: new SpatialGrid(colliders, 60),
    lanes,
    streetlights,
    props,
    parkingSpots,
    // Spawn mid-arcade, facing north up the colonnade toward 钟鼓楼: the shot that
    // sells the whole map is the covered walkway receding between two brick walls.
    center: { x: 0, z: -62 },
    // The player's car waits at the north end of 朝阳路, a short walk away.
    carSpawn: { x: 72, z: -124, heading: 0 },
    shops,
    stalls,
    zones,
    surfaceQuads,
  };
}

/** Cheap guard for the 朝阳路 frontage loop. */
function czOverlap(z: number, to: number): boolean {
  return z < to && z > -180;
}
