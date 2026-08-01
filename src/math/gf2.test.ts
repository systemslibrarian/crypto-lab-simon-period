import { describe, expect, it } from 'vitest';
import {
  candidatePeriods,
  dot,
  fromBits,
  insert,
  isRedundant,
  newSystem,
  nullSpaceBasis,
  nullSpaceElements,
  parity,
  popcount,
  rank,
  reduce,
  toBits,
} from './gf2';

describe('bit utilities', () => {
  it('parity is the XOR of all bits', () => {
    expect(parity(0b0000)).toBe(0);
    expect(parity(0b0001)).toBe(1);
    expect(parity(0b0011)).toBe(0);
    expect(parity(0b0111)).toBe(1);
    expect(parity(0xffffffff)).toBe(0);
    expect(parity(0x7fffffff)).toBe(1);
  });

  it('dot is symmetric and bilinear over GF(2)', () => {
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        expect(dot(a, b)).toBe(dot(b, a));
        for (let c = 0; c < 16; c++) {
          // dot(a ⊕ b, c) = dot(a,c) ⊕ dot(b,c)
          expect(dot(a ^ b, c)).toBe(dot(a, c) ^ dot(b, c));
        }
      }
    }
  });

  it('popcount counts set bits', () => {
    expect(popcount(0)).toBe(0);
    expect(popcount(0b1011)).toBe(3);
    expect(popcount(0xffffffff)).toBe(32);
  });

  it('bit strings round-trip, most significant bit first', () => {
    expect(toBits(0b1010, 4)).toBe('1010');
    expect(toBits(0b1, 6)).toBe('000001');
    expect(fromBits('1010')).toBe(0b1010);
    for (let v = 0; v < 64; v++) expect(fromBits(toBits(v, 6))).toBe(v);
  });

  it('rejects non-bit characters', () => {
    expect(() => fromBits('10x1')).toThrow();
  });
});

describe('GF(2) system', () => {
  it('starts empty with the whole space as candidates', () => {
    const sys = newSystem(4);
    expect(rank(sys)).toBe(0);
    // 2^4 - 1 non-zero vectors are all still possible periods.
    expect(candidatePeriods(sys)).toHaveLength(15);
  });

  it('rejects the zero vector as uninformative', () => {
    const sys = newSystem(4);
    expect(isRedundant(sys, 0)).toBe(true);
    expect(insert(sys, 0).accepted).toBe(false);
  });

  it('accepts independent vectors and rejects dependent ones', () => {
    let sys = newSystem(4);
    let r = insert(sys, 0b0011);
    expect(r.accepted).toBe(true);
    sys = r.system;

    r = insert(sys, 0b0101);
    expect(r.accepted).toBe(true);
    sys = r.system;

    // 0b0011 ⊕ 0b0101 = 0b0110 is already in the span.
    r = insert(sys, 0b0110);
    expect(r.accepted).toBe(false);
    expect(rank(r.system)).toBe(2);
  });

  it('reduce returns zero exactly on the span', () => {
    let sys = newSystem(5);
    for (const v of [0b00011, 0b00101, 0b11000]) sys = insert(sys, v).system;
    expect(reduce(sys, 0b00110)).toBe(0);
    expect(reduce(sys, 0b11011)).toBe(0);
    expect(reduce(sys, 0b00001)).not.toBe(0);
  });

  it('null space vectors are orthogonal to every row', () => {
    for (let trial = 0; trial < 200; trial++) {
      const n = 6;
      let sys = newSystem(n);
      const rows: number[] = [];
      for (let i = 0; i < 4; i++) {
        const v = Math.floor(Math.random() * (1 << n));
        const res = insert(sys, v);
        if (res.accepted) rows.push(v);
        sys = res.system;
      }
      const basis = nullSpaceBasis(sys);
      expect(basis).toHaveLength(n - rank(sys));
      for (const b of basis) for (const row of rows) expect(dot(b, row)).toBe(0);
    }
  });

  it('null space has exactly 2^(n-rank) elements', () => {
    let sys = newSystem(6);
    expect(nullSpaceElements(sys)).toHaveLength(64);
    sys = insert(sys, 0b000011).system;
    expect(nullSpaceElements(sys)).toHaveLength(32);
    sys = insert(sys, 0b000101).system;
    expect(nullSpaceElements(sys)).toHaveLength(16);
  });

  it('rank n-1 leaves exactly one candidate period — the moment Simon finishes', () => {
    const n = 5;
    const s = 0b10110;
    let sys = newSystem(n);
    // Feed vectors orthogonal to s until the rank saturates at n-1.
    for (let v = 1; v < 1 << n; v++) {
      if (dot(v, s) === 0) sys = insert(sys, v).system;
    }
    expect(rank(sys)).toBe(n - 1);
    expect(candidatePeriods(sys)).toEqual([s]);
  });

  it('full rank leaves no candidate period at all', () => {
    const n = 4;
    let sys = newSystem(n);
    for (const v of [0b0001, 0b0010, 0b0100, 0b1000]) sys = insert(sys, v).system;
    expect(rank(sys)).toBe(4);
    expect(candidatePeriods(sys)).toEqual([]);
  });

  it('stays in reduced echelon form: each pivot column holds a single 1', () => {
    let sys = newSystem(6);
    for (const v of [0b101101, 0b011010, 0b110011, 0b001111]) sys = insert(sys, v).system;
    for (let i = 0; i < sys.rows.length; i++) {
      for (let j = 0; j < sys.rows.length; j++) {
        const bit = (sys.rows[j] >>> sys.pivots[i]) & 1;
        expect(bit).toBe(i === j ? 1 : 0);
      }
    }
    // Pivots strictly descending — echelon order.
    for (let i = 1; i < sys.pivots.length; i++) expect(sys.pivots[i - 1]).toBeGreaterThan(sys.pivots[i]);
  });

  it('insertion order does not change the span or the candidates', () => {
    const vectors = [0b100110, 0b011001, 0b111111, 0b000110, 0b101011];
    const build = (order: number[]) => {
      let sys = newSystem(6);
      for (const i of order) sys = insert(sys, vectors[i]).system;
      return sys;
    };
    const a = build([0, 1, 2, 3, 4]);
    const b = build([4, 2, 0, 3, 1]);
    expect(rank(a)).toBe(rank(b));
    expect(candidatePeriods(a)).toEqual(candidatePeriods(b));
  });
});
