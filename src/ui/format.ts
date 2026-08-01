/**
 * Presentation helpers. Kept separate from the DOM so they can be tested, and
 * because every one of them is a place where a demo can quietly start lying —
 * rounding a probability to something prettier than it is, or printing an
 * equation that does not match the vector it came from.
 */

const SUBSCRIPTS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/** Render a non-negative integer as Unicode subscript digits. */
export function subscript(i: number): string {
  return String(i)
    .split('')
    .map((d) => SUBSCRIPTS[Number(d)])
    .join('');
}

/**
 * The linear equation a measured vector encodes, written out in full.
 *
 * y = 101101 over 6 bits means bits 5, 3, 2 and 0 of s are selected, so the
 * equation is s₅ ⊕ s₃ ⊕ s₂ ⊕ s₀ = 0. The all-zero vector encodes 0 = 0, which
 * is true of every s and therefore says nothing — the UI labels it as such
 * rather than hiding it, because a wasted query is part of the cost.
 */
export function equationText(y: number, n: number): string {
  const terms: string[] = [];
  for (let i = n - 1; i >= 0; i--) if ((y >>> i) & 1) terms.push(`s${subscript(i)}`);
  if (terms.length === 0) return '0 = 0';
  return `${terms.join(' ⊕ ')} = 0`;
}

/** '+', '−' or '0' — the sign of an amplitude, with a zero tolerance. */
export function amplitudeSign(a: number, tolerance = 1e-12): '+' | '−' | '0' {
  if (Math.abs(a) < tolerance) return '0';
  return a > 0 ? '+' : '−';
}

/** A class name matching `amplitudeSign`, so colour and glyph never disagree. */
export function amplitudeClass(a: number, tolerance = 1e-12): 'pos' | 'neg' | 'zero' {
  const s = amplitudeSign(a, tolerance);
  return s === '0' ? 'zero' : s === '+' ? 'pos' : 'neg';
}

/** A probability as a percentage with one decimal, or an exact "0". */
export function formatProbability(p: number): string {
  if (p < 1e-12) return '0';
  return `${(p * 100).toFixed(1)}%`;
}

/** A mean query count: one decimal, because the trials are finite. */
export function formatMean(v: number): string {
  return v.toFixed(1);
}

/**
 * A large query count in the form a reader can weigh: exact below 10 000, and
 * a power-of-two shorthand above it. Used for the extrapolation copy.
 */
export function formatQueries(v: number): string {
  if (v < 10000) return Math.round(v).toLocaleString('en-US');
  const exp = Math.log2(v);
  return `≈ 2^${exp.toFixed(0)}`;
}

/**
 * The n-bit binary string of a value, most significant bit first — the same
 * order the equations and the matrix rows are printed in, so a reader can line
 * them up by eye.
 */
export function bits(value: number, n: number): string {
  let out = '';
  for (let i = n - 1; i >= 0; i--) out += (value >>> i) & 1 ? '1' : '0';
  return out;
}

/** Pluralise a count without the "1 items" tell. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
