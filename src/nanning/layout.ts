/**
 * 中山路美食街 — one pedestrian street, true to the slice.
 *
 * Playable run is 300 m (z = -150..+150). The carriageway is 9 m. Each side
 * has a 2.4 m qilou arcade raised 0.15 m, then an 8 m shopfront. A 4×15 m
 * dead-end alley cuts the west row at z = 0. Both ends are barred; 民族大道
 * and 桃源路 sit beyond the barriers and only carry background traffic.
 *
 * Generation is a pure function of `seed`. Shop assignment is data, not RNG,
 * so the tenant list does not drift. Building heights do use the seeded RNG.
 * Nothing here writes to module-level arrays.
 *
 * Units are metres. +X east, +Z south.
 */

import type { City, Building, Lane, Streetlight, Prop, ParkingSpot } from '../world/City';
import { SpatialGrid } from '../systems/SpatialGrid';
import type { Aabb, Aabb3 } from '../systems/Collision';
import { SHOPS, STALLS, type ShopDef, type StreetSection } from './data';

export const STREET_Z0 = -150;
export const STREET_Z1 = 150;
/** Half-width of the open carriageway. Full width is 9 m. */
// Carriageway half-width. The 2.4 m arcade that used to sit inside this width
// reached more than a quarter of the way across the street, so the two canopies
// met overhead and the road read as a tunnel you had to squeeze down. The
// covered walkway is now 1.5 m — still a real 骑楼 arcade you can stand in — and
// the street it leaves open is 10.8 m. STREET_HALF + ARCADE_DEPTH is held at 6.9
// so the arcade's outer edge still lands on the shopfront line.
export const STREET_HALF = 5.4;
export const ARCADE_DEPTH = 1.5;
export const ARCADE_RAISE = 0.15;
export const SHOP_DEPTH = 8;
export const ALLEY_WIDTH = 4;
export const ALLEY_DEPTH = 15;

export const NORTH_Z0 = -150;
export const NORTH_Z1 = -50;
export const MIDDLE_Z0 = -50;
export const MIDDLE_Z1 = 50;
export const SOUTH_Z0 = 50;
export const SOUTH_Z1 = 150;

/** Shopfront face, just behind the arcade. */
export const SHOP_FRONT = STREET_HALF + ARCADE_DEPTH;
/** Back wall of a shopfront. */
export const SHOP_BACK = SHOP_FRONT + SHOP_DEPTH;

export const MAP_HALF = 190;

/** Background cross streets, outside the barriers. */
export const MINZU_Z = -168;
export const TAOYUAN_Z = 168;

const SECTIONS: { id: StreetSection; z0: number; z1: number }[] = [
  { id: 'north', z0: NORTH_Z0, z1: NORTH_Z1 },
  { id: 'middle', z0: MIDDLE_Z0, z1: MIDDLE_Z1 },
  { id: 'south', z0: SOUTH_Z0, z1: SOUTH_Z1 },
];

export type BuildingKind = 'modern' | 'arcade' | 'factory' | 'block' | 'shophouse' | 'landmark';

export interface NanningBuilding extends Building {
  kind: BuildingKind;
  /** Street-facing normal for qilou rows. */
  face?: { x: number; z: number };
  floors?: number;
  shopId?: string;
  slot?: { index: number; offset: number; width: number };
}

export interface ShopUnit {
  id: string;
  def: ShopDef;
  x: number;
  z: number;
  /** Outward normal toward the street. */
  nx: number;
  nz: number;
  rot: number;
  width: number;
  building: number;
  slot: number;
  /** Night-market stall: hidden and not interactable before 18:00. */
  nightOnly?: boolean;
}

export interface Stall {
  x: number;
  z: number;
  rot: number;
  hue: number;
  shopId: string;
}

export interface AreaZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Alley {
  /** Centre of the dead-end, on the west side. */
  cx: number;
  cz: number;
  width: number;
  depth: number;
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
  alley: Alley;
  surfaceQuads: { x: number; z: number; w: number; d: number; kind: 'bluestone' | 'asphalt' | 'plaza' | 'riverside' }[];
  /** Walls, steps, ceilings. The 2D `grid` does not contain walkable floors. */
  heightBoxes: Aabb3[];
  heightGrid: SpatialGrid<Aabb3>;
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

function volume(box: Aabb, minY: number, maxY: number, kind: Aabb3['kind'], camBlock = false): Aabb3 {
  return { ...box, minY, maxY, kind, camBlock };
}

/** Party walls, back wall, and the two door jambs. The doorway itself is open. */
function shopWalls(cx: number, cz: number, depth: number, frontage: number, side: -1 | 1): Aabb[] {
  const minX = cx - depth / 2;
  const maxX = cx + depth / 2;
  const minZ = cz - frontage / 2;
  const maxZ = cz + frontage / 2;
  const t = 0.28;
  const doorW = Math.min(2.6, Math.max(1.8, frontage * 0.22));
  const door0 = cz - doorW / 2;
  const door1 = cz + doorW / 2;
  const walls: Aabb[] = [
    { minX, maxX, minZ, maxZ: minZ + t },
    { minX, maxX, minZ: maxZ - t, maxZ },
  ];
  if (side > 0) {
    walls.push({ minX: maxX - t, maxX, minZ, maxZ });
    if (door0 > minZ + t) walls.push({ minX, maxX: minX + t, minZ: minZ + t, maxZ: door0 });
    if (door1 < maxZ - t) walls.push({ minX, maxX: minX + t, minZ: door1, maxZ: maxZ - t });
  } else {
    walls.push({ minX, maxX: minX + t, minZ, maxZ });
    if (door0 > minZ + t) walls.push({ minX: maxX - t, maxX, minZ: minZ + t, maxZ: door0 });
    if (door1 < maxZ - t) walls.push({ minX: maxX - t, maxX, minZ: door1, maxZ: maxZ - t });
  }
  return walls;
}

/** Walk `dist` metres along a list of [z0,z1] spans. */
function pointAlong(spans: [number, number][], dist: number): number {
  let left = dist;
  for (const [a, b] of spans) {
    const len = b - a;
    if (left <= len) return a + left;
    left -= len;
  }
  const last = spans[spans.length - 1];
  return last[1];
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
  const heightBoxes: Aabb3[] = [];
  const addSolid = (box: Aabb, maxY = 4, minY = 0): void => {
    colliders.push(box);
    heightBoxes.push(volume(box, minY, maxY, 'solid', true));
  };
  const addWalk = (box: Aabb, maxY: number, minY = 0): void => {
    heightBoxes.push(volume(box, minY, maxY, 'walkable', false));
  };

  const alley: Alley = {
    cx: -(STREET_HALF + ALLEY_DEPTH / 2),
    cz: 0,
    width: ALLEY_WIDTH,
    depth: ALLEY_DEPTH,
    minX: -(STREET_HALF + ALLEY_DEPTH),
    maxX: -STREET_HALF,
    minZ: -ALLEY_WIDTH / 2,
    maxZ: ALLEY_WIDTH / 2,
  };

  // ── Ground ──────────────────────────────────────────────────────────────
  surfaceQuads.push({
    x: 0,
    z: 0,
    w: STREET_HALF * 2,
    d: STREET_Z1 - STREET_Z0,
    kind: 'bluestone',
  });
  // Cross streets beyond the barriers — background only.
  surfaceQuads.push({ x: 0, z: MINZU_Z, w: 80, d: 16, kind: 'asphalt' });
  surfaceQuads.push({ x: 0, z: TAOYUAN_Z, w: 80, d: 16, kind: 'asphalt' });
  // Alley floor, street level (not the raised arcade).
  surfaceQuads.push({
    x: alley.cx,
    z: 0,
    w: ALLEY_DEPTH,
    d: ALLEY_WIDTH,
    kind: 'bluestone',
  });

  // ── Storefronts ─────────────────────────────────────────────────────────
  // East/west facing: the renderer treats b.depth as the X size and b.width
  // as the Z size. Colliders use the same convention.
  const storefronts = SHOPS.filter((s) => s.place === 'shop');
  for (const section of SECTIONS) {
    for (const side of [-1, 1] as const) {
      const defs = storefronts.filter((s) => s.section === section.id && s.side === side);
      const spans: [number, number][] = [[section.z0, section.z1]];
      if (side < 0 && section.id === 'middle') {
        spans.length = 0;
        spans.push([section.z0, -ALLEY_WIDTH / 2], [ALLEY_WIDTH / 2, section.z1]);
      }
      const total = spans.reduce((sum, [a, b]) => sum + (b - a), 0);
      const slot = total / defs.length;
      for (let i = 0; i < defs.length; i++) {
        const def = defs[i];
        const zc = pointAlong(spans, (i + 0.5) * slot);
        const frontage = slot * 0.985;
        const inland = SHOP_DEPTH;
        const cx = side * (SHOP_FRONT + inland / 2);
        const floors = 2 + (rand() < 0.55 ? 1 : 0);
        const height = 4.2 + floors * 3.15;
        const b: NanningBuilding = {
          cx,
          cz: zc,
          width: frontage,
          depth: inland,
          height,
          color: 0x8d9299,
          style: 'brick',
          kind: 'arcade',
          face: { x: -side, z: 0 },
          floors,
          shopId: def.id,
          slot: { index: i, offset: 0, width: frontage },
        };
        buildings.push(b);
        const sideSign = side < 0 ? -1 : 1;
        for (const wall of shopWalls(cx, zc, inland, frontage, sideSign)) addSolid(wall, 4);
        // Lintel over the door, tall enough to jump through, short enough to read as a shopfront.
        const doorW = Math.min(2.6, Math.max(1.8, frontage * 0.22));
        const frontX = sideSign > 0 ? cx - inland / 2 : cx + inland / 2;
        heightBoxes.push(
          volume(
            { minX: frontX - 0.14, maxX: frontX + 0.14, minZ: zc - doorW / 2, maxZ: zc + doorW / 2 },
            2.55,
            4,
            'solid',
            true,
          ),
        );
        // Interior floor, level with the arcade. Not a 2D collider — you walk on it.
        addWalk(
          {
            minX: cx - inland / 2 + 0.3,
            maxX: cx + inland / 2 - 0.3,
            minZ: zc - frontage / 2 + 0.3,
            maxZ: zc + frontage / 2 - 0.3,
          },
          ARCADE_RAISE,
        );
        shops.push({
          id: `${side < 0 ? 'w' : 'e'}-${section.id}-${i}`,
          def,
          x: side * SHOP_FRONT,
          z: zc,
          nx: -side,
          nz: 0,
          rot: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          width: frontage * 0.86,
          building: buildings.length - 1,
          slot: i,
        });
      }
    }
  }

  // ── Night-market stalls, two rows down the middle ───────────────────────
  // Not colliders in the static grid: they only exist after 18:00, and the
  // grid is built once. The session resolves them while the market is open.
  const stallDefs = STALLS.filter((s) => s.place === 'stall');
  const perRow = Math.ceil(stallDefs.length / 2);
  for (let i = 0; i < stallDefs.length; i++) {
    const def = stallDefs[i];
    const row = i < perRow ? 0 : 1;
    const index = row === 0 ? i : i - perRow;
    const count = row === 0 ? perRow : stallDefs.length - perRow;
    const z = -42 + ((index + 0.5) * 84) / count;
    const side = row === 0 ? -1 : 1;
    const x = side * 1.55;
    // West row faces +X (toward the middle), east row faces -X.
    const rot = side < 0 ? -Math.PI / 2 : Math.PI / 2;
    stalls.push({ x, z, rot, hue: rand(), shopId: def.id });
    shops.push({
      id: `stall-${i}`,
      def,
      x,
      z,
      nx: -side,
      nz: 0,
      rot,
      width: 2.2,
      building: 10000 + i,
      slot: i,
      nightOnly: true,
    });
  }

  // ── Raised arcade. A 0.15 m step, no horizontal push. Ceiling blocks the camera.
  const pushArcade = (side: -1 | 1, z0: number, z1: number): void => {
    const span: Aabb = {
      minX: Math.min(side * STREET_HALF, side * (STREET_HALF + ARCADE_DEPTH)),
      maxX: Math.max(side * STREET_HALF, side * (STREET_HALF + ARCADE_DEPTH)),
      minZ: z0,
      maxZ: z1,
    };
    addWalk(span, ARCADE_RAISE);
    heightBoxes.push(volume(span, 3.02, 3.28, 'solid', true));
  };
  pushArcade(1, STREET_Z0, STREET_Z1);
  pushArcade(-1, STREET_Z0, -ALLEY_WIDTH / 2);
  pushArcade(-1, ALLEY_WIDTH / 2, STREET_Z1);

  // Columns on the carriageway edge of the arcade. Same spacing as the scenery.
  for (let z = STREET_Z0 + 1.2; z < STREET_Z1 - 0.6; z += 4.4) {
    for (const side of [-1, 1] as const) {
      if (side < 0 && Math.abs(z) < ALLEY_WIDTH / 2 + 0.4) continue;
      addSolid(rect(side * STREET_HALF, z, 0.32, 0.32), 3.15);
    }
  }

  // ── Dead-end alley walls (west). Shop boxes already stop at the mouth. ──
  // The alley runs from the carriageway edge 15 m inland, past the shop backs.
  addSolid(rect(alley.minX - 0.2, 0, 0.4, ALLEY_WIDTH), 3);
  const pastShops = SHOP_BACK - (STREET_HALF + ALLEY_DEPTH);
  // Side returns from the shop back wall to the dead end.
  if (pastShops < 0) {
    const extra = -pastShops;
    const mid = alley.minX + extra / 2;
    addSolid(rect(mid, -ALLEY_WIDTH / 2, extra, 0.35), 3);
    addSolid(rect(mid, ALLEY_WIDTH / 2, extra, 0.35), 3);
  }

  // ── Barriers. Seal the street so you cannot walk onto the cross roads
  //    or around the end of the arcade. Cars live at |z| = 168, clear of this.
  for (const z of [STREET_Z0 - 0.35, STREET_Z1 + 0.35]) {
    // 1.1 m rail: a jump (0.75) plus a step (0.30) still comes up short.
    addSolid(rect(0, z, 48, 0.55), 1.1);
  }

  // ── Backdrop blocks behind the shops, so the street is not a floating set.
  //    Kept off the alley and off the cross streets.
  for (const side of [-1, 1] as const) {
    for (let z = STREET_Z0 + 12; z < STREET_Z1 - 8; z += 24) {
      if (side < 0 && Math.abs(z) < ALLEY_WIDTH + 6) continue;
      const w = 12;
      const d = 18;
      const h = 9 + rand() * 14;
      const cx = side * (SHOP_BACK + 2 + w / 2);
      buildings.push({
        cx,
        cz: z,
        width: w,
        depth: d,
        height: h,
        color: 0x8a9099,
        style: 'concrete',
        kind: 'block',
        floors: Math.max(2, Math.floor(h / 3.2)),
      });
      addSolid(rect(cx, z, w, d), h);
    }
  }

  // ── Banyans in the back lots, not in the 9 m carriageway. ───────────────
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (SHOP_BACK + 16 + rand() * 4);
    const z = STREET_Z0 + 20 + rand() * (STREET_Z1 - STREET_Z0 - 40);
    if (side < 0 && Math.abs(z) < 10) continue;
    props.push({ x, z, type: 'tree', rot: rand() * Math.PI * 2 });
  }

  // ── Streetlights along the column line. ─────────────────────────────────
  for (let z = STREET_Z0 + 8; z < STREET_Z1; z += 28) {
    streetlights.push({ x: -STREET_HALF + 0.3, z });
    streetlights.push({ x: STREET_HALF - 0.3, z });
  }

  // ── Background lanes ONLY. No lane runs down 中山路. ─────────────────────
  // Local roads — never push onto a shared module array.
  const lanes: Lane[] = [
    { axis: 'x', fixed: MINZU_Z - 3.2, dir: 1 },
    { axis: 'x', fixed: MINZU_Z + 3.2, dir: -1 },
    { axis: 'x', fixed: TAOYUAN_Z - 3.2, dir: 1 },
    { axis: 'x', fixed: TAOYUAN_Z + 3.2, dir: -1 },
  ];

  const zones: AreaZone[] = [
    { id: 'north', minX: -20, maxX: 20, minZ: NORTH_Z0, maxZ: NORTH_Z1 },
    { id: 'middle', minX: -20, maxX: 20, minZ: MIDDLE_Z0, maxZ: MIDDLE_Z1 },
    { id: 'south', minX: -20, maxX: 20, minZ: SOUTH_Z0, maxZ: SOUTH_Z1 },
    { id: 'alley', minX: alley.minX - 1, maxX: -STREET_HALF + 0.4, minZ: alley.minZ, maxZ: alley.maxZ },
    { id: 'minzu', minX: -40, maxX: 40, minZ: MINZU_Z - 10, maxZ: STREET_Z0 },
    { id: 'taoyuan', minX: -40, maxX: 40, minZ: STREET_Z1, maxZ: TAOYUAN_Z + 10 },
  ];

  // Spawn in the north section, middle of the carriageway, clear of stalls.
  const center = { x: 0, z: -80 };

  return {
    config: {
      seed,
      grid: 1,
      blockSize: SHOP_DEPTH,
      roadWidth: STREET_HALF * 2,
      chunkBlocks: 1,
    },
    cell: 60,
    extent: MAP_HALF * 2,
    half: MAP_HALF,
    roadCenters: [],
    laneOffset: 3.2,
    buildings,
    colliders,
    grid: new SpatialGrid(colliders, 24),
    lanes,
    streetlights,
    props,
    parkingSpots,
    center,
    // The player's car waits on 民族大道, outside the barrier. It is not on the street.
    carSpawn: { x: 24, z: MINZU_Z, heading: 0 },
    shops,
    stalls,
    zones,
    alley,
    surfaceQuads,
    heightBoxes,
    heightGrid: new SpatialGrid(heightBoxes, 8),
  };
}
