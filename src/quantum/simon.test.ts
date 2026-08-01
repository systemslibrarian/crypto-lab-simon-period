import { describe, expect, it } from 'vitest';
import { dot } from '../math/gf2';
import { offPeriodMass, promiseReport, simonDistribution, simonRound, verifyPeriod } from './simon';
import { applyOracle, hadamardAllInputs, inputMarginal, measureOutput, zeroState } from './statevector';

/** A function satisfying Simon's promise exactly, with the given period. */
function textbookOracle(n: number, s: number): Uint32Array {
  const table = new Uint32Array(1 << n);
  const label = new Map<number, number>();
  let next = 0;
  for (let x = 0; x < 1 << n; x++) {
    const rep = Math.min(x, x ^ s);
    if (!label.has(rep)) label.set(rep, next++);
    table[x] = label.get(rep)!;
  }
  return table;
}

describe('Simon KAT — the measurement distribution (Simon 1997, §4)', () => {
  it('is exactly uniform over s⊥ and exactly zero elsewhere, for every n and every s', () => {
    for (let n = 2; n <= 6; n++) {
      for (let s = 1; s < 1 << n; s++) {
        const probs = simonDistribution(textbookOracle(n, s), n, n);
        const expected = Math.pow(2, -(n - 1)); // 2^(n-1) surviving outcomes
        for (let y = 0; y < 1 << n; y++) {
          if (dot(y, s) === 0) expect(probs[y]).toBeCloseTo(expected, 12);
          else expect(probs[y]).toBeCloseTo(0, 14);
        }
      }
    }
  });

  it('leaves the algorithm no information when the outcome is y = 0', () => {
    // y = 0 is orthogonal to everything, so it is a legal outcome with the same
    // probability as any other — and it teaches nothing. This is why the query
    // count is n-1 *plus a few*, not exactly n-1.
    const n = 5;
    const probs = simonDistribution(textbookOracle(n, 0b10110), n, n);
    expect(probs[0]).toBeCloseTo(Math.pow(2, -(n - 1)), 12);
  });
});

describe('Simon KAT — the interference amplitudes', () => {
  it('matches (−1)^(x₀·y)·(1 + (−1)^(s·y)) / √(2^(n+1)) term for term', () => {
    const n = 4;
    const s = 0b1011;
    const table = textbookOracle(n, s);

    const state = zeroState(n, n);
    hadamardAllInputs(state);
    applyOracle(state, table);
    const { value, state: collapsed } = measureOutput(state, 0.31);

    // Recover x₀: the smaller of the two inputs mapping to the observed value.
    const preimage = [...table.keys()].filter((x) => table[x] === value);
    expect(preimage).toHaveLength(2);
    const x0 = preimage[0];

    hadamardAllInputs(collapsed);
    const outSize = 1 << n;
    const norm = Math.pow(2, -(n + 1) / 2);
    for (let y = 0; y < 1 << n; y++) {
      const sign = dot(x0, y) === 0 ? 1 : -1;
      const bracket = 1 + (dot(s, y) === 0 ? 1 : -1);
      const expected = norm * sign * bracket;
      expect(collapsed.amp[y * outSize + value]).toBeCloseTo(expected, 12);
    }
  });

  it('cancels exactly half the outcomes to machine zero', () => {
    const n = 6;
    const s = 0b101101;
    const round = simonRound(textbookOracle(n, s), n, n, 0.62, 0.5);
    const zeros = [...round.amplitudesAfterFinalH].filter((a) => Math.abs(a) < 1e-14).length;
    expect(zeros).toBe(1 << (n - 1));
    expect(dot(round.measured, s)).toBe(0);
  });
});

describe('deferred measurement', () => {
  it('reading the output register changes nothing about the answer', () => {
    // The demo shows the collapsed 2-term superposition because it teaches, and
    // this is the check that showing it is not a lie: the input-register
    // distribution is identical either way.
    const n = 5;
    const s = 0b01101;
    const table = textbookOracle(n, s);

    const withoutMeasurement = simonDistribution(table, n, n);

    // With an intermediate measurement, averaged over every outcome weighted by
    // that outcome's probability.
    const state = zeroState(n, n);
    hadamardAllInputs(state);
    applyOracle(state, table);
    const averaged = new Float64Array(1 << n);
    const seen = new Set<number>();
    for (let x = 0; x < 1 << n; x++) {
      const v = table[x];
      if (seen.has(v)) continue;
      seen.add(v);
      const fresh = zeroState(n, n);
      hadamardAllInputs(fresh);
      applyOracle(fresh, table);
      // Collapse onto this specific outcome and weight by its probability.
      const outSize = 1 << n;
      let norm = 0;
      for (let xx = 0; xx < 1 << n; xx++) norm += fresh.amp[xx * outSize + v] ** 2;
      const collapsed = zeroState(n, n);
      collapsed.amp.fill(0);
      for (let xx = 0; xx < 1 << n; xx++) {
        collapsed.amp[xx * outSize + v] = fresh.amp[xx * outSize + v] / Math.sqrt(norm);
      }
      hadamardAllInputs(collapsed);
      const marg = inputMarginal(collapsed);
      for (let y = 0; y < 1 << n; y++) averaged[y] += norm * marg[y];
    }
    for (let y = 0; y < 1 << n; y++) expect(averaged[y]).toBeCloseTo(withoutMeasurement[y], 12);
  });
});

describe('measurements are always orthogonal to a genuine period', () => {
  it('holds even when f has extra collisions beyond the promise', () => {
    // Whenever f(x) = f(x ⊕ s) for all x, every preimage class is a union of
    // s-cosets — so the (1 + (−1)^(s·y)) factor is present in every term and
    // every off-period outcome still cancels. Accidental collisions skew *which*
    // orthogonal vectors turn up, never whether they are orthogonal. This is the
    // precise reason the attack survives real constructions.
    const n = 5;
    const s = 0b10011;
    const table = new Uint32Array(1 << n);
    const label = new Map<number, number>();
    let next = 0;
    for (let x = 0; x < 1 << n; x++) {
      const rep = Math.min(x, x ^ s);
      if (!label.has(rep)) label.set(rep, next++);
      table[x] = label.get(rep)!;
    }
    // Deliberately merge two cosets: an accidental collision on top of the period.
    for (let x = 0; x < 1 << n; x++) if (table[x] === 3) table[x] = 1;

    expect(promiseReport(table, n, s).exact).toBe(false);
    expect(offPeriodMass(table, n, n, s)).toBeCloseTo(0, 14);

    const probs = simonDistribution(table, n, n);
    // The distribution is no longer uniform — that is the real cost.
    const live = [...probs].filter((p) => p > 1e-14);
    expect(new Set(live.map((p) => p.toFixed(6))).size).toBeGreaterThan(1);
  });
});

describe('an injective f has nothing to find', () => {
  it('spreads the measurement uniformly over all 2ⁿ outcomes', () => {
    const n = 4;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = (x * 7 + 5) & 15; // a permutation
    const probs = simonDistribution(table, n, n);
    for (let y = 0; y < 1 << n; y++) expect(probs[y]).toBeCloseTo(Math.pow(2, -n), 12);
  });
});

describe('verifyPeriod is the fail-closed gate', () => {
  it('accepts the true period and rejects everything else', () => {
    const n = 4;
    const s = 0b0110;
    const table = textbookOracle(n, s);
    expect(verifyPeriod(table, n, s).holds).toBe(true);
    expect(verifyPeriod(table, n, s).matches).toBe(1 << n);
    for (let c = 1; c < 1 << n; c++) {
      if (c === s) continue;
      const v = verifyPeriod(table, n, c);
      expect(v.holds).toBe(false);
      expect(v.firstFailure).not.toBeNull();
    }
  });

  it('never accepts s = 0, which every function trivially satisfies', () => {
    const table = textbookOracle(4, 0b1001);
    const v = verifyPeriod(table, 4, 0);
    expect(v.matches).toBe(16);
    expect(v.holds).toBe(false);
  });
});
