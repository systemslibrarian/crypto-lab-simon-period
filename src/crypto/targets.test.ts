import { describe, expect, it } from 'vitest';
import { candidatePeriods, dot, insert, newSystem } from '../math/gf2';
import { offPeriodMass, promiseReport, simonDistribution, verifyPeriod } from '../quantum/simon';
import { makeRng, quantumPeriodSearch } from '../classical/race';
import {
  makeCbcMacTarget,
  makeEvenMansourTarget,
  makeNoPeriodTarget,
  makeTarget,
  makeTextbookTarget,
  TARGET_IDS,
} from './targets';

describe('every target is a well-formed oracle', () => {
  it('has a table covering the domain with values inside the output register', async () => {
    for (const id of TARGET_IDS) {
      for (let n = 4; n <= 6; n++) {
        const t = await makeTarget(id, n);
        expect(t.table).toHaveLength(1 << n);
        for (let x = 0; x < 1 << n; x++) {
          expect(t.table[x]).toBeLessThan(1 << t.m);
        }
      }
    }
  });

  it('reports its true period accurately, or honestly reports none', async () => {
    for (const id of TARGET_IDS) {
      for (let n = 4; n <= 6; n++) {
        const t = await makeTarget(id, n);
        if (t.truePeriod === null) {
          for (let s = 1; s < 1 << n; s++) expect(verifyPeriod(t.table, n, s).holds).toBe(false);
        } else {
          expect(verifyPeriod(t.table, n, t.truePeriod).holds).toBe(true);
        }
      }
    }
  });
});

describe('KAT — Kuwakado & Morii 2012: Even-Mansour’s period is the whitening key', () => {
  it('f(x) = E(x) ⊕ P(x) has period exactly k₁, for every n and every key', async () => {
    for (let n = 4; n <= 6; n++) {
      for (let trial = 0; trial < 12; trial++) {
        const t = await makeEvenMansourTarget(n);
        const k1 = t.truePeriod!;
        expect(k1).not.toBe(0);
        // The paper's claim, checked over the entire domain.
        for (let x = 0; x < 1 << n; x++) expect(t.table[x]).toBe(t.table[x ^ k1]);
      }
    }
  });

  it('recovering the period yields both key halves and predicts a fresh block', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const t = await makeEvenMansourTarget(5);
      const res = t.exploit(t.truePeriod!);
      expect(res.ok).toBe(true);
      expect(res.rows.every((r) => r.match !== 'bad')).toBe(true);
    }
  });

  it('never claims to predict the one block it already spent a classical query on', async () => {
    // k₂ is derived from E(0), so block 0 is queried, not predicted. The
    // challenge used to be (k₁ ^ 0b1011) unconditionally, which lands on 0
    // whenever k₁ = 0b1011 — one key in fifteen at n = 4. Exhaustive over every
    // possible k₁ at n = 4, then sampled at 5 and 6.
    for (let n = 4; n <= 6; n++) {
      const zero = '0'.repeat(n);
      for (let trial = 0; trial < (n === 4 ? 60 : 20); trial++) {
        const t = await makeEvenMansourTarget(n);
        const res = t.exploit(t.truePeriod!);
        expect(res.ok).toBe(true);
        for (const row of res.rows) {
          expect(row.label).not.toBe(`predicted E(${zero})`);
          expect(row.label).not.toBe(`real E(${zero})`);
        }
      }
    }
  });

  it('a wrong period does not yield the key — the exploit fails closed', async () => {
    // Exhaustive over the wrong periods, not a single sample.
    //
    // This used to take one wrong period, k₁ ⊕ 1, and check one predicted
    // block. It failed about 1 run in 6 and read as a flaky test; the real
    // problem was that a one-block check is not sound. With p = k₁ ⊕ 2^b,
    // challenge 2^b agrees for EVERY key and every permutation, because both
    // sides reduce to the same expression — measured, that challenge accepted
    // the wrong period in 3000 of 3000 trials. `exploit` now decides `ok` by
    // sweeping all 2^n blocks, so this can assert the real security property:
    // no wrong period is ever accepted.
    for (let trial = 0; trial < 8; trial++) {
      const t = await makeEvenMansourTarget(5);
      for (let wrong = 0; wrong < 32; wrong++) {
        if (wrong === t.truePeriod!) continue;
        const res = t.exploit(wrong);
        expect(res.ok).toBe(false);
        // k₂guess = E(0) ⊕ P(period) is injective in `period` because P is a
        // permutation, so a wrong period never derives the right k₂ either.
        expect(res.rows[1].match).toBe('bad');
      }
      // The true period still succeeds, and on every block.
      expect(t.exploit(t.truePeriod!).ok).toBe(true);
    }
  });

  it('measurements stay orthogonal to k₁ even though f is not exactly 2-to-1', async () => {
    // Even-Mansour's f collides by accident on top of its period. Those extra
    // collisions merge whole cosets, so the interference still kills every
    // non-orthogonal outcome — the mass off s⊥ is exactly zero.
    let sawIrregular = false;
    for (let trial = 0; trial < 12; trial++) {
      const t = await makeEvenMansourTarget(6);
      const rep = promiseReport(t.table, 6, t.truePeriod!);
      if (!rep.exact) sawIrregular = true;
      expect(offPeriodMass(t.table, 6, t.m, t.truePeriod!)).toBeCloseTo(0, 13);
    }
    // At n = 6 the birthday odds make accidental collisions near-certain; this
    // asserts the demo's honesty note describes something real.
    expect(sawIrregular).toBe(true);
  });
});

describe('KAT — Kaplan et al. 2016: CBC-MAC has an affine period', () => {
  it('f(b, m) = MAC(α_b ‖ m) has period (1 ‖ Δ)', async () => {
    for (let n = 4; n <= 6; n++) {
      for (let trial = 0; trial < 12; trial++) {
        const t = await makeCbcMacTarget(n);
        const s = t.truePeriod!;
        // The period must move the selector bit — that is what makes it a
        // cross-message forgery rather than a message-internal collision.
        expect((s >>> (n - 1)) & 1).toBe(1);
        for (let x = 0; x < 1 << n; x++) expect(t.table[x]).toBe(t.table[x ^ s]);
      }
    }
  });

  it('is exactly 2-to-1, unlike Even-Mansour', async () => {
    for (let trial = 0; trial < 10; trial++) {
      const t = await makeCbcMacTarget(6);
      expect(promiseReport(t.table, 6, t.truePeriod!).exact).toBe(true);
      const probs = simonDistribution(t.table, 6, t.m);
      // Exactly 2-to-1 ⇒ exactly uniform over s⊥.
      for (let y = 0; y < 64; y++) {
        if (dot(y, t.truePeriod!) === 0) expect(probs[y]).toBeCloseTo(Math.pow(2, -5), 12);
        else expect(probs[y]).toBeCloseTo(0, 13);
      }
    }
  });

  it('produces a forgery the real MAC accepts, on a message never queried', async () => {
    for (let trial = 0; trial < 20; trial++) {
      const t = await makeCbcMacTarget(6);
      const res = t.exploit(t.truePeriod!);
      expect(res.ok).toBe(true);
      expect(res.rows.every((r) => r.match !== 'bad')).toBe(true);
    }
  });

  it('rejects a period that does not carry the selector bit', async () => {
    const t = await makeCbcMacTarget(6);
    const withoutSelector = t.truePeriod! & 0b011111;
    expect(t.exploit(withoutSelector).ok).toBe(false);
  });
});

describe('the textbook target satisfies the promise exactly', () => {
  it('is 2-to-1 with a uniform distribution over s⊥', async () => {
    for (let n = 4; n <= 6; n++) {
      const t = await makeTextbookTarget(n);
      expect(promiseReport(t.table, n, t.truePeriod!).exact).toBe(true);
      const probs = simonDistribution(t.table, n, t.m);
      for (let y = 0; y < 1 << n; y++) {
        const expected = dot(y, t.truePeriod!) === 0 ? Math.pow(2, -(n - 1)) : 0;
        expect(probs[y]).toBeCloseTo(expected, 12);
      }
    }
  });
});

describe('the control target has no period, and the demo proves it rather than assuming', () => {
  it('is injective', async () => {
    const t = await makeNoPeriodTarget(6);
    expect(new Set(t.table).size).toBe(64);
  });

  it('drives the linear system to full rank, leaving zero candidates', async () => {
    const t = await makeNoPeriodTarget(5);
    const run = quantumPeriodSearch(t.table, 5, t.m, makeRng(7));
    expect(run.period).toBeNull();
    let sys = newSystem(5);
    for (const v of run.vectors) sys = insert(sys, v).system;
    expect(candidatePeriods(sys)).toEqual([]);
  });

  it('exhaustively confirms no period exists', async () => {
    const t = await makeNoPeriodTarget(5);
    const res = t.exploit(0);
    expect(res.ok).toBe(true);
  });
});

describe('end to end: Simon recovers the period of every periodic target', () => {
  it('succeeds on all three, at every supported width', async () => {
    const rng = makeRng(0xc0ffee);
    for (const id of ['even-mansour', 'cbc-mac', 'textbook'] as const) {
      for (let n = 4; n <= 6; n++) {
        for (let trial = 0; trial < 6; trial++) {
          const t = await makeTarget(id, n);
          const run = quantumPeriodSearch(t.table, n, t.m, rng);
          expect(run.period).toBe(t.truePeriod);
          expect(t.exploit(run.period!).ok).toBe(true);
        }
      }
    }
  });
});
