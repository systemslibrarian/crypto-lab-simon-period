import { describe, expect, it } from 'vitest';
import {
  applyOracle,
  cloneState,
  hadamardAllInputs,
  hadamardInput,
  inputAmplitudes,
  inputMarginal,
  measureOutput,
  outputMarginal,
  sampleFrom,
  totalProbability,
  zeroState,
} from './statevector';

const NEAR = 1e-12;

describe('statevector basics', () => {
  it('starts in |0…0⟩ with total probability 1', () => {
    const s = zeroState(4, 4);
    expect(s.amp[0]).toBe(1);
    expect(totalProbability(s)).toBeCloseTo(1, 12);
  });

  it('Hadamard is its own inverse', () => {
    const s = zeroState(3, 2);
    // Seed a non-trivial state so the test is not just about |0⟩.
    s.amp[0] = 0.6;
    s.amp[5] = 0.8;
    const before = Float64Array.from(s.amp);
    hadamardInput(s, 1);
    hadamardInput(s, 1);
    for (let i = 0; i < before.length; i++) expect(s.amp[i]).toBeCloseTo(before[i], 12);
  });

  it('H⊗ⁿ on |0⟩ gives a uniform superposition of amplitude 2^(-n/2)', () => {
    const n = 5;
    const s = zeroState(n, 3);
    hadamardAllInputs(s);
    const expected = Math.pow(2, -n / 2);
    for (let x = 0; x < 1 << n; x++) {
      // Output register is still |0⟩, so all mass sits in column w = 0.
      expect(s.amp[x * 8]).toBeCloseTo(expected, 12);
    }
    expect(totalProbability(s)).toBeCloseTo(1, 12);
  });

  it('the oracle is unitary — it permutes basis states and preserves the norm', () => {
    const n = 4;
    const m = 4;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = (x * 7 + 3) & 15;
    const s = zeroState(n, m);
    hadamardAllInputs(s);
    const before = totalProbability(s);
    applyOracle(s, table);
    expect(totalProbability(s)).toBeCloseTo(before, 12);
    // Applying it twice is the identity, because XOR is an involution.
    const copy = cloneState(s);
    applyOracle(s, table);
    applyOracle(s, table);
    for (let i = 0; i < s.amp.length; i++) expect(s.amp[i]).toBeCloseTo(copy.amp[i], 12);
  });

  it('rejects an oracle value that does not fit the output register', () => {
    const s = zeroState(3, 2);
    const table = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]); // 3-bit values, 2-bit register
    expect(() => applyOracle(s, table)).toThrow();
  });

  it('rejects a table of the wrong length', () => {
    const s = zeroState(3, 3);
    expect(() => applyOracle(s, new Uint32Array(4))).toThrow();
  });

  it('rejects an out-of-range qubit index', () => {
    const s = zeroState(3, 3);
    expect(() => hadamardInput(s, 3)).toThrow();
    expect(() => hadamardInput(s, -1)).toThrow();
  });
});

describe('measurement', () => {
  it('marginals are probability distributions', () => {
    const n = 4;
    const m = 3;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = x % 8;
    const s = zeroState(n, m);
    hadamardAllInputs(s);
    applyOracle(s, table);
    const sum = (a: Float64Array) => a.reduce((t, v) => t + v, 0);
    expect(sum(inputMarginal(s))).toBeCloseTo(1, 12);
    expect(sum(outputMarginal(s))).toBeCloseTo(1, 12);
  });

  it('measuring the output register collapses to exactly its preimage', () => {
    const n = 4;
    const s = 0b1001;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = Math.min(x, x ^ s);
    const state = zeroState(n, n);
    hadamardAllInputs(state);
    applyOracle(state, table);

    const { value, state: after } = measureOutput(state, 0.4);
    expect(totalProbability(after)).toBeCloseTo(1, 12);

    const amps = inputAmplitudes(after, value);
    const support = [...amps.keys()].filter((x) => Math.abs(amps[x]) > NEAR);
    expect(support).toHaveLength(2);
    expect(support[0] ^ support[1]).toBe(s);
    // Equal weight on both, 1/√2 each.
    for (const x of support) expect(Math.abs(amps[x])).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('an injective oracle collapses to a single basis state', () => {
    const n = 4;
    const table = new Uint32Array(1 << n);
    for (let x = 0; x < 1 << n; x++) table[x] = (x * 3 + 1) & 15; // a permutation
    const state = zeroState(n, n);
    hadamardAllInputs(state);
    applyOracle(state, table);
    const { value, state: after } = measureOutput(state, 0.77);
    const amps = inputAmplitudes(after, value);
    const support = [...amps.keys()].filter((x) => Math.abs(amps[x]) > NEAR);
    expect(support).toHaveLength(1);
  });

  it('inverse-CDF sampling hits each outcome in proportion to its probability', () => {
    const probs = new Float64Array([0.25, 0.5, 0.25]);
    expect(sampleFrom(probs, 0)).toBe(0);
    expect(sampleFrom(probs, 0.24)).toBe(0);
    expect(sampleFrom(probs, 0.26)).toBe(1);
    expect(sampleFrom(probs, 0.74)).toBe(1);
    expect(sampleFrom(probs, 0.76)).toBe(2);
    // u at the very top must not fall off the end into a zero-probability slot.
    expect(sampleFrom(new Float64Array([0.5, 0.5, 0]), 0.999999999)).toBe(1);
  });
});
