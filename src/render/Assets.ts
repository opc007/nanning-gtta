import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building, Streetlight, Prop } from '../world/City';
import type { FacadeStyle, PropType } from '../world/biome';
import { makeFacadeTexture, makeGlowTexture } from './textures';

import { makeCarBody, type BodyShape } from './vehicleBody';
import { makeHumanoid, streetStyle } from './character';

const LAMP_HEIGHT = 5.2;

const UV_TILE = 24; // world units per full facade-texture tile (~3 units/window)

/**
 * Mesh factories. Buildings share a small pool of facade textures and a cached
 * material-per-(texture x tint) set, so hundreds of towers cost only a handful
 * of materials. Per-building geometry carries custom UV scaling so window rows
 * track each tower's real height.
 */
const FACADE_STYLES: FacadeStyle[] = ['glass', 'brick', 'concrete'];

export class CityAssets {
  private readonly facadesByStyle: Record<FacadeStyle, THREE.CanvasTexture[]>;
  private readonly sideCache = new Map<string, THREE.Material>();
  private readonly roofMat: THREE.Material;

  // Shared across every streetlight so the whole grid of lamps costs a handful
  // of GPU resources, not one set per pole.
  private readonly poleGeo = new THREE.CylinderGeometry(0.13, 0.18, LAMP_HEIGHT, 8);
  private readonly headGeo = new THREE.SphereGeometry(0.42, 12, 10);
  private readonly poolGeo = new THREE.PlaneGeometry(11, 11);
  private readonly poleMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7, metalness: 0.4 });
  private readonly headMat = new THREE.MeshStandardMaterial({
    color: 0xffe6bf,
    emissive: 0xffd9a0,
    emissiveIntensity: 3,
  });
  private readonly poolMat: THREE.Material;

  // Shared prototype geometry+material per prop type; each geometry is shifted so
  // its base sits at y=0, so an instance matrix only needs world x/z + rotation.
  private readonly propProto: Record<PropType, { geo: THREE.BufferGeometry; mat: THREE.Material }>;

  constructor(seed: number, variants = 3) {
    // A small pool of texture variants per facade style; buildings draw from the
    // pool matching their biome-assigned style, so the skyline isn't all glass.
    this.facadesByStyle = { glass: [], brick: [], concrete: [] };
    FACADE_STYLES.forEach((style, s) => {
      for (let i = 0; i < variants; i++) {
        this.facadesByStyle[style].push(makeFacadeTexture(seed + s * 1000 + i * 101, style));
      }
    });
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.95 });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });

    // Each prop is several primitives merged into ONE vertex-coloured geometry,
    // so a whole prop type still renders as a single InstancedMesh while looking
    // like an actual tree / hydrant / bench instead of a bare cone or box.
    const vc = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.propProto = {
      tree: { geo: makeTreeGeometry(), mat: vc() },
      hydrant: { geo: makeHydrantGeometry(), mat: vc() },
      bench: { geo: makeBenchGeometry(), mat: vc() },
    };
  }

  /** One InstancedMesh per prop type (a few draw calls for the whole map). */
  makeProps(props: Prop[]): THREE.Group {
    const group = new THREE.Group();
    const byType: Record<PropType, Prop[]> = { tree: [], hydrant: [], bench: [] };
    for (const p of props) byType[p.type].push(p);

    const dummy = new THREE.Object3D();
    for (const type of Object.keys(byType) as PropType[]) {
      const list = byType[type];
      if (list.length === 0) continue;
      const { geo, mat } = this.propProto[type];
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      inst.castShadow = true;
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    return group;
  }

  makeStreetlight(s: Streetlight): THREE.Group {
    const g = new THREE.Group();

    const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
    pole.position.y = LAMP_HEIGHT / 2;
    pole.castShadow = true;
    g.add(pole);

    const head = new THREE.Mesh(this.headGeo, this.headMat);
    head.position.y = LAMP_HEIGHT;
    g.add(head);

    const pool = new THREE.Mesh(this.poolGeo, this.poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.05; // hover just above the road to avoid z-fighting
    g.add(pool);

    g.position.set(s.x, 0, s.z);
    return g;
  }

  makeBuilding(b: Building, index: number): THREE.Mesh {
    const geo = new THREE.BoxGeometry(b.width, b.height, b.depth);
    scaleFacadeUvs(geo, b.width, b.height, b.depth);

    const pool = this.facadesByStyle[b.style];
    const facade = pool[index % pool.length];
    const side = this.sideMaterial(facade, b.color);
    // Face order: +X, -X, +Y(roof), -Y(floor), +Z, -Z.
    const mesh = new THREE.Mesh(geo, [side, side, this.roofMat, this.roofMat, side, side]);
    mesh.position.set(b.cx, b.height / 2, b.cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Day/night: lit windows and lamp heads shouldn't glow in daylight, so scale
   * their emissive by the daylight factor (`d`: 0 night → 1 noon). By day the
   * facades also turn glassier (lower roughness, higher metalness) so windows
   * read as reflective glass instead of dark holes.
   */
  setDaylight(d: number): void {
    const lit = 1 - 0.92 * d; // full glow at night → nearly off at noon
    for (const m of this.sideCache.values()) {
      const sm = m as THREE.MeshStandardMaterial;
      sm.emissiveIntensity = 1.1 * lit;
      sm.roughness = 0.75 - 0.5 * d;
      sm.metalness = 0.05 + 0.5 * d;
    }
    // Pressed down per the PR #5 review: lamp heads and their ground pools
    // were washing the shop doorheads white together with the signs.
    this.headMat.emissiveIntensity = 2.2 * lit;
    (this.poolMat as THREE.MeshBasicMaterial).opacity = 0.6 * lit;
  }

  private sideMaterial(facade: THREE.CanvasTexture, tint: number): THREE.Material {
    const key = `${facade.uuid}:${tint}`;
    let mat = this.sideCache.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: tint,
        map: facade,
        emissive: 0xffffff,
        emissiveMap: facade,
        emissiveIntensity: 1.1,
        roughness: 0.75,
        metalness: 0.05,
      });
      this.sideCache.set(key, mat);
    }
    return mat;
  }
}

/** Scale per-face UVs so windows tile by real dimensions; roof/floor collapse to the dark texel. */
function scaleFacadeUvs(geo: THREE.BoxGeometry, w: number, h: number, d: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const set = (face: number, su: number, sv: number): void => {
    const base = face * 8;
    for (let i = 0; i < 4; i++) {
      uv.array[base + i * 2] *= su;
      uv.array[base + i * 2 + 1] *= sv;
    }
  };
  // Repeat a WHOLE number of tiles per face: a fractional repeat leaves a
  // partial tile at the seam that slices windows in half (worst on the big,
  // sparse brick facades). Rounding to integer tiles keeps every window intact;
  // window size then varies slightly per building, which reads fine.
  const ru = (n: number) => Math.max(1, Math.round(n / UV_TILE));
  set(0, ru(d), ru(h)); // +X
  set(1, ru(d), ru(h)); // -X
  set(2, 0, 0); // +Y roof
  set(3, 0, 0); // -Y floor
  set(4, ru(w), ru(h)); // +Z
  set(5, ru(w), ru(h)); // -Z
  uv.needsUpdate = true;
}

export interface CarMesh {
  group: THREE.Group;
  /** Front wheels, rotated for a visual steering cue. */
  steerWheels: THREE.Object3D[];
}

/** Give every vertex of a geometry the same colour (for merged, vertex-coloured props). */
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

/** A little conifer: brown trunk + green canopy, base at y=0. */
function makeTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6);
  trunk.translate(0, 0.6, 0);
  const canopy = new THREE.ConeGeometry(1.1, 2.6, 8);
  canopy.translate(0, 2.5, 0);
  return merge([paint(trunk, 0x6b4a2f), paint(canopy, 0x2f5d3a)]);
}

/** A fire hydrant: stout body, domed cap, two side nozzles. */
function makeHydrantGeometry(): THREE.BufferGeometry {
  const red = 0xb5402f;
  const body = new THREE.CylinderGeometry(0.2, 0.24, 0.7, 8);
  body.translate(0, 0.35, 0);
  const dome = new THREE.SphereGeometry(0.2, 8, 6);
  dome.translate(0, 0.7, 0);
  const noz = new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6);
  noz.rotateZ(Math.PI / 2);
  const left = noz.clone();
  left.translate(-0.26, 0.42, 0);
  const right = noz.clone();
  right.translate(0.26, 0.42, 0);
  return merge([body, dome, left, right].map((g) => paint(g, red)));
}

/** A park bench: seat, backrest, two legs. */
function makeBenchGeometry(): THREE.BufferGeometry {
  const dark = 0x33363d;
  const seat = new THREE.BoxGeometry(1.5, 0.12, 0.5);
  seat.translate(0, 0.45, 0);
  const back = new THREE.BoxGeometry(1.5, 0.4, 0.1);
  back.translate(0, 0.66, -0.2);
  const legGeo = new THREE.BoxGeometry(0.12, 0.45, 0.45);
  const legL = legGeo.clone();
  legL.translate(-0.65, 0.22, 0);
  const legR = legGeo.clone();
  legR.translate(0.65, 0.22, 0);
  return merge([seat, back, legL, legR].map((g) => paint(g, dark)));
}

/**
 * A car body silhouette. Dimensions stay close to the shared collision circle
 * (CAR_RADIUS), so variety is visual — proportions, ride height, cabin shape —
 * not a physics change (per-car mass/radius is R003). `cabinX` shifts the cabin
 * fore/aft (a pickup's cab sits forward; a van's is long and tall).
 */
export interface CarShape {
  id: string;
  length: number;
  width: number;
  bodyH: number; // body box height
  bodyY: number; // body centre height (ride)
  cabinLen: number;
  cabinH: number;
  cabinX: number; // cabin offset along length (+front)
  wheelR: number;
}

export const CAR_SHAPES: CarShape[] = [
  { id: 'sedan', length: 4.0, width: 1.9, bodyH: 0.7, bodyY: 0.65, cabinLen: 2.1, cabinH: 0.7, cabinX: -0.2, wheelR: 0.45 },
  { id: 'compact', length: 3.5, width: 1.8, bodyH: 0.72, bodyY: 0.62, cabinLen: 1.6, cabinH: 0.74, cabinX: -0.1, wheelR: 0.42 },
  { id: 'sports', length: 4.3, width: 1.86, bodyH: 0.55, bodyY: 0.5, cabinLen: 1.8, cabinH: 0.5, cabinX: -0.35, wheelR: 0.44 },
  { id: 'van', length: 4.4, width: 2.0, bodyH: 1.0, bodyY: 0.8, cabinLen: 2.7, cabinH: 1.0, cabinX: 0.1, wheelR: 0.46 },
  { id: 'pickup', length: 4.4, width: 1.96, bodyH: 0.8, bodyY: 0.72, cabinLen: 1.5, cabinH: 0.95, cabinX: 0.55, wheelR: 0.48 },
  // 电动车 — narrow, no cabin, and 1/8th the mass of a car.
  { id: 'ebike', length: 1.85, width: 0.72, bodyH: 0.5, bodyY: 0.52, cabinLen: 0, cabinH: 0, cabinX: 0, wheelR: 0.28 },
];

/** Body builder for the CAR_SHAPES table — lofted hulls, not boxes. */
export function makeCar(color: number, shape: CarShape = CAR_SHAPES[0]): CarMesh {
  return makeCarBody(color, (shape.id as BodyShape) ?? 'sedan');
}

/** The e-bike entry from CAR_SHAPES, so the mesh builder and the table can't drift. */
export const EBIKE_SHAPE: CarShape = CAR_SHAPES.find((s) => s.id === 'ebike')!;

/**
 * 电瓶车 body. Step-through scooter silhouette: floorboard, battery box, seat,
 * leg shield, handlebar. Narrow enough (0.72 m) to feel wrong on a main road
 * and right on a pavement, which is the whole point.
 */
export function makeEbike(color: number, shape: CarShape = EBIKE_SHAPE): CarMesh {
  const group = new THREE.Group();
  const hl = shape.length / 2;
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.88 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.32, metalness: 0.85 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(shape.length * 0.5, 0.08, shape.width * 0.86), dark);
  floor.position.set(-0.08, shape.bodyY - 0.18, 0);
  group.add(floor);
  const batt = new THREE.Mesh(new THREE.BoxGeometry(shape.length * 0.34, 0.22, shape.width * 0.72), paint);
  batt.position.set(-0.05, shape.bodyY - 0.3, 0);
  group.add(batt);
  const seat = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 7), dark);
  seat.position.set(-0.52, shape.bodyY + 0.16, 0);
  seat.scale.set(1.1, 0.42, 0.82);
  group.add(seat);
  // Leg shield: a tapered shell, not a slab.
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.5, 10), paint);
  shield.position.set(0.42, shape.bodyY + 0.06, 0);
  shield.scale.set(0.62, 1, 1.15);
  shield.rotation.z = -0.12;
  shield.castShadow = true;
  group.add(shield);
  const fair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), paint);
  fair.position.set(0.62, shape.bodyY + 0.16, 0);
  fair.scale.set(0.6, 0.85, 1.05);
  group.add(fair);
  // Handlebar + grips
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, shape.width * 1.2, 6), chrome);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.44, shape.bodyY + 0.42, 0);
  group.add(bar);
  for (const sz of [-1, 1]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 6), dark);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.44, shape.bodyY + 0.42, sz * shape.width * 0.55);
    group.add(grip);
    // Mirrors
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 4), dark);
    stalk.position.set(0.47, shape.bodyY + 0.5, sz * 0.19);
    stalk.rotation.x = sz * 0.28;
    group.add(stalk);
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), chrome);
    mirror.position.set(0.49, shape.bodyY + 0.57, sz * 0.24);
    mirror.scale.set(0.45, 1, 1);
    group.add(mirror);
  }
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.082, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xffe9b0, emissiveIntensity: 2.4 }),
  );
  head.position.set(0.74, shape.bodyY + 0.2, 0);
  group.add(head);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.09, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x551015, emissive: 0xff2030, emissiveIntensity: 1.8 }),
  );
  tail.position.set(-hl + 0.04, shape.bodyY + 0.2, 0);
  group.add(tail);

  // Tyres with spoked rims, not smooth tori.
  const tyre = new THREE.TorusGeometry(shape.wheelR * 0.76, shape.wheelR * 0.26, 8, 16);
  tyre.rotateY(Math.PI / 2);
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.96 });
  const rimGeo = new THREE.CylinderGeometry(shape.wheelR * 0.52, shape.wheelR * 0.52, 0.05, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b4b8, roughness: 0.35, metalness: 0.8 });
  const spokeGeo = new THREE.BoxGeometry(0.03, shape.wheelR * 0.98, 0.02);
  const steerWheels: THREE.Object3D[] = [];
  for (const wx of [hl * 0.84, -hl * 0.76]) {
    const w = new THREE.Mesh(tyre, tyreMat);
    w.position.set(wx, shape.wheelR, 0);
    w.castShadow = true;
    group.add(w);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.copy(w.position);
    group.add(rim);
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(spokeGeo, rimMat);
      sp.position.copy(w.position);
      sp.rotation.x = (k / 5) * Math.PI;
      group.add(sp);
    }
    if (wx > 0) steerWheels.push(w);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, steerWheels };
}

/**
 * Ambient pedestrian. Was a capsule + sphere, which is a placeholder, not a
 * person. Now the same proportioned rig as the player in street clothes.
 */
export function makePed(color: number): THREE.Group {
  const style = { ...streetStyle(Math.floor(Math.random() * 8)), shirt: color, jacket: color };
  const rig = makeHumanoid(style);
  rig.group.userData.rig = rig;
  return rig.group;
}
