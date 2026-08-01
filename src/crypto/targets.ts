/**
 * The four functions Simon's algorithm is pointed at on this page.
 *
 * Two are textbook objects that exist to show the algorithm working and the
 * algorithm failing. Two are real symmetric-crypto constructions whose
 * published quantum attacks *are* Simon's algorithm — Even-Mansour
 * (Kuwakado-Morii 2012) and CBC-MAC (Kaplan-Leurent-Leverrier-Naya-Plasencia
 * 2016). For those two, recovering the period is not the end of the story: the
 * demo goes on to use it, and checks the resulting key recovery or forgery
 * against the real construction rather than announcing success.
 *
 * Every target exposes the same shape — an oracle table over the input domain,
 * a ground-truth period held aside for verification only, and a consequence the
 * period unlocks — so the UI never special-cases the crypto.
 */

import { toBits } from '../math/gf2';
import { applyPerm, derivePermutation, publicPermutation, randomKey, randomWord } from './prp';

export type TargetId = 'textbook' | 'even-mansour' | 'cbc-mac' | 'no-period';

export interface ExploitRow {
  label: string;
  value: string;
  /** Compared against another row and expected to match — drives the ✓/✗ mark. */
  match?: 'ok' | 'bad';
}

export interface ExploitResult {
  /** Did the real construction accept what the attack produced? */
  ok: boolean;
  headline: string;
  rows: ExploitRow[];
  note: string;
}

export interface Target {
  readonly id: TargetId;
  /** Short name for the selector. */
  readonly name: string;
  /** One line under the selector. */
  readonly tagline: string;
  /** Where the attack comes from, or "textbook". */
  readonly source: string;
  /** Input register width, in qubits. */
  readonly n: number;
  /** Output register width, in qubits. */
  readonly m: number;
  /** f evaluated over the whole domain — the oracle the circuit queries. */
  readonly table: Uint32Array;
  /**
   * The true period, held for verification and for the reveal button. The
   * attack never reads it: `simonRound` only ever sees `table`.
   */
  readonly truePeriod: number | null;
  /** Human-readable description of what the input bits mean. */
  readonly inputLegend: string;
  /** Human-readable description of what f returns. */
  readonly outputLegend: string;
  /** The secret material, for the "peek" control. */
  readonly secrets: { label: string; value: string }[];
  /** What recovering the period actually buys an attacker. */
  readonly consequence: string;
  /** Run that consequence for real, and check it against the construction. */
  exploit(period: number): ExploitResult;
}

const hex = (v: number, n: number): string => `${toBits(v, n)} (0x${v.toString(16)})`;

/* ────────────────────────────────────────────────────────────────────────────
   1. Textbook Simon — the exact promise, nothing more
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * f is built to satisfy Simon's promise exactly: pick s, pair the domain into
 * 2^(n-1) cosets {x, x⊕s}, and give each coset its own distinct output value.
 * Exactly 2-to-1, no accidental collisions, so the measurement distribution is
 * exactly uniform over s⊥.
 */
export async function makeTextbookTarget(n: number): Promise<Target> {
  const size = 1 << n;
  let s = randomWord(n);
  while (s === 0) s = randomWord(n);

  // A random permutation supplies 2^(n-1) guaranteed-distinct output values.
  const values = await derivePermutation(n, randomKey());
  const table = new Uint32Array(size);
  const assigned = new Map<number, number>();
  let next = 0;
  for (let x = 0; x < size; x++) {
    const rep = Math.min(x, x ^ s);
    let v = assigned.get(rep);
    if (v === undefined) {
      v = applyPerm(values, next++);
      assigned.set(rep, v);
    }
    table[x] = v;
  }

  return {
    id: 'textbook',
    name: 'Textbook 2-to-1',
    tagline: 'Simon’s promise, exactly: f(x) = f(y) ⟺ y = x ⊕ s.',
    source: 'Simon 1994 — the original problem statement',
    n,
    m: n,
    table,
    truePeriod: s,
    inputLegend: `x — an ${n}-bit input`,
    outputLegend: 'f(x) — an arbitrary label, distinct per pair',
    secrets: [{ label: 'hidden period s', value: hex(s, n) }],
    consequence: 'Nothing is broken here. This is the algorithm in its clean form, so the interference is visible without any construction in the way.',
    exploit(period) {
      const ok = period === s;
      return {
        ok,
        headline: ok ? 'Period recovered' : 'Recovered value is not the period',
        rows: [
          { label: 'recovered s', value: hex(period, n), match: ok ? 'ok' : 'bad' },
          { label: 'true s', value: hex(s, n), match: ok ? 'ok' : 'bad' },
        ],
        note: ok
          ? 'The linear system pinned s from measurements alone. Nothing about f was searched, guessed, or brute-forced.'
          : 'The system solved to a value that does not satisfy f(x) = f(x ⊕ s). Discard and re-run — Simon’s algorithm is Las Vegas, and this is why the demo verifies.',
      };
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   2. Even-Mansour — Kuwakado & Morii 2012
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Even-Mansour turns a *public* permutation P into a block cipher with two
 * whitening keys:  E(x) = P(x ⊕ k₁) ⊕ k₂.
 *
 * Classically it is provably secure to ~2^(n/2) queries, and that bound is
 * tight — a slide-with-a-twist attack meets it. It is the minimal block cipher:
 * you cannot get a cipher from a public permutation with less key material.
 *
 * Kuwakado and Morii observed that
 *
 *     f(x) = E(x) ⊕ P(x) = P(x ⊕ k₁) ⊕ P(x) ⊕ k₂
 *
 * satisfies f(x ⊕ k₁) = f(x) for every x. The whitening key *is* a hidden
 * period, so Simon's algorithm recovers k₁ in O(n) quantum queries — and k₂
 * follows from a single classical evaluation. The 2^(n/2) security proof does
 * not survive contact with a quantum adversary who can query E in superposition.
 *
 * Note what is NOT weak here: P is a uniformly random permutation, the strongest
 * possible instantiation. The break is structural, not a property of the
 * permutation.
 */
export async function makeEvenMansourTarget(n: number): Promise<Target> {
  const P = await publicPermutation(n);
  let k1 = randomWord(n);
  while (k1 === 0) k1 = randomWord(n);
  const k2 = randomWord(n);

  const encrypt = (x: number): number => applyPerm(P, x ^ k1) ^ k2;

  const size = 1 << n;
  const table = new Uint32Array(size);
  for (let x = 0; x < size; x++) table[x] = encrypt(x) ^ applyPerm(P, x);

  return {
    id: 'even-mansour',
    name: 'Even-Mansour',
    tagline: 'E(x) = P(x ⊕ k₁) ⊕ k₂ — the minimal block cipher, period k₁.',
    source: 'Kuwakado & Morii, ISITA 2012',
    n,
    m: n,
    table,
    truePeriod: k1,
    inputLegend: `x — an ${n}-bit plaintext block`,
    outputLegend: 'f(x) = E(x) ⊕ P(x) — cipher XOR public permutation',
    secrets: [
      { label: 'whitening key k₁', value: hex(k1, n) },
      { label: 'whitening key k₂', value: hex(k2, n) },
    ],
    consequence:
      'The period IS the first whitening key. With k₁ in hand, k₂ falls out of one classical encryption, and the cipher is fully recovered — every future block predictable.',
    exploit(period) {
      // k₂ = E(0) ⊕ P(0 ⊕ k₁): one classical query, no search.
      const k2Guess = encrypt(0) ^ applyPerm(P, period);
      // Predict a block the attack has never encrypted, and check it. Block 0
      // is the one classical query already spent above, so it must not be the
      // challenge — and (period ^ 0b1011) lands on 0 whenever the period
      // happens to be 0b1011, which at n = 4 is one key in fifteen.
      const spentOnKeyDerivation = 0;
      let challenge = (period ^ 0b1011) & (size - 1);
      if (challenge === spentOnKeyDerivation) challenge = (challenge + 1) & (size - 1);
      const predicted = applyPerm(P, challenge ^ period) ^ k2Guess;
      const actual = encrypt(challenge);

      // `ok` is decided by checking the derived key against EVERY block, not by
      // the single prediction shown below.
      //
      // One block is not a test. A wrong period p leaves the guessed key related
      // to the real one by P(x ⊕ p) ⊕ P(p) vs P(x ⊕ k₁) ⊕ P(k₁), and for
      // particular challenges those coincide for structural reasons rather than
      // by luck: with p = k₁ ⊕ 2^b, challenge 2^b makes the two sides literally
      // the same expression, so it agrees for every key and every permutation.
      // A one-block check therefore does not fail closed — measured, it accepted
      // a wrong period in 100% of 3000 trials at n = 5 for that challenge, and
      // roughly 1 run in 6 for the challenge chosen above. The suite saw the
      // latter as a flaky test; it was really an unsound check.
      //
      // Sweeping all 2^n blocks is the lab grading itself, not part of the
      // attack — it costs 2^n table reads on a toy where n <= 6, and it makes
      // `ok` mean exactly "this key pair reproduces the cipher". The attack's
      // own cost is unchanged and is stated in the note below.
      let verifiedBlocks = 0;
      let ok = true;
      for (let x = 0; x < size; x++) {
        if ((applyPerm(P, x ^ period) ^ k2Guess) !== encrypt(x)) {
          ok = false;
          break;
        }
        verifiedBlocks++;
      }
      return {
        ok,
        headline: ok ? 'Full key recovered — cipher predicted' : 'Key recovery failed',
        rows: [
          { label: 'recovered k₁ (= the period)', value: hex(period, n), match: period === k1 ? 'ok' : 'bad' },
          { label: 'derived k₂ = E(0) ⊕ P(k₁)', value: hex(k2Guess, n), match: k2Guess === k2 ? 'ok' : 'bad' },
          { label: `predicted E(${toBits(challenge, n)})`, value: hex(predicted, n), match: predicted === actual ? 'ok' : 'bad' },
          { label: `real E(${toBits(challenge, n)})`, value: hex(actual, n), match: predicted === actual ? 'ok' : 'bad' },
        ],
        note: ok
          ? `Both key halves recovered, and the derived key reproduces all ${verifiedBlocks} blocks of the cipher — not just the one shown. Recovering the key took a handful of superposition queries plus one ordinary encryption of block 0; the full sweep above is this page checking itself, not part of the attack. Classically this construction needs ~2^(n/2) queries.`
          : 'The period did not yield the key: the derived key fails to reproduce the cipher. Verify before you trust, always — and verify on more than one block, because a single prediction can agree by coincidence.',
      };
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   3. CBC-MAC — Kaplan, Leurent, Leverrier, Naya-Plasencia 2016
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Raw CBC-MAC over two blocks:  MAC(m₁ ‖ m₂) = E_k(E_k(m₁) ⊕ m₂).
 *
 * Fix two distinct first blocks α₀ ≠ α₁ and define
 *
 *     f(b, m) = MAC(α_b ‖ m) = E_k(E_k(α_b) ⊕ m)
 *
 * over the (1 + block)-bit input (b, m). Then f(b ⊕ 1, m ⊕ Δ) = f(b, m) where
 * Δ = E_k(α₀) ⊕ E_k(α₁). The period s = (1, Δ) is an *affine* one — it moves the
 * selector bit as well as the message — and recovering Δ is an existential
 * forgery: query the tag of α₀‖m, and it is also the tag of α₁‖(m ⊕ Δ), a
 * message that was never sent.
 *
 * Unlike Even-Mansour's f, this one is exactly 2-to-1: E_k is a permutation, so
 * each half of the domain covers every output exactly once.
 */
export async function makeCbcMacTarget(n: number): Promise<Target> {
  const blockBits = n - 1;
  if (blockBits < 2) throw new Error('CBC-MAC target needs n ≥ 3');
  const blockSize = 1 << blockBits;
  const key = randomKey();
  const E = await derivePermutation(blockBits, key);

  // Two distinct, publicly chosen first blocks. Any pair works; the attack only
  // needs them to differ.
  const alpha0: number = 0;
  const alpha1: number = 1;
  const mac = (m1: number, m2: number): number => applyPerm(E, applyPerm(E, m1) ^ m2);
  const delta = applyPerm(E, alpha0) ^ applyPerm(E, alpha1);

  const table = new Uint32Array(1 << n);
  for (let x = 0; x < 1 << n; x++) {
    const b = (x >>> blockBits) & 1;
    const m = x & (blockSize - 1);
    table[x] = mac(b === 0 ? alpha0 : alpha1, m);
  }

  const period = (1 << blockBits) | delta;
  const bl = (v: number): string => toBits(v, blockBits);

  return {
    id: 'cbc-mac',
    name: 'CBC-MAC',
    tagline: 'MAC(m₁‖m₂) = Eₖ(Eₖ(m₁) ⊕ m₂) — period (1, Δ), an existential forgery.',
    source: 'Kaplan, Leurent, Leverrier & Naya-Plasencia, CRYPTO 2016',
    n,
    m: blockBits,
    table,
    truePeriod: period,
    inputLegend: `x = (b ‖ m) — 1 selector bit, then a ${blockBits}-bit message block`,
    outputLegend: `f(x) — the ${blockBits}-bit tag of α_b ‖ m`,
    secrets: [
      { label: 'MAC key (16 bytes)', value: [...key].map((v) => v.toString(16).padStart(2, '0')).join('') },
      { label: 'Δ = Eₖ(α₀) ⊕ Eₖ(α₁)', value: hex(delta, blockBits) },
      { label: 'period s = (1 ‖ Δ)', value: hex(period, n) },
    ],
    consequence:
      'Δ is a universal forgery key for this MAC: any tag you legitimately obtain for α₀‖m is also the tag of α₁‖(m ⊕ Δ) — a message you never sent and the verifier will accept.',
    exploit(recovered) {
      const selector = (recovered >>> blockBits) & 1;
      const deltaGuess = recovered & (blockSize - 1);
      // One legitimate query: the tag of α₀ ‖ m.
      const m = 0b101 & (blockSize - 1);
      const queriedTag = mac(alpha0, m);
      // The forged message, never queried, and the tag we claim for it.
      const forgedM = m ^ deltaGuess;
      const realTag = mac(alpha1, forgedM);
      // The forged message must be one that was never queried: α₁ ≠ α₀ makes
      // (α₁ ‖ forgedM) a different message from (α₀ ‖ m) no matter what Δ is.
      const isFreshMessage = alpha1 !== alpha0 || forgedM !== m;
      const ok = selector === 1 && queriedTag === realTag && isFreshMessage;
      return {
        ok,
        headline: ok ? 'Forgery accepted by the real MAC' : 'Forgery rejected',
        rows: [
          { label: 'recovered Δ', value: hex(deltaGuess, blockBits), match: deltaGuess === delta ? 'ok' : 'bad' },
          { label: `queried:  MAC(α₀ ‖ ${bl(m)})`, value: hex(queriedTag, blockBits) },
          { label: `forged:   MAC(α₁ ‖ ${bl(forgedM)})`, value: hex(queriedTag, blockBits), match: ok ? 'ok' : 'bad' },
          { label: 'what the real MAC returns', value: hex(realTag, blockBits), match: ok ? 'ok' : 'bad' },
        ],
        note: ok
          ? 'The forged message was never queried, and the tag matches byte for byte. Classically this needs ~2^(b/2) queries by birthday; Simon needs O(b).'
          : 'The recovered period does not carry the selector bit, or Δ is wrong — the forgery fails and the demo says so.',
      };
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   4. No period — the control
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A uniformly random permutation. It is 1-to-1, so it has no period at all, and
 * Simon's algorithm is honest about that: with f injective, reading the output
 * register collapses the input register to a single basis state, the final
 * Hadamard spreads it uniformly over *all* 2ⁿ outcomes, and the collected
 * vectors climb to full rank n. Rank n means the only solution to y·s = 0 for
 * all y is s = 0, which is not a period.
 *
 * This is the control that makes the other three mean something: the algorithm
 * does not manufacture a period where none exists, and the demo does not
 * pretend it does.
 */
export async function makeNoPeriodTarget(n: number): Promise<Target> {
  const perm = await derivePermutation(n, randomKey());
  const table = new Uint32Array(perm.table);

  return {
    id: 'no-period',
    name: 'No period (control)',
    tagline: 'A random permutation — nothing hidden, nothing to find.',
    source: 'The control case: what "the attack does not apply" looks like',
    n,
    m: n,
    table,
    truePeriod: null,
    inputLegend: `x — an ${n}-bit input`,
    outputLegend: 'f(x) — a bijection, so every output has exactly one preimage',
    secrets: [{ label: 'hidden period', value: 'none — f is injective' }],
    consequence:
      'Nothing. Rank climbs to n instead of stopping at n−1, the only vector orthogonal to everything measured is zero, and the demo reports no period rather than inventing one.',
    exploit() {
      // Exhaustively confirm no non-zero period exists, rather than asserting it.
      const failures: number[] = [];
      for (let s = 1; s < 1 << n; s++) {
        let holds = true;
        for (let x = 0; x < 1 << n; x++) {
          if (table[x] !== table[x ^ s]) {
            holds = false;
            break;
          }
        }
        if (holds) failures.push(s);
      }
      const ok = failures.length === 0;
      return {
        ok,
        headline: ok ? 'Confirmed: no period exists' : 'Unexpected period found',
        rows: [
          { label: 'candidate periods tested', value: String((1 << n) - 1) },
          { label: 'periods that hold for all x', value: String(failures.length), match: ok ? 'ok' : 'bad' },
        ],
        note: ok
          ? 'Checked exhaustively against the function itself, not inferred. Simon’s algorithm needs the promise; against an unstructured permutation it has nothing to grip.'
          : 'A period turned up in a permutation, which cannot happen — this would be a bug.',
      };
    },
  };
}

/** Build a target by id. */
export function makeTarget(id: TargetId, n: number): Promise<Target> {
  switch (id) {
    case 'textbook':
      return makeTextbookTarget(n);
    case 'even-mansour':
      return makeEvenMansourTarget(n);
    case 'cbc-mac':
      return makeCbcMacTarget(n);
    case 'no-period':
      return makeNoPeriodTarget(n);
  }
}

export const TARGET_IDS: TargetId[] = ['even-mansour', 'cbc-mac', 'textbook', 'no-period'];
