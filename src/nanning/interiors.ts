/**
 * Walk-in shop interiors. Pure: a shop shell becomes furniture, seats and
 * collision boxes. The renderer instances the props; the player stands on
 * the boxes. Nothing here imports three.
 *
 * Local frame: u grows inland from the street door, v grows along +Z.
 */

import type { Aabb3 } from '../systems/Collision';
import type { ShopKind } from './data';
import { footprintOverlaps } from '../systems/Collision';

export type InteriorTemplate = 'laoyou' | 'fenjiao' | 'bbq' | 'milktea' | 'generic';

export interface ShopShell {
  id: string;
  /** ShopDef id, e.g. 'zhongshan-fenjiao'. unit.id is a generated slot id. */
  defId: string;
  kind: ShopKind;
  /** Centre of the street-facing door line. */
  x: number;
  z: number;
  /** Outward normal, toward the street. */
  nx: number;
  nz: number;
  cx: number;
  cz: number;
  /** Size along X (shop depth for an east/west frontage). */
  depth: number;
  /** Size along Z (frontage). */
  width: number;
}

export type PropId =
  | 'table-square'
  | 'table-round'
  | 'table-high'
  | 'stool'
  | 'stool-high'
  | 'counter'
  | 'steamer'
  | 'case'
  | 'grill'
  | 'menu'
  | 'lantern'
  | 'pot';

/** PR #5 的三家店：粉饺 / 烧烤 / 奶茶。店内按老友粉密度加料只作用于这三家。 */
export const WARM_SHOP_IDS = new Set(['zhongshan-fenjiao', 'rongji', 'hengzhou']);

export interface InteriorProp {
  prop: PropId;
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  h: number;
  /** World Y of the prop origin. Defaults to the 0.15 floor lip in the renderer. */
  y?: number;
  /** Hanging props (lanterns): no footprint, no collider. */
  hang?: boolean;
}

export interface InteriorSeat {
  id: string;
  x: number;
  z: number;
  y: number;
}

export interface InteriorLayout {
  shopId: string;
  template: InteriorTemplate;
  props: InteriorProp[];
  colliders: Aabb3[];
  seats: InteriorSeat[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** A point just inside the door, on the floor. */
  door: { x: number; z: number };
}

export function templateForKind(kind: ShopKind): InteriorTemplate {
  switch (kind) {
    case 'noodle':
    case 'luosifen':
    case 'rice':
      return 'laoyou';
    case 'fenjiao':
      return 'fenjiao';
    case 'grill':
    case 'seafood':
      return 'bbq';
    case 'tea':
      return 'milktea';
    default:
      return 'generic';
  }
}

interface LocalProp {
  prop: PropId;
  u: number;
  v: number;
  w: number;
  d: number;
  h: number;
  /** Stools become seats. */
  seat?: boolean;
  /** Hanging from the lid: skips the footprint/overlap checks and the collider. */
  hang?: boolean;
  /** World Y override for the prop origin. */
  y?: number;
}

const PROP_SIZE: Record<PropId, { w: number; d: number; h: number }> = {
  'table-square': { w: 0.8, d: 0.8, h: 0.75 },
  'table-round': { w: 1.05, d: 1.05, h: 0.76 },
  'table-high': { w: 0.7, d: 0.7, h: 1.05 },
  stool: { w: 0.34, d: 0.34, h: 0.45 },
  'stool-high': { w: 0.32, d: 0.32, h: 0.75 },
  counter: { w: 0.7, d: 2.4, h: 0.95 },
  steamer: { w: 0.55, d: 0.55, h: 0.9 },
  case: { w: 0.5, d: 1.2, h: 1.05 },
  grill: { w: 0.7, d: 1.1, h: 0.9 },
  // Short collider so it isn't a step or a camera block. The mesh is a wall board.
  menu: { w: 0.08, d: 1.05, h: 0.2 },
  // Hanging red lantern: no footprint, no collider.
  lantern: { w: 0.34, d: 0.34, h: 0 },
  // Floor stew pot on a burner.
  pot: { w: 0.52, d: 0.52, h: 0.55 },
};

function toWorld(shell: ShopShell, u: number, v: number): { x: number; z: number } {
  return {
    x: shell.x - shell.nx * u - shell.nz * v,
    z: shell.z - shell.nz * u + shell.nx * 0 + v,
  };
}

function boundsOf(shell: ShopShell): InteriorLayout['bounds'] {
  return {
    minX: shell.cx - shell.depth / 2,
    maxX: shell.cx + shell.depth / 2,
    minZ: shell.cz - shell.width / 2,
    maxZ: shell.cz + shell.width / 2,
  };
}

function addProp(
  list: LocalProp[],
  prop: PropId,
  u: number,
  v: number,
  seat = false,
  size?: Partial<{ w: number; d: number; h: number }> & { hang?: boolean; y?: number },
): void {
  const base = PROP_SIZE[prop];
  list.push({
    prop,
    u,
    v,
    w: size?.w ?? base.w,
    d: size?.d ?? base.d,
    h: size?.h ?? base.h,
    seat,
    hang: size?.hang,
    y: size?.y,
  });
}

function stoolsAround(list: LocalProp[], u: number, v: number, towardAisle: number): void {
  const s = 0.58;
  // Two on the aisle side, two on the flanks. The aisle side keeps a corridor at v=0.
  addProp(list, 'stool', u, v - Math.sign(towardAisle || 1) * s, true);
  addProp(list, 'stool', u + s, v, true);
  addProp(list, 'stool', u - s * 0.3, v + Math.sign(v || 1) * s, true);
  addProp(list, 'stool', u + s * 0.85, v + Math.sign(v || 1) * (s * 0.2), true);
}

/** Wall board on the back (or a side, if the back is a grill). Not a step. */
function addMenu(list: LocalProp[], depth: number, width: number, v: number): void {
  const d = 0.9;
  const limit = Math.max(0.4, width / 2 - 0.85);
  const vv = Math.max(-limit, Math.min(limit, v));
  addProp(list, 'menu', Math.max(1.4, depth - 0.58), vv, false, { w: 0.08, d, h: 0.2 });
}

function layoutFor(template: InteriorTemplate, depth: number, width: number): LocalProp[] {
  const list: LocalProp[] = [];
  const half = Math.max(1.2, width / 2 - 1.1);
  const side = Math.min(2.15, half * 0.72);
  const back = depth - 1.15;
  const counterW = Math.min(3.2, width - 1.6);

  if (template === 'laoyou') {
    addProp(list, 'counter', back, 0, false, { d: counterW, w: 0.7 });
    addProp(list, 'grill', back, counterW / 2 + 0.7, false, { w: 0.6, d: 0.6, h: 0.85 });
    const vs = width > 9 ? [-side, side] : [0];
    const us = [2.15, 4.35];
    for (const u of us) {
      for (const v of vs) {
        if (u > depth - 2.2) continue;
        addProp(list, 'table-square', u, v);
        stoolsAround(list, u, v, v === 0 ? 1 : v);
      }
    }
    addMenu(list, depth, width, side * 0.15);
  } else if (template === 'fenjiao') {
    addProp(list, 'counter', back, -0.4, false, { d: counterW * 0.8, w: 0.65 });
    addProp(list, 'steamer', back, counterW * 0.45);
    addProp(list, 'case', back - 0.2, -counterW * 0.55);
    const spots = [
      [2.2, -side],
      [2.2, side * 0.15],
      [4.3, side * 0.5],
    ] as const;
    for (const [u, v] of spots) {
      addProp(list, 'table-square', u, v);
      stoolsAround(list, u, v, v === 0 ? 1 : v);
    }
    addMenu(list, depth, width, side * 0.2);
  } else if (template === 'bbq') {
    addProp(list, 'grill', back, 0, false, { d: Math.min(2.2, counterW), w: 0.75, h: 0.9 });
    addProp(list, 'table-round', 2.4, -side);
    addProp(list, 'table-round', 4.4, side * 0.85);
    stoolsAround(list, 2.4, -side, -side);
    stoolsAround(list, 4.4, side * 0.85, side);
    addProp(list, 'stool', 3.3, 0.15, true);
    addProp(list, 'stool', 3.3, -0.55, true);
    addMenu(list, depth, width, side);
  } else if (template === 'milktea') {
    addProp(list, 'counter', back, 0, false, { d: Math.min(3.4, width - 1.4), w: 0.65, h: 1.0 });
    addProp(list, 'case', 1.5, -half * 0.75, false, { h: 1.05 });
    addProp(list, 'table-high', 2.5, side * 0.55);
    addProp(list, 'table-high', 4.3, -side * 0.35);
    addProp(list, 'stool-high', 2.5, side * 0.55 - 0.55, true);
    addProp(list, 'stool-high', 2.5 + 0.5, side * 0.55, true);
    addProp(list, 'stool-high', 4.3, -side * 0.35 + 0.55, true);
    addProp(list, 'stool-high', 4.3 - 0.5, -side * 0.35, true);
    addMenu(list, depth, width, 0);
  } else {
    addProp(list, 'counter', back, 0, false, { d: counterW, w: 0.7 });
    addProp(list, 'table-square', 2.4, -side * 0.7);
    addProp(list, 'table-square', 4.2, side * 0.7);
    stoolsAround(list, 2.4, -side * 0.7, -1);
    stoolsAround(list, 4.2, side * 0.7, 1);
    addMenu(list, depth, width, 0);
  }
  return list;
}

/** 老友粉级密度：三家暖色店专属。红灯笼 + 加灶 / 加桌，模板级布局不动。 */
function addWarmExtras(list: LocalProp[], template: InteriorTemplate, depth: number, width: number): void {
  const half = Math.max(1.2, width / 2 - 1.1);
  const side = Math.min(2.15, half * 0.72);
  const back = depth - 1.15;
  const hang = { hang: true, y: 2.15 } as const;
  // Red paper lanterns down the middle of the room, like 老友粉.
  addProp(list, 'lantern', 1.9, 0, false, hang);
  addProp(list, 'lantern', 3.4, 0, false, hang);
  if (template === 'fenjiao') {
    const counterW = Math.min(3.2, width - 1.6);
    // Second steamer stack + a stew pot on a burner beside the first.
    addProp(list, 'steamer', back, counterW * 0.45 + 0.95);
    addProp(list, 'pot', back - 0.85, counterW * 0.45 + 0.45);
    addProp(list, 'table-square', 4.35, -side * 0.6);
    stoolsAround(list, 4.35, -side * 0.6, -1);
  } else if (template === 'bbq') {
    addProp(list, 'table-round', 5.6, -side * 0.3);
    stoolsAround(list, 5.6, -side * 0.3, -1);
    addProp(list, 'lantern', 4.9, 0, false, hang);
  } else if (template === 'milktea') {
    addProp(list, 'table-high', 3.4, side * 0.55);
    addProp(list, 'stool-high', 3.4, side * 0.55 - 0.55, true);
    addProp(list, 'stool-high', 3.4 + 0.5, side * 0.55, true);
  }
}

function colliderFor(prop: InteriorProp): Aabb3 {
  return {
    minX: prop.x - prop.w / 2,
    maxX: prop.x + prop.w / 2,
    minZ: prop.z - prop.d / 2,
    maxZ: prop.z + prop.d / 2,
    minY: 0,
    maxY: prop.h,
    kind: 'walkable',
    camBlock: prop.h > 0.5,
    id: undefined,
  };
}

export function buildInterior(shell: ShopShell): InteriorLayout {
  const template = templateForKind(shell.kind);
  const depth = shell.depth;
  const local = layoutFor(template, depth, shell.width);
  if (WARM_SHOP_IDS.has(shell.defId)) addWarmExtras(local, template, depth, shell.width);
  const props: InteriorProp[] = [];
  const seats: InteriorSeat[] = [];
  const bounds = boundsOf(shell);
  const inset = 0.42;
  for (const item of local) {
    const at = toWorld(shell, item.u, item.v);
    const prop: InteriorProp = {
      prop: item.prop,
      x: at.x,
      z: at.z,
      rot: 0,
      w: item.w,
      d: item.d,
      h: item.h,
      y: item.y ?? 0.15,
      hang: item.hang,
    };
    if (!item.hang) {
      // Keep furniture off the party walls and the back wall. Drop a piece
      // that would stick out rather than shove it into another piece.
      const box = {
        minX: at.x - item.w / 2,
        maxX: at.x + item.w / 2,
        minZ: at.z - item.d / 2,
        maxZ: at.z + item.d / 2,
      };
      if (
        box.minX < bounds.minX + inset ||
        box.maxX > bounds.maxX - inset ||
        box.minZ < bounds.minZ + inset ||
        box.maxZ > bounds.maxZ - inset
      ) {
        continue;
      }
      const overlaps = props.some((other) => {
        if (other.hang) return false;
        const ow = other.w / 2;
        const od = other.d / 2;
        return !(
          box.maxX < other.x - ow + 0.02 ||
          box.minX > other.x + ow - 0.02 ||
          box.maxZ < other.z - od + 0.02 ||
          box.minZ > other.z + od - 0.02
        );
      });
      if (overlaps) continue;
    }
    props.push(prop);
    if (item.seat) {
      seats.push({ id: `${shell.id}-seat-${seats.length}`, x: at.x, z: at.z, y: item.h });
    }
  }
  const door = toWorld(shell, 0.55, 0);
  return {
    shopId: shell.id,
    template,
    props,
    colliders: props.filter((p) => !p.hang).map(colliderFor),
    seats,
    bounds,
    door,
  };
}

export function pointInsideShop(shell: ShopShell, x: number, z: number, margin = 0.25): boolean {
  const b = boundsOf(shell);
  return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin;
}

/**
 * Door → every seat has a path at least ~0.7 m wide. Furniture is blocked,
 * expanded by the player radius. A seat counts as reached when a free cell
 * within 0.6 m of it is connected to the door.
 */
export function seatsReachable(layout: InteriorLayout, radius = 0.34): { ok: boolean; missed: string[] } {
  const b = layout.bounds;
  const cell = 0.35;
  const x0 = b.minX + 0.3;
  const z0 = b.minZ + 0.3;
  const x1 = b.maxX - 0.3;
  const z1 = b.maxZ - 0.3;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
  const blocked = (x: number, z: number): boolean => {
    for (const c of layout.colliders) {
      if (c.maxY < 0.3) continue;
      if (footprintOverlaps(x, z, radius, c)) return true;
    }
    return false;
  };
  const idx = (ix: number, iz: number): number => iz * nx + ix;
  const open = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + (ix + 0.5) * cell;
      const z = z0 + (iz + 0.5) * cell;
      open[idx(ix, iz)] = blocked(x, z) ? 0 : 1;
    }
  }
  const startX = clampIndex(Math.floor((layout.door.x - x0) / cell), nx);
  const startZ = clampIndex(Math.floor((layout.door.z - z0) / cell), nz);
  // The door cell itself might clip a jamb. Search a small ring for a free cell.
  let sx = startX;
  let sz = startZ;
  let found = open[idx(sx, sz)] === 1;
  if (!found) {
    for (let r = 1; r <= 4 && !found; r++) {
      for (let dz = -r; dz <= r && !found; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const ix = startX + dx;
          const iz = startZ + dz;
          if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
          if (open[idx(ix, iz)] === 1) {
            sx = ix;
            sz = iz;
            found = true;
            break;
          }
        }
      }
    }
  }
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  if (found) {
    seen[idx(sx, sz)] = 1;
    queue.push(sx, sz);
  }
  for (let q = 0; q < queue.length; q += 2) {
    const ix = queue[q];
    const iz = queue[q + 1];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const jx = ix + dx;
      const jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      const k = idx(jx, jz);
      if (seen[k] || !open[k]) continue;
      seen[k] = 1;
      queue.push(jx, jz);
    }
  }
  const missed: string[] = [];
  for (const seat of layout.seats) {
    let reach = false;
    const ix0 = Math.floor((seat.x - 0.6 - x0) / cell);
    const ix1 = Math.floor((seat.x + 0.6 - x0) / cell);
    const iz0 = Math.floor((seat.z - 0.6 - z0) / cell);
    const iz1 = Math.floor((seat.z + 0.6 - z0) / cell);
    for (let iz = iz0; iz <= iz1 && !reach; iz++) {
      for (let ix = ix0; ix <= ix1 && !reach; ix++) {
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        if (seen[idx(ix, iz)] === 1) reach = true;
      }
    }
    if (!reach) missed.push(seat.id);
  }
  return { ok: found && missed.length === 0, missed };
}

function clampIndex(i: number, n: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}

export interface StreamShop {
  id: string;
  x: number;
  z: number;
}

export interface StreamRadii {
  enter: number;
  exit: number;
  max: number;
}

export function interiorRadii(touch: boolean): StreamRadii {
  return touch
    ? { enter: 20, exit: 28, max: 4 }
    : { enter: 30, exit: 40, max: 8 };
}

/**
 * Hysteresis stream: build within `enter`, keep until `exit`, never more
 * than `max` rooms. Closest doors win.
 */
export function planInteriorStream(
  active: readonly string[],
  shops: readonly StreamShop[],
  px: number,
  pz: number,
  radii: StreamRadii,
): { spawn: string[]; drop: string[] } {
  const dist = new Map<string, number>();
  for (const s of shops) dist.set(s.id, Math.hypot(s.x - px, s.z - pz));
  const activeSet = new Set(active);
  const drop: string[] = [];
  for (const id of active) {
    const d = dist.get(id);
    if (d === undefined || d > radii.exit) drop.push(id);
  }
  for (const id of drop) activeSet.delete(id);
  const candidates = shops
    .filter((s) => !activeSet.has(s.id) && (dist.get(s.id) ?? Infinity) <= radii.enter)
    .sort((a, b) => (dist.get(a.id) ?? 0) - (dist.get(b.id) ?? 0));
  const spawn: string[] = [];
  let count = activeSet.size;
  // If we are already over the cap (player walked into a crowd of rooms),
  // drop the farthest active rooms first.
  if (count > radii.max) {
    const ranked = [...activeSet].sort((a, b) => (dist.get(b) ?? 0) - (dist.get(a) ?? 0));
    while (count > radii.max && ranked.length) {
      const id = ranked.shift()!;
      drop.push(id);
      activeSet.delete(id);
      count--;
    }
  }
  for (const s of candidates) {
    if (count >= radii.max) break;
    spawn.push(s.id);
    count++;
  }
  return { spawn, drop };
}
