/**
 * The classical side of the comparison, actually run rather than plotted.
 *
 * It would be easy — and dishonest — to draw a 2^(n/2) curve next to an O(n)
 * curve and call it a comparison. Instead both sides here are *measured*: the
 * classical attacker runs a real birthday collision search against the same
 * oracle table the quantum circuit queries, and the quantum side runs complete
 * Simon rounds through the statevector simulator. Both count oracle queries the
 * same way. The gap on screen is a measurement, not an assertion.
 */

import { insert, newSystem, candidatePeriods, type Gf2System } from '../math/gf2';
import { simonRound, verifyPeriod } from '../quantum/simon';

/** mulberry32 — a small, seedable PRNG so every measured figure reproduces. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClassicalRun {
  /** Oracle queries spent. */
  queries: number;
  /** The period found, or null if the domain was exhausted without one. */
  period: number | null;
}

/**
 * The best generic classical attack: query f at random points, remember every
 * output, and stop when one repeats. A repeat f(x) = f(x') gives the candidate
 * x ⊕ x', which is then verified against the function.
 *
 * This is a birthday search over 2^(n-1) preimage classes, so it costs ~2^(n/2)
 * queries — and no classical algorithm does better against a black box, which
 * is the lower bound Simon's paper proves.
 */
export function classicalPeriodSearch(table: Uint32Array, n: number, rng: () => number): ClassicalRun {
  const size = 1 << n;
  const seen = new Map<number, number>(); // output value → the input that produced it
  const queried = new Set<number>();
  let queries = 0;

  while (queried.size < size) {
    let x = Math.floor(rng() * size);
    if (queried.has(x)) {
      // Sample without replacement: repeating a query buys nothing, and a real
      // attacker would not pay for it.
      let probe = x;
      let found = false;
      for (let i = 0; i < size; i++) {
        probe = (probe + 1) % size;
        if (!queried.has(probe)) {
          x = probe;
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    queried.add(x);
    queries++;

    const value = table[x];
    const prev = seen.get(value);
    if (prev !== undefined) {
      const candidate = prev ^ x;
      // Verification is free for the demo but is itself 2^n work; the query
      // count reported is the search cost, which is the quantity being compared.
      if (candidate !== 0 && verifyPeriod(table, n, candidate).holds) {
        return { queries, period: candidate };
      }
      // An accidental collision that is not the period — keep going.
    } else {
      seen.set(value, x);
    }
  }
  return { queries, period: null };
}

export interface QuantumRun {
  /** Oracle queries spent — one per Simon round. */
  queries: number;
  /** Rounds whose measurement was linearly dependent on earlier ones. */
  wasted: number;
  /** The period found, or null. */
  period: number | null;
  /** The measurements, in order. */
  vectors: number[];
  /** Candidates the linear system named that f then refused to confirm. */
  rejected: number[];
  /** True when the rank reached n, which *proves* no period exists. */
  provedNoPeriod: boolean;
}

/**
 * Simon's algorithm run to completion: measure, insert into the GF(2) system,
 * and the moment exactly one non-zero candidate survives, check it against f.
 *
 * A candidate that fails the check is not a failure of the run — it is
 * information. It means f has no period in that direction, so the loop keeps
 * measuring; more vectors push the rank higher, and rank n is a *proof* that no
 * period exists. The demo therefore has three honest outcomes rather than two:
 * period found and verified, no period (proved), or out of budget.
 *
 * `maxRounds` is a hard stop, not part of the algorithm.
 */
export function quantumPeriodSearch(
  table: Uint32Array,
  n: number,
  m: number,
  rng: () => number,
  maxRounds = 16 * n,
): QuantumRun {
  let sys: Gf2System = newSystem(n);
  let queries = 0;
  let wasted = 0;
  const vectors: number[] = [];
  const rejected: number[] = [];

  for (let r = 0; r < maxRounds; r++) {
    const round = simonRound(table, n, m, rng(), rng());
    queries++;
    vectors.push(round.measured);
    const res = insert(sys, round.measured);
    if (!res.accepted) wasted++;
    sys = res.system;

    const candidates = candidatePeriods(sys);
    if (candidates.length === 0) {
      return { queries, wasted, period: null, vectors, rejected, provedNoPeriod: true };
    }
    if (candidates.length === 1) {
      const s = candidates[0];
      if (verifyPeriod(table, n, s).holds) {
        return { queries, wasted, period: s, vectors, rejected, provedNoPeriod: false };
      }
      if (!rejected.includes(s)) rejected.push(s);
    }
  }
  return { queries, wasted, period: null, vectors, rejected, provedNoPeriod: false };
}

export interface RaceRow {
  n: number;
  quantumMean: number;
  classicalMean: number;
  trials: number;
  /** 2^(n/2) — the textbook birthday bound, for reference. */
  birthdayBound: number;
}

/**
 * Run both attacks `trials` times against freshly built oracles and average the
 * query counts. `build` returns a new oracle table per trial so the averages are
 * over functions, not over one lucky function.
 */
export function runRace(
  n: number,
  m: number,
  build: (trial: number) => Uint32Array,
  trials: number,
  seed = 0x5100de,
): RaceRow {
  const rng = makeRng(seed ^ (n << 8));
  let q = 0;
  let c = 0;
  for (let t = 0; t < trials; t++) {
    const table = build(t);
    q += quantumPeriodSearch(table, n, m, rng).queries;
    c += classicalPeriodSearch(table, n, rng).queries;
  }
  return {
    n,
    quantumMean: q / trials,
    classicalMean: c / trials,
    trials,
    birthdayBound: Math.pow(2, n / 2),
  };
}
