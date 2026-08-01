import { describe, expect, it } from 'vitest';
import { dot } from '../math/gf2';
import {
  amplitudeClass,
  amplitudeSign,
  bits,
  equationText,
  formatMean,
  formatProbability,
  formatQueries,
  plural,
  subscript,
} from './format';

describe('subscripts', () => {
  it('renders multi-digit indices', () => {
    expect(subscript(0)).toBe('₀');
    expect(subscript(5)).toBe('₅');
    expect(subscript(12)).toBe('₁₂');
  });
});

describe('equationText', () => {
  it('lists exactly the selected coordinates, most significant first', () => {
    expect(equationText(0b101101, 6)).toBe('s₅ ⊕ s₃ ⊕ s₂ ⊕ s₀ = 0');
    expect(equationText(0b000001, 6)).toBe('s₀ = 0');
    expect(equationText(0b100000, 6)).toBe('s₅ = 0');
  });

  it('says 0 = 0 for the uninformative measurement', () => {
    expect(equationText(0, 6)).toBe('0 = 0');
  });

  it('agrees with the vector it came from, for every vector', () => {
    // The printed equation must select precisely the set bits — a mismatch here
    // would put a false equation on screen next to a true one.
    const n = 6;
    for (let y = 0; y < 1 << n; y++) {
      const text = equationText(y, n);
      const listed = new Set([...text.matchAll(/s([₀-₉])/g)].map((m) => '₀₁₂₃₄₅₆₇₈₉'.indexOf(m[1])));
      for (let i = 0; i < n; i++) expect(listed.has(i)).toBe(((y >>> i) & 1) === 1);
    }
  });

  it('describes a constraint the true period actually satisfies', () => {
    const n = 5;
    const s = 0b10110;
    for (let y = 0; y < 1 << n; y++) {
      if (dot(y, s) !== 0) continue;
      // XOR of the selected bits of s must be 0 — the equation as written.
      let acc = 0;
      for (let i = 0; i < n; i++) if ((y >>> i) & 1) acc ^= (s >>> i) & 1;
      expect(acc).toBe(0);
    }
  });
});

describe('amplitude presentation', () => {
  it('maps sign and class consistently', () => {
    expect(amplitudeSign(0.5)).toBe('+');
    expect(amplitudeSign(-0.5)).toBe('−');
    expect(amplitudeSign(0)).toBe('0');
    expect(amplitudeSign(1e-15)).toBe('0');
    expect(amplitudeClass(0.5)).toBe('pos');
    expect(amplitudeClass(-0.5)).toBe('neg');
    expect(amplitudeClass(-1e-15)).toBe('zero');
  });

  it('never shows a non-zero glyph for a cancelled amplitude', () => {
    // Cancellation lands on values like 1.1e-16 rather than exactly 0, and a
    // glyph of "+" there would misrepresent an impossible outcome as possible.
    for (const a of [0, 1e-16, -1e-16, 5e-13]) {
      expect(amplitudeSign(a)).toBe('0');
      expect(amplitudeClass(a)).toBe('zero');
    }
  });
});

describe('numeric formatting', () => {
  it('prints an exact zero probability as 0, not 0.0%', () => {
    expect(formatProbability(0)).toBe('0');
    expect(formatProbability(1e-15)).toBe('0');
    expect(formatProbability(0.25)).toBe('25.0%');
  });

  it('formats means to one decimal', () => {
    expect(formatMean(7)).toBe('7.0');
    expect(formatMean(7.25)).toBe('7.3');
  });

  it('switches to a power of two for large counts', () => {
    expect(formatQueries(7)).toBe('7');
    expect(formatQueries(9999)).toBe('9,999');
    expect(formatQueries(Math.pow(2, 64))).toBe('≈ 2^64');
  });

  it('pluralises', () => {
    expect(plural(1, 'equation')).toBe('1 equation');
    expect(plural(2, 'equation')).toBe('2 equations');
    expect(plural(0, 'query', 'queries')).toBe('0 queries');
  });
});

describe('bit strings', () => {
  it('are most-significant-bit first and padded to width', () => {
    expect(bits(0b101, 6)).toBe('000101');
    expect(bits(0, 4)).toBe('0000');
    expect(bits(15, 4)).toBe('1111');
  });
});
