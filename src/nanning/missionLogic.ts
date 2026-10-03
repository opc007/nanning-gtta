/**
 * Pure mission log. No Three.js — the marker mesh lives in `missions.ts`.
 *
 * Shop objectives track distinct shops **per objective**. A shared set is what
 * made the old mission 3 impossible: the 酸嘢 objective and the 糖水 objective
 * both matched dessert shops and wrote into one `seenDessert`, so the second
 * objective never got a shop of its own.
 */

export type ObjectiveKind = 'eat' | 'drink' | 'snack' | 'smash' | 'checkpoint' | 'talk' | 'ride';

export interface Objective {
  id: string;
  label: string;
  kind: ObjectiveKind;
  /** Shop kind this counts toward. `dessert-alt` also matches kind `dessert`. */
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
  requires?: string;
  waypoint: { x: number; z: number };
}

export interface MissionEvent {
  kind: ObjectiveKind;
  shopKind?: string;
  shopId?: string;
  checkpoint?: number;
  debt?: number;
}

export interface MissionPayout {
  title: string;
  reward: number;
  line: string;
}

const obj = (id: string, label: string, kind: ObjectiveKind, match: string, need: number): Objective => ({
  id, label, kind, match, need, got: 0,
});

/**
 * Three jobs, all on 中山路. Nothing sends you to a district this map no longer has.
 */
export const STREET_MISSIONS: Mission[] = [
  {
    id: 'm1',
    title: '友仔，食粉未？',
    brief: '中山路北段有三间老友粉。每间各嗍一碗，唔好喺同一间刷。',
    giver: '街口阿婆',
    objectives: [obj('a', '去 3 间唔同嘅老友粉', 'eat', 'noodle', 3)],
    reward: 90,
    waypoint: { x: 0, z: -80 },
  },
  {
    id: 'm2',
    title: '粉饺配糖水',
    brief: '粉饺两间都试过，再搵一间糖水铺收尾。',
    giver: '粉饺铺',
    objectives: [
      obj('a', '去 2 间唔同嘅粉饺', 'snack', 'fenjiao', 2),
      obj('b', '买 1 次糖水', 'snack', 'dessert', 1),
    ],
    reward: 80,
    requires: 'm1',
    waypoint: { x: 0, z: -40 },
  },
  {
    id: 'm3',
    title: '夜市扫一条街',
    brief: '中段烧烤食两间，南段再饮一杯奶茶。',
    giver: '夜市口',
    objectives: [
      obj('a', '去 2 间烧烤', 'snack', 'grill', 2),
      obj('b', '买 1 杯奶茶', 'drink', 'tea', 1),
    ],
    reward: 70,
    requires: 'm2',
    waypoint: { x: 0, z: 10 },
  },
];

const REWARD_TEXT: Record<string, string> = {
  m1: '三碗粉落肚，酸笋还在。',
  m2: '粉饺配糖水，刚刚好。',
  m3: '烧烤配奶茶，中山路行完一转。',
};

function cloneMission(m: Mission): Mission {
  return {
    ...m,
    waypoint: { ...m.waypoint },
    objectives: m.objectives.map((o) => ({ ...o })),
  };
}

export function matchesShop(o: Objective, shopKind: string | undefined): boolean {
  if (!shopKind) return false;
  if (o.match === shopKind) return true;
  // Legacy alias: a second dessert objective used to share the first's record.
  if (o.match === 'dessert-alt') return shopKind === 'dessert';
  if (o.match === 'any') return true;
  return false;
}

export class MissionLog {
  active: Mission | null = null;
  readonly completed = new Set<string>();
  justFinished: Mission | null = null;

  private readonly missions: Mission[];
  /** Objective id → shop ids already counted. Never shared across objectives. */
  private readonly seen = new Map<string, Set<string>>();
  private checkpoint = 0;
  private debts = 0;

  constructor(list: Mission[] = STREET_MISSIONS) {
    this.missions = list.map(cloneMission);
    this.refresh();
  }

  private next(): Mission | undefined {
    return this.missions.find((m) => !this.completed.has(m.id) && (!m.requires || this.completed.has(m.requires)));
  }

  refresh(): void {
    this.active = this.next() ?? null;
  }

  /** Move the active (or named) mission's waypoint onto a real shop. */
  setWaypoint(id: string, x: number, z: number): void {
    const m = this.missions.find((mission) => mission.id === id);
    if (m) m.waypoint = { x, z };
  }

  waypoint(): { x: number; z: number } | null {
    return this.active ? { ...this.active.waypoint } : null;
  }

  feed(e: MissionEvent): MissionPayout | null {
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
      if (!matchesShop(o, e.shopKind)) continue;
      const key = `${e.shopId}`;
      if (o.kind === 'eat' || o.kind === 'drink' || o.kind === 'snack') {
        const seen = this.seenFor(o.id);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      o.got = Math.min(o.need, o.got + 1);
      touched = true;
    }

    if (!touched) return null;
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

  progress(): string {
    if (!this.active) return '';
    return this.active.objectives.map((o) => `${o.got}/${o.need}`).join(' · ');
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

  distanceTo(px: number, pz: number): number {
    if (!this.active) return Infinity;
    return Math.hypot(this.active.waypoint.x - px, this.active.waypoint.z - pz);
  }

  angleTo(px: number, pz: number): number {
    if (!this.active) return 0;
    return Math.atan2(this.active.waypoint.x - px, -(this.active.waypoint.z - pz));
  }

  consumeFinished(): Mission | null {
    const m = this.justFinished;
    this.justFinished = null;
    return m;
  }

  private seenFor(objectiveId: string): Set<string> {
    let set = this.seen.get(objectiveId);
    if (!set) {
      set = new Set();
      this.seen.set(objectiveId, set);
    }
    return set;
  }

  private resetCounters(): void {
    this.seen.clear();
    this.checkpoint = 0;
    this.debts = 0;
  }
}

/** Objective tag for a shop kind, for the mission feed. */
export function tagForShop(kind: string): ObjectiveKind {
  if (kind === 'noodle') return 'eat';
  if (kind === 'tea' || kind === 'cold') return 'drink';
  return 'snack';
}

/**
 * Point each mission's waypoint at a real storefront of the kind it asks for.
 */
export function anchorStreetMissions(
  log: MissionLog,
  shops: { x: number; z: number; kind: string; nightOnly?: boolean }[],
): void {
  const find = (kind: string) => shops.find((s) => s.kind === kind && !s.nightOnly);
  const noodle = find('noodle');
  const fenjiao = find('fenjiao');
  const grill = find('grill');
  if (noodle) log.setWaypoint('m1', noodle.x, noodle.z);
  if (fenjiao) log.setWaypoint('m2', fenjiao.x, fenjiao.z);
  if (grill) log.setWaypoint('m3', grill.x, grill.z);
}
