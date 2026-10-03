/**
 * 任务系统 — the reason to walk a direction instead of wandering.
 *
 * GTA is not fun because of the city, it's fun because the city gives you
 * reasons to be violent in it. A vertical slice with shops and a wanted level
 * but no goals is a sandbox you quit in four minutes. This is the loop: a
 * chained quest log, objective counters, waypoints, and rewards that open up
 * the next thing.
 *
 * Everything is data-driven off `SHOP` tags so adding a mission never touches
 * the systems that fire the events.
 */

import * as THREE from 'three';
import { SHOPS } from './data';
import type { NanningCity, ShopUnit } from './layout';

export type ObjectiveKind = 'eat' | 'drink' | 'snack' | 'smash' | 'checkpoint' | 'talk' | 'ride';

export interface Objective {
  id: string;
  label: string;
  kind: ObjectiveKind;
  /** Shop kind(s) this counts toward, or a specific mission id for the others. */
  match: string;
  need: number;
  got: number;
}

export interface Mission {
  id: string;
  title: string;
  brief: string;
  giver: string;
  objectives: Objective[];
  reward: number;
  /** Mission id that must be complete first. */
  requires?: string;
  /** 3D waypoint in world space. */
  waypoint: { x: number; z: number };
}

const obj = (id: string, label: string, kind: ObjectiveKind, match: string, need: number): Objective => ({
  id, label, kind, match, need, got: 0,
});

/**
 * The chain. Each entry is one contract; completing one pays out and opens the
 * next, so there is always exactly one thing you should be doing.
 */
export const MISSIONS: Mission[] = [
  {
    id: 'm1',
    title: '友仔，食粉未？',
    brief: '天朝肚腩冇嘢食。去三间唔同嘅粉店，各嗍一碗。',
    giver: '街口嗰个阿婆',
    objectives: [obj('a', '去 3 间唔同嘅粉店买粉', 'eat', 'noodle', 3)],
    reward: 90,
    waypoint: { x: 0, z: -20 },
  },
  {
    id: 'm2',
    title: '奶茶自由',
    brief: '横州嘅茉莉花，四间茶饮都试齐先算你有品味。',
    giver: '奶茶铺阿妹',
    objectives: [obj('a', '去 4 间唔同嘅茶饮店各买一杯', 'drink', 'tea', 4)],
    reward: 140,
    requires: 'm1',
    waypoint: { x: 0, z: 10 },
  },
  {
    id: 'm3',
    title: '酸嘢一条街',
    brief: '唔食酸嘢嘅南宁人唔算南宁人。酸嘢、凉茶、甜水，各样来一份。',
    giver: '酸嘢阿婆',
    objectives: [
      obj('a', '买 2 次酸嘢', 'snack', 'dessert', 2),
      obj('b', '买 1 次凉茶', 'drink', 'cold', 1),
      obj('c', '买 1 次糖水', 'snack', 'dessert-alt', 1),
    ],
    reward: 110,
    requires: 'm2',
    waypoint: { x: 0, z: -30 },
  },
  {
    id: 'm4',
    title: '夜市收租',
    brief: '有三条友仔赊咗租冇畀。搵佢哋，佢哋会畀你。',
    giver: '夜市管理处',
    objectives: [obj('a', '收齐 3 份数', 'talk', 'debt', 3)],
    reward: 260,
    requires: 'm3',
    waypoint: { x: 0, z: 30 },
  },
  {
    id: 'm5',
    title: '电瓶车飙车',
    brief: '搵部电瓶车，喺文创园嗰头跑五个圈。南宁人靠呢度车仔搵饭吃。',
    giver: '车行老板',
    objectives: [obj('a', '骑电瓶车穿过 5 个检查点', 'checkpoint', 'ride', 5)],
    reward: 320,
    requires: 'm4',
    waypoint: { x: 150, z: 0 },
  },
  {
    id: 'm6',
    title: '拆铺行动',
    brief: '有啲铺唔係咁开嘅。砸烂三间，当帮大家清理。',
    giver: '你自己想嘅',
    objectives: [obj('a', '砸烂 3 间铺', 'smash', 'any', 3)],
    reward: 0,
    requires: 'm5',
    waypoint: { x: 0, z: -60 },
  },
];

export interface MissionEvent {
  kind: ObjectiveKind;
  shopKind?: string;
  shopId?: string;
  checkpoint?: number;
  debt?: number;
}

const REWARD_TEXT: Record<string, string> = {
  m1: '三碗粉落肚，暖到脚趾都爽。',
  m2: '茉莉花香一路返屋企。',
  m3: '酸嘢配凉茶，冇咁上火。',
  m4: '钱到手，今晚宵夜有着落。',
  m5: '呢个速度，开去五象都得。',
  m6: '……你系真系唔讲道理㗎。',
};

export class Missions {
  active: Mission | null = null;
  completed = new Set<string>();
  /** Set for one frame when a mission finishes, so main.ts can play the payoff. */
  justFinished: Mission | null = null;
  /** Waypoint marker in the world. */
  readonly marker: THREE.Group;

  private seenShops = new Set<string>();
  private seenDessert = new Set<string>();
  private checkpoint = 0;
  private debts = 0;

  constructor(scene: THREE.Scene) {
    this.marker = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(1.5, 2.1, 24);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    this.marker.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 7, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
    );
    beam.position.y = 3.5;
    this.marker.add(beam);
    this.marker.visible = false;
    scene.add(this.marker);
    this.refresh();
  }

  /** The first mission whose prerequisite is met and which isn't done yet. */
  private next(): Mission | undefined {
    return MISSIONS.find((m) => !this.completed.has(m.id) && (!m.requires || this.completed.has(m.requires)));
  }

  /** Re-open the log at whatever the player has earned, and place the waypoint. */
  refresh(): void {
    this.active = this.next() ?? null;
    if (this.active) {
      this.marker.position.set(this.active.waypoint.x, 0, this.active.waypoint.z);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
    }
  }

  /** Feed an event in. Returns a payout description if this completed a mission. */
  feed(e: MissionEvent): { title: string; reward: number; line: string } | null {
    const m = this.active;
    if (!m) return null;
    let touched = false;

    for (const o of m.objectives) {
      if (o.kind !== e.kind) continue;
      if (e.kind === 'checkpoint') {
        this.checkpoint++;
        o.got = Math.min(o.need, this.checkpoint);
        touched = true;
        continue;
      }
      if (e.kind === 'talk') {
        this.debts++;
        o.got = Math.min(o.need, this.debts);
        touched = true;
        continue;
      }
      if (e.kind === 'smash') {
        o.got = Math.min(o.need, o.got + 1);
        touched = true;
        continue;
      }
      // Shop-kind objectives count DISTINCT shops, so you can't buy five bowls
      // at the same place and call it done.
      if (!this.matches(o, e)) continue;
      const key = `${e.shopId}`;
      if (o.kind === 'eat' || o.kind === 'drink' || o.kind === 'snack') {
        if (o.match === 'dessert' || o.match === 'dessert-alt') {
          if (this.seenDessert.has(key)) continue;
          this.seenDessert.add(key);
        } else if (this.seenShops.has(key)) continue;
        else this.seenShops.add(key);
      }
      o.got = Math.min(o.need, o.got + 1);
      touched = true;
    }

    if (!touched) return null;
    this.syncMarker();
    if (m.objectives.every((o) => o.got >= o.need)) {
      this.completed.add(m.id);
      const out = { title: m.title, reward: m.reward, line: REWARD_TEXT[m.id] ?? '搞掂。' };
      this.justFinished = m;
      this.resetCounters();
      this.refresh();
      return out;
    }
    return null;
  }

  private matches(o: Objective, e: MissionEvent): boolean {
    const k = e.shopKind;
    if (!k) return false;
    if (o.match === k) return true;
    if (o.match === 'dessert-alt') return k === 'dessert' && o.id === 'c';
    if (o.match === 'any') return true;
    return false;
  }

  /** Progress string for the HUD, e.g. "1/3". */
  progress(): string {
    if (!this.active) return '';
    const parts = this.active.objectives.map((o) => `${o.got}/${o.need}`);
    return parts.join(' · ');
  }

  title(): string {
    return this.active?.title ?? '';
  }

  brief(): string {
    return this.active?.brief ?? '';
  }

  giver(): string {
    return this.active?.giver ?? '';
  }

  objectiveLines(): { label: string; got: number; need: number }[] {
    return (this.active?.objectives ?? []).map((o) => ({ label: o.label, got: o.got, need: o.need }));
  }

  /** Distance to the current waypoint, for the HUD arrow. */
  distanceTo(px: number, pz: number): number {
    if (!this.active) return Infinity;
    return Math.hypot(this.active.waypoint.x - px, this.active.waypoint.z - pz);
  }

  angleTo(px: number, pz: number): number {
    if (!this.active) return 0;
    return Math.atan2(this.active.waypoint.x - px, -(this.active.waypoint.z - pz));
  }

  private syncMarker(): void {
    if (!this.active) {
      this.marker.visible = false;
      return;
    }
    this.marker.position.set(this.active.waypoint.x, 0, this.active.waypoint.z);
  }

  /** Spin the ring and bob the beam so it reads from across the street. */
  render(t: number): void {
    if (!this.marker.visible) return;
    this.marker.children[0].rotation.z = t * 0.8;
    const s = 1 + Math.sin(t * 2.4) * 0.09;
    this.marker.children[0].scale.set(s, s, 1);
  }

  consumeFinished(): Mission | null {
    const m = this.justFinished;
    this.justFinished = null;
    return m;
  }

  private resetCounters(): void {
    this.seenShops.clear();
    this.seenDessert.clear();
    this.checkpoint = 0;
    this.debts = 0;
  }
}

// ── Debt NPCs for the 收租 mission ──────────────────────────────────────────

export interface DebtTarget {
  x: number;
  z: number;
  name: string;
  amount: number;
  paid: boolean;
}

/** Find one NPC-shaped spot per 粉/茶/酸嘢 shop so the waypoints point somewhere real. */
export function debtTargets(city: NanningCity): DebtTarget[] {
  const names = ['肥仔阿明', '靓女阿珍', '肥婆秀英', '卷毛阿强', '阿婆细妹', '学生仔阿俊'];
  const out: DebtTarget[] = [];
  for (const u of city.shops as ShopUnit[]) {
    if (out.length >= 3) break;
    if (!['noodle', 'tea', 'grill'].includes(u.def.kind)) continue;
    out.push({
      x: u.x + u.nx * 2.2,
      z: u.z + u.nz * 2.2,
      name: names[out.length],
      amount: 60 + out.length * 45,
      paid: false,
    });
  }
  return out;
}

/** Objective tag for a shop kind, for the mission feed. */
export function tagForShop(kind: string): ObjectiveKind {
  if (kind === 'noodle') return 'eat';
  if (kind === 'tea' || kind === 'cold') return 'drink';
  return 'snack';
}

export function shopCount(): number {
  return SHOPS.length;
}
