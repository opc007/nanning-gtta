import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The shipped `protagonist.glb` is a Quaternius "Ultimate Modular Men" rig. The
 * one thing you must not do is trust the bone names as they appear in the .glb
 * JSON: three's `PropertyBinding` strips `.` from glTF node names when it builds
 * the scene graph, so `UpperArm.L` arrives as `UpperArmL`.
 *
 * Getting that wrong is silent. The bone lookup falls back to a dummy Object3D
 * at the origin, the character still loads, and you are left with a naked
 * T-posed model — no coat, no glasses, no animation, and no error anywhere.
 * So the names the rig depends on are pinned here against the real file.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const GLB = join(HERE, '..', '..', 'public', 'assets', 'characters', 'protagonist.glb');

interface GlbJson {
  nodes: { name?: string }[];
  materials?: { name?: string }[];
  skins?: { joints: number[] }[];
}

function readGlb(): { json: GlbJson; total: number } {
  const buf = readFileSync(GLB);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a glb');
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) {
    throw new Error(`truncated glb: header says ${total} bytes, file is ${buf.length}`);
  }
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    if (buf.toString('ascii', off + 4, off + 8) === 'JSON') {
      const text = buf.toString('utf8', off + 8, off + 8 + len).replace(/[\0\s]+$/, '');
      return { json: JSON.parse(text) as GlbJson, total };
    }
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  throw new Error('no JSON chunk');
}

/** How three's PropertyBinding renames a node on load. */
const asThreeSeesIt = (name: string): string => name.replace(/[^a-zA-Z0-9_]/g, '');

const BONES = [
  'Head', 'Neck', 'Chest', 'Hips', 'Abdomen', 'Torso',
  'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR',
  'LowerArmL', 'LowerArmR', 'HandL', 'HandR',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR',
];

const MATERIALS = ['Skin', 'Hair', 'Eyebrows', 'Eye', 'Suit', 'White', 'Tie', 'Black'];
const PARTS = ['Suit_Body', 'Suit_Feet', 'Suit_Head', 'Suit_Legs'];

describe('protagonist.glb', () => {
  const { json, total } = readGlb();
  const names = new Set<string>(json.nodes.map((n) => n.name as string));
  const mats = new Set<string>((json.materials ?? []).map((m) => m.name as string));
  const sceneNames = new Set([...names].map(asThreeSeesIt));

  it('is a complete file, not a truncated download', () => {
    // `readGlb` throws above if the header length disagrees with the file.
    expect(names.size).toBeGreaterThan(40);
    expect(total).toBeGreaterThan(0);
  });

  it('carries every bone the rig binds to, under its runtime name', () => {
    const missing = BONES.filter((b) => !sceneNames.has(b));
    expect(missing).toEqual([]);
  });

  it('is skinned, so the bones actually drive the mesh', () => {
    const jointCount = (json.skins ?? [])[0]?.joints.length ?? 0;
    expect(jointCount).toBeGreaterThan(20);
  });

  it('names bones with dots, so the table must use the stripped form', () => {
    // The trap. If someone "fixes" the table back to `UpperArm.L`, this fails
    // and points straight at the cause instead of at a mystery.
    expect(names.has('UpperArm.L')).toBe(true);
    expect(sceneNames.has('UpperArm.L')).toBe(false);
    expect(sceneNames.has('UpperArmL')).toBe(true);
  });

  it('exposes the material slots the retint step looks up', () => {
    const missing = MATERIALS.filter((m) => !mats.has(m));
    expect(missing).toEqual([]);
  });

  it('is split into body/feet/head/legs so the dress shoes can be hidden', () => {
    const missing = PARTS.filter((p) => !sceneNames.has(p));
    expect(missing).toEqual([]);
  });

  it('stays well under the 10 MB asset budget', () => {
    expect(total).toBeLessThan(10 * 1024 * 1024);
  });
});
