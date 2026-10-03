import type { CharacterDef } from './types';

/**
 * 男主 — middle-aged, open white lab coat, grey ribbed tank, grey cargo
 * shorts, black flip-flops, thick black glasses, messy grey-black hair.
 * Colours sampled from the owner's reference photo. All procedural; no textures.
 */
export const PROTAGONIST: CharacterDef = {
  id: 'protagonist',
  name: '男主',
  body: {
    height: 1.74,
    shoulder: 0.44,
    skin: 0xd2b49a,
  },
  hair: {
    style: 'messy',
    color: 0x2c2c30,
    streak: 0x8a8a90,
  },
  glasses: {
    style: 'thick-rect',
    color: 0x141414,
  },
  top: {
    id: 'grey-rib-tank',
    style: 'tank',
    color: 0x8d9094,
  },
  outerwear: {
    id: 'white-labcoat',
    style: 'labcoat',
    color: 0xf3f1ec,
    open: true,
    pocketPens: true,
    sideNotebook: true,
  },
  bottoms: {
    id: 'grey-cargo-shorts',
    style: 'cargo-shorts',
    color: 0x6a6e70,
  },
  shoes: {
    id: 'black-flipflops',
    style: 'flipflop',
    color: 0x141414,
  },
};
