/**
 * Linear algebra over GF(2), the field with two elements.
 *
 * Simon's algorithm hands you a stream of measured bit-vectors y, each one
 * satisfying y · s = 0 (mod 2) for the hidden period s. Recovering s is
 * therefore a linear-algebra problem, not a search problem: collect vectors
 * until they span an (n-1)-dimensional space, then read s off as the unique
 * non-zero vector orthogonal to all of them.
 *
 * Vectors are held as plain numbers, bit i of the number being coordinate i of
 * the vector. n never exceeds 6 here, so 32-bit integer bit-tricks are exact
 * and every routine below is O(n²) at worst.
 */

/** Parity of a bit-vector: the XOR of all its bits. This is the GF(2) dot */
/** product's inner loop — `dot(a, b) = parity(a & b)`. */
export function parity(x: number): number {
  let v = x >>> 0;
  v ^= v >>> 16;
  v ^= v >>> 8;
  v ^= v >>> 4;
  v ^= v >>> 2;
  v ^= v >>> 1;
  return v & 1;
}

/** The GF(2) inner product y · s = ⊕ᵢ yᵢsᵢ. Zero means "orthogonal". */
export function dot(a: number, b: number): number {
  return parity((a & b) >>> 0);
}

/** Population count — used for Hamming weights in the UI. */
export function popcount(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/**
 * Render a vector as its bit string, most-significant bit first, so that the
 * printed string reads left-to-right like the equation on screen.
 */
export function toBits(x: number, n: number): string {
  let out = '';
  for (let i = n - 1; i >= 0; i--) out += (x >>> i) & 1 ? '1' : '0';
  return out;
}

/** Parse a bit string (MSB first) back into a number. Ignores whitespace. */
export function fromBits(s: string): number {
  let v = 0;
  for (const ch of s.replace(/\s+/g, '')) {
    if (ch !== '0' && ch !== '1') throw new Error(`not a bit: ${ch}`);
    v = (v << 1) | (ch === '1' ? 1 : 0);
  }
  return v >>> 0;
}

/**
 * A row-reduced GF(2) system, built incrementally.
 *
 * The demo needs to answer, after every single measurement: did that vector
 * teach us anything new, what is the rank now, and what is the current set of
 * candidate periods? Keeping the matrix in reduced row echelon form as rows
 * arrive answers all three in O(n) per insertion, and — this is the part the UI
 * shows — makes "this measurement was redundant" a fact the structure knows
 * rather than a claim the prose makes.
 */
export interface Gf2System {
  /** Vector width in bits. */
  readonly n: number;
  /**
   * Reduced rows, one per pivot, ordered by descending pivot position.
   * `pivots[i]` is the bit index that `rows[i]` owns.
   */
  readonly rows: number[];
  readonly pivots: number[];
}

export function newSystem(n: number): Gf2System {
  return { n, rows: [], pivots: [] };
}

export function rank(sys: Gf2System): number {
  return sys.rows.length;
}

/**
 * Reduce `v` against the current rows. Returns the residue: zero exactly when
 * `v` is already in the span.
 */
export function reduce(sys: Gf2System, v: number): number {
  let r = v >>> 0;
  for (let i = 0; i < sys.rows.length; i++) {
    const p = sys.pivots[i];
    if ((r >>> p) & 1) r ^= sys.rows[i];
  }
  return r >>> 0;
}

/** True when `v` adds no new information — the redundant-measurement case. */
export function isRedundant(sys: Gf2System, v: number): boolean {
  return reduce(sys, v) === 0;
}

/**
 * Insert a vector, keeping the system in reduced row echelon form.
 * Returns a fresh system plus whether the insertion raised the rank.
 */
export function insert(sys: Gf2System, v: number): { system: Gf2System; accepted: boolean } {
  const residue = reduce(sys, v);
  if (residue === 0) return { system: sys, accepted: false };

  // Highest set bit becomes the new pivot.
  let pivot = 0;
  for (let b = sys.n - 1; b >= 0; b--) {
    if ((residue >>> b) & 1) {
      pivot = b;
      break;
    }
  }

  // Back-substitute the new row into the existing ones so the form stays
  // *reduced* — every pivot column then holds a single 1, which is what makes
  // the on-screen matrix readable.
  const rows = sys.rows.map((row) => ((row >>> pivot) & 1 ? row ^ residue : row));
  const pivots = sys.pivots.slice();
  rows.push(residue);
  pivots.push(pivot);

  // Keep rows sorted by descending pivot: echelon form, top-left to bottom-right.
  const order = pivots.map((_, i) => i).sort((a, b) => pivots[b] - pivots[a]);
  return {
    system: {
      n: sys.n,
      rows: order.map((i) => rows[i]),
      pivots: order.map((i) => pivots[i]),
    },
    accepted: true,
  };
}

/**
 * A basis for the null space { s : y · s = 0 for every row y }.
 *
 * The rows are constraints on s, one linear equation each. With rank r the
 * solution space has dimension n - r, so a basis has n - r vectors and the
 * space holds 2^(n-r) candidates (including s = 0, which every function
 * trivially "has" and which Simon can never distinguish).
 */
export function nullSpaceBasis(sys: Gf2System): number[] {
  const pivotSet = new Set(sys.pivots);
  const free: number[] = [];
  for (let b = 0; b < sys.n; b++) if (!pivotSet.has(b)) free.push(b);

  return free.map((f) => {
    // Set the free coordinate to 1; each pivot coordinate is then forced to the
    // value that satisfies its own row.
    let v = 1 << f;
    for (let i = 0; i < sys.rows.length; i++) {
      if ((sys.rows[i] >>> f) & 1) v |= 1 << sys.pivots[i];
    }
    return v >>> 0;
  });
}

/** Every vector in the null space, listed. Only ever called for small n. */
export function nullSpaceElements(sys: Gf2System): number[] {
  const basis = nullSpaceBasis(sys);
  const out: number[] = [];
  for (let mask = 0; mask < 1 << basis.length; mask++) {
    let v = 0;
    for (let i = 0; i < basis.length; i++) if ((mask >>> i) & 1) v ^= basis[i];
    out.push(v >>> 0);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The candidate periods consistent with everything measured so far: the null
 * space minus the all-zero vector, which is not a period.
 *
 * Length 1 is the moment the demo exists for — the system has pinned s.
 */
export function candidatePeriods(sys: Gf2System): number[] {
  return nullSpaceElements(sys).filter((v) => v !== 0);
}
