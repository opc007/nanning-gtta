/**
 * NPC 白话对话.
 *
 * Pedestrians in the base game are anonymous capsules. Two things turn them into
 * 街坊: a speech bubble when you get close, and a real conversation when you
 * press E. Both are cheap — a canvas sprite for the bubble, a small state
 * machine per talker.
 *
 * The debt NPCs double as the 收租 mission's targets, which is deliberate: GTA
 * debt collection works because the person you're collecting from is a
 * character, not a waypoint.
 */

import * as THREE from 'three';
import { CHATTER, COP_SHOUT, CHATTER_REACT } from './data';
import { stepCrowd, type CrowdMover } from './crowdStep';
import { NpcPool, preloadCrowd } from '../characters/npcPool';
import type { TargetCandidate } from '../systems/Targets';

export interface Talker {
  x: number;
  z: number;
  /** Height off the ground, while thrown. */
  y: number;
  name: string;
  amount: number;
  paid: boolean;
  group: THREE.Group;
  bubble: THREE.Sprite;
  line: string;
  t: number;
  /** Health. Punches stagger, they do not delete. */
  hp: number;
  /** What is happening to them right now. */
  combat: 'none' | 'shoved' | 'down' | 'carried' | 'fight';
  /** Countdown for shoved and down. */
  timer: number;
  /** Seconds until this one throws a punch. */
  swingCd: number;
  /** How long the fight has been going. */
  fightT: number;
  /** Seconds left of running away from the player. */
  panic: number;
  /** In a fight with the player. */
  hostile: boolean;
  /** Velocity while shoved. */
  vx: number;
  vz: number;
  vy: number;
}

/**
 * The street's own rules for a punch.
 *
 * These used to live on a second population of pedestrians that the Nanning
 * street never actually had — the people you can see are this crowd, so the
 * punching bag was empty while the street was full. Everything here exists so
 * that the people you can see are the people you can hit.
 */
const CROWD_HP = 3; // punches to put someone on the floor
const CROWD_SHOVE_TIME = 1.6; // seconds knocked back before they get up
const CROWD_DOWN_TIME = 3.2; // seconds face-down before they struggle up
const CROWD_PANIC_TIME = 3.5; // seconds running from you after a punch
const CROWD_FLEE_SPEED = 5; // m/s
const CROWD_AID_RADIUS = 8; // how far a friend has to be to notice the punch
const CROWD_AID_CHANCE = 0.5; // ...and how likely they are to care enough
const CROWD_FIGHT_REACH = 2.0; // swinging distance
const CROWD_FIGHT_SPEED = 2.9; // closing speed
const CROWD_SWING_DAMAGE = 7; // health the player loses per swing
const CROWD_SWING_COOLDOWN = 1.35; // seconds between swings
const CROWD_FIGHT_BREAK = 14; // if you get this far away, they give up
const CROWD_FIGHT_GIVE_UP = 9; // no brawl lasts forever
const GRAVITY = 18;

/** Draw a line of text into a rounded bubble sprite. */
function makeBubble(): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(3.2, 0.8, 1);
  sp.renderOrder = 999;
  sp.visible = false;
  (sp as THREE.Sprite & { cv?: HTMLCanvasElement; tex?: THREE.CanvasTexture }).cv = cv;
  (sp as THREE.Sprite & { cv?: HTMLCanvasElement; tex?: THREE.CanvasTexture }).tex = tex;
  return sp;
}

function drawBubble(sp: THREE.Sprite, text: string, color = '#f3ece0'): void {
  const cv = (sp as THREE.Sprite & { cv?: HTMLCanvasElement }).cv;
  const tex = (sp as THREE.Sprite & { tex?: THREE.CanvasTexture }).tex;
  if (!cv || !tex) return;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  // Bubble body
  g.fillStyle = 'rgba(16,14,12,.9)';
  const w = 480;
  const h = 78;
  const x = 16;
  const y = 14;
  g.beginPath();
  g.moveTo(x + 18, y);
  g.lineTo(x + w - 18, y);
  g.quadraticCurveTo(x + w, y, x + w, y + 18);
  g.lineTo(x + w, y + h - 18);
  g.quadraticCurveTo(x + w, y + h, x + w - 18, y + h);
  g.lineTo(x + 28, y + h);
  g.lineTo(x + 20, y + h + 22); // tail
  g.lineTo(x + 12, y + h);
  g.lineTo(x + 18, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - 18);
  g.lineTo(x, y + 18);
  g.quadraticCurveTo(x, y, x + 18, y);
  g.closePath();
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.stroke();
  // Text, auto-shrunk
  let size = 34;
  g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  while (g.measureText(text).width > w - 40 && size > 15) {
    size -= 2;
    g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2);
  tex.needsUpdate = true;
}

/**
 * The pool the street draws its bodies from, and the clip each one idles on.
 * `makePerson` used to build a capsule torso, a sphere head and two capsule
 * legs here; the brief rules that out.
 */
const NPC_POOL = [
  'character-male-d', 'character-male-a', 'character-male-b', 'character-male-c',
  'character-male-e', 'character-female-a', 'character-female-b',
];

export class Crowd {
  readonly talkers: Talker[] = [];
  private readonly bubbles: THREE.Sprite[] = [];
  private t = 0;

  private readonly mixers: THREE.AnimationMixer[] = [];
  private readonly npcs = new NpcPool();
  /** Where the player was last frame, for shoving and panicking away. */
  private px = 0;
  private pz = 0;
  /** Called when someone lands a punch on the player. */
  onSwing?: (x: number, z: number, damage: number) => void;
  /** Called the first time a brawl starts, so the street can call the police. */
  onFightStart?: () => void;
  private tick(dt: number): void {
    for (const m of this.mixers) m.update(Math.min(dt, 0.05));
  }


  constructor(scene: THREE.Scene, targets: { x: number; z: number; name: string; amount: number }[], ambient = 14) {
    preloadCrowd();
    let seed = 17;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (const t of targets) {
      this.place(scene, t.x, t.z, NPC_POOL[Math.floor(rnd() * NPC_POOL.length)], rnd(), {
        name: t.name, amount: t.amount, paid: false, t: rnd() * 6,
      });
    }

    // Ambient chatter along the carriageway. The old scatter covered the whole
    // 560 m city; on a single street that put most people inside buildings.
    //
    // People stand in knots, not in a queue. Spacing them evenly left the
    // street looking empty — and it also meant nobody was ever close enough to
    // anyone else to have an opinion about a punch, so a brawl could never
    // start. A knot of two to four within arm's reach of each other is both
    // how a real pavement looks and what makes the crowd answer back.
    let placed = 0;
    while (placed < ambient) {
      const anchorX = (placed % 2 === 0 ? -1 : 1) * (1.6 + rnd() * 2.2);
      const anchorZ = -140 + (placed + 0.5) * (280 / Math.max(1, ambient));
      const knot = Math.min(ambient - placed, 2 + Math.floor(rnd() * 3));
      for (let k = 0; k < knot; k++) {
        const jx = anchorX + (rnd() - 0.5) * 2.2;
        const jz = anchorZ + (rnd() - 0.5) * 2.8;
        this.place(scene, jx, jz, NPC_POOL[Math.floor(rnd() * NPC_POOL.length)], rnd() * Math.PI * 2, {
          name: '', amount: 0, paid: true, t: rnd() * 8,
        });
      }
      placed += knot;
    }
  }

  /**
   * Put one pedestrian on the street. The model arrives asynchronously, so a
   * miss is not an error: the body simply joins a moment later.
   */
  private place(
    scene: THREE.Scene, x: number, z: number, file: string, facing: number,
    talker: { name: string; amount: number; paid: boolean; t: number },
  ): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = facing;
    scene.add(g);
    const b = makeBubble();
    b.position.set(0, 2.1, 0);
    g.add(b);
    this.bubbles.push(b);
    this.talkers.push({
      x, z, y: 0, group: g, bubble: b, line: '',
      hp: CROWD_HP, combat: 'none', timer: 0, swingCd: 0, fightT: 0,
      panic: 0, hostile: false, vx: 0, vz: 0, vy: 0,
      ...talker,
    });
    void this.npcs.spawn(file, 'idle').then((made) => {
      if (!made) return;
      g.add(made.group);
      this.mixers.push(made.mixer);
    });
  }

  /**
   * Everyone on the street, for the shared target resolver.
   *
   * This is the piece that was missing. The punch, the grab and the reticle
   * all asked a second population of pedestrians for their targets, and the
   * Nanning street never had that population — so the people you could see
   * were people you could not touch.
   */
  targets(): TargetCandidate[] {
    const out: TargetCandidate[] = [];
    for (let i = 0; i < this.talkers.length; i++) {
      const t = this.talkers[i];
      if (t.combat === 'carried') continue;
      out.push({
        kind: 'ped',
        id: `crowd-${i}`,
        x: t.x,
        z: t.z,
        hp: t.hp,
        maxHp: CROWD_HP,
        label: t.name || '街坊',
        strike: () => this.strikeTalker(i),
        grab: () => this.grabTalker(i),
      });
    }
    return out;
  }

  /**
   * A punch lands: they stagger, remember your face, and run. Three of them
   * put someone on the floor, and they get up.
   */
  private strikeTalker(i: number): boolean {
    const t = this.talkers[i];
    if (!t || t.combat === 'carried' || t.combat === 'down') return false;
    t.hp -= 1;
    t.t = 0;
    t.bubble.visible = false;
    const dx = t.x - this.px;
    const dz = t.z - this.pz;
    const d = Math.hypot(dx, dz) || 1;
    t.vx = (dx / d) * 2.4;
    t.vz = (dz / d) * 2.4;
    t.vy = 1.4;
    t.y = 0;
    t.combat = 'shoved';
    t.timer = CROWD_SHOVE_TIME;
    t.panic = CROWD_PANIC_TIME;
    t.hostile = false;
    t.group.rotation.x = 0;
    if (t.hp <= 0) {
      t.hp = CROWD_HP;
      t.combat = 'down';
      t.timer = CROWD_DOWN_TIME;
    }
    this.rouse(t);
    return true;
  }

  /** Pick someone up over your shoulder. */
  private grabTalker(i: number): boolean {
    const t = this.talkers[i];
    if (!t || t.combat === 'carried' || t.combat === 'down') return false;
    t.combat = 'carried';
    t.vx = t.vz = t.vy = 0;
    t.y = 0;
    t.hostile = false;
    t.t = 0;
    t.bubble.visible = false;
    t.group.rotation.x = 0;
    return true;
  }

  /** Let go. `power` throws them; zero just puts them down at your feet. */
  release(power: number, dirX: number, dirZ: number): boolean {
    for (const t of this.talkers) {
      if (t.combat !== 'carried') continue;
      if (power > 0) {
        t.combat = 'shoved';
        t.timer = CROWD_SHOVE_TIME;
        t.vx = dirX * power;
        t.vz = dirZ * power;
        t.vy = 2.5;
        t.panic = CROWD_PANIC_TIME;
      } else {
        t.combat = 'none';
        t.group.rotation.x = 0;
        t.panic = CROWD_PANIC_TIME;
      }
      return true;
    }
    return false;
  }

  /** Carrying someone? Movement is taxed and the fist is busy. */
  carrying(): boolean {
    return this.talkers.some((t) => t.combat === 'carried');
  }

  /**
   * The friends of the person you just hit. Not everyone cares — some just
   * walk faster — but enough of them do that a punch on a busy street stops
   * being a private act.
   */
  private rouse(victim: Talker): void {
    const hadFight = this.talkers.some((o) => o.hostile);
    for (const other of this.talkers) {
      if (other === victim) continue;
      if (other.combat !== 'none' || other.hostile) continue;
      const d = Math.hypot(other.x - victim.x, other.z - victim.z);
      if (d > CROWD_AID_RADIUS) continue;
      if (Math.random() > CROWD_AID_CHANCE) continue;
      other.hostile = true;
      other.combat = 'fight';
      other.fightT = 0;
      other.panic = 0;
      other.t = 0;
      other.bubble.visible = false;
      // Stagger the swings so three of them do not all connect at once.
      other.swingCd = CROWD_SWING_COOLDOWN * (0.5 + Math.random() * 0.9);
      if (!hadFight) this.onFightStart?.();
    }
  }

  /**
   * Advance one person's fight, knockdown or panic. Everything that happens
   * to a person who is not simply standing there talking.
   */
  private stepCombat(t: Talker, dt: number, px: number, pz: number, heading: number): void {
    if (t.combat === 'carried') {
      // Held out in front of the carrier, tilted.
      const fx = Math.cos(heading);
      const fz = -Math.sin(heading);
      t.group.position.set(px + fx * 0.85, 1.05, pz + fz * 0.85);
      t.group.rotation.set(-0.5, heading, 0.2);
      t.x = t.group.position.x;
      t.z = t.group.position.z;
      return;
    }
    if (t.combat === 'none') {
      if (t.panic > 0) {
        t.panic -= dt;
        const dx = t.x - px;
        const dz = t.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 0.2) {
          t.x += (dx / d) * CROWD_FLEE_SPEED * dt;
          t.z += (dz / d) * CROWD_FLEE_SPEED * dt;
          t.group.position.set(t.x, 0, t.z);
          t.group.rotation.y = Math.atan2(-dx / d, -dz / d);
        }
      }
      return;
    }
    if (t.combat === 'shoved') {
      t.timer -= dt;
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.vy -= GRAVITY * dt;
      t.y += t.vy * dt;
      if (t.y <= 0) { t.y = 0; t.vy = 0; }
      t.vx *= 1 - Math.min(1, dt * 3.5);
      t.vz *= 1 - Math.min(1, dt * 3.5);
      t.group.position.set(t.x, t.y, t.z);
      t.group.rotation.x = -Math.min(1.15, t.timer * 1.6);
      if (t.timer <= 0) {
        t.group.rotation.x = 0;
        // They get up angry. Punching a person and having them simply run
        // away is a pushover; on a real street they turn around.
        t.combat = 'fight';
        t.hostile = true;
        t.fightT = 0;
        t.swingCd = CROWD_SWING_COOLDOWN * 0.8;
      }
      return;
    }
    if (t.combat === 'down') {
      t.timer -= dt;
      t.group.position.set(t.x, 0.3, t.z);
      t.group.rotation.x = -Math.PI / 2;
      if (t.timer <= 0) {
        t.combat = 'none';
        t.group.rotation.x = 0;
        t.panic = CROWD_PANIC_TIME;
      }
      return;
    }
    // In a fight: close on the player, swing when in reach, and know when to
    // give up. Without that last part this is a mob that never stops.
    t.fightT += dt;
    t.swingCd -= dt;
    const dx = px - t.x;
    const dz = pz - t.z;
    const dist = Math.hypot(dx, dz);
    if (dist > CROWD_FIGHT_BREAK || t.fightT > CROWD_FIGHT_GIVE_UP) {
      t.combat = 'none';
      t.hostile = false;
      t.fightT = 0;
      t.group.rotation.x = 0;
      t.panic = CROWD_PANIC_TIME;
      return;
    }
    if (dist > 0.2) {
      const nx = dx / dist;
      const nz = dz / dist;
      t.group.rotation.y = Math.atan2(nx, nz);
      if (dist > CROWD_FIGHT_REACH) {
        t.x += nx * CROWD_FIGHT_SPEED * dt;
        t.z += nz * CROWD_FIGHT_SPEED * dt;
      }
    }
    t.group.position.set(t.x, 0, t.z);
    if (dist < CROWD_FIGHT_REACH && t.swingCd <= 0) {
      t.swingCd = CROWD_SWING_COOLDOWN;
      this.onSwing?.(t.x, t.z, CROWD_SWING_DAMAGE);
    }
  }

  /** The nearest unpaid debt target, or null. */
  nearestDebtor(px: number, pz: number, max = 3.4): Talker | null {
    let best: Talker | null = null;
    let bd = max * max;
    for (const t of this.talkers) {
      if (t.paid || !t.amount) continue;
      const d = (t.x - px) ** 2 + (t.z - pz) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Collect from a debtor. Returns the payout, or null if there was nothing to take. */
  collect(t: Talker): number {
    if (t.paid || !t.amount) return 0;
    t.paid = true;
    const amt = t.amount;
    t.amount = 0;
    this.say(t, `多谢老板！${amt} 蚊真系及时雨。`);
    // Walk off with the money.
    t.group.userData.leaving = true;
    t.group.userData.vel = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize().multiplyScalar(2.4);
    return amt;
  }

  /** Make a talker say something for a couple of seconds. */
  say(t: Talker, line: string, seconds = 3.2): void {
    t.line = line;
    t.t = seconds;
    drawBubble(t.bubble, line, t.amount ? '#ffd24a' : '#f3ece0');
    t.bubble.visible = true;
  }

  /**
   * Ambient behaviour: people murmur to themselves on a timer, and panic lines
   * play if you walk up swinging. Called every frame.
   */
  update(dt: number, px: number, pz: number, heat: number, smashes: number, heading = 0): void {
    this.t += dt;
    this.tick(dt);
    this.px = px;
    this.pz = pz;
    // Combat first: someone who is being hit, carried or is in a fight is not
    // also murmuring to themselves.
    for (const t of this.talkers) this.stepCombat(t, dt, px, pz, heading);
    const movers: CrowdMover[] = this.talkers.map((t) => {
      const v = t.group.userData.vel as THREE.Vector3 | undefined;
      return {
        t: t.t,
        leaving: !!t.group.userData.leaving,
        x: t.x,
        z: t.z,
        vx: v?.x ?? 0,
        vz: v?.z ?? 0,
        idleSteps: 0,
      };
    });
    // `leaving` continues to the next person. Returning here used to freeze
    // everyone queued after the first walker.
    stepCrowd(movers, dt);

    for (let i = 0; i < this.talkers.length; i++) {
      const t = this.talkers[i];
      if (t.combat !== 'none') continue; // already handled above
      const m = movers[i];
      const wasTalking = t.t > 0;
      t.t = m.t;
      t.x = m.x;
      t.z = m.z;
      if (wasTalking) {
        if (t.t <= 0) t.bubble.visible = false;
        continue;
      }
      if (m.leaving) {
        const v = t.group.userData.vel as THREE.Vector3;
        t.group.position.x = t.x;
        t.group.position.z = t.z;
        t.group.rotation.y = Math.atan2(v.x, v.z);
        continue;
      }
      // Not talking: occasionally murmur, and turn to face the player up close.
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d < 7) {
        t.group.rotation.y = Math.atan2(px - t.x, pz - t.z);
        if (d < 3.2 && heat > 35 && Math.random() < dt * 0.9) {
          this.say(t, CHATTER_REACT[Math.floor(Math.random() * CHATTER_REACT.length)], 2);
        }
        if (t.amount && d < 6 && Math.random() < dt * 0.35) {
          this.say(t, `喂，老板，${t.name} 欠咗 ${t.amount} 蚊，几时畀？`, 3.4);
        }
      } else if (Math.random() < dt * 0.08) {
        const line = heat > 40 ? COP_SHOUT[Math.floor(Math.random() * COP_SHOUT.length)] : CHATTER[Math.floor(Math.random() * CHATTER.length)];
        this.say(t, line, 2.6);
      }
      if (smashes > 0 && d < 5 && Math.random() < dt * 0.15) {
        this.say(t, '喂喂喂，唔好搞我哋铺头啊！', 2.4);
      }
    }
  }

  render(camera: THREE.Camera): void {
    for (const b of this.bubbles) {
      if (b.visible) b.quaternion.copy(camera.quaternion);
    }
  }
}
