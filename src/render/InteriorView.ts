/**
 * Instanced furniture for the shops near the player, plus a merged shell
 * (floor + inner walls) so a room reads as a room once the camera is inside
 * the solid exterior. Shells rebuild when the active set changes; furniture
 * matrices update with it. At most one new room is built per call.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NanningBuilding, NanningCity, ShopUnit } from '../nanning/layout';
import {
  buildInterior,
  interiorRadii,
  planInteriorStream,
  pointInsideShop,
  type InteriorLayout,
  type InteriorProp,
  type PropId,
  type ShopShell,
} from '../nanning/interiors';
import type { Aabb3 } from '../systems/Collision';

const MAX_INST = 320;

const WOOD = 0x8d5a32;
const RED = 0xb4232a;
const STEEL = 0x8e949c;
const CREAM = 0xe7e0d4;
const TILE = 0xc4b49a;
const DARK = 0x2a2420;

function mat(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 });
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return parts.length === 1 ? parts[0] : (mergeGeometries(parts) as THREE.BufferGeometry);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function propGeometry(id: PropId): THREE.BufferGeometry {
  switch (id) {
    case 'table-square':
      return merged([
        box(0.8, 0.05, 0.8, 0, 0.72, 0),
        box(0.06, 0.7, 0.06, -0.32, 0.35, -0.32),
        box(0.06, 0.7, 0.06, 0.32, 0.35, -0.32),
        box(0.06, 0.7, 0.06, -0.32, 0.35, 0.32),
        box(0.06, 0.7, 0.06, 0.32, 0.35, 0.32),
      ]);
    case 'table-round': {
      const top = new THREE.CylinderGeometry(0.52, 0.52, 0.05, 10);
      top.translate(0, 0.74, 0);
      const leg = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6);
      leg.translate(0, 0.35, 0);
      return merged([top, leg]);
    }
    case 'table-high':
      return merged([
        box(0.7, 0.05, 0.7, 0, 1.02, 0),
        box(0.08, 1.0, 0.08, 0, 0.5, 0),
        box(0.4, 0.04, 0.08, 0, 0.28, 0),
      ]);
    case 'stool':
      return merged([
        box(0.32, 0.04, 0.32, 0, 0.43, 0),
        box(0.06, 0.4, 0.06, 0, 0.2, 0),
        box(0.28, 0.03, 0.06, 0, 0.08, 0),
      ]);
    case 'stool-high':
      return merged([
        box(0.3, 0.04, 0.3, 0, 0.73, 0),
        box(0.05, 0.7, 0.05, 0, 0.35, 0),
        box(0.22, 0.03, 0.22, 0, 0.28, 0),
      ]);
    case 'counter':
      return merged([box(0.7, 0.9, 2.4, 0, 0.45, 0), box(0.74, 0.05, 2.44, 0, 0.92, 0)]);
    case 'steamer':
      return merged([
        box(0.5, 0.16, 0.5, 0, 0.2, 0),
        box(0.46, 0.16, 0.46, 0, 0.4, 0),
        box(0.42, 0.16, 0.42, 0, 0.6, 0),
        box(0.4, 0.04, 0.4, 0, 0.72, 0),
      ]);
    case 'case':
      return merged([box(0.5, 0.08, 1.2, 0, 0.2, 0), box(0.46, 0.7, 1.12, 0, 0.6, 0)]);
    case 'grill':
      return merged([
        box(0.7, 0.35, 1.1, 0, 0.55, 0),
        box(0.6, 0.06, 1.0, 0, 0.78, 0),
        box(0.08, 0.4, 0.08, -0.28, 0.2, -0.45),
        box(0.08, 0.4, 0.08, 0.28, 0.2, 0.45),
      ]);
    case 'menu':
      return merged([
        box(0.05, 0.7, 1.05, 0, 1.55, 0),
        box(0.07, 0.08, 1.08, 0, 1.22, 0),
        box(0.07, 0.06, 1.08, 0, 1.88, 0),
        box(0.02, 0.5, 0.9, 0, 1.55, 0.03),
      ]);
    default:
      return box(0.4, 0.4, 0.4, 0, 0.2, 0);
  }
}

const PROP_MAT: Record<PropId, number> = {
  'table-square': WOOD,
  'table-round': WOOD,
  // Cartoon-warm like the 老友粉店: the milk-tea bar table and stools used to
  // be dark brown / near-black. Warm wood + red keeps the whole street one family.
  'table-high': WOOD,
  stool: RED,
  'stool-high': RED,
  counter: CREAM,
  steamer: STEEL,
  case: 0xd5dde6,
  grill: DARK,
  menu: 0xf4efe4,
};

const PROP_IDS: PropId[] = [
  'table-square', 'table-round', 'table-high', 'stool', 'stool-high',
  'counter', 'steamer', 'case', 'grill', 'menu',
];

function shellOf(unit: ShopUnit, building: NanningBuilding): ShopShell {
  return {
    id: unit.id,
    kind: unit.def.kind,
    x: unit.x,
    z: unit.z,
    nx: unit.nx,
    nz: unit.nz,
    cx: building.cx,
    cz: building.cz,
    depth: building.depth,
    width: building.width,
  };
}

export class InteriorView {
  readonly group = new THREE.Group();
  private readonly layouts = new Map<string, InteriorLayout>();
  private readonly shells = new Map<string, ShopShell>();
  private readonly pending: string[] = [];
  private shellMesh: THREE.Mesh | null = null;
  private readonly instances = new Map<PropId, THREE.InstancedMesh>();
  private readonly dummy = new THREE.Object3D();
  private shellDirty = false;

  constructor(scene: THREE.Scene) {
    this.group.name = 'interiors';
    scene.add(this.group);
    for (const id of PROP_IDS) {
      const mesh = new THREE.InstancedMesh(propGeometry(id), mat(PROP_MAT[id], id === 'case' ? 0.25 : 0.78), MAX_INST);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      if (id === 'case') {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.transparent = true;
        m.opacity = 0.45;
      }
      this.instances.set(id, mesh);
      this.group.add(mesh);
    }
  }

  /**
   * One new room per call. Returns the furniture colliders of every room
   * that is currently built, and which shop the player is standing in.
   */
  update(city: NanningCity, px: number, pz: number, touch: boolean): { colliders: Aabb3[]; inside: ShopShell | null } {
    const fronts = city.shops.filter((s) => !s.nightOnly && city.buildings[s.building]);
    const plan = planInteriorStream(
      [...this.layouts.keys(), ...this.pending],
      fronts.map((s) => ({ id: s.id, x: s.x, z: s.z })),
      px,
      pz,
      interiorRadii(touch),
    );
    for (const id of plan.drop) {
      this.layouts.delete(id);
      this.shells.delete(id);
      const at = this.pending.indexOf(id);
      if (at >= 0) this.pending.splice(at, 1);
      this.shellDirty = true;
    }
    for (const id of plan.spawn) {
      if (!this.layouts.has(id) && !this.pending.includes(id)) this.pending.push(id);
    }
    const next = this.pending.shift();
    if (next) {
      const unit = fronts.find((s) => s.id === next);
      const building = unit ? (city.buildings[unit.building] as NanningBuilding) : undefined;
      if (unit && building) {
        const shell = shellOf(unit, building);
        this.shells.set(unit.id, shell);
        this.layouts.set(unit.id, buildInterior(shell));
        this.shellDirty = true;
      }
    }
    if (this.shellDirty) {
      this.shellDirty = false;
      this.rebuildShells();
      this.writeInstances();
    }

    const colliders: Aabb3[] = [];
    for (const layout of this.layouts.values()) colliders.push(...layout.colliders);
    let inside: ShopShell | null = null;
    for (const shell of this.shells.values()) {
      if (pointInsideShop(shell, px, pz, 0.15)) {
        inside = shell;
        break;
      }
    }
    return { colliders, inside };
  }

  /** Furniture currently in the world, for screenshots and e2e. */
  props(): (InteriorProp & { shopId: string })[] {
    const all: (InteriorProp & { shopId: string })[] = [];
    for (const layout of this.layouts.values()) {
      for (const p of layout.props) all.push({ ...p, shopId: layout.shopId });
    }
    return all;
  }

  private writeInstances(): void {
    const buckets = new Map<PropId, InteriorProp[]>();
    for (const id of PROP_IDS) buckets.set(id, []);
    for (const layout of this.layouts.values()) {
      for (const p of layout.props) buckets.get(p.prop)?.push(p);
    }
    for (const id of PROP_IDS) {
      const mesh = this.instances.get(id)!;
      const list = buckets.get(id)!;
      const n = Math.min(list.length, MAX_INST);
      for (let i = 0; i < n; i++) {
        const p = list[i];
        // Counter / case geometry is authored at a fixed depth. Scale Z to the prop.
        const base = id === 'counter' ? 2.4 : id === 'case' ? 1.2 : id === 'grill' ? 1.1 : p.d;
        const sz = base > 0 ? p.d / base : 1;
        const sx = id === 'counter' || id === 'grill' ? p.w / (id === 'grill' ? 0.7 : 0.7) : 1;
        this.dummy.position.set(p.x, 0.15, p.z);
        this.dummy.rotation.set(0, p.rot, 0);
        this.dummy.scale.set(sx, 1, sz);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private rebuildShells(): void {
    if (this.shellMesh) {
      this.group.remove(this.shellMesh);
      this.shellMesh.geometry.dispose();
      (this.shellMesh.material as THREE.Material).dispose();
      this.shellMesh = null;
    }
    const parts: THREE.BufferGeometry[] = [];
    for (const layout of this.layouts.values()) {
      const shell = this.shells.get(layout.shopId);
      if (!shell) continue;
      const b = layout.bounds;
      const y = 0.15;
      // Floor, inset so it doesn't z-fight the arcade lip.
      parts.push(box(b.maxX - b.minX - 0.5, 0.04, b.maxZ - b.minZ - 0.5, (b.minX + b.maxX) / 2, y - 0.02, (b.minZ + b.maxZ) / 2));
      const t = 0.12;
      const h = 2.6;
      const cy = y + h / 2;
      // Inner walls along Z (the depth sides) and the back. Leave the street face open.
      const backX = shell.nx > 0 ? b.minX + 0.2 : b.maxX - 0.2;
      parts.push(box(t, h, b.maxZ - b.minZ - 0.4, backX, cy, (b.minZ + b.maxZ) / 2));
      parts.push(box(b.maxX - b.minX - 0.5, h, t, (b.minX + b.maxX) / 2, cy, b.minZ + 0.22));
      parts.push(box(b.maxX - b.minX - 0.5, h, t, (b.minX + b.maxX) / 2, cy, b.maxZ - 0.22));
      // Lid so a high orbit still reads as a room. The eye stays below 2.45.
      parts.push(box(b.maxX - b.minX - 0.55, 0.06, b.maxZ - b.minZ - 0.55, (b.minX + b.maxX) / 2, y + 2.58, (b.minZ + b.maxZ) / 2));
    }
    if (!parts.length) return;
    const geo = merged(parts);
    const shellMat = mat(TILE, 0.9);
    shellMat.side = THREE.DoubleSide;
    this.shellMesh = new THREE.Mesh(geo, shellMat);
    this.shellMesh.receiveShadow = true;
    this.shellMesh.castShadow = false;
    this.group.add(this.shellMesh);
  }
}
