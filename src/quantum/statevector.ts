/**
 * An exact statevector simulator, big enough for Simon's algorithm on 4–6 bits.
 *
 * Nothing here is a shortcut. The demo could have cheated — the output
 * distribution of Simon's algorithm on a perfectly 2-to-1 function is uniform
 * over s⊥, so you can "simulate" the whole thing with one line of sampling
 * code. That line would also lie, because the constructions this demo actually
 * attacks (Even-Mansour) do *not* satisfy the promise exactly: they have
 * accidental collisions, the true distribution is skewed, and the algorithm
 * occasionally returns a vector that is not orthogonal to the period. Only a
 * real amplitude-level simulation reproduces that, so that is what this is.
 *
 * Amplitudes are real. Simon's circuit is Hadamards plus an XOR oracle, and
 * both matrices are real, so no imaginary part is ever populated. Storing one
 * Float64Array instead of two halves the memory and makes the interference
 * arithmetic on screen (+1 and −1 adding or cancelling) literally the numbers
 * in this array.
 *
 * Qubit indexing: the register is `n` input qubits and `m` output qubits, and a
 * basis state is indexed `x * 2^m + w` — input value x, output value w. That
 * layout keeps the oracle's action a contiguous stride and makes the input
 * marginal a simple row sum.
 */

export interface QuantumState {
  /** Input register width in qubits. */
  readonly n: number;
  /** Output register width in qubits. */
  readonly m: number;
  /** 2^(n+m) real amplitudes, indexed x * 2^m + w. */
  readonly amp: Float64Array;
}

const SQRT1_2 = Math.SQRT1_2;

/** |0…0⟩ ⊗ |0…0⟩ — the circuit's starting state. */
export function zeroState(n: number, m: number): QuantumState {
  const amp = new Float64Array(1 << (n + m));
  amp[0] = 1;
  return { n, m, amp };
}

/**
 * Apply a Hadamard to one input-register qubit, in place.
 *
 * H acts on each pair of basis states that differ only in that qubit:
 *   a' = (a + b)/√2 , b' = (a − b)/√2
 * The minus sign in the second line is the entire reason Simon's algorithm
 * works. It is what lets two paths to the same measurement outcome cancel.
 */
export function hadamardInput(state: QuantumState, qubit: number): void {
  const { n, m, amp } = state;
  if (qubit < 0 || qubit >= n) throw new Error(`input qubit ${qubit} out of range`);
  const outSize = 1 << m;
  const bit = 1 << qubit;

  for (let x = 0; x < 1 << n; x++) {
    if (x & bit) continue; // handle each pair once, from its lower member
    const xPartner = x | bit;
    const base = x * outSize;
    const partnerBase = xPartner * outSize;
    for (let w = 0; w < outSize; w++) {
      const a = amp[base + w];
      const b = amp[partnerBase + w];
      amp[base + w] = (a + b) * SQRT1_2;
      amp[partnerBase + w] = (a - b) * SQRT1_2;
    }
  }
}

/** H⊗ⁿ on the whole input register. */
export function hadamardAllInputs(state: QuantumState): void {
  for (let q = 0; q < state.n; q++) hadamardInput(state, q);
}

/**
 * The oracle U_f : |x⟩|w⟩ ↦ |x⟩|w ⊕ f(x)⟩.
 *
 * This is the only place the secret function is touched, and it is touched
 * exactly once per query — which is the whole point of a query-complexity
 * result. `table` is f evaluated over the entire input domain.
 */
export function applyOracle(state: QuantumState, table: Uint32Array): void {
  const { n, m, amp } = state;
  if (table.length !== 1 << n) throw new Error('oracle table has wrong length');
  const outSize = 1 << m;
  const next = new Float64Array(amp.length);

  for (let x = 0; x < 1 << n; x++) {
    const fx = table[x];
    if (fx >= outSize) throw new Error(`f(${x}) = ${fx} does not fit in ${m} bits`);
    const base = x * outSize;
    for (let w = 0; w < outSize; w++) {
      // XOR is an involution, so this is a permutation of basis states: the
      // oracle is unitary, and no amplitude is created or destroyed.
      next[base + (w ^ fx)] = amp[base + w];
    }
  }
  amp.set(next);
}

/** Probability of each input-register value, marginalising over the output. */
export function inputMarginal(state: QuantumState): Float64Array {
  const { n, m, amp } = state;
  const outSize = 1 << m;
  const probs = new Float64Array(1 << n);
  for (let x = 0; x < 1 << n; x++) {
    const base = x * outSize;
    let p = 0;
    for (let w = 0; w < outSize; w++) p += amp[base + w] * amp[base + w];
    probs[x] = p;
  }
  return probs;
}

/** Probability of each output-register value, marginalising over the input. */
export function outputMarginal(state: QuantumState): Float64Array {
  const { n, m, amp } = state;
  const outSize = 1 << m;
  const probs = new Float64Array(outSize);
  for (let x = 0; x < 1 << n; x++) {
    const base = x * outSize;
    for (let w = 0; w < outSize; w++) probs[w] += amp[base + w] * amp[base + w];
  }
  return probs;
}

/**
 * Measure the output register, collapsing the state and renormalising.
 *
 * Simon's algorithm does not need this step — by the deferred-measurement
 * principle the final input-register distribution is identical whether or not
 * the output register is ever read. The demo performs it anyway, because the
 * collapsed state is the one a learner can actually see: a superposition of
 * exactly the handful of inputs that share one output value, which for a
 * 2-to-1 function is the famous |x₀⟩ + |x₀ ⊕ s⟩. A unit test pins the claim
 * that measuring here changes nothing about the answer.
 */
export function measureOutput(state: QuantumState, u: number): { value: number; state: QuantumState } {
  const probs = outputMarginal(state);
  const value = sampleFrom(probs, u);
  const { n, m, amp } = state;
  const outSize = 1 << m;

  const collapsed = new Float64Array(amp.length);
  let norm = 0;
  for (let x = 0; x < 1 << n; x++) {
    const idx = x * outSize + value;
    collapsed[idx] = amp[idx];
    norm += amp[idx] * amp[idx];
  }
  const scale = 1 / Math.sqrt(norm);
  for (let i = 0; i < collapsed.length; i++) collapsed[i] *= scale;

  return { value, state: { n, m, amp: collapsed } };
}

/** Measure the input register. Returns the observed value. */
export function measureInput(state: QuantumState, u: number): number {
  return sampleFrom(inputMarginal(state), u);
}

/**
 * Inverse-CDF sampling from a probability vector, given a uniform u ∈ [0,1).
 * Taking `u` as an argument rather than calling a generator inside keeps every
 * quantum routine here a pure function — which is what makes the unit suite
 * able to assert on exact outcomes.
 */
export function sampleFrom(probs: Float64Array | number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (u < acc) return i;
  }
  // Floating-point crumbs at the top of the range: fall back to the last
  // outcome with non-zero probability rather than returning a zero-probability
  // one.
  for (let i = probs.length - 1; i >= 0; i--) if (probs[i] > 0) return i;
  return 0;
}

/** Total probability — should be 1 to within floating-point noise. */
export function totalProbability(state: QuantumState): number {
  let t = 0;
  for (let i = 0; i < state.amp.length; i++) t += state.amp[i] * state.amp[i];
  return t;
}

/** A copy, for code that wants to keep a snapshot of an intermediate state. */
export function cloneState(state: QuantumState): QuantumState {
  return { n: state.n, m: state.m, amp: new Float64Array(state.amp) };
}

/**
 * The input-register amplitudes of a state whose output register has already
 * been measured (so exactly one output column is populated).
 */
export function inputAmplitudes(state: QuantumState, outputValue: number): Float64Array {
  const { n, m, amp } = state;
  const outSize = 1 << m;
  const out = new Float64Array(1 << n);
  for (let x = 0; x < 1 << n; x++) out[x] = amp[x * outSize + outputValue];
  return out;
}
