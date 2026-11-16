import { describe, expect, it } from 'vitest';
import { dot } from '../math/gf2';
import { verifyPeriod } from '../quantum/simon';
import { classicalPeriodSearch, makeRng, quantumPeriodSearch, runRace } from './race';

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

describe('the seeded RNG', () => {
  it('is deterministic and stays in [0,1)', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 500; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('the classical birthday search', () => {
  it('finds the period, and every query it counts is a distinct input', () => {
    const rng = makeRng(1);
    for (let n = 4; n <= 6; n++) {
      for (let trial = 0; trial < 20; trial++) {
        const s = 1 + Math.floor(rng() * ((1 << n) - 1));
        const table = textbookOracle(n, s);
        const run = classicalPeriodSearch(table, n, rng);
        expect(run.period).toBe(s);
        expect(run.queries).toBeLessThanOrEqual(1 << n);
        expect(run.queries).toBeGreaterThan(1);
      }
    }
  });

  it('returns no period for an injective function, having spent the whole domain', () => {
    const n = 5;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = (x * 7 + 1) & 31;
    const run = classicalPeriodSearch(table, n, makeRng(3));
    expect(run.period).toBeNull();
    expect(run.queries).toBe(1 << n);
  });

  it('costs about √(π/2 · 2ⁿ) distinct queries — the birthday scale', () => {
    // What this measures is the number of DISTINCT inputs read until a
    // candidate verified as the period. Inputs are sampled without replacement
    // (race.ts), so two draws collide only when they are partners — odds
    // 1/(2^n − 1), not 1/2^(n-1) — and the expectation is √(π/2 · 2^n), not
    // √(π/2 · 2^(n-1)). Computed exactly, the mean number of draws until some
    // pair {x, x ⊕ s} is complete is 5.09, 7.14 and 10.07 at n = 4, 5, 6;
    // √(π/2 · 2^n) gives 5.01, 7.09 and 10.03, while √(π/2 · 2^(n-1)) gives
    // 3.54, 5.01 and 7.09 — low by a factor of √2.
    //
    // The window is ±15%, which the old ×0.6/×1.8 one was far too loose to
    // notice: at n = 6 it admitted everything from 4.3 to 12.8, so both
    // formulae and 2^(n/2) = 8.0 passed it. The measured means below are
    // 5.12, 7.32 and 10.00 — all within 4% of the formula.
    for (const n of [4, 5, 6]) {
      const rng = makeRng(99);
      let total = 0;
      const trials = 400;
      for (let t = 0; t < trials; t++) {
        const s = 1 + Math.floor(rng() * ((1 << n) - 1));
        total += classicalPeriodSearch(textbookOracle(n, s), n, rng).queries;
      }
      const mean = total / trials;
      const expected = Math.sqrt((Math.PI / 2) * Math.pow(2, n));
      expect(mean, `n=${n}: mean ${mean.toFixed(2)} vs √(π/2·2ⁿ) = ${expected.toFixed(2)}`).toBeGreaterThan(expected * 0.85);
      expect(mean, `n=${n}: mean ${mean.toFixed(2)} vs √(π/2·2ⁿ) = ${expected.toFixed(2)}`).toBeLessThan(expected * 1.15);
    }
  });
});

describe('the quantum search', () => {
  it('recovers the period of every textbook oracle it is given', () => {
    const rng = makeRng(11);
    for (let n = 4; n <= 6; n++) {
      for (let s = 1; s < 1 << n; s++) {
        const table = textbookOracle(n, s);
        const run = quantumPeriodSearch(table, n, n, rng);
        expect(run.period).toBe(s);
        expect(verifyPeriod(table, n, run.period!).holds).toBe(true);
        for (const v of run.vectors) expect(dot(v, s)).toBe(0);
      }
    }
  });

  it('costs on the order of n queries, not 2^(n/2)', () => {
    const rng = makeRng(5);
    const trials = 300;
    for (const n of [4, 5, 6]) {
      let total = 0;
      for (let t = 0; t < trials; t++) {
        const s = 1 + Math.floor(rng() * ((1 << n) - 1));
        total += quantumPeriodSearch(textbookOracle(n, s), n, n, rng).queries;
      }
      const mean = total / trials;
      // n-1 independent vectors are needed; the wasted draws (repeats and y = 0)
      // add a small constant, and the expected total sits just above n.
      expect(mean).toBeGreaterThan(n - 1);
      expect(mean).toBeLessThan(n + 3);
    }
  });

  it('counts the measurements that taught it nothing', () => {
    const rng = makeRng(2);
    let sawWaste = 0;
    for (let t = 0; t < 200; t++) {
      const run = quantumPeriodSearch(textbookOracle(5, 0b10110), 5, 5, rng);
      expect(run.queries).toBe(run.vectors.length);
      expect(run.wasted).toBeLessThan(run.queries);
      if (run.wasted > 0) sawWaste++;
    }
    // y = 0 and repeats happen often enough that the UI's "this one told us
    // nothing new" state is reachable, which is why the demo shows it.
    expect(sawWaste).toBeGreaterThan(20);
  });
});

describe('the measured race', () => {
  it('shows quantum flat in n while classical grows exponentially', () => {
    // Seeded, because the period was drawn from an unseeded Math.random() while
    // runRace seeds everything else. That one call was the only thing making
    // this test irreproducible, and it is what turned the marginal assertion
    // below into a roughly 1-in-10 failure nobody could re-run.
    const rows = [4, 5, 6].map((n) => {
      const rng = makeRng(0xc0ffee + n);
      return runRace(n, n, () => textbookOracle(n, 1 + Math.floor(rng() * ((1 << n) - 1))), 60);
    });
    for (const r of rows) {
      expect(r.quantumMean).toBeLessThan(r.n + 4);
    }
    // The separation is only real once the birthday bound clears Simon's ~n+O(1).
    // At n = 4 the two costs are the same size — classical ~sqrt(pi*2^4/2) ~ 5,
    // quantum ~ 5 — so asserting "classical > quantum" there asserted something
    // that is not reliably true, and it failed on the observed run at 4.717 vs
    // 4.733. That n = 4 shows no separation yet is the honest result, and it is
    // part of the lesson: an exponential only outruns a linear once n is big
    // enough. The growth-ratio assertions below are what carry the real claim.
    for (const r of rows.filter((row) => row.n >= 5)) {
      expect(r.classicalMean).toBeGreaterThan(r.quantumMean);
    }
    // Classical cost must grow with n; quantum must not blow up.
    expect(rows[2].classicalMean / rows[0].classicalMean).toBeGreaterThan(1.4);
    expect(rows[2].quantumMean / rows[0].quantumMean).toBeLessThan(1.8);
  });
});
