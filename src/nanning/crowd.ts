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

export interface Talker {
  x: number;
  z: number;
  name: string;
  amount: number;
  paid: boolean;
  group: THREE.Group;
  bubble: THREE.Sprite;
  line: string;
  t: number;
}

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
    for (let i = 0; i < ambient; i++) {
      const x = (i % 2 === 0 ? -1 : 1) * (1.6 + rnd() * 2.2);
      const z = -140 + (i + 0.5) * (280 / Math.max(1, ambient));
      this.place(scene, x, z, NPC_POOL[Math.floor(rnd() * NPC_POOL.length)], rnd() * Math.PI * 2, {
        name: '', amount: 0, paid: true, t: rnd() * 8,
      });
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
    this.talkers.push({ x, z, group: g, bubble: b, line: '', ...talker });
    void this.npcs.spawn(file, 'idle').then((made) => {
      if (!made) return;
      g.add(made.group);
      this.mixers.push(made.mixer);
    });
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
  update(dt: number, px: number, pz: number, heat: number, smashes: number): void {
    this.t += dt;
    this.tick(dt);
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
