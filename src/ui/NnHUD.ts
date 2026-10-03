/**
 * Nanning overlay: the wallet / satiety / notoriety readouts, the area card that
 * names where you are, the shop prompt, the buy panel, and the toast queue.
 *
 * Deliberately layered ON TOP of the base HUD rather than editing it — gta7's
 * HUD has its own tests and its own layout constraints, and the Nanning-specific
 * widgets are a separate concern.
 */

import { AREAS, type AreaDef } from '../nanning/data';
import type { ShopState, Wallet } from '../nanning/shops';
import type { AreaZone } from '../nanning/layout';
import type { Missions } from '../nanning/missions';

const GOLD = '#ffd24a';
const RED = '#ff5a4a';
const JADE = '#2ee6a8';

const PANEL =
  'background:rgba(14,12,10,.88);border:1px solid rgba(255,210,74,.28);' +
  'border-radius:12px;backdrop-filter:blur(10px);';

export interface NnHudCallbacks {
  onBuy: (shop: ShopState, itemId: string) => void;
  onClose: () => void;
}

export class NnHUD {
  private readonly walletEl: HTMLElement;
  private readonly fillTrack: HTMLElement;
  private readonly fillBar: HTMLElement;
  private readonly areaCard: HTMLElement;
  private readonly areaName: HTMLElement;
  private readonly areaSub: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly stamWrap: HTMLElement;
  private readonly stamFill: HTMLElement;
  private readonly toastWrap: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly panelTitle: HTMLElement;
  private readonly panelItems: HTMLElement;
  private readonly panelMoney: HTMLElement;
  private readonly statEl: HTMLElement;
  private readonly missionBox: HTMLElement;
  private readonly missionTitle: HTMLElement;
  private readonly missionGiver: HTMLElement;
  private readonly missionObjs: HTMLElement;
  private readonly missionReward: HTMLElement;
  private readonly wpEl: HTMLElement;
  private readonly wpArrow: HTMLElement;
  private readonly wpText: HTMLElement;
  private lastMissionSig = '';

  private openShop: ShopState | null = null;
  private lastWallet: Wallet | null = null;
  private currentArea: string | null = null;
  private areaTimer = 0;
  private stamShow = 0;
  private shopPrompt = false;
  private mountHint = false;
  private readonly toasts: { el: HTMLElement; t: number }[] = [];

  constructor(
    container: HTMLElement,
    private readonly zones: AreaZone[],
    private readonly cb: NnHudCallbacks,
  ) {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;pointer-events:none;color:#f3ece0;z-index:5;' +
      'font-family:"PingFang SC","Microsoft YaHei",ui-sans-serif,system-ui,sans-serif;' +
      'text-shadow:0 2px 6px rgba(0,0,0,.85);';
    container.appendChild(root);

    // ── Top-left: 钱包 + 饱食度 ─────────────────────────────────────────
    const walletBox = document.createElement('div');
    walletBox.style.cssText = `position:absolute;left:20px;bottom:20px;padding:11px 15px;min-width:186px;${PANEL}`;
    this.walletEl = document.createElement('div');
    this.walletEl.style.cssText = `font-size:25px;font-weight:800;color:${GOLD};letter-spacing:.5px;line-height:1.1;`;
    const fillLabel = document.createElement('div');
    fillLabel.style.cssText = 'font-size:11px;opacity:.62;margin-top:9px;letter-spacing:1px;';
    fillLabel.textContent = '饱食度 SATIETY';
    this.fillTrack = document.createElement('div');
    this.fillTrack.style.cssText =
      'height:7px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden;';
    this.fillBar = document.createElement('div');
    this.fillBar.style.cssText =
      `height:100%;width:60%;background:linear-gradient(90deg,${RED},${GOLD},${JADE});transition:width .2s;`;
    this.fillTrack.appendChild(this.fillBar);
    const stamLabel = document.createElement('div');
    stamLabel.style.cssText = 'font-size:11px;opacity:.62;margin-top:8px;letter-spacing:1px;';
    stamLabel.textContent = '体力 STAMINA';
    this.stamWrap = document.createElement('div');
    this.stamWrap.style.cssText = 'opacity:0;transition:opacity .35s;';
    const stamTrack = document.createElement('div');
    stamTrack.style.cssText =
      'height:7px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden;';
    this.stamFill = document.createElement('div');
    this.stamFill.style.cssText = `height:100%;width:100%;background:${GOLD};`;
    stamTrack.appendChild(this.stamFill);
    this.stamWrap.append(stamLabel, stamTrack);
    walletBox.append(this.walletEl, fillLabel, this.fillTrack, this.stamWrap);
    root.appendChild(walletBox);

    // ── Bottom-right: 战绩 ──────────────────────────────────────────────
    this.statEl = document.createElement('div');
    this.statEl.style.cssText = `position:absolute;right:20px;bottom:132px;text-align:right;font-size:12px;line-height:1.75;${PANEL}padding:9px 13px;`;
    root.appendChild(this.statEl);

    // ── Centre-top: 区域卡 ─────────────────────────────────────────────
    this.areaCard = document.createElement('div');
    this.areaCard.style.cssText =
      `position:absolute;left:50%;top:22%;transform:translateX(-50%);text-align:center;` +
      `opacity:0;transition:opacity .5s;${PANEL}padding:15px 34px;`;
    this.areaName = document.createElement('div');
    this.areaName.style.cssText = 'font-size:31px;font-weight:800;letter-spacing:7px;';
    this.areaSub = document.createElement('div');
    this.areaSub.style.cssText = `font-size:12px;opacity:.7;margin-top:5px;letter-spacing:2px;color:${GOLD};`;
    this.areaCard.append(this.areaName, this.areaSub);
    root.appendChild(this.areaCard);

    // ── Near-bottom-centre: 交互提示 ───────────────────────────────────
    this.promptEl = document.createElement('div');
    this.promptEl.style.cssText =
      `position:absolute;left:50%;bottom:26%;transform:translateX(-50%);` +
      `font-size:14px;letter-spacing:1px;${PANEL}padding:9px 18px;display:none;`;
    root.appendChild(this.promptEl);

    // ── Toast queue ───────────────────────────────────────────────────
    this.toastWrap = document.createElement('div');
    this.toastWrap.style.cssText =
      'position:absolute;left:50%;bottom:33%;transform:translateX(-50%);' +
      'display:flex;flex-direction:column-reverse;gap:6px;align-items:center;';
    root.appendChild(this.toastWrap);

    // ── Buy panel ─────────────────────────────────────────────────────
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      `width:352px;padding:20px 22px;${PANEL};display:none;pointer-events:auto;`;
    this.panelTitle = document.createElement('div');
    this.panelTitle.style.cssText = `font-size:22px;font-weight:800;color:${GOLD};letter-spacing:2px;`;
    this.panelMoney = document.createElement('div');
    this.panelMoney.style.cssText = 'font-size:12px;opacity:.7;margin:4px 0 13px;';
    this.panelItems = document.createElement('div');
    this.panelItems.style.cssText = 'display:flex;flex-direction:column;gap:7px;';
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:11px;opacity:.5;margin-top:15px;letter-spacing:1px;';
    hint.textContent = 'ESC / E 关闭　·　按 E 关门出去';
    this.panel.append(this.panelTitle, this.panelMoney, this.panelItems, hint);
    root.appendChild(this.panel);

    // ── Mission panel, top-left under the wanted stars ──────────────────
    this.missionBox = document.createElement('div');
    this.missionBox.style.cssText =
      `position:absolute;left:20px;top:126px;width:246px;padding:12px 14px;${PANEL}`;
    this.missionTitle = document.createElement('div');
    this.missionTitle.style.cssText = 'font-size:15px;font-weight:800;color:#f3ece0;letter-spacing:1px;';
    this.missionGiver = document.createElement('div');
    this.missionGiver.style.cssText = `font-size:10px;opacity:.55;margin-top:2px;color:${GOLD};letter-spacing:1px;`;
    this.missionObjs = document.createElement('div');
    this.missionObjs.style.cssText = 'margin-top:9px;display:flex;flex-direction:column;gap:5px;';
    this.missionReward = document.createElement('div');
    this.missionReward.style.cssText = `font-size:11px;margin-top:9px;opacity:.8;color:${GOLD};`;
    this.missionBox.append(this.missionTitle, this.missionGiver, this.missionObjs, this.missionReward);
    root.appendChild(this.missionBox);

    // ── Waypoint arrow + distance, bottom-left above the wallet ─────────
    this.wpEl = document.createElement('div');
    this.wpEl.style.cssText =
      `position:absolute;left:20px;bottom:96px;display:flex;align-items:center;gap:8px;` +
      `font-size:12px;${PANEL}padding:7px 12px;display:none;`;
    this.wpArrow = document.createElement('div');
    this.wpArrow.style.cssText = `font-size:17px;color:${GOLD};line-height:1;`;
    this.wpText = document.createElement('div');
    this.wpEl.append(this.wpArrow, this.wpText);
    root.appendChild(this.wpEl);
  }

  /**
   * Objective list. Rebuilt only when the text changes — `innerHTML` every frame
   * at 60 fps is a surprisingly expensive way to GC.
   */
  setMission(missions: Missions): void {
    if (!missions.active) {
      this.missionBox.style.display = 'none';
      this.wpEl.style.display = 'none';
      this.lastMissionSig = '';
      return;
    }
    this.missionBox.style.display = 'block';
    this.wpEl.style.display = 'flex';
    const lines = missions.objectiveLines();
    const sig = `${missions.title()}|${lines.map((l) => l.got + '/' + l.need).join(',')}`;
    if (sig !== this.lastMissionSig) {
      this.lastMissionSig = sig;
      this.missionTitle.textContent = `📋 ${missions.title()}`;
      this.missionGiver.textContent = `委托人 · ${missions.giver()}`;
      this.missionObjs.innerHTML = lines
        .map(
          (l) =>
            `<div style="display:flex;gap:6px;font-size:11.5px;line-height:1.45">` +
            `<span style="color:${l.got >= l.need ? JADE : GOLD}">${l.got >= l.need ? '✔' : '▸'}</span>` +
            `<span style="opacity:${l.got >= l.need ? 0.55 : 1}">${l.label}</span>` +
            `<span style="margin-left:auto;opacity:.7">${l.got}/${l.need}</span></div>`,
        )
        .join('');
      this.missionReward.textContent = missions.brief();
    }
  }

  setWaypoint(dist: number, relAngle: number, camYaw: number): void {
    if (!Number.isFinite(dist)) {
      this.wpEl.style.display = 'none';
      return;
    }
    this.wpEl.style.display = 'flex';
    this.wpText.textContent = `${Math.round(dist)} m`;
    // Rotate the arrow by the bearing relative to where the camera is looking.
    this.wpArrow.style.transform = `rotate(${(((relAngle - camYaw) * 180) / Math.PI).toFixed(0)}deg)`;
  }

  get isPanelOpen(): boolean {
    return this.openShop !== null;
  }

  togglePanel(shop: ShopState | null): void {
    if (shop) {
      this.openShop = shop;
      this.renderPanel(shop);
      this.panel.style.display = 'block';
    } else {
      this.openShop = null;
      this.panel.style.display = 'none';
    }
  }

  closePanel(): void {
    this.togglePanel(null);
  }

  private renderPanel(shop: ShopState): void {
    this.panelTitle.textContent = shop.broken ? `${shop.unit.def.name}（烂咗）` : shop.unit.def.name;
    this.panelItems.innerHTML = '';
    for (const item of shop.unit.def.items) {
      const row = document.createElement('button');
      const afford = (this.lastWallet?.money ?? 0) >= item.price && !shop.broken;
      row.style.cssText =
        'display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;' +
        `padding:10px 13px;border-radius:8px;cursor:${afford ? 'pointer' : 'not-allowed'};` +
        `border:1px solid ${afford ? 'rgba(255,210,74,.3)' : 'rgba(255,255,255,.06)'};` +
        `background:${afford ? 'rgba(255,210,74,.09)' : 'rgba(255,255,255,.02)'};` +
        'color:inherit;font:inherit;font-size:14px;';
      const left = document.createElement('span');
      left.innerHTML = `<b>${item.name}</b><br><span style="font-size:11px;opacity:.6">${item.blurb}</span>`;
      const right = document.createElement('b');
      right.style.cssText = `color:${afford ? GOLD : RED};font-size:15px;`;
      right.textContent = `¥${item.price}`;
      row.append(left, right);
      if (afford) {
        row.onclick = (): void => this.cb.onBuy(shop, item.id);
        row.onmouseenter = (): void => {
          row.style.background = 'rgba(255,210,74,.2)';
        };
        row.onmouseleave = (): void => {
          row.style.background = 'rgba(255,210,74,.09)';
        };
      }
      this.panelItems.appendChild(row);
    }
  }

  toast(text: string, color = '#f3ece0'): void {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      `padding:8px 16px;border-radius:8px;font-size:13px;${PANEL}border-color:${color}44;` +
      'animation:nnToastIn .22s ease-out;';
    const s = document.createElement('style');
    s.textContent = '@keyframes nnToastIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}';
    el.appendChild(s);
    this.toastWrap.appendChild(el);
    this.toasts.push({ el, t: 2.6 });
    // Keep the stack short so a brawl doesn't wallpaper the screen.
    while (this.toasts.length > 4) this.toasts.shift()?.el.remove();
  }

  update(dt: number, wallet: Wallet, px: number, pz: number, shop: ShopState | null): void {
    const wasMoney = this.lastWallet?.money;
    this.lastWallet = wallet;
    if (this.openShop && wasMoney !== wallet.money) this.renderPanel(this.openShop);
    this.walletEl.textContent = `¥ ${wallet.money}`;
    this.fillBar.style.width = `${Math.max(0, Math.min(100, wallet.satiety))}%`;
    this.statEl.innerHTML =
      `🍜 食过 <b>${wallet.eaten}</b> 样<br>` +
      `🔨 砸烂 <b style="color:${RED}">${wallet.smashed}</b> 间铺`;

    if (this.openShop) {
      this.panelMoney.textContent = `你身上：¥ ${wallet.money}　｜　铺头状态：${
        this.openShop.broken ? '已砸烂' : `完好 ${Math.round(this.openShop.hp)}%`
      }`;
    }

    // Interaction prompt. J is the punch key; left click does the same.
    this.shopPrompt = !!(shop && !this.isPanelOpen);
    if (this.shopPrompt && shop) {
      this.promptEl.style.display = 'block';
      this.promptEl.innerHTML = shop.broken
        ? `<span style="color:${RED}">J</span> / 左键 继续砸　·　铺面已烂（老板很生气）`
        : `<span style="color:${GOLD}">E</span> 进店买嘢　·　<span style="color:${RED}">J</span> / 左键 砸铺`;
    } else if (!this.mountHint) {
      this.promptEl.style.display = 'none';
    }

    // Area card
    const area = this.zoneAt(px, pz);
    const id = area?.id ?? null;
    if (id && id !== this.currentArea) {
      this.currentArea = id;
      const def: AreaDef | undefined = AREAS.find((a) => a.id === id);
      if (def) {
        this.areaName.textContent = def.name;
        this.areaSub.textContent = def.subtitle;
        this.areaTimer = 3.0;
      }
    }
    if (this.areaTimer > 0) {
      this.areaTimer -= dt;
      this.areaCard.style.opacity = this.areaTimer > 2.2 ? '1' : String(Math.max(0, this.areaTimer / 2.2));
    } else {
      this.areaCard.style.opacity = '0';
    }

    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      t.t -= dt;
      if (t.t <= 0) {
        t.el.remove();
        this.toasts.splice(i, 1);
      } else if (t.t < 0.5) {
        t.el.style.opacity = String(t.t / 0.5);
      }
    }
  }

  /** Show the bar while sprinting or recovering, then fade it. */
  setStamina(value: number, max: number, active: boolean, dt: number): void {
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    this.stamFill.style.width = `${ratio * 100}%`;
    this.stamFill.style.background = ratio < 0.25 ? RED : GOLD;
    if (active || value < max - 0.5) this.stamShow = 2;
    else this.stamShow = Math.max(0, this.stamShow - dt);
    this.stamWrap.style.opacity = this.stamShow > 0 ? '1' : '0';
  }

  /** [F] 上车 when a car is in reach and no shop prompt is up. */
  setMountHint(near: boolean): void {
    this.mountHint = near && !this.shopPrompt && !this.isPanelOpen;
    if (this.shopPrompt || this.isPanelOpen) return;
    if (this.mountHint) {
      this.promptEl.style.display = 'block';
      this.promptEl.innerHTML = `<span style="color:${GOLD}">F</span> 上车`;
    } else {
      this.promptEl.style.display = 'none';
    }
  }

  private zoneAt(x: number, z: number): AreaDef | undefined {
    // Later zones in the list are narrower (specific beats general), so scan
    // backwards and take the most specific match.
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) {
        return AREAS.find((a) => a.id === zn.id);
      }
    }
    return undefined;
  }
}
