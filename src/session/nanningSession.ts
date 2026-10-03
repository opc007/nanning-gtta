/**
 * The default-mode session: one street, its shops, missions, and crowd.
 * Split out of main.ts so the orchestrator doesn't also own the Nanning layer.
 * `?stream=1` never constructs this — that path stays the upstream city.
 */

import * as THREE from 'three';
import type { NanningCity } from '../nanning/layout';
import { hourFromDay, nightMarketOpen } from '../nanning/clock';
import { addNanningScenery, updateNanningScenery, addBanyans } from '../nanning/scenery';
import { Shops, type ShopEvent, type ShopState } from '../nanning/shops';
import { NnHUD } from '../ui/NnHUD';
import { Missions, tagForShop } from '../nanning/missions';
import { Crowd } from '../nanning/crowd';
import { buildModernDistrict, addDistrictClutter, addBackgroundBuildings, type ModernDistrict } from '../render/modernCity';
import { mountLaoyouSample, type LaoyouSample } from '../render/laoyouSample';
import { resolveCircleAabb } from '../systems/Collision';

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
  /** When set, 复记老友粉 is dressed as the visual sample. */
  interiors?: { omitVisual(shopId: string): void };
}

export class NanningSession {
  readonly shops: Shops;
  readonly missions: Missions;
  readonly crowd: Crowd;
  readonly hud: NnHUD;
  readonly district: ModernDistrict;
  readonly laoyou: LaoyouSample | null;
  readonly camBlockers: { x: number; z: number; r: number }[];
  nightOpen: boolean;

  private debtor: ReturnType<Crowd['nearestDebtor']> = null;

  constructor(private readonly opts: NanningSessionOptions) {
    const { scene, city, seed } = opts;
    const district = buildModernDistrict(city.buildings, city.shops, seed);
    scene.add(district.group);
    addDistrictClutter(scene, district.clutterTargets, seed);
    addBackgroundBuildings(scene, city.buildings, seed + 4);
    this.district = district;
    this.laoyou = opts.interiors ? mountLaoyouSample(scene, city, district, opts.interiors) : null;

    addBanyans(scene, city.props);
    this.camBlockers = city.props.map((p) => ({ x: p.x, z: p.z, r: 3.6 }));

    const scenery = addNanningScenery(scene, city);
    for (const [key, visual] of scenery.stallMeshes) district.shopMeshes.set(key, visual);
    for (const visual of scenery.stallMeshes.values()) district.glowMats.push(...visual.litMats);

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
      if (m.transparent) m.opacity = 0.1 + 0.85 * lit;
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
    this.laoyou?.update(dt);
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
