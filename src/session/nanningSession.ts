/**
 * The default-mode session: one street, its shops, missions, and crowd.
 * Split out of main.ts so the orchestrator doesn't also own the Nanning layer.
 * `?stream=1` never constructs this — that path stays the upstream city.
 */

import * as THREE from 'three';
import type { NanningCity } from '../nanning/layout';
import { hourFromDay, nightMarketOpen } from '../nanning/clock';
import { addNanningScenery, updateNanningScenery, addBanyans, type BarrierSegment } from '../nanning/scenery';
import { Shops, type ShopEvent, type ShopState } from '../nanning/shops';
import { NnHUD } from '../ui/NnHUD';
import { Missions, tagForShop } from '../nanning/missions';
import { Crowd } from '../nanning/crowd';
import {
  buildModernDistrict,
  addDistrictClutter,
  addBackgroundBuildings,
  type ModernDistrict,
} from '../render/modernCity';
import { resolveCircleAabb } from '../systems/Collision';
import type { Target, TargetCandidate } from '../systems/Targets';
import type { InteriorView } from '../render/InteriorView';
import { PED_HP, type Pedestrians } from '../systems/Pedestrians';

export interface NanningPayout {
  title: string;
  reward: number;
  line: string;
}

export interface NanningSessionOptions {
  scene: THREE.Scene;
  city: NanningCity;
  container: HTMLElement;
  seed: number;
  touch: boolean;
  /** Starting time-of-day in [0,1), so stalls match the clock on frame 0. */
  timeOfDay: number;
  onHeat: (amount: number) => void;
  onPayout: (payout: NanningPayout) => void;
  onBlip: () => void;
}

/** Below this a vehicle nudges the railing; above it, the bay comes down. */
const RAM_SPEED = 6.5;
/** How far ahead of the car a bay is tested for the ram. */
const RAM_REACH = 2.6;

export class NanningSession {
  readonly shops: Shops;
  readonly missions: Missions;
  readonly crowd: Crowd;
  readonly hud: NnHUD;
  readonly district: ModernDistrict;
  readonly camBlockers: { x: number; z: number; r: number }[];
  nightOpen: boolean;

  private debtor: ReturnType<Crowd['nearestDebtor']> = null;
  private readonly barriers: BarrierSegment[];
  /** Furniture, so a swing can land on a table and not only on a person. */
  private props: InteriorView | null = null;

  constructor(private readonly opts: NanningSessionOptions) {
    const { scene, city, seed } = opts;
    // Building massing stays in `modernCity`, set back behind the arcade.
    // `scenery.ts` owns everything the player actually reads from the street —
    // the colonnade, the covered walkway, the lantern garlands, the shop boards
    // and the 钟鼓楼 — and an earlier attempt to also build the frontage out of
    // `qilou.ts` put a second storey wall right on top of that arcade, where it
    // blanked out the shop signs from a street-level camera. The massing here is
    // deliberately the background: old arcade in front, towers behind.
    const district = buildModernDistrict(city.buildings, city.shops, seed);
    scene.add(district.group);
    addDistrictClutter(scene, district.clutterTargets, seed);
    addBackgroundBuildings(scene, city.buildings, seed + 4);
    this.district = district;

    addBanyans(scene, city.props);
    this.camBlockers = city.props.map((p) => ({ x: p.x, z: p.z, r: 3.6 }));

    const scenery = addNanningScenery(scene, city);
    this.barriers = scenery.barriers;
    for (const [key, visual] of scenery.stallMeshes) district.shopMeshes.set(key, visual);
    for (const visual of scenery.stallMeshes.values()) district.glowMats.push(...visual.litMats);
    district.signMats.push(...scenery.signMats);

    this.shops = new Shops(city, district, scene);
    this.missions = new Missions(scene, city);
    this.crowd = new Crowd(scene, [], opts.touch ? 8 : 16);
    this.nightOpen = nightMarketOpen(hourFromDay(opts.timeOfDay));
    this.shops.setNightMarket(this.nightOpen);
    scenery.stalls.visible = this.nightOpen;

    this.hud = new NnHUD(opts.container, city.zones, {
      onBuy: (shop, itemId) => this.buy(shop, itemId),
      onClose: () => this.hud.closePanel(),
    });
  }

  /** E at a shop opens the menu. Returns true when the key was consumed. */
  interact(onFoot: boolean): boolean {
    if (this.hud.isPanelOpen) {
      this.hud.closePanel();
      return true;
    }
    if (onFoot && this.shops.focused) {
      this.hud.togglePanel(this.shops.focused);
      return true;
    }
    if (onFoot && this.debtor) {
      const who = this.debtor;
      const got = this.crowd.collect(who);
      if (got > 0) {
        this.shops.wallet.money += got;
        this.hud.toast(`收到 ${who.name} 嘅 ¥${got}`, '#ffd24a');
        const payout = this.missions.feed({ kind: 'talk', debt: 1 });
        if (payout) this.opts.onPayout(payout);
      }
      this.debtor = null;
      return true;
    }
    return false;
  }

  /** Punch a shopfront. Returns true when the punch connected with a shop. */
  /**
   * Everything the player can hit, in one list, for the shared target resolver.
   * Peds, shops and railings all answer here rather than each running its own
   * reach-and-facing test.
   */
  targets(peds?: Pedestrians): TargetCandidate[] {
    const out: TargetCandidate[] = [];
    if (peds) {
      for (let i = 0; i < peds.count(); i++) {
        const pd = peds.at(i);
        if (!pd) continue;
        out.push({
          kind: 'ped', id: i, x: pd.x, z: pd.z, label: '街坊',
          hp: pd.hp, maxHp: PED_HP,
        });
      }
    }
    for (const st of this.shops.states) {
      out.push({
        kind: 'shop', id: st.unit.id, x: st.unit.x, z: st.unit.z,
        hp: st.hp, label: st.unit.def.name,
        strike: () => { this.shops.hit(st.unit.x, st.unit.z, st.unit.nx, st.unit.nz); return true; },
      });
    }
    for (const b of this.barriers) {
      if (b.broken) continue;
      out.push({ kind: 'barrier', id: (b.box.minX + b.box.maxZ).toString(), x: (b.box.minX + b.box.maxX) / 2, z: (b.box.minZ + b.box.maxZ) / 2,
        label: '护栏' });
    }
    return out;
  }

  /**
   * Hit whatever the resolver picked, and report what it was. One verb, one
   * answer, so swinging at a stool and swinging at a counter feel like the
   * same act even when the outcome is wildly different.
   */
  strikeTarget(t: Target, damage: number): { label: string; broke: boolean } | null {
    if (t.kind === 'shop') {
      const st = this.shops.states.find((s) => s.unit.id === t.id);
      if (!st) return null;
      const ev = this.shops.hit(st.unit.x, st.unit.z, st.unit.nx, st.unit.nz);
      if (!ev) return null;
      this.note(ev);
      return { label: st.unit.def.name, broke: !!st.broken };
    }
    if (t.kind === 'prop' && this.props) {
      return this.props.damageNear(t.x, t.z, 0, 1, 2.2, damage);
    }
    return null;
  }

  /**
   * Hand the interior view to the session so a swing can land on furniture.
   * Set by main.ts once both exist — they are built independently and the
   * session is created first.
   */
  attachProps(view: InteriorView): void {
    this.props = view;
  }

  punch(px: number, pz: number, dirX: number, dirZ: number): boolean {
    const ev = this.shops.hit(px, pz, dirX, dirZ);
    if (!ev) return false;
    this.note(ev);
    if (ev.kind === 'broke') {
      const payout = this.missions.feed({ kind: 'smash' });
      if (payout) this.opts.onPayout(payout);
    }
    return true;
  }

  /**
   * Push the player out of night-market stalls. Stalls are not in the static
   * grid because they are absent before 18:00.
   */
  /**
   * Push a walker out of the intact end-of-street railings. Broken bays drop
   * out of the test, so once you have knocked a hole through on foot you can
   * walk out of the gap you made.
   */
  resolveBarriers(x: number, z: number, radius: number): { x: number; z: number } {
    let cx = x;
    let cz = z;
    for (const b of this.barriers) {
      if (b.broken) continue;
      const hit = resolveCircleAabb(cx, cz, radius, b.box);
      cx = hit.x;
      cz = hit.z;
    }
    return { x: cx, z: cz };
  }

  /**
   * Knock down any railing bay a fast enough vehicle runs into. Returns how many
   * went, so the caller can pay out the noise and the wanted level. This is the
   * only way past the barriers at either end of 中山路, which is the point: they
   * are meant to be an obstacle you break, not a wall.
   */
  ramBarriers(x: number, z: number, dirX: number, dirZ: number, speed: number): number {
    if (speed < RAM_SPEED) return 0;
    let broke = 0;
    for (const b of this.barriers) {
      if (b.broken) continue;
      const dx = x - (b.box.minX + b.box.maxX) / 2;
      const dz = z - (b.box.minZ + b.box.maxZ) / 2;
      const d = Math.hypot(dx, dz);
      if (d > RAM_REACH) continue;
      if ((dx / (d || 1)) * -dirX + (dz / (d || 1)) * -dirZ < 0.2) continue;
      b.broken = true;
      b.mesh.visible = false;
      broke++;
    }
    return broke;
  }

  resolveStalls(x: number, z: number, radius: number): { x: number; z: number } {
    if (!this.nightOpen) return { x, z };
    let cx = x;
    let cz = z;
    for (const s of this.shops.states) {
      if (!s.unit.nightOnly) continue;
      const hit = resolveCircleAabb(cx, cz, radius, {
        minX: s.unit.x - 1.15,
        maxX: s.unit.x + 1.15,
        minZ: s.unit.z - 0.85,
        maxZ: s.unit.z + 0.85,
      });
      cx = hit.x;
      cz = hit.z;
    }
    return { x: cx, z: cz };
  }

  applyDaylight(daylight: number): void {
    const lit = 1 - 0.95 * daylight;
    for (const m of this.district.glowMats) {
      // Preserve each material's authored opacity: the old code overwrote it
      // with the ramp, so a doorway glow authored at 0.22 became a 0.95 solid
      // quad at night — and a smashed neon came back to life every frame.
      if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
      if (m.transparent) m.opacity = (m.userData.baseOpacity as number) * (0.12 + 0.88 * lit);
    }
    // Opaque signboards and paper lanterns: ramp by colour multiplier. Full
    // texture brightness at night is what blows the signs out to white under
    // the night bloom; the ramp keeps the strokes just under the bloom
    // threshold so the name stays readable. Shop-driven mats only stash the
    // level — the shop system composes it with the smash-flash tint. Plain
    // mats (lanterns) get the multiplier applied directly.
    for (const m of this.district.signMats) {
      const dayK = (m.userData.dayK as number | undefined) ?? 0.55;
      const nightK = (m.userData.nightK as number | undefined) ?? 0.85;
      const level = dayK + (nightK - dayK) * lit;
      if (m.userData.shopDriven) {
        m.userData.signLevel = level;
      } else {
        m.color.setHex((m.userData.baseColor as number) ?? 0xffffff).multiplyScalar(level);
      }
    }
    for (const m of this.district.windowMats) {
      m.emissiveIntensity = 0.02 + 1.15 * lit;
    }
  }

  tick(
    dt: number,
    timeOfDay: number,
    px: number,
    pz: number,
    onFoot: boolean,
    heat: number,
    yaw: number,
    scene: THREE.Scene,
    daylight: number,
  ): void {
    const hour = hourFromDay(timeOfDay);
    this.nightOpen = nightMarketOpen(hour);
    this.shops.setNightMarket(this.nightOpen);
    updateNanningScenery(scene, hour, daylight);

    this.shops.update(dt, px, pz);
    this.hud.update(dt, this.shops.wallet, px, pz, onFoot ? this.shops.focused : null);
    this.missions.render(timeOfDay * 40);
    this.hud.setMission(this.missions);
    this.hud.setWaypoint(
      onFoot ? this.missions.distanceTo(px, pz) : Infinity,
      this.missions.angleTo(px, pz),
      yaw,
    );
    this.debtor = onFoot ? this.crowd.nearestDebtor(px, pz) : null;
    this.crowd.update(dt, px, pz, heat, this.shops.wallet.smashed);
  }

  render(camera: THREE.Camera): void {
    this.crowd.render(camera);
  }

  private buy(shop: ShopState, itemId: string): void {
    const ev = this.shops.buy(shop, itemId);
    if (!ev) return;
    this.hud.toast(ev.text, ev.kind === 'too-poor' ? '#ff5a4a' : '#2ee6a8');
    this.opts.onBlip();
    if (ev.kind !== 'bought') return;
    this.hud.toast(this.shops.randomEatLine(), '#ffd24a');
    const payout = this.missions.feed({
      kind: tagForShop(shop.unit.def.kind),
      shopKind: shop.unit.def.kind,
      shopId: shop.unit.id,
    });
    if (payout) this.opts.onPayout(payout);
  }

  private note(ev: ShopEvent): void {
    this.hud.toast(ev.text, ev.kind === 'broke' ? '#ff5a4a' : ev.kind === 'hit' ? '#ff8a5a' : '#2ee6a8');
    if (ev.heat > 0) this.opts.onHeat(ev.heat);
  }
}
