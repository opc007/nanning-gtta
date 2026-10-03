/**
 * Procedural PBR material library.
 *
 * The base game paints everything with flat vertex colours, which is fine for
 * "look, procedural neon city" and hopeless for "画面细腻". Everything a
 * building or the street is made of gets a diffuse + a derived normal +
 * roughness here, generated once into small canvases and cached. That is what
 * turns a wall from a flat rectangle into brick you can read the courses on.
 *
 * Normal maps are built by Sobel-filtering a procedurally drawn height field,
 * so each material's normal agrees with its own bumps instead of being
 * unrelated noise.
 */

import * as THREE from 'three';

const cache = new Map<string, { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }>();

/** Deterministic noise so the same material is byte-identical across reloads. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Separable box blur, repeated — cheap approximation of a Gaussian for height maps. */
function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= w) continue;
          sum += a[y * w + xx];
          n++;
        }
        tmp[y * w + x] = sum / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= h) continue;
          sum += tmp[yy * w + x];
          n++;
        }
        out[y * w + x] = sum / n;
      }
    }
    a = out;
  }
  return a;
}

/** Sobel a height field into a tangent-space normal map. */
function heightToNormal(height: Float32Array, w: number, h: number, strength: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const at = (x: number, y: number): number => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const dx = tl + 2 * l + bl - (tr + 2 * r + br);
      const dy = tl + 2 * t + tr - (bl + 2 * b + br);
      // Normal = normalize(-dx*strength, -dy*strength, 1)
      const nx = -dx * strength;
      const ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function grayTexture(field: Float32Array, w: number, h: number, lo: number, hi: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(1, lo + field[i] * (hi - lo))) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── Height-field painters (they draw BOTH the albedo and the height) ─────────

type Gen = (size: number, seed: number) => { g: CanvasRenderingContext2D; height: Float32Array };

function genRedBrick(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    const height = new Float32Array(size * size);
    g.fillStyle = '#3a322e'; // mortar
    g.fillRect(0, 0, size, size);
    const rows = 16;
    const rh = size / rows;
    const bw = size / 6;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let i = -1; i < 7; i++) {
        const x = i * bw + off;
        const y = r * rh;
        const v = 0.72 + rnd() * 0.42;
        const rr = Math.round(150 * v);
        const gg = Math.round(72 * v);
        const bb = Math.round(58 * v);
        g.fillStyle = `rgb(${rr},${gg},${bb})`;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
        // Face shading: the top of each brick catches light, the bottom is dirty.
        const grad = g.createLinearGradient(0, y, 0, y + rh);
        grad.addColorStop(0, 'rgba(255,235,215,0.16)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.20)');
        g.fillStyle = grad;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
        // Speckle
        for (let k = 0; k < 6; k++) {
          g.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
          g.fillRect(x + 2 + rnd() * (bw - 5), y + 2 + rnd() * (rh - 5), 2, 2);
        }
      }
    }
    // Grime wash — the thing that makes a real brick wall not look like Lego.
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(24,20,18,${0.03 + rnd() * 0.07})`;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 10 + rnd() * 40, 8 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // Height: brick faces proud, mortar recessed.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const row = Math.floor(y / rh);
        const off = (row % 2) * (bw / 2);
        const bx = (((x - off) % bw) + bw) % bw;
        const by = y % rh;
        const onBrick = bx > 1.5 && bx < bw - 1.5 && by > 1.5 && by < rh - 1.5;
        height[y * size + x] = onBrick ? 0.78 + rnd() * 0.08 : 0.18;
      }
    }
    void S;
    return { g, height };
  };
}

function genGreyBrick(S: number, seed: number): Gen {
  // 青砖 — the grey-blue Nanning brick. Same construction, desaturated.
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    const height = new Float32Array(size * size);
    g.fillStyle = '#2f3436';
    g.fillRect(0, 0, size, size);
    const rows = 14;
    const rh = size / rows;
    const bw = size / 7;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let i = -1; i < 8; i++) {
        const x = i * bw + off;
        const y = r * rh;
        const v = 0.78 + rnd() * 0.38;
        const base = Math.round(96 * v);
        g.fillStyle = `rgb(${base},${Math.round(base * 1.05)},${Math.round(base * 1.08)})`;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
        const grad = g.createLinearGradient(0, y, 0, y + rh);
        grad.addColorStop(0, 'rgba(255,255,255,0.13)');
        grad.addColorStop(1, 'rgba(0,0,0,0.17)');
        g.fillStyle = grad;
        g.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
      }
    }
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(20,26,24,${0.03 + rnd() * 0.08})`;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 12 + rnd() * 44, 10 + rnd() * 34, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const row = Math.floor(y / rh);
        const off = (row % 2) * (bw / 2);
        const bx = (((x - off) % bw) + bw) % bw;
        const by = y % rh;
        height[y * size + x] = bx > 1.5 && bx < bw - 1.5 && by > 1.5 && by < rh - 1.5 ? 0.78 : 0.18;
      }
    }
    void S;
    return { g, height };
  };
}

function genConcrete(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    g.fillStyle = '#a9a49b';
    g.fillRect(0, 0, size, size);
    // Aggregate speckle: cement is never flat.
    for (let i = 0; i < size * 9; i++) {
      const v = rnd();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.3})` : `rgba(0,0,0,${(0.5 - v) * 0.28})`;
      const s = 1 + rnd() * 2.4;
      g.fillRect(rnd() * size, rnd() * size, s, s);
    }
    // Form-tie holes and panel joints — the give-away of cast concrete.
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 1.6;
    for (let i = 0; i <= 2; i++) {
      g.beginPath();
      g.moveTo(0, (i * size) / 2);
      g.lineTo(size, (i * size) / 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(size / 2, 0);
    g.lineTo(size / 2, size);
    g.stroke();
    for (let i = 0; i < 6; i++) {
      const x = size / 2 + (i % 2 ? 1 : -1) * size * 0.22;
      const y = (Math.floor(i / 2) + 0.5) * (size / 3);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.arc(x, y, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    // Water staining running down from the joints.
    for (let i = 0; i < 16; i++) {
      const x = rnd() * size;
      const grad = g.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, 'rgba(60,55,48,0.18)');
      grad.addColorStop(1, 'rgba(60,55,48,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, 3 + rnd() * 16, size);
    }
    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) height[i] = 0.5 + (rnd() - 0.5) * 0.4;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const jx = Math.abs(x - size / 2) < 1 ? 0 : 1;
        const jy = Math.abs((y % (size / 2)) - 0) < 1 || Math.abs((y % (size / 2)) - size / 2) < 1 ? 0 : 1;
        height[y * size + x] = jx * jy ? height[y * size + x] : 0.22;
      }
    }
    void S;
    return { g, height };
  };
}

function genAsphalt(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    g.fillStyle = '#22242a';
    g.fillRect(0, 0, size, size);
    // Chipped aggregate.
    for (let i = 0; i < size * 16; i++) {
      const v = rnd();
      g.fillStyle = v > 0.55 ? `rgba(150,152,160,${(v - 0.55) * 0.5})` : `rgba(8,8,10,${(0.55 - v) * 0.6})`;
      const s = 1 + rnd() * 3;
      g.fillRect(rnd() * size, rnd() * size, s, s);
    }
    // Cracks — asphalt always has them.
    g.strokeStyle = 'rgba(10,10,12,0.65)';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = 0.7 + rnd() * 1.4;
      g.beginPath();
      let x = rnd() * size;
      let y = rnd() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Oil patches: dark, slightly glossy, and they read at night.
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(6,6,9,${0.2 + rnd() * 0.25})`;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 14 + rnd() * 40, 10 + rnd() * 28, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) height[i] = 0.5 + (rnd() - 0.5) * 0.5;
    void S;
    return { g, height };
  };
}

function genPlaster(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    g.fillStyle = '#e2ddd2';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 7; i++) {
      const v = rnd();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.22})` : `rgba(120,112,98,${(0.5 - v) * 0.18})`;
      g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    // Weathering at the base of the wall — every Chinese street wall has this.
    for (let i = 0; i < 22; i++) {
      g.fillStyle = `rgba(110,102,90,${0.02 + rnd() * 0.05})`;
      g.beginPath();
      g.ellipse(rnd() * size, size - rnd() * size * 0.5, 8 + rnd() * 34, 6 + rnd() * 22, 0, 0, Math.PI * 2);
      g.fill();
    }
    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) height[i] = 0.5 + (rnd() - 0.5) * 0.35;
    void S;
    return { g, height };
  };
}

function genBluestone(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    g.fillStyle = '#26292c';
    g.fillRect(0, 0, size, size);
    const height = new Float32Array(size * size);
    const rows = 5;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const cols = 4;
      const cw = size / cols;
      const off = (r % 2) * (cw / 2);
      for (let i = -1; i <= cols; i++) {
        const x = i * cw + off;
        const v = 0.8 + rnd() * 0.4;
        const base = Math.round(74 * v);
        g.fillStyle = `rgb(${base},${Math.round(base * 1.07)},${Math.round(base * 1.02)})`;
        g.fillRect(x + 2, r * rh + 2, cw - 4, rh - 4);
        const grad = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
        grad.addColorStop(0, 'rgba(255,255,255,0.07)');
        grad.addColorStop(1, 'rgba(0,0,0,0.16)');
        g.fillStyle = grad;
        g.fillRect(x + 2, r * rh + 2, cw - 4, rh - 4);
      }
    }
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(16,20,20,${0.04 + rnd() * 0.08})`;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 14 + rnd() * 46, 10 + rnd() * 30, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const row = Math.floor(y / rh);
        const off = (row % 2) * (size / 4 / 2);
        const bx = (((x - off) % (size / 4)) + size / 4) % (size / 4);
        const by = y % rh;
        height[y * size + x] = bx > 2 && bx < size / 4 - 2 && by > 2 && by < rh - 2 ? 0.8 : 0.2;
      }
    }
    void S;
    return { g, height };
  };
}

function genPaintedSteel(S: number, seed: number): Gen {
  return (size) => {
    const g = document.createElement('canvas').getContext('2d')!;
    const rnd = makeRng(seed);
    g.canvas.width = g.canvas.height = size;
    g.fillStyle = '#d8d5cd';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < size * 4; i++) {
      const v = rnd();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.2})` : `rgba(90,88,82,${(0.5 - v) * 0.2})`;
      g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 4, 1 + rnd() * 2);
    }
    // Chipped paint showing rust — the detail that makes metal read as old.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${120 + rnd() * 40 | 0},${60 + rnd() * 25 | 0},${30 + rnd() * 15 | 0},${0.2 + rnd() * 0.45})`;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 1.5 + rnd() * 6, 1.5 + rnd() * 5, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const height = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) height[i] = 0.5 + (rnd() - 0.5) * 0.3;
    void S;
    return { g, height };
  };
}

const GENERATORS: Record<string, Gen> = {
  redBrick: genRedBrick(0, 0),
  greyBrick: genGreyBrick(0, 0),
  concrete: genConcrete(0, 0),
  asphalt: genAsphalt(0, 0),
  plaster: genPlaster(0, 0),
  bluestone: genBluestone(0, 0),
  steel: genPaintedSteel(0, 0),
};

export type MaterialKey = keyof typeof GENERATORS;

export interface Surface {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  /** Repeat factor per world metre, so tiling is resolution-independent. */
  scale: number;
  normalScale: number;
  rough: [number, number];
}

export function surface(key: MaterialKey, seed = 1, size = 256, scale = 0.25, normalScale = 1, rough: [number, number] = [0.75, 1]): Surface {
  const id = `${key}:${seed}:${size}:${scale}:${normalScale}:${rough[0]}`;
  const hit = cache.get(id);
  if (hit) return { ...hit, scale, normalScale, rough };
  const { g, height } = GENERATORS[key](size, seed);
  const map = new THREE.CanvasTexture(g.canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const blurred = blur(height, size, size, 1);
  const out = {
    map,
    normalMap: heightToNormal(blurred, size, size, 2.4 * normalScale),
    roughnessMap: grayTexture(blurred, size, size, rough[0], rough[1]),
  };
  cache.set(id, out);
  return { ...out, scale, normalScale, rough };
}

/**
 * A ready-to-use MeshStandardMaterial. Every call clones the textures so each
 * surface can carry its own repeat without fighting its neighbours over a
 * shared CanvasTexture.
 */
export function pbr(
  key: MaterialKey,
  opts: { color?: number; seed?: number; size?: number; scale?: number; normalScale?: number; rough?: [number, number]; metalness?: number } = {},
): THREE.MeshStandardMaterial {
  const s = surface(key, opts.seed ?? 1, opts.size ?? 256, opts.scale ?? 0.25, opts.normalScale ?? 1, opts.rough ?? [0.75, 1]);
  const map = s.map.clone();
  const nrm = s.normalMap.clone();
  const rgh = s.roughnessMap.clone();
  for (const t of [map, nrm, rgh]) {
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
  }
  const m = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map,
    normalMap: nrm,
    roughnessMap: rgh,
    roughness: 1,
    metalness: opts.metalness ?? 0,
  });
  m.normalScale = new THREE.Vector2(s.normalScale, s.normalScale);
  // Store the per-metre scale so geometry builders can size UVs correctly.
  (m as THREE.MeshStandardMaterial & { uvScale?: number }).uvScale = s.scale;
  return m;
}

/** Apply a world-size UV scale to a box geometry so tiling is metres-accurate. */
export function scaleBoxUv(geo: THREE.BoxGeometry, w: number, h: number, d: number, perMetre: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const set = (face: number, su: number, sv: number): void => {
    const base = face * 8;
    for (let i = 0; i < 4; i++) {
      uv.array[base + i * 2] *= Math.max(0.001, su);
      uv.array[base + i * 2 + 1] *= Math.max(0.001, sv);
    }
  };
  set(0, d * perMetre, h * perMetre);
  set(1, d * perMetre, h * perMetre);
  set(4, w * perMetre, h * perMetre);
  set(5, w * perMetre, h * perMetre);
  uv.needsUpdate = true;
}

export function disposeSurfaceCache(): void {
  for (const v of cache.values()) {
    v.map.dispose();
    v.normalMap.dispose();
    v.roughnessMap.dispose();
  }
  cache.clear();
}
