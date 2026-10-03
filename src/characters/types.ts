/**
 * Data-only description of a person and what they are wearing.
 * The mesh builder (`buildCharacter`) is the only thing that reads this;
 * gameplay code never branches on a coat colour or a hair style.
 *
 * Swap a character by passing a different `CharacterDef`. Swap an outfit by
 * replacing `top` / `outerwear` / `bottoms` / `shoes` — same body, new clothes.
 */

export type HairStyle = 'messy';
export type GlassesStyle = 'thick-rect';
export type TopStyle = 'tank';
export type OuterwearStyle = 'labcoat';
export type BottomStyle = 'cargo-shorts';
export type ShoeStyle = 'flipflop';

export interface BodyDef {
  /** Standing height in metres, sole to crown (hair may stick up past this). */
  height: number;
  /** Shoulder width in metres. */
  shoulder: number;
  /** Skin tone, hex. */
  skin: number;
}

export interface HairDef {
  style: HairStyle;
  /** Base hair colour. Messy styles mix a little grey into this. */
  color: number;
  /** Highlight / grey strand colour. */
  streak: number;
}

export interface GlassesDef {
  style: GlassesStyle;
  color: number;
}

export interface TopDef {
  id: string;
  style: TopStyle;
  color: number;
}

export interface OuterwearDef {
  id: string;
  style: OuterwearStyle;
  /** Shell colour. A lab coat is off-white, not emissive white. */
  color: number;
  open: boolean;
  /** Pens in the chest pocket (wearer's left). */
  pocketPens: boolean;
  /** Notebook in the side pocket (wearer's right). */
  sideNotebook: boolean;
}

export interface BottomDef {
  id: string;
  style: BottomStyle;
  color: number;
}

export interface ShoeDef {
  id: string;
  style: ShoeStyle;
  color: number;
}

export interface CharacterDef {
  id: string;
  /** Short label for debug / future character select. Not drawn on the mesh. */
  name: string;
  body: BodyDef;
  hair: HairDef;
  /** Null = no glasses. */
  glasses: GlassesDef | null;
  top: TopDef;
  /** Null = no jacket. */
  outerwear: OuterwearDef | null;
  bottoms: BottomDef;
  shoes: ShoeDef;
}
