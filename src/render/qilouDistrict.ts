/**
 * Zhongshan Road as an actual qilou street, assembled from `qilou.ts`.
 *
 * The map data was always qilou-shaped — `layout.ts` gives every building a
 * street-facing normal and a frontage slot, and the shot is supposed to open on
 * 中山路 looking down a covered arcade. What was actually rendering was
 * `modernCity`: plaster-and-glass boxes, which is any Chinese city centre and
 * no part of this one. `qilou.ts` already had the right anatomy (满洲窗, the
 * overhang the walkway tucks under, carved cornice, canvas shop signs) and was
 * never called from anywhere.
 *
 * So this walks the same building list and drops one qilou unit per building,
 * plus the 钟鼓楼 at whichever building the layout marked `landmark`. Modern
 * towers stay in the background: the real street is old arcades with glass
 * high-rises standing right behind them, and that contrast is the look.
 *
 * Draw calls: one merged vertex-coloured mesh per building, so a 100 m street
 * is ~80 static calls plus the signs, not the ~1900 the modern path needed.
 */

import * as THREE from 'three';
import { makeQilou, makeZhonggulou } from './qilou';
import type { NanningBuilding } from '../nanning/layout';
import type { ShopUnit } from '../nanning/layout';
import type { ModernDistrict, ShopVisual } from './modernCity';
import type { ClutterTarget } from './props';

export function buildQilouDistrict(
  buildings: NanningBuilding[],
  shops: ShopUnit[],
  seed = 1952,
): ModernDistrict {
  // 1952 is the year the street dates its own signage from.
  void seed;
  const group = new THREE.Group();
  const shopByBuilding = new Map<number, ShopUnit>();
  for (const s of shops) shopByBuilding.set(s.building, s);

  const shopMeshes = new Map<number, ShopVisual>();
  const glowMats: THREE.MeshBasicMaterial[] = [];
  const signMats: THREE.MeshBasicMaterial[] = [];
  const windowMats: THREE.MeshStandardMaterial[] = [];
  const clutterTargets: ClutterTarget[] = [];

  let qilouCount = 0;
  let gateCount = 0;

  buildings.forEach((b, i) => {
    const unit = shopByBuilding.get(i);

    if (b.kind === 'landmark') {
      const gate = makeZhonggulou(b);
      gate.position.set(b.cx, 0, b.cz);
      group.add(gate);
      gateCount++;
      return;
    }

    // Outward normal toward the street. Buildings on the two runs share one
    // axis, so this is cardinal in practice.
    const fx = b.face?.x ?? 0;
    const fz = b.face?.z ?? -1;

    // `makeQilou` reads `b.depth` as the frontage and `b.width` as the inland
    // depth. The layout generator uses the opposite convention: for a run
    // facing ±X the frontage is the Z extent (`b.width`, 16.4 m here) and the
    // inland extent is `b.depth` (8 m). Hand it a swapped copy so the two
    // agree, instead of rebuilding every qilou 90° off its own slot.
    const qb: NanningBuilding = { ...b, width: b.depth, depth: b.width };
    const q = makeQilou(qb, i, unit?.def);
    if (!q) return;
    qilouCount++;

    // `makeQilou` builds in local space with X = depth, where x=0 is the street
    // face and +X runs inland. Rotate so local +X points along the inland
    // direction, i.e. opposite the street normal, then park the origin on the
    // street face itself.
    const inland = b.depth / 2; // half the inland extent, per the layout
    q.group.rotation.y = Math.atan2(fz, -fx);
    q.group.position.set(b.cx + fx * inland, 0, b.cz + fz * inland);
    // Frontage runs along local Z; a row offset slides the unit along its run
    // so neighbours in the same building do not stack on one another.
    if (b.slot) q.group.position.add(new THREE.Vector3(0, 0, -b.slot.offset));

    group.add(q.group);
    windowMats.push(q.windowMat);

    const lit: THREE.MeshBasicMaterial[] = [];
    if (q.signMat) {
      signMats.push(q.signMat);
      glowMats.push(q.signMat);
      lit.push(q.signMat);
    }
    if (q.neonMat) {
      signMats.push(q.neonMat);
      glowMats.push(q.neonMat);
      lit.push(q.neonMat);
    }

    // The shop system drives signage by building index. Only register a
    // building that actually got a signboard — the rest are plain frontage.
    if (unit && q.sign && q.signMat) {
      shopMeshes.set(i, {
        sign: q.sign,
        signMat: q.signMat,
        neon: q.neonMat ?? q.signMat,
        glass: q.windowMat,
        litMats: lit,
      });
    }

    if (unit) {
      clutterTargets.push({
        x: q.door.x,
        z: q.door.z,
        width: b.width, // frontage
        depth: b.depth, // inland
        height: b.height,
        nx: fx,
        nz: fz,
      });
    }
  });

  // ── 钟鼓楼 (应侯门楼) ──────────────────────────────────────────────────
  // The layout marks no building `landmark`, but the street's defining view is
  // the gate tower standing at the end of the run — you walk under it off the
  // 拱门 and the whole arcade opens up in front of you. Built axis-aligned at
  // the north end and turned to face down the street (its doorway recess is
  // authored on -Z, hence the half turn).
  const north = Math.min(...buildings.map(b => b.cz - b.depth / 2)) - 8;
  const gateB: NanningBuilding = {
    cx: 0, cz: north, width: 16, depth: 10, height: 20,
    color: 0xa8a094, style: 'brick', kind: 'landmark',
  };
  const gate = makeZhonggulou(gateB);
  gate.position.set(0, 0, north);
  gate.rotation.y = Math.PI;
  group.add(gate);
  gateCount++;

  group.name = 'zhongshan-qilou';
  group.userData.qilou = { qilouCount, gateCount };
  return { group, shopMeshes, glowMats, signMats, clutterTargets, windowMats };
}
