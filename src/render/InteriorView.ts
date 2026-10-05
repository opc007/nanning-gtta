/**
 * Instanced furniture for the shops near the player, plus a merged shell
 * (floor + inner walls) so a room reads as a room once the camera is inside
 * the solid exterior. Shells rebuild when the active set changes; furniture
 * matrices update with it. At most one new room is built per call.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadInteriorKit } from './kenneyInterior';
import type { NanningBuilding, NanningCity, ShopUnit } from '../nanning/layout';
import {
  buildInterior,
  interiorRadii,
  planInteriorStream,
  pointInsideShop,
  WARM_SHOP_IDS,
  type InteriorLayout,
  type InteriorProp,
  type PropId,
  type ShopShell,
} from '../nanning/interiors';
import type { ShopDef } from '../nanning/data';
import { makeMenuBoardTexture } from './nnArch';
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

function paintGeo(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
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
    case 'lantern': {
      // Red paper lantern hanging from the lid; origin at the hang point.
      const body = new THREE.SphereGeometry(0.17, 12, 10);
      body.scale(1, 0.8, 1);
      const capT = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8);
      const capB = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8);
      const tassel = new THREE.BoxGeometry(0.035, 0.14, 0.035);
      return merged([
        paintGeo(body, 0xc22a28).translate(0, -0.19, 0),
        paintGeo(capT, 0xd9a441).translate(0, -0.045, 0),
        paintGeo(capB, 0xd9a441).translate(0, -0.335, 0),
        paintGeo(tassel, 0x8e1f1e).translate(0, -0.43, 0),
      ]);
    }
    case 'pot': {
      // Stew pot on a burner, lid on.
      const burner = new THREE.BoxGeometry(0.4, 0.08, 0.4);
      const body = new THREE.CylinderGeometry(0.24, 0.2, 0.3, 12);
      const lid = new THREE.CylinderGeometry(0.25, 0.25, 0.05, 12);
      const knob = new THREE.SphereGeometry(0.035, 8, 6);
      const hL = new THREE.BoxGeometry(0.12, 0.04, 0.04);
      const hR = new THREE.BoxGeometry(0.12, 0.04, 0.04);
      return merged([
        paintGeo(burner, 0x2e3238).translate(0, 0.04, 0),
        paintGeo(body, 0x9aa0a8).translate(0, 0.23, 0),
        paintGeo(lid, 0x3a3f45).translate(0, 0.405, 0),
        paintGeo(knob, 0x3a3f45).translate(0, 0.45, 0),
        paintGeo(hL, 0x6a7078).translate(-0.28, 0.3, 0),
        paintGeo(hR, 0x6a7078).translate(0.28, 0.3, 0),
      ]);
    }
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
  // Lantern / pot are vertex-coloured; the entries below are unused fallbacks.
  lantern: 0xc22a28,
  pot: STEEL,
};

const PROP_IDS: PropId[] = [
  'table-square', 'table-round', 'table-high', 'stool', 'stool-high',
  'counter', 'steamer', 'case', 'grill', 'menu', 'lantern', 'pot',
];

// Props small enough to instance per detail rather than per furniture piece.
const DECOR_IDS = ['charcoal', 'skewer', 'cup', 'bowl'] as const;
type DecorId = (typeof DECOR_IDS)[number];
const DECOR_CAP: Record<DecorId, number> = { charcoal: 32, skewer: 200, cup: 128, bowl: 128 };

function decorGeometry(id: DecorId): THREE.BufferGeometry {
  switch (id) {
    case 'charcoal': {
      const g = new THREE.PlaneGeometry(0.55, 0.95);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'skewer': {
      const stick = new THREE.BoxGeometry(0.025, 0.025, 0.72);
      const meat = new THREE.BoxGeometry(0.06, 0.05, 0.34);
      meat.translate(0, 0.02, 0.08);
      return merged([stick, meat]);
    }
    case 'cup': {
      const body = new THREE.CylinderGeometry(0.045, 0.038, 0.13, 10);
      body.translate(0, 0.065, 0);
      const lid = new THREE.CylinderGeometry(0.048, 0.048, 0.02, 10);
      lid.translate(0, 0.14, 0);
      return merged([body, lid]);
    }
    case 'bowl': {
      const g = new THREE.CylinderGeometry(0.075, 0.05, 0.07, 10);
      g.translate(0, 0.035, 0);
      return g;
    }
  }
}

function decorMaterial(id: DecorId): THREE.Material {
  switch (id) {
    case 'charcoal':
      // Glowing coal bed on the grill. Small and warm, well under bloom blowout.
      return new THREE.MeshStandardMaterial({ color: 0x20100a, emissive: 0xff5a1a, emissiveIntensity: 1.1, roughness: 1 });
    case 'skewer':
      return mat(0xd9b36a, 0.85);
    case 'cup':
      return mat(0xf4efe4, 0.6);
    case 'bowl':
      return mat(0xf8f5ec, 0.55);
  }
}

// Rising steam wisps over steamers, grills and stew pots. One draw call.
const STEAM_CAP = 360;
const STEAM_VERT = `
uniform float uTime;
attribute float aSeed;
varying float vAlpha;
void main() {
  float life = fract(uTime * 0.22 + aSeed);
  vec3 p = position;
  p.y += life * 1.15;
  p.x += sin(uTime * 1.4 + aSeed * 40.0) * 0.07 * life;
  p.z += cos(uTime * 1.1 + aSeed * 31.0) * 0.07 * life;
  vAlpha = (1.0 - life) * smoothstep(0.0, 0.14, life) * 0.4;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (10.0 + life * 46.0) * (140.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const STEAM_FRAG = `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.06, d) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.96, 0.93, 0.88, a);
}`;

function shellOf(unit: ShopUnit, building: NanningBuilding): ShopShell {
  return {
    id: unit.id,
    defId: unit.def.id,
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
  private readonly decorMeshes = new Map<DecorId, THREE.InstancedMesh>();
  private readonly dummy = new THREE.Object3D();
  private shellDirty = false;
  private defs = new Map<string, ShopDef>();
  private readonly menuGeo = new THREE.PlaneGeometry(1.15, 1.72);
  private readonly menuMeshes = new Map<string, THREE.Mesh>();
  private readonly steamGeo = new THREE.BufferGeometry();
  private readonly steamMat: THREE.ShaderMaterial;
  private readonly steam: THREE.Points;

  constructor(scene: THREE.Scene) {
    this.group.name = 'interiors';
    scene.add(this.group);
    for (const id of PROP_IDS) {
      // Lanterns and pots carry their own vertex colours.
      const material =
        id === 'lantern' || id === 'pot'
          ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 })
          : mat(PROP_MAT[id], id === 'case' ? 0.25 : 0.78);
      const mesh = new THREE.InstancedMesh(propGeometry(id), material, MAX_INST);
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
    // Tabletop / grill details for the three warm shops.
    for (const id of DECOR_IDS) {
      const mesh = new THREE.InstancedMesh(decorGeometry(id), decorMaterial(id), DECOR_CAP[id]);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.decorMeshes.set(id, mesh);
      this.group.add(mesh);
    }
    // Steam points, one draw call for every emitter.
    this.steamGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(STEAM_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.steamGeo.setAttribute(
      'aSeed',
      new THREE.BufferAttribute(new Float32Array(STEAM_CAP), 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.steamGeo.setDrawRange(0, 0);
    this.steamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: STEAM_VERT,
      fragmentShader: STEAM_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.steam = new THREE.Points(this.steamGeo, this.steamMat);
    this.steam.frustumCulled = false;
    this.steam.visible = false;
    this.steam.renderOrder = 5;
    this.group.add(this.steam);
  }

  /** Advance the steam shader clock. Called every frame from the main loop. */
  tick(dt: number): void {
    this.steamMat.uniforms.uTime.value += dt;
  }

  /**
   * One new room per call. Returns the furniture colliders of every room
   * that is currently built, and which shop the player is standing in.
   */
  update(city: NanningCity, px: number, pz: number, touch: boolean): { colliders: Aabb3[]; inside: ShopShell | null } {
    this.defs = new Map(city.shops.map((s) => [s.id, s.def]));
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

  /**
   * Swap the buckets that a code-built box could not credibly stand in for —
   * steamer stacks, stew pots, freezer cases, cups, bowls — for the Kenney
   * models. Layout, colliders and instance matrices are untouched; only the
   * geometry on the bucket changes, so this is safe to call at any time.
   * Returns how many buckets were actually replaced.
   */
  async useKenneyKit(): Promise<number> {
    const kit = await loadInteriorKit();
    let swapped = 0;
    for (const [id, geo] of kit) {
      const mesh = this.instances.get(id as PropId);
      if (!mesh) continue;
      mesh.geometry.dispose();
      mesh.geometry = geo;
      const m = mesh.material as THREE.MeshStandardMaterial;
      // The procedural props carry a vertex-colour attribute; the imported ones
      // do not, and leaving the flag on renders them black.
      m.vertexColors = false;
      m.needsUpdate = true;
      swapped++;
    }
    return swapped;
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
        this.dummy.position.set(p.x, p.y ?? 0.15, p.z);
        this.dummy.rotation.set(0, p.rot, 0);
        this.dummy.scale.set(sx, 1, sz);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.writeDecor();
    this.rebuildSteam();
  }

  /**
   * Small storytelling details, only for the three warm shops: glowing coals
   * and skewers on the grill, cups on the counter, bowls on the tables.
   */
  private writeDecor(): void {
    const buckets = new Map<DecorId, { x: number; y: number; z: number; rot: number; sx: number; sz: number }[]>();
    for (const id of DECOR_IDS) buckets.set(id, []);
    for (const layout of this.layouts.values()) {
      if (!WARM_SHOP_IDS.has(layout.shopId)) continue;
      for (const p of layout.props) {
        const cos = Math.cos(p.rot);
        const sin = Math.sin(p.rot);
        const at = (lx: number, lz: number): { x: number; z: number } => ({
          x: p.x + lx * cos + lz * sin,
          z: p.z - lx * sin + lz * cos,
        });
        if (p.prop === 'grill') {
          const sx = p.w / 0.7;
          const sz = p.d / 1.1;
          const c = at(0, 0);
          buckets.get('charcoal')!.push({ x: c.x, y: 0.965, z: c.z, rot: p.rot, sx, sz });
          for (let i = 0; i < 5; i++) {
            const s = at(0, (i - 2) * 0.17 * sz);
            buckets.get('skewer')!.push({ x: s.x, y: 1.0, z: s.z, rot: p.rot + (i % 2 === 0 ? 0.09 : -0.09), sx: 1, sz: 1 });
          }
        } else if (p.prop === 'counter') {
          const sz = p.d / 2.4;
          for (let i = 0; i < 4; i++) {
            const s = at(i % 2 === 0 ? -0.12 : 0.12, (i - 1.5) * 0.5 * sz);
            buckets.get('cup')!.push({ x: s.x, y: 1.095, z: s.z, rot: 0, sx: 1, sz: 1 });
          }
        } else if (p.prop === 'table-square') {
          for (const lx of [-0.18, 0.18]) {
            const s = at(lx, 0);
            buckets.get('bowl')!.push({ x: s.x, y: 0.895, z: s.z, rot: 0, sx: 1, sz: 1 });
          }
        }
      }
    }
    for (const id of DECOR_IDS) {
      const mesh = this.decorMeshes.get(id)!;
      const list = buckets.get(id)!;
      const n = Math.min(list.length, DECOR_CAP[id]);
      for (let i = 0; i < n; i++) {
        const d = list[i];
        this.dummy.position.set(d.x, d.y, d.z);
        this.dummy.rotation.set(0, d.rot, 0);
        this.dummy.scale.set(d.sx, 1, d.sz);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Steam emitters over every steamer, grill and stew pot of the warm shops. */
  private rebuildSteam(): void {
    const PER = 36;
    const emitters: { x: number; y: number; z: number }[] = [];
    for (const layout of this.layouts.values()) {
      if (!WARM_SHOP_IDS.has(layout.shopId)) continue;
      for (const p of layout.props) {
        const y = p.y ?? 0.15;
        if (p.prop === 'steamer') emitters.push({ x: p.x, y: y + 0.78, z: p.z });
        else if (p.prop === 'grill') emitters.push({ x: p.x, y: y + 0.86, z: p.z });
        else if (p.prop === 'pot') emitters.push({ x: p.x, y: y + 0.44, z: p.z });
      }
    }
    const pos = this.steamGeo.getAttribute('position') as THREE.BufferAttribute;
    const seed = this.steamGeo.getAttribute('aSeed') as THREE.BufferAttribute;
    let k = 0;
    for (const e of emitters) {
      for (let i = 0; i < PER && k < STEAM_CAP; i++, k++) {
        pos.setXYZ(k, e.x + (Math.random() - 0.5) * 0.34, e.y, e.z + (Math.random() - 0.5) * 0.34);
        seed.setX(k, Math.random());
      }
    }
    this.steamGeo.setDrawRange(0, k);
    pos.needsUpdate = true;
    seed.needsUpdate = true;
    this.steam.visible = k > 0;
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

    // Readable wall menus for the three warm shops — same art as the A-board,
    // hung on a side wall so it never fights the back-wall blank board.
    for (const m of this.menuMeshes.values()) m.visible = false;
    for (const layout of this.layouts.values()) {
      if (!WARM_SHOP_IDS.has(layout.shopId)) continue;
      const def = this.defs.get(layout.shopId);
      if (!def) continue;
      let mesh = this.menuMeshes.get(layout.shopId);
      if (!mesh) {
        const material = new THREE.MeshStandardMaterial({ map: makeMenuBoardTexture(def), roughness: 0.85 });
        mesh = new THREE.Mesh(this.menuGeo, material);
        this.menuMeshes.set(layout.shopId, mesh);
        this.group.add(mesh);
      }
      const b = layout.bounds;
      mesh.position.set((b.minX + b.maxX) / 2, 1.62, b.minZ + 0.3);
      mesh.rotation.set(0, 0, 0);
      mesh.visible = true;
    }
  }
}
