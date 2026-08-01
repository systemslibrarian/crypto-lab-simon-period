/**
 * A keyed pseudorandom permutation on n bits, and the public permutation P that
 * Even-Mansour is built from.
 *
 * The constructions this demo attacks are proved secure in the **ideal cipher**
 * and **random permutation** models, so the honest way to instantiate them at
 * teaching scale is not to shrink AES — it is to sample a permutation uniformly
 * at random and hand it out. That is exactly what happens here: a SHA-256
 * counter-mode stream (real WebCrypto, `crypto.subtle.digest`) drives a
 * Fisher-Yates shuffle of the whole domain, which for a 4–6 bit block is a
 * genuinely uniform random permutation, not an approximation of one.
 *
 * The consequence matters for what the demo proves: Simon's attack on
 * Even-Mansour succeeds here *against an ideal permutation*, which is the
 * strongest possible target. There is no toy-cipher weakness doing the work.
 */

const SEED_LABEL = new TextEncoder().encode('crypto-lab-simon-period/prp/v1');

/** Bytes of SHA-256(label ‖ key ‖ counter) for counter = 0, 1, 2, … */
async function keystream(key: Uint8Array, bytesNeeded: number): Promise<Uint8Array> {
  const out = new Uint8Array(bytesNeeded);
  let filled = 0;
  let counter = 0;
  while (filled < bytesNeeded) {
    const block = new Uint8Array(SEED_LABEL.length + key.length + 4);
    block.set(SEED_LABEL, 0);
    block.set(key, SEED_LABEL.length);
    new DataView(block.buffer).setUint32(SEED_LABEL.length + key.length, counter, false);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', block));
    const take = Math.min(digest.length, bytesNeeded - filled);
    out.set(digest.subarray(0, take), filled);
    filled += take;
    counter++;
  }
  return out;
}

/** A deterministic uniform-integer source drawn from the keystream. */
class StreamRng {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  private next32(): number {
    if (this.pos + 4 > this.bytes.length) throw new Error('keystream exhausted');
    const v =
      (this.bytes[this.pos] << 24) |
      (this.bytes[this.pos + 1] << 16) |
      (this.bytes[this.pos + 2] << 8) |
      this.bytes[this.pos + 3];
    this.pos += 4;
    return v >>> 0;
  }

  /** Uniform in [0, bound), by rejection — no modulo bias. */
  below(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    const limit = Math.floor(0x100000000 / bound) * bound;
    for (;;) {
      const v = this.next32();
      if (v < limit) return v % bound;
    }
  }
}

/**
 * A permutation of {0, …, 2ⁿ−1}, together with its inverse.
 *
 * `apply` and `invert` are plain table lookups; both directions are needed
 * because Even-Mansour's attacker is allowed to evaluate the public permutation
 * either way, and CBC-MAC verification needs neither but the Feistel note does.
 */
export interface Permutation {
  readonly n: number;
  readonly table: Uint32Array;
  readonly inverse: Uint32Array;
}

export function applyPerm(p: Permutation, x: number): number {
  return p.table[x];
}

export function invertPerm(p: Permutation, y: number): number {
  return p.inverse[y];
}

function fromTable(n: number, table: Uint32Array): Permutation {
  const inverse = new Uint32Array(table.length);
  for (let i = 0; i < table.length; i++) inverse[table[i]] = i;
  return { n, table, inverse };
}

/**
 * Sample a uniformly random permutation on n bits, deterministically from
 * `key`. Fisher-Yates over the full domain: every one of the (2ⁿ)! orderings is
 * equally likely given a uniform stream.
 */
export async function derivePermutation(n: number, key: Uint8Array): Promise<Permutation> {
  const size = 1 << n;
  // 8 bytes of slack per swap is far more than rejection sampling will use.
  const rng = new StreamRng(await keystream(key, size * 8 + 64));
  const table = new Uint32Array(size);
  for (let i = 0; i < size; i++) table[i] = i;
  for (let i = size - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    const t = table[i];
    table[i] = table[j];
    table[j] = t;
  }
  return fromTable(n, table);
}

/**
 * The *public* permutation of the Even-Mansour construction: fixed, published,
 * and known to the attacker. Derived from a constant so the whole page — and
 * every test — sees the same P for a given block size. Memoised per width,
 * because the race panel rebuilds hundreds of Even-Mansour instances and P is
 * the same object in every one of them.
 */
const publicCache = new Map<number, Promise<Permutation>>();

export function publicPermutation(n: number): Promise<Permutation> {
  let p = publicCache.get(n);
  if (!p) {
    p = derivePermutation(n, new TextEncoder().encode('public-permutation'));
    publicCache.set(n, p);
  }
  return p;
}

/** A fresh key of `bytes` bytes from the platform CSPRNG. */
export function randomKey(bytes = 16): Uint8Array {
  const k = new Uint8Array(bytes);
  crypto.getRandomValues(k);
  return k;
}

/** A uniformly random n-bit value from the platform CSPRNG. */
export function randomWord(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & ((1 << n) - 1);
}
