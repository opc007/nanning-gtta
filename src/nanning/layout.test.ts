import { describe, expect, it } from 'vitest';
import {
  ALLEY_DEPTH,
  ALLEY_WIDTH,
  ARCADE_DEPTH,
  ARCADE_RAISE,
  SHOP_DEPTH,
  STREET_HALF,
  STREET_Z0,
  STREET_Z1,
  generateNanningCity,
  type NanningCity,
} from './layout';
import { hourFromDay, nightMarketOpen } from './clock';
import { MissionLog, anchorStreetMissions, tagForShop, type Mission } from './missionLogic';

const sig = (c: NanningCity): string =>
  JSON.stringify({
    shops: c.shops.map((s) => [s.id, +s.x.toFixed(3), +s.z.toFixed(3), s.def.id, !!s.nightOnly]),
    stalls: c.stalls.map((s) => [+s.x.toFixed(3), +s.z.toFixed(3)]),
    cols: c.colliders.map((b) => [b.minX, b.minZ, b.maxX, b.maxZ]),
    lanes: c.lanes,
    buildings: c.buildings.map((b) => [b.cx, b.cz, b.width, b.depth, b.height, b.kind]),
    center: c.center,
    car: c.carSpawn,
  });

describe('中山路 layout', () => {
  const city = generateNanningCity(1945);

  it('is a 300 m street, 9 m wide, with a 2.4 m raised arcade and 8 m shops', () => {
    expect(STREET_Z1 - STREET_Z0).toBe(300);
    expect(STREET_HALF * 2).toBeCloseTo(10.8);
    expect(ARCADE_DEPTH).toBeCloseTo(1.5);
    expect(ARCADE_RAISE).toBeCloseTo(0.15);
    expect(SHOP_DEPTH).toBeCloseTo(8);
    expect(ALLEY_WIDTH).toBe(4);
    expect(ALLEY_DEPTH).toBe(15);
  });

  it('is deterministic and does not accumulate roads across calls', () => {
    const a = generateNanningCity(7);
    const b = generateNanningCity(7);
    const c = generateNanningCity(7);
    expect(sig(a)).toBe(sig(b));
    expect(sig(c)).toBe(sig(a));
    expect(a.lanes.length).toBe(4);
    expect(c.lanes.length).toBe(a.lanes.length);
    expect(c.buildings.length).toBe(a.buildings.length);
  });

  it('places 36 storefronts and 24 night stalls, with the required kinds', () => {
    const fronts = city.shops.filter((s) => !s.nightOnly);
    const stalls = city.shops.filter((s) => s.nightOnly);
    expect(fronts).toHaveLength(36);
    expect(stalls).toHaveLength(24);
    expect(city.stalls).toHaveLength(24);
    const kinds = (list: typeof fronts, kind: string) => list.filter((s) => s.def.kind === kind);
    expect(kinds(fronts, 'noodle')).toHaveLength(3);
    expect(kinds(fronts, 'fenjiao')).toHaveLength(2);
    expect(kinds(fronts, 'grill')).toHaveLength(3);
    expect(kinds(fronts, 'tea')).toHaveLength(3);
    expect(kinds(stalls, 'suan').length).toBeGreaterThanOrEqual(3);
    expect(kinds(stalls, 'grill').length).toBeGreaterThanOrEqual(2);
    for (const kind of ['roll', 'luosifen', 'duck', 'cold', 'mart', 'dessert']) {
      expect(kinds(fronts, kind).length).toBeGreaterThanOrEqual(1);
    }
    const names = city.shops.map((s) => s.def.name);
    for (const name of ['复记老友粉', '舒记老友粉', '中山粉饺', '梁记卷筒粉', '阿婆酸嘢', '横州茉莉奶茶', '荣记烧烤']) {
      expect(names).toContain(name);
    }
    const fuji = fronts.find((s) => s.def.id === 'fuji')!;
    expect(fuji.def.items.find((i) => i.name === '老友粉')?.price).toBe(12);
    const oyster = fronts.find((s) => s.def.kind === 'grill')!;
    expect(oyster.def.items.find((i) => i.name === '生蚝 6 只')?.price).toBe(20);
  });

  it('keeps the carriageway, arcade, alley, and spawn clear of colliders', () => {
    const spawn = city.grid.resolve(city.center.x, city.center.z, 0.4);
    expect(spawn.x).toBeCloseTo(city.center.x, 2);
    expect(spawn.z).toBeCloseTo(city.center.z, 2);

    const arcadeX = STREET_HALF + ARCADE_DEPTH / 2;
    const arcade = city.grid.resolve(arcadeX, -80, 0.35);
    expect(arcade.x).toBeCloseTo(arcadeX, 2);

    const alley = city.grid.resolve(city.alley.cx, 0, 0.3);
    expect(alley.x).toBeCloseTo(city.alley.cx, 1);
    expect(alley.z).toBeCloseTo(0, 1);

    // The doorway and the room are open. The back wall is not.
    const shop = city.shops.find((s) => !s.nightOnly && s.nx !== 0)!;
    const insideX = shop.x - shop.nx * 3;
    const inside = city.grid.resolve(insideX, shop.z, 0.3);
    expect(inside.x).toBeCloseTo(insideX, 1);
    expect(inside.z).toBeCloseTo(shop.z, 1);
    const door = city.grid.resolve(shop.x, shop.z, 0.3);
    expect(door.x).toBeCloseTo(shop.x, 1);
    const backX = shop.x - shop.nx * (SHOP_DEPTH - 0.12);
    const blocked = city.grid.resolve(backX, shop.z, 0.3);
    expect(Math.hypot(blocked.x - backX, blocked.z - shop.z)).toBeGreaterThan(0.15);
  });

  it('has no AI lanes or parked cars on the street', () => {
    expect(city.parkingSpots).toHaveLength(0);
    expect(city.lanes.length).toBeGreaterThan(0);
    for (const lane of city.lanes) {
      expect(lane.axis).toBe('x');
      expect(Math.abs(lane.fixed)).toBeGreaterThan(150);
    }
    expect(Math.abs(city.carSpawn?.z ?? 0)).toBeGreaterThan(150);
  });

  it('drops the old districts', () => {
    const ids = new Set(city.zones.map((z) => z.id));
    expect(ids.has('north')).toBe(true);
    expect(ids.has('middle')).toBe(true);
    expect(ids.has('south')).toBe(true);
    expect(ids.has('alley')).toBe(true);
    for (const gone of ['chaoyang', 'xingning', 'shuijie', 'yongjiang', 'daqiao', 'jixiechang', 'xiang', 'zhonggulou']) {
      expect(ids.has(gone)).toBe(false);
    }
  });

  it('opens the night market at 18:00 and packs it up by morning', () => {
    expect(hourFromDay(0)).toBeCloseTo(0);
    expect(hourFromDay(0.75)).toBeCloseTo(18);
    expect(hourFromDay(0.79)).toBeGreaterThan(18);
    expect(nightMarketOpen(18)).toBe(true);
    expect(nightMarketOpen(23)).toBe(true);
    expect(nightMarketOpen(2)).toBe(true);
    expect(nightMarketOpen(12)).toBe(false);
    expect(nightMarketOpen(17.9)).toBe(false);
    expect(nightMarketOpen(5)).toBe(false);
  });
});

describe('street missions', () => {
  const city = generateNanningCity(1945);

  it('does not let two dessert objectives share one shop record', () => {
    const legacy: Mission[] = [
      {
        id: 'old3',
        title: '酸嘢一条街',
        brief: '',
        giver: '',
        reward: 10,
        waypoint: { x: 0, z: 0 },
        objectives: [
          { id: 'a', label: '酸嘢', kind: 'snack', match: 'dessert', need: 2, got: 0 },
          { id: 'c', label: '糖水', kind: 'snack', match: 'dessert-alt', need: 1, got: 0 },
        ],
      },
    ];
    const log = new MissionLog(legacy);
    log.feed({ kind: 'snack', shopKind: 'dessert', shopId: 'suan-1' });
    expect(log.active?.objectives.find((o) => o.id === 'a')?.got).toBe(1);
    expect(log.active?.objectives.find((o) => o.id === 'c')?.got).toBe(1);
    const done = log.feed({ kind: 'snack', shopKind: 'dessert', shopId: 'sweet-1' });
    expect(done?.title).toBe('酸嘢一条街');
    expect(log.completed.has('old3')).toBe(true);
  });

  it('counts a noodle shop only once', () => {
    const log = new MissionLog();
    const shop = city.shops.find((s) => s.def.kind === 'noodle')!;
    log.feed({ kind: 'eat', shopKind: 'noodle', shopId: shop.id });
    log.feed({ kind: 'eat', shopKind: 'noodle', shopId: shop.id });
    expect(log.active?.objectives[0].got).toBe(1);
  });

  it('can be finished with the shops that actually exist on the street', () => {
    const log = new MissionLog();
    anchorStreetMissions(
      log,
      city.shops.map((s) => ({ x: s.x, z: s.z, kind: s.def.kind, nightOnly: s.nightOnly })),
    );
    const buy = (kind: string, n: number): void => {
      const found = city.shops.filter((s) => s.def.kind === kind && !s.nightOnly);
      expect(found.length).toBeGreaterThanOrEqual(n);
      for (let i = 0; i < n; i++) {
        log.feed({ kind: tagForShop(kind), shopKind: kind, shopId: found[i].id });
      }
    };
    buy('noodle', 3);
    expect(log.completed.has('m1')).toBe(true);
    buy('fenjiao', 2);
    buy('dessert', 1);
    expect(log.completed.has('m2')).toBe(true);
    buy('grill', 2);
    buy('tea', 1);
    expect(log.completed.has('m3')).toBe(true);
    expect(log.active).toBeNull();
    const wp = log.waypoint();
    expect(wp).toBeNull();
  });
});
