import { describe, expect, it } from 'vitest';
import { applyPerm, derivePermutation, invertPerm, publicPermutation, randomKey, randomWord } from './prp';

describe('derived permutations', () => {
  it('are genuine permutations of the whole domain', async () => {
    for (let n = 2; n <= 6; n++) {
      const p = await derivePermutation(n, randomKey());
      const seen = new Set<number>();
      for (let x = 0; x < 1 << n; x++) {
        const y = applyPerm(p, x);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(1 << n);
        seen.add(y);
      }
      expect(seen.size).toBe(1 << n);
    }
  });

  it('invert correctly in both directions', async () => {
    const p = await derivePermutation(5, randomKey());
    for (let x = 0; x < 32; x++) {
      expect(invertPerm(p, applyPerm(p, x))).toBe(x);
      expect(applyPerm(p, invertPerm(p, x))).toBe(x);
    }
  });

  it('are deterministic in the key', async () => {
    const key = randomKey();
    const a = await derivePermutation(6, key);
    const b = await derivePermutation(6, key);
    expect([...a.table]).toEqual([...b.table]);
  });

  it('change completely with the key', async () => {
    const a = await derivePermutation(6, new Uint8Array([1, 2, 3]));
    const b = await derivePermutation(6, new Uint8Array([1, 2, 4]));
    let same = 0;
    for (let x = 0; x < 64; x++) if (a.table[x] === b.table[x]) same++;
    // A fixed point count near 1 is expected; anything like 64 would mean the
    // key is not reaching the shuffle.
    expect(same).toBeLessThan(10);
  });

  it('give every lab the same public permutation for a given width', async () => {
    const a = await publicPermutation(5);
    const b = await publicPermutation(5);
    expect([...a.table]).toEqual([...b.table]);
  });
});

describe('platform randomness helpers', () => {
  it('randomWord stays inside n bits', () => {
    for (let n = 1; n <= 6; n++) {
      for (let i = 0; i < 200; i++) {
        const v = randomWord(n);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1 << n);
      }
    }
  });

  it('randomKey returns the requested length and varies', () => {
    const a = randomKey(16);
    const b = randomKey(16);
    expect(a).toHaveLength(16);
    expect([...a]).not.toEqual([...b]);
  });
});
