import { describe, expect, it } from 'vitest';
import { PROTAGONIST } from './protagonist';

describe('protagonist definition', () => {
  it('is a swappable outfit on a separate body', () => {
    expect(PROTAGONIST.id).toBe('protagonist');
    expect(PROTAGONIST.body.skin).toBeGreaterThan(0);
    expect(PROTAGONIST.body.height).toBeGreaterThan(1.6);
    expect(PROTAGONIST.hair.style).toBe('messy');
    expect(PROTAGONIST.hair.color).not.toBe(PROTAGONIST.hair.streak);
    expect(PROTAGONIST.glasses?.style).toBe('thick-rect');
    expect(PROTAGONIST.glasses?.color).toBeLessThan(0x333333);
    expect(PROTAGONIST.top.style).toBe('tank');
    expect(PROTAGONIST.outerwear?.style).toBe('labcoat');
    expect(PROTAGONIST.outerwear?.open).toBe(true);
    expect(PROTAGONIST.outerwear?.pocketPens).toBe(true);
    expect(PROTAGONIST.outerwear?.sideNotebook).toBe(true);
    expect(PROTAGONIST.bottoms.style).toBe('cargo-shorts');
    expect(PROTAGONIST.shoes.style).toBe('flipflop');
    // Clothes are not the skin colour — they can be swapped without touching the body.
    expect(PROTAGONIST.top.color).not.toBe(PROTAGONIST.body.skin);
    expect(PROTAGONIST.outerwear?.color).not.toBe(PROTAGONIST.top.color);
    expect(PROTAGONIST.shoes.color).not.toBe(PROTAGONIST.bottoms.color);
  });
});
