/**
 * Simon's algorithm (Simon, FOCS 1994 / SICOMP 1997), one round at a time.
 *
 * One round is four steps and exactly ONE oracle query:
 *
 *   1. H⊗ⁿ on the input register   — every input at once, amplitude 2^(-n/2)
 *   2. U_f                          — the single query; input and output entangle
 *   3. (read the output register)   — collapses to the inputs sharing that value
 *   4. H⊗ⁿ again, then measure      — interference; every y with y·s = 1 cancels
 *
 * Step 4 is the algorithm. For a 2-to-1 function with period s, step 3 leaves
 * (|x₀⟩ + |x₀⊕s⟩)/√2, and the final Hadamard sends that to
 *
 *   Σ_y (−1)^(x₀·y) · (1 + (−1)^(s·y)) / √(2^(n+1)) · |y⟩
 *
 * where the bracket is 2 when s·y = 0 and 0 when s·y = 1. Half the outcomes are
 * annihilated. Every measurement is therefore a free linear equation about s,
 * and n−1 independent ones pin it down.
 *
 * Each round is returned with the intermediate states attached, because the
 * intermediate states are the lesson.
 */

import { dot } from '../math/gf2';
import {
  applyOracle,
  hadamardAllInputs,
  inputAmplitudes,
  inputMarginal,
  measureInput,
  measureOutput,
  zeroState,
  type QuantumState,
} from './statevector';

export interface SimonRound {
  /** Input register width. */
  n: number;
  /** The value seen when the output register was read. */
  observedOutput: number;
  /** Inputs consistent with that output — the surviving superposition. */
  preimage: number[];
  /**
   * Input-register amplitudes just BEFORE the final Hadamard: a flat, equal
   * superposition over `preimage`, zero everywhere else.
   */
  amplitudesBeforeFinalH: Float64Array;
  /**
   * Input-register amplitudes just AFTER the final Hadamard. The zeros in here
   * are the interference — this array is the headline of the whole demo.
   */
  amplitudesAfterFinalH: Float64Array;
  /** Measurement probability of each y — the square of the row above. */
  probabilities: Float64Array;
  /** The y actually measured this round. */
  measured: number;
}

/**
 * Run one full round of Simon's algorithm against `table`, an oracle for f.
 *
 * `u1` and `u2` are the two uniform randoms the two measurements consume,
 * passed in so the routine stays pure and the test suite can drive exact
 * outcomes.
 */
export function simonRound(table: Uint32Array, n: number, m: number, u1: number, u2: number): SimonRound {
  let state: QuantumState = zeroState(n, m);

  hadamardAllInputs(state); // step 1
  applyOracle(state, table); // step 2 — the one and only query

  const collapsed = measureOutput(state, u1); // step 3
  state = collapsed.state;

  const before = inputAmplitudes(state, collapsed.value);
  const preimage: number[] = [];
  for (let x = 0; x < 1 << n; x++) if (table[x] === collapsed.value) preimage.push(x);

  hadamardAllInputs(state); // step 4
  const after = inputAmplitudes(state, collapsed.value);
  const probabilities = inputMarginal(state);
  const measured = measureInput(state, u2);

  return {
    n,
    observedOutput: collapsed.value,
    preimage,
    amplitudesBeforeFinalH: before,
    amplitudesAfterFinalH: after,
    probabilities,
    measured,
  };
}

/**
 * The exact measurement distribution of one Simon round, without sampling.
 *
 * Used by the tests and by the "what the algorithm is really doing" panel, and
 * it is how the demo can state — rather than hope — that every high-probability
 * outcome is orthogonal to the period.
 */
export function simonDistribution(table: Uint32Array, n: number, m: number): Float64Array {
  const state = zeroState(n, m);
  hadamardAllInputs(state);
  applyOracle(state, table);
  hadamardAllInputs(state);
  return inputMarginal(state);
}

/**
 * Total probability mass sitting on outcomes that are NOT orthogonal to `s` —
 * i.e. the chance a round hands back a vector that would corrupt the linear
 * system.
 *
 * For any f with f(x) = f(x ⊕ s) everywhere this is exactly zero, promise or no
 * promise: each preimage class is a union of s-cosets, so every y with y·s = 1
 * cancels term for term. Accidental collisions skew *which* orthogonal vectors
 * turn up (that is the real cost, and it is visible in simonDistribution),
 * never whether they are orthogonal. This function measures that rather than
 * assuming it, so the claim on the page is checked against the live target
 * instead of quoted. It is non-zero only when `s` is not a period of the table
 * at all.
 */
export function offPeriodMass(table: Uint32Array, n: number, m: number, s: number): number {
  const probs = simonDistribution(table, n, m);
  let mass = 0;
  for (let y = 0; y < 1 << n; y++) if (dot(y, s) === 1) mass += probs[y];
  return mass;
}

/**
 * Check a claimed period against the function itself, over the whole domain.
 *
 * This is the demo's fail-closed rule: a period is never reported as recovered
 * on the strength of the linear algebra alone. Simon's algorithm is Las Vegas —
 * it can return a wrong answer, and the answer is cheap to check, so it is
 * always checked.
 */
export interface PeriodVerdict {
  /** f(x) = f(x ⊕ s) for every x in the domain. */
  holds: boolean;
  /** How many of the 2^n inputs satisfy it. */
  matches: number;
  /** Total inputs tested. */
  total: number;
  /** The first x where it fails, or null. */
  firstFailure: { x: number; fx: number; fxs: number } | null;
}

export function verifyPeriod(table: Uint32Array, n: number, s: number): PeriodVerdict {
  const total = 1 << n;
  let matches = 0;
  let firstFailure: PeriodVerdict['firstFailure'] = null;
  for (let x = 0; x < total; x++) {
    const fx = table[x];
    const fxs = table[x ^ s];
    if (fx === fxs) matches++;
    else if (!firstFailure) firstFailure = { x, fx, fxs };
  }
  return { holds: matches === total && s !== 0, matches, total, firstFailure };
}

/**
 * How far the oracle is from Simon's textbook promise.
 *
 * The promise is that f is exactly 2-to-1 with f(x) = f(y) ⟺ y = x ⊕ s. Real
 * constructions collide by accident on top of that. `irregularInputs / 2^n` is
 * the probability that a round starts from a superposition wider than two terms,
 * because reading the output register returns a value with probability equal to
 * its preimage's share of the domain.
 *
 * A wider superposition is NOT where a non-orthogonal measurement comes from —
 * see `offPeriodMass`, which is exactly zero whenever s is a period at all. An
 * oversized class is still a union of s-cosets, so every y with y·s = 1 still
 * cancels. What it costs is uniformity: the surviving outcomes stop being spread
 * evenly over s⊥, so more rounds are needed to reach rank n−1.
 */
export interface PromiseReport {
  /** Distinct output values, and the size distribution of their preimages. */
  classSizes: Map<number, number>;
  /** Inputs whose preimage class is not of size 2. */
  irregularInputs: number;
  /** True when the function is exactly 2-to-1 with the given period. */
  exact: boolean;
}

export function promiseReport(table: Uint32Array, n: number, s: number): PromiseReport {
  const counts = new Map<number, number>();
  for (let x = 0; x < 1 << n; x++) counts.set(table[x], (counts.get(table[x]) ?? 0) + 1);

  const classSizes = new Map<number, number>();
  let irregularInputs = 0;
  for (const size of counts.values()) {
    classSizes.set(size, (classSizes.get(size) ?? 0) + 1);
    if (size !== 2) irregularInputs += size;
  }
  const expected = s === 0 ? 1 : 2;
  return { classSizes, irregularInputs, exact: irregularInputs === 0 && expected === 2 };
}
