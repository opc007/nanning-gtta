import { describe, expect, it } from 'vitest';
import { generateNanningCity } from './layout';
import {
  buildInterior,
  interiorRadii,
  planInteriorStream,
  pointInsideShop,
  seatsReachable,
  templateForKind,
  type ShopShell,
} from './interiors';
import type { ShopKind } from './data';

function shells(): ShopShell[] {
  const city = generateNanningCity(1945);
  return city.shops
    .filter((s) => !s.nightOnly)
    .map((s) => {
      const b = city.buildings[s.building];
      return {
        id: s.id,
        kind: s.def.kind,
        x: s.x,
        z: s.z,
        nx: s.nx,
        nz: s.nz,
        cx: b.cx,
        cz: b.cz,
        depth: b.depth,
        width: b.width,
      };
    });
}

describe('interiors', () => {
  const all = shells();

  it('maps the four required kinds onto their templates', () => {
    expect(templateForKind('noodle')).toBe('laoyou');
    expect(templateForKind('fenjiao')).toBe('fenjiao');
    expect(templateForKind('grill')).toBe('bbq');
    expect(templateForKind('tea')).toBe('milktea');
    expect(templateForKind('mart')).toBe('generic');
    for (const kind of ['noodle', 'fenjiao', 'grill', 'tea'] as ShopKind[]) {
      expect(all.some((s) => s.kind === kind)).toBe(true);
    }
  });

  it('keeps furniture inside the shop and a path to every seat', () => {
    for (const shell of all) {
      const layout = buildInterior(shell);
      expect(layout.props.length).toBeGreaterThan(2);
      expect(layout.seats.length).toBeGreaterThanOrEqual(2);
      for (const p of layout.props) {
        expect(p.x).toBeGreaterThan(layout.bounds.minX + 0.3);
        expect(p.x).toBeLessThan(layout.bounds.maxX - 0.3);
        expect(p.z).toBeGreaterThan(layout.bounds.minZ + 0.3);
        expect(p.z).toBeLessThan(layout.bounds.maxZ - 0.3);
      }
      const path = seatsReachable(layout);
      expect(path.ok, `${shell.id} ${shell.kind} missed ${path.missed.join(',')}`).toBe(true);
      expect(pointInsideShop(shell, layout.door.x, layout.door.z, 0.05)).toBe(true);
    }
  });

  it('places a stool and a table you can stand on in a noodle shop', () => {
    const noodle = all.find((s) => s.kind === 'noodle')!;
    const layout = buildInterior(noodle);
    const stool = layout.props.find((p) => p.prop === 'stool');
    const table = layout.props.find((p) => p.prop === 'table-square');
    expect(stool?.h).toBeCloseTo(0.45);
    expect(table?.h).toBeCloseTo(0.75);
  });
});

describe('planInteriorStream', () => {
  const shops = [
    { id: 'a', x: 0, z: 0 },
    { id: 'b', x: 10, z: 0 },
    { id: 'c', x: 25, z: 0 },
    { id: 'd', x: 50, z: 0 },
  ];
  const radii = interiorRadii(false);

  it('spawns inside 30 m, keeps until 40 m, and caps the count', () => {
    expect(radii).toEqual({ enter: 30, exit: 40, max: 8 });
    expect(interiorRadii(true).max).toBe(4);
    const first = planInteriorStream([], shops, 0, 0, radii);
    expect(first.spawn).toEqual(['a', 'b', 'c']);
    expect(first.drop).toEqual([]);
    const stay = planInteriorStream(['a', 'b', 'c'], shops, 0, 0, { enter: 30, exit: 40, max: 8 });
    expect(stay.drop).toEqual([]);
    expect(stay.spawn).toEqual([]);
    // Player has walked west: c (25 m) is past the 40 m keep radius, b is in range.
    const leave = planInteriorStream(['a', 'c'], shops, -16, 0, radii);
    expect(leave.drop).toContain('c');
    expect(leave.spawn).toContain('b');
  });

  it('drops the farthest room when over the cap', () => {
    const tight = { enter: 100, exit: 100, max: 2 };
    const over = planInteriorStream(['a', 'b', 'd'], shops, 0, 0, tight);
    expect(over.drop).toContain('d');
    expect(over.spawn.length + 3 - over.drop.length).toBeLessThanOrEqual(2);
  });
});
