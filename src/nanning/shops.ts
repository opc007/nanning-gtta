/**
 * 店铺系统 — the thing that makes this a 南宁 game rather than a generic city.
 *
 * Two verbs the base game doesn't have:
 *   • 买 — walk under a 骑楼 colonnade, press E, buy 老友粉 / 茉莉花奶茶 / 酸嘢.
 *     Eating restores satiety, which decays, which is the soft timer that makes
 *     wandering feel like a day in the street rather than aimless walking.
 *   • 砸 — punch a shopfront. Damage accrues per shop, the signboard and neon
 *     degrade with it, and at zero it goes permanent: the sign swaps to 砸烂咗,
 *     the neon dies, the 满洲窗 goes dark. Smashing raises heat, so the base
 *     game's wanted system handles the consequences for free.
 */

import * as THREE from 'three';
import type { ShopUnit, NanningCity } from './layout';
import { EAT_LOG } from './data';
import { makeSignTexture } from '../render/nnArch';
import type { ShopVisual, ModernDistrict } from '../render/modernCity';

export const SHOP_MAX_HP = 100;
const HIT_DAMAGE = 9;
const REACH = 3.2;

export interface ShopState {
  unit: ShopUnit;
  mesh: ShopVisual;
  hp: number;
  broken: boolean;
  /** Counts down after each hit; drives the red flash. */
  flash: number;
  /** Revenue lost to vandalism, purely for the end-of-session tally. */
  smashCount: number;
}

export interface Wallet {
  money: number;
  satiety: number;
  eaten: number;
  smashed: number;
  earned: number;
}

export interface ShopEvent {
  kind: 'bought' | 'broke' | 'hit' | 'too-poor' | 'full';
  text: string;
  /** Heat to add to the base game's wanted system. 0 = no heat. */
  heat: number;
  shopId: string;
}

export class Shops {
  readonly states: ShopState[] = [];
  readonly wallet: Wallet = { money: 60, satiety: 82, eaten: 0, smashed: 0, earned: 0 };
  /** Shop id the player is standing at, or null. Read by the HUD each frame. */
  focused: ShopState | null = null;
  /** Night-market stalls are interactable only while this is true. */
  nightMarket = true;

  private readonly sparkMat: THREE.PointsMaterial;
  private readonly sparkGeo: THREE.BufferGeometry;
  private readonly sparkVel: Float32Array;
  private readonly sparkPos: Float32Array;
  private readonly SPARKS = 26;
  private sparkPool: THREE.Points;
  private sparkTimer = 0;

  constructor(city: NanningCity, district: ModernDistrict, scene: THREE.Scene) {
    const meshes = district.shopMeshes;
    for (const unit of city.shops) {
      const mesh = meshes.get(unit.building);
      if (!mesh) continue;
      this.states.push({ unit, mesh, hp: SHOP_MAX_HP, broken: false, flash: 0, smashCount: 0 });
    }

    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(this.SPARKS * 3);
    this.sparkVel = new Float32Array(this.SPARKS * 3);
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkMat = new THREE.PointsMaterial({
      color: 0xffd9a0,
      size: 0.22,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.sparkPool = new THREE.Points(this.sparkGeo, this.sparkMat);
    this.sparkPool.frustumCulled = false;
    this.sparkPool.visible = false;
    scene.add(this.sparkPool);
  }

  /** Night-market stalls drop out of reach while the market is packed up. */
  setNightMarket(open: boolean): void {
    this.nightMarket = open;
    if (!open && this.focused?.unit.nightOnly) this.focused = null;
  }

  private available(s: ShopState): boolean {
    return this.nightMarket || !s.unit.nightOnly;
  }

  /** Nearest shop to (px,pz) within `max`, for the E prompt. */
  nearest(px: number, pz: number, max = REACH + 2): ShopState | null {
    let best: ShopState | null = null;
    let bestD = max * max;
    for (const s of this.states) {
      if (!this.available(s)) continue;
      const dx = s.unit.x - px;
      const dz = s.unit.z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /**
   * Try to damage a shop along the punch direction. Returns an event when the
   * punch connects, or null so the caller can fall through to punching a ped.
   */
  hit(px: number, pz: number, dirX: number, dirZ: number): ShopEvent | null {
    const reach = 2.6;
    let best: ShopState | null = null;
    let bestScore = -Infinity;
    for (const s of this.states) {
      if (!this.available(s)) continue;
      const dx = s.unit.x - px;
      const dz = s.unit.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > reach || d < 0.001) continue;
      // Must be roughly in front of the player, and aligned with the shopfront
      // normal (you punch the wall, not the middle of the arcade).
      const facing = (dx / d) * dirX + (dz / d) * dirZ;
      if (facing < 0.25) continue;
      const aligned = Math.abs((dx / d) * s.unit.nx + (dz / d) * s.unit.nz);
      if (aligned < 0.4) continue;
      const score = facing + aligned;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    if (!best) return null;

    best.flash = 0.35;
    if (best.broken) {
      this.burst(best);
      return { kind: 'hit', text: '烂咗咯仲砸？', heat: 0, shopId: best.unit.id };
    }

    best.hp -= HIT_DAMAGE;
    this.burst(best);
    if (best.hp <= 0) {
      best.hp = 0;
      best.broken = true;
      best.smashCount++;
      this.wallet.smashed++;
      this.breakShop(best);
      return {
        kind: 'broke',
        text: `${best.unit.def.name} 砸烂咗！${pickAngry(best)}`,
        heat: 18,
        shopId: best.unit.id,
      };
    }
    return {
      kind: 'hit',
      text: `${best.unit.def.name} ${pickIdle(best)}`,
      heat: HIT_DAMAGE * 0.25,
      shopId: best.unit.id,
    };
  }

  private breakShop(s: ShopState): void {
    s.mesh.signMat.map = makeSignTexture(s.unit.def, true);
    s.mesh.signMat.needsUpdate = true;
    s.mesh.neon.opacity = 0.05;
    s.mesh.glass.userData.broken = true;
    s.mesh.glass.emissiveIntensity = 0.02;
  }

  /** Buy an item. Returns null if the purchase was rejected. */
  buy(s: ShopState, itemId: string): ShopEvent | null {
    if (s.broken) return { kind: 'hit', text: '铺都烂咗，边度买得？', heat: 0, shopId: s.unit.id };
    const item = s.unit.def.items.find((i) => i.id === itemId);
    if (!item) return null;
    if (this.wallet.money < item.price) {
      return { kind: 'too-poor', text: '冇咗钱咯，友仔。', heat: 0, shopId: s.unit.id };
    }
    this.wallet.money -= item.price;
    this.wallet.satiety = Math.min(100, this.wallet.satiety + item.fill);
    this.wallet.eaten++;
    return {
      kind: 'bought',
      text: `${item.name} ¥${item.price} — ${item.blurb}`,
      heat: 0,
      shopId: s.unit.id,
    };
  }

  update(dt: number, px: number, pz: number): void {
    // Satiety drains slowly; an empty stomach only drains the wallet of fun, not
    // health, so this stays a gentle nudge rather than a punishing timer.
    this.wallet.satiety = Math.max(0, this.wallet.satiety - dt * 0.42);

    this.focused = this.nearest(px, pz);

    for (const s of this.states) {
      if (s.flash > 0) {
        s.flash = Math.max(0, s.flash - dt);
        const k = s.flash / 0.35;
        if (s.mesh.signMat) s.mesh.signMat.color.setRGB(1, 1 - k * 0.6, 1 - k * 0.6);
      } else if (s.mesh.signMat) {
        s.mesh.signMat.color.setRGB(1, 1, 1);
      }
    }

    // Sparks: a single shared pool, recycled by the most recent burst.
    if (this.sparkTimer > 0) {
      this.sparkTimer -= dt;
      for (let i = 0; i < this.SPARKS * 3; i += 3) {
        this.sparkVel[i + 1] -= 9.8 * dt;
        this.sparkPos[i] += this.sparkVel[i] * dt;
        this.sparkPos[i + 1] += this.sparkVel[i + 1] * dt;
        this.sparkPos[i + 2] += this.sparkVel[i + 2] * dt;
        if (this.sparkPos[i + 1] < 0.05) {
          this.sparkPos[i + 1] = 0.05;
          this.sparkVel[i + 1] *= -0.35;
        }
      }
      (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      if (this.sparkTimer <= 0) this.sparkPool.visible = false;
    }
  }

  private burst(s: ShopState): void {
    const cx = s.unit.x - s.unit.nx * 0.6;
    const cz = s.unit.z - s.unit.nz * 0.6;
    for (let i = 0; i < this.SPARKS; i++) {
      const j = i * 3;
      this.sparkPos[j] = cx;
      this.sparkPos[j + 1] = 1.2 + Math.random() * 2.2;
      this.sparkPos[j + 2] = cz;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.sparkVel[j] = Math.cos(a) * sp;
      this.sparkVel[j + 1] = 3 + Math.random() * 5;
      this.sparkVel[j + 2] = Math.sin(a) * sp;
    }
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.sparkPool.visible = true;
    this.sparkTimer = 0.7;
  }

  randomEatLine(): string {
    return EAT_LOG[Math.floor(Math.random() * EAT_LOG.length)];
  }
}

function pickAngry(s: ShopState): string {
  const a = s.unit.def.angry;
  return a[Math.floor(Math.random() * a.length)];
}

function pickIdle(s: ShopState): string {
  const a = s.unit.def.idle;
  return a[Math.floor(Math.random() * a.length)];
}
