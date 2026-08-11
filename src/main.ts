/**
 * Simon's Period — page wiring.
 *
 * The crypto and the quantum simulation live in src/quantum, src/crypto,
 * src/math and src/classical, and are unit-tested there. This file owns state
 * and DOM only: it never decides anything a test could not check.
 *
 * The one rule that shapes everything below: a recovered period is never
 * reported on the strength of the linear algebra. It is checked against f over
 * the whole domain first, and a candidate that fails the check is shown as
 * rejected rather than quietly discarded.
 */

import './style.css';

import { quantumPeriodSearch, classicalPeriodSearch, makeRng } from './classical/race';
import { makeTarget, TARGET_IDS, type ExploitResult, type Target, type TargetId } from './crypto/targets';
import { candidatePeriods, insert, newSystem, rank, toBits, type Gf2System } from './math/gf2';
import { promiseReport, simonRound, verifyPeriod, type SimonRound } from './quantum/simon';
import { amplitudeClass, amplitudeSign, bits, equationText, formatMean, plural } from './ui/format';

/* ── tiny DOM helpers ─────────────────────────────────────────────────── */

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ── state ────────────────────────────────────────────────────────────── */

type Status = 'idle' | 'working' | 'solved' | 'noPeriod' | 'rejected' | 'stalled';

interface Measurement {
  y: number;
  accepted: boolean;
}

interface State {
  targetId: TargetId;
  n: number;
  target: Target | null;
  system: Gf2System;
  measurements: Measurement[];
  rejectedCandidates: number[];
  lastRound: SimonRound | null;
  selectedY: number | null;
  status: Status;
  solved: { period: number; exploit: ExploitResult } | null;
  busy: boolean;
}

const state: State = {
  targetId: 'even-mansour',
  n: 5,
  target: null,
  system: newSystem(5),
  measurements: [],
  rejectedCandidates: [],
  lastRound: null,
  selectedY: null,
  status: 'idle',
  solved: null,
  busy: false,
};

/** The two targets where a recovered period is an actual cryptographic break. */
const BREAKS_SOMETHING = new Set<TargetId>(['even-mansour', 'cbc-mac']);

/**
 * Runs are animated, so they span many turns of the event loop, and a visitor
 * is entitled to change target or width in the middle of one. Every async
 * action takes a token; when a newer action bumps the counter, the older one
 * notices and abandons its remaining work instead of writing stale state (or,
 * worse, being silently ignored because something else held a busy flag).
 */
let runToken = 0;

function supersede(): number {
  return ++runToken;
}

const MAX_ROUNDS = (n: number): number => 16 * n;

/* ── circuit description ──────────────────────────────────────────────── */

const CIRCUIT_STEPS = [
  {
    title: 'H⊗ⁿ — build the superposition',
    body: 'Every one of the 2ⁿ inputs, all at once, each with amplitude 2^(−n/2). Nothing secret has been touched yet.',
  },
  {
    title: 'U_f — the one query',
    body: 'f is evaluated on the whole superposition in a single query. Input and output registers are now entangled.',
  },
  {
    title: 'Read the output register',
    body: 'The input register collapses to exactly the inputs sharing that output — for a periodic f, the pair x₀ and x₀ ⊕ s.',
  },
  {
    title: 'H⊗ⁿ again, then measure',
    body: 'Each surviving input sends a signed path to every outcome. Where the signs disagree, the paths cancel. What is left is orthogonal to s.',
  },
];

function renderCircuit(active: number): void {
  const list = el('circuit');
  clear(list);
  CIRCUIT_STEPS.forEach((step, i) => {
    const li = make('li');
    if (i === active) li.classList.add('on');
    li.appendChild(make('span', 'step-num', String(i + 1)));
    const body = make('div');
    body.appendChild(make('span', 'step-title', step.title));
    body.appendChild(make('p', 'step-body', step.body));
    li.appendChild(body);
    list.appendChild(li);
  });
}

/* ── selectors ────────────────────────────────────────────────────────── */

const TARGET_LABELS: Record<TargetId, string> = {
  'even-mansour': 'Even-Mansour',
  'cbc-mac': 'CBC-MAC',
  textbook: 'Textbook 2-to-1',
  'no-period': 'No period (control)',
};

function renderSelectors(): void {
  const targets = el('seg-target');
  clear(targets);
  for (const id of TARGET_IDS) {
    const b = make('button', undefined, TARGET_LABELS[id]);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === state.targetId));
    b.dataset.target = id;
    b.addEventListener('click', () => {
      if (state.targetId === id) return;
      state.targetId = id;
      void rebuild();
    });
    targets.appendChild(b);
  }

  const widths = el('seg-width');
  clear(widths);
  for (const n of [4, 5, 6]) {
    const b = make('button', undefined, `${n} bits`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(n === state.n));
    b.dataset.width = String(n);
    b.addEventListener('click', () => {
      if (state.n === n) return;
      state.n = n;
      void rebuild();
    });
    widths.appendChild(b);
  }
}

/* ── target card ──────────────────────────────────────────────────────── */

function renderTargetCard(): void {
  const t = state.target;
  if (!t) return;
  el('target-name').textContent = t.name;
  el('target-source').textContent = t.source;
  el('target-note').textContent = t.tagline;
  el('legend-in').textContent = t.inputLegend;
  el('legend-out').textContent = t.outputLegend;
  el('consequence-text').textContent = t.consequence;

  const list = el('secret-list');
  clear(list);
  for (const s of t.secrets) {
    const row = make('div');
    row.appendChild(make('dt', undefined, s.label));
    row.appendChild(make('dd', undefined, s.value));
    list.appendChild(row);
  }

  // The promise report is a fact about the constructed f, computed here rather
  // than described: it is what tells the learner whether this target satisfies
  // Simon's textbook assumption or merely something weaker.
  const promiseRow = make('div');
  const rep = t.truePeriod === null ? null : promiseReport(t.table, t.n, t.truePeriod);
  promiseRow.appendChild(make('dt', undefined, 'satisfies Simon’s promise exactly'));
  promiseRow.appendChild(
    make(
      'dd',
      undefined,
      rep === null
        ? 'n/a — no period'
        : rep.exact
          ? 'yes — exactly 2-to-1'
          : `no — ${plural(rep.irregularInputs, 'input')} sit in a preimage class that is not a clean pair`,
    ),
  );
  list.appendChild(promiseRow);
}

/* ── meters, tallies, verdict ─────────────────────────────────────────── */

/**
 * The rank threshold is target-shaped, not universal.
 *
 * Against a periodic f every measured y satisfies y·s = 0, so every row lands
 * in s⊥ and the rank can never exceed n−1: n−1 is the finish line. The control
 * has no period, its measurements span the whole space, and the rank runs to n
 * — measured, 100 of 100 control runs at each of n = 4, 5, 6 end above n−1.
 * Printing "5 / 4 needed" there stated a requirement the run had already blown
 * past, and the e2e suite asserted that string rather than questioning it.
 */
function rankGoal(): number {
  return state.targetId === 'no-period' ? state.n : state.n - 1;
}

function renderMeters(): void {
  const n = state.n;
  const r = rank(state.system);
  const goal = rankGoal();
  el('rank-value').textContent = `${r} / ${goal} needed`;
  el('rank-note').textContent =
    goal === n
      ? `There is no period here to pin, so n−1 is not the threshold. Rank n = ${n} is: it leaves zero as the only vector orthogonal to everything measured, which is a proof of absence.`
      : 'The period is pinned once the rank reaches n−1 — one dimension short of everything.';

  const meter = el('rank-meter');
  clear(meter);
  meter.setAttribute('aria-label', `Rank ${r} of ${goal} needed`);
  for (let i = 0; i < goal; i++) {
    const seg = make('span');
    if (i < r) seg.classList.add('filled');
    meter.appendChild(seg);
  }

  const queries = state.measurements.length;
  const wasted = state.measurements.filter((m) => !m.accepted).length;
  el('tally-queries').textContent = String(queries);
  el('tally-wasted').textContent = String(wasted);

  const cands = candidatePeriods(state.system);
  el('tally-candidates').textContent =
    queries === 0 ? `${(1 << n) - 1} (everything)` : cands.length === 0 ? '0 — none possible' : String(cands.length);
}

interface VerdictSpec {
  cls: string;
  icon: string;
  text: string;
  sub: string;
}

function verdictSpec(): VerdictSpec {
  const t = state.target;
  const n = state.n;
  switch (state.status) {
    case 'idle':
      return {
        cls: '',
        icon: '◌',
        text: 'Not started',
        sub: 'Press Measure once to send the first query.',
      };
    case 'working': {
      const need = n - 1 - rank(state.system);
      return {
        cls: 'is-working',
        icon: '◍',
        text: 'Collecting equations',
        sub: `${plural(need, 'more independent equation')} needed before the period is forced.`,
      };
    }
    case 'solved': {
      const s = state.solved!.period;
      const breaks = t && BREAKS_SOMETHING.has(t.id);
      // A break claim states the model it holds in. Every query counted above
      // was a superposition query to the *keyed* primitive — the Q2 model — and
      // a verdict that says "BROKEN" without saying so is claiming more than
      // this run learned.
      const qualifier = breaks
        ? ' Broken in the Q2 model only — every query above was a superposition query to the keyed primitive, which no deployed system offers.'
        : '';
      return {
        cls: breaks ? 'is-broken' : 'is-working',
        icon: breaks ? '⚠' : '✓',
        text: breaks ? `BROKEN — period s = ${toBits(s, n)}` : `Period recovered — s = ${toBits(s, n)}`,
        sub: `Verified against f over all ${1 << n} inputs: f(x) = f(x ⊕ s) everywhere. ${plural(
          state.measurements.length,
          'query',
          'queries',
        )} spent.${qualifier}`,
      };
    }
    case 'noPeriod':
      return {
        cls: 'is-safe',
        icon: '✓',
        text: 'NO PERIOD — nothing to find',
        sub: `The rank reached n = ${n}, so the only vector orthogonal to every measurement is zero. That is a proof, not a timeout.`,
      };
    case 'rejected':
      return {
        cls: 'is-rejected',
        icon: '✗',
        text: 'Candidate rejected by f',
        sub: `The system named ${state.rejectedCandidates.map((c) => toBits(c, n)).join(', ')}, and f refused to confirm it. Simon’s algorithm is Las Vegas — keep measuring.`,
      };
    case 'stalled':
      return {
        cls: 'is-rejected',
        icon: '⏱',
        text: 'Out of budget',
        sub: `Stopped after ${MAX_ROUNDS(n)} rounds without a verdict. Reset and try again — this is a hard stop, not part of the algorithm.`,
      };
  }
}

function renderVerdict(): void {
  const spec = verdictSpec();
  const box = el('verdict');
  box.className = `verdict ${spec.cls}`.trim();
  (box.querySelector('.verdict-icon') as HTMLElement).textContent = spec.icon;
  el('verdict-text').textContent = spec.text;
  el('verdict-sub').textContent = spec.sub;

  const exploit = el('exploit');
  if (!state.solved && state.status !== 'noPeriod') {
    exploit.hidden = true;
    return;
  }
  const t = state.target!;
  const result = state.solved ? state.solved.exploit : t.exploit(0);
  exploit.hidden = false;
  exploit.classList.toggle('neutral', !BREAKS_SOMETHING.has(t.id));
  el('exploit-h').textContent = result.headline;

  const rows = el('exploit-rows');
  clear(rows);
  for (const row of result.rows) {
    const line = make('div', `exploit-row${row.match ? ` ${row.match}` : ''}`);
    line.appendChild(make('span', 'lbl', row.label));
    const right = make('span');
    if (row.match) {
      right.appendChild(make('span', 'mark', row.match === 'ok' ? '✓ ' : '✗ '));
    }
    const val = make('span', 'val', row.value);
    right.appendChild(val);
    line.appendChild(right);
    rows.appendChild(line);
  }
  el('exploit-note').textContent = result.note;
}

/* ── the equation log and the matrix ──────────────────────────────────── */

function renderEquations(): void {
  const list = el('eq-list');
  clear(list);
  if (state.measurements.length === 0) {
    list.appendChild(make('p', 'panel-note', 'No measurements yet.'));
    return;
  }
  state.measurements.forEach((m, i) => {
    const row = make('div', `eq ${m.accepted ? 'new' : 'dup'}`);
    row.appendChild(make('span', 'eq-idx', `#${i + 1}`));
    const body = make('span', 'eq-body');
    body.textContent = `y = ${toBits(m.y, state.n)}   →   ${equationText(m.y, state.n)}`;
    row.appendChild(body);
    row.appendChild(
      make('span', 'eq-flag', m.accepted ? 'NEW' : m.y === 0 ? 'y = 0, NO INFO' : 'REDUNDANT'),
    );
    list.appendChild(row);
  });
  list.scrollTop = list.scrollHeight;
}

function renderMatrix(): void {
  const wrap = el('matrix-wrap');
  clear(wrap);
  const sys = state.system;
  if (sys.rows.length === 0) {
    wrap.appendChild(make('p', 'panel-note', 'Empty — no equations yet.'));
    return;
  }
  const grid = make('div', 'matrix');
  sys.rows.forEach((row, i) => {
    const line = make('div', 'matrix-row');
    for (let b = state.n - 1; b >= 0; b--) {
      const bit = (row >>> b) & 1;
      const cell = make('span', `mcell${bit ? ' one' : ''}${b === sys.pivots[i] ? ' pivot' : ''}`, String(bit));
      line.appendChild(cell);
    }
    grid.appendChild(line);
  });
  wrap.appendChild(grid);
  wrap.appendChild(
    make(
      'p',
      'matrix-caption',
      `Rank ${sys.rows.length} of ${state.n}. Highlighted cells are pivots — each owns a coordinate of s.`,
    ),
  );
}

function renderCandidates(): void {
  const box = el('cand-list');
  clear(box);
  const cands = candidatePeriods(state.system);
  if (state.measurements.length === 0) {
    box.appendChild(
      make('p', 'panel-note', `Every non-zero vector — ${(1 << state.n) - 1} of them — is still possible.`),
    );
    return;
  }
  if (cands.length === 0) {
    box.appendChild(
      make('p', 'panel-note', 'None. The measurements span the whole space, so no non-zero period can exist.'),
    );
    return;
  }
  box.appendChild(
    make(
      'p',
      'panel-note',
      cands.length === 1
        ? 'Exactly one candidate survives — the period is determined, subject to verification against f.'
        : `${cands.length} candidates still fit. Each new independent equation halves this.`,
    ),
  );
  const chips = make('div', 'cand-chips');
  const shown = cands.slice(0, 32);
  for (const c of shown) {
    chips.appendChild(make('span', `cand${cands.length === 1 ? ' solo' : ''}`, toBits(c, state.n)));
  }
  if (cands.length > shown.length) {
    chips.appendChild(make('span', 'cand', `+${cands.length - shown.length} more`));
  }
  box.appendChild(chips);
}

/* ── the interference grids ───────────────────────────────────────────── */

function buildGrid(
  container: HTMLElement,
  amplitudes: Float64Array,
  opts: { measured?: number; kind: 'before' | 'after' },
): void {
  clear(container);
  for (let x = 0; x < amplitudes.length; x++) {
    const a = amplitudes[x];
    const sign = amplitudeSign(a);
    const cls = amplitudeClass(a);
    const cell = make('button', `amp-cell ${opts.kind === 'before' && cls === 'zero' ? 'empty' : cls}`);
    cell.type = 'button';
    if (opts.measured === x) cell.classList.add('measured');
    if (state.selectedY === x && opts.kind === 'after') cell.classList.add('selected');

    const glyph = make('span', 'amp-sign', opts.kind === 'before' && cls === 'zero' ? '·' : sign);
    const label = make('span', 'amp-y', bits(x, state.n));
    cell.appendChild(glyph);
    cell.appendChild(label);

    const name =
      opts.kind === 'before'
        ? `input ${bits(x, state.n)}: ${cls === 'zero' ? 'not in the superposition' : 'in the superposition'}`
        : `outcome ${bits(x, state.n)}: amplitude ${sign === '0' ? 'cancelled to zero — impossible' : sign === '+' ? 'positive' : 'negative'}${
            opts.measured === x ? ', measured this round' : ''
          }`;
    cell.setAttribute('aria-label', name);
    cell.title = name;
    cell.addEventListener('click', () => {
      state.selectedY = x;
      renderInterference();
      renderArithmetic();
    });
    container.appendChild(cell);
  }
}

function renderInterference(): void {
  const round = state.lastRound;
  const before = el('grid-before');
  const after = el('grid-after');
  if (!round) {
    clear(before);
    clear(after);
    el('before-note').textContent = 'Run a measurement to populate this.';
    return;
  }
  el('before-note').textContent =
    `Output register read as ${bits(round.observedOutput, state.target!.m)}. ` +
    `${plural(round.preimage.length, 'input')} share that value, so the machine now holds all of them at once.`;
  buildGrid(before, round.amplitudesBeforeFinalH, { kind: 'before' });
  buildGrid(after, round.amplitudesAfterFinalH, { kind: 'after', measured: round.measured });

  // The count decides the sentence. Against the control f is injective, the
  // output read collapses the input register to a single basis state, and the
  // final Hadamard spreads it over every outcome with equal weight: nothing
  // cancels at all. Measured, that is 480 of 480 rounds at each of n = 4, 5, 6.
  // The old text printed "0 of 32 outcomes cancelled to exactly zero — they are
  // impossible, not merely unlikely", asserting an impossibility about the empty
  // set on the one target that exists to show the algorithm finding nothing.
  const total = round.amplitudesAfterFinalH.length;
  const cancelled = [...round.amplitudesAfterFinalH].filter((a) => amplitudeSign(a) === '0').length;
  el('after-note').textContent =
    cancelled === 0
      ? `None of the ${total} outcomes cancelled: this f is injective, so the read left a single input rather than a ` +
        `coset, and a single path cannot interfere with itself. Every outcome stays possible — which is exactly why ` +
        `the rank climbs to n and no period is found. The measured outcome is ringed.`
      : `${cancelled} of ${total} outcomes cancelled — their contributing paths sum to zero exactly, so they are ` +
        `impossible, not merely unlikely. (The float amplitudes land within 1e-12 of zero, and are classified by ` +
        `that tolerance.) The measured outcome is ringed.`;
}

function renderArithmetic(): void {
  const body = el('arith-body');
  clear(body);
  const round = state.lastRound;
  const y = state.selectedY;
  if (!round || y === null) {
    body.appendChild(make('p', 'panel-note', 'Pick a cell in either grid.'));
    return;
  }

  const intro = make('p', 'panel-note');
  intro.textContent = `Outcome y = ${bits(y, state.n)}. Each input still in the superposition contributes a term (−1)^(x · y):`;
  body.appendChild(intro);

  const sum = make('div', 'arith-sum');
  let total = 0;
  round.preimage.forEach((x, i) => {
    if (i > 0) sum.appendChild(make('span', 'arith-op', '+'));
    let parityBit = 0;
    for (let b = 0; b < state.n; b++) if ((x >>> b) & 1 && (y >>> b) & 1) parityBit ^= 1;
    const term = parityBit === 0 ? 1 : -1;
    total += term;
    sum.appendChild(make('span', 'arith-term', `x=${bits(x, state.n)} → ${term > 0 ? '+1' : '−1'}`));
  });
  sum.appendChild(make('span', 'arith-op', '='));
  const kills = total === 0;
  sum.appendChild(make('span', `arith-result ${kills ? 'kills' : 'lives'}`, total > 0 ? `+${total}` : String(total)));
  body.appendChild(sum);

  const verdict = make('p', 'arith-verdict');
  verdict.textContent = kills
    ? 'The paths cancel exactly. This outcome has probability zero — the machine can never return it, which is what makes every measurement informative.'
    : round.preimage.length === 1
      ? `A single path has nothing to reinforce with and nothing to cancel against. This outcome survives, as every outcome does here, and measuring it would give the equation ${equationText(y, state.n)}.`
      : `The paths reinforce. This outcome survives, and measuring it would give the equation ${equationText(y, state.n)}.`;
  body.appendChild(verdict);

  // Three cases, not two. The old two-way branch sent everything that was not a
  // clean pair down the "more than a clean pair, because f collided by accident
  // on top of its period" sentence — and against the control the class holds
  // exactly ONE input, in 480 of 480 measured rounds at each of n = 4, 5, 6.
  // That sentence then asserted three things at once that are all false there:
  // that the class is larger than a pair, that f has a period to collide on top
  // of, and that the cancellation kills every y with y·s = 1. It said this on
  // the one target whose whole job is to show the algorithm finding nothing.
  const why = make('p', 'arith-verdict');
  why.textContent =
    round.preimage.length === 1
      ? 'There is only one contributing path, so there is nothing to interfere with: a single term can never sum to zero. That is what an injective f looks like from inside the circuit — no outcome is cancelled, every one of them stays possible, and the equations that come back span the whole space instead of a hyperplane.'
      : round.preimage.length === 2
        ? 'The two inputs differ by exactly s, so their signs disagree precisely when y · s = 1 — which is why every outcome that survives satisfies y · s = 0.'
        : 'This preimage class holds more than a clean pair, because f collided by accident on top of its period. The class is still a union of s-cosets, so the cancellation still kills every y with y · s = 1.';
  body.appendChild(why);
}

/* ── one round ────────────────────────────────────────────────────────── */

function applyMeasurement(round: SimonRound): void {
  const t = state.target!;
  state.lastRound = round;
  state.selectedY = round.measured;

  const res = insert(state.system, round.measured);
  state.system = res.system;
  state.measurements.push({ y: round.measured, accepted: res.accepted });

  const cands = candidatePeriods(state.system);
  if (cands.length === 0) {
    state.status = 'noPeriod';
  } else if (cands.length === 1) {
    const s = cands[0];
    if (verifyPeriod(t.table, state.n, s).holds) {
      state.status = 'solved';
      state.solved = { period: s, exploit: t.exploit(s) };
    } else {
      if (!state.rejectedCandidates.includes(s)) state.rejectedCandidates.push(s);
      state.status = 'rejected';
    }
  } else {
    state.status = state.rejectedCandidates.length > 0 ? 'rejected' : 'working';
  }
  if (state.status !== 'solved' && state.status !== 'noPeriod' && state.measurements.length >= MAX_ROUNDS(state.n)) {
    state.status = 'stalled';
  }
}

function finished(): boolean {
  return state.status === 'solved' || state.status === 'noPeriod' || state.status === 'stalled';
}

async function measureOnce(animate = true): Promise<void> {
  const t = state.target;
  if (!t || finished() || state.busy) return;
  const token = supersede();
  state.busy = true;
  syncButtons();

  const stepDelay = animate && !reducedMotion() ? 110 : 0;
  for (let i = 0; i < CIRCUIT_STEPS.length; i++) {
    renderCircuit(i);
    if (stepDelay) await wait(stepDelay);
    if (token !== runToken) return;
  }

  const round = simonRound(t.table, t.n, t.m, Math.random(), Math.random());
  applyMeasurement(round);

  renderCircuit(-1);
  renderAll();
  state.busy = false;
  syncButtons();
}

async function runToVerdict(): Promise<void> {
  if (!state.target || finished() || state.busy) return;
  const token = supersede();
  const stepDelay = reducedMotion() ? 0 : 90;
  state.busy = true;
  syncButtons();
  while (!finished() && state.measurements.length < MAX_ROUNDS(state.n)) {
    const t = state.target;
    if (!t) break;
    const round = simonRound(t.table, t.n, t.m, Math.random(), Math.random());
    applyMeasurement(round);
    renderAll();
    if (stepDelay) await wait(stepDelay);
    if (token !== runToken) return;
  }
  renderCircuit(-1);
  renderAll();
  state.busy = false;
  syncButtons();
}

function syncButtons(): void {
  const done = finished();
  (el('measure') as HTMLButtonElement).disabled = state.busy || done || !state.target;
  (el('run-all') as HTMLButtonElement).disabled = state.busy || done || !state.target;
  el('run-hint').textContent = done
    ? 'This run is finished. Reset the equations, or take a new secret, to run it again.'
    : 'One press = one query to f. Watch the query counter, not the clock.';
  for (const b of el('seg-target').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.target === state.targetId));
  }
  for (const b of el('seg-width').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.width) === state.n));
  }
}

/* ── the measured race ────────────────────────────────────────────────── */

async function runRacePanel(): Promise<void> {
  const btn = el<HTMLButtonElement>('race-run');
  const status = el('race-status');
  const out = el('race-out');
  btn.disabled = true;
  const trials = 40;
  // The race spans three widths and yields the event loop between them, and the
  // target selector stays live throughout — a visitor may switch target while
  // it runs. Read `state.targetId` once, here, and use that snapshot for every
  // trial and for the caption. Reading it live meant a switch landing on one of
  // those boundaries silently measured the later widths against a DIFFERENT
  // function than the earlier ones, and then labelled the whole table with
  // whichever target happened to be selected when the last row landed: three
  // rows presented as one experiment that were two.
  const racedId = state.targetId;
  const racedLabel = TARGET_LABELS[racedId];
  status.textContent = `Running ${trials} trials per width against fresh ${racedLabel} instances…`;
  clear(out);

  const rng = makeRng(0x5170ce);
  for (const n of [4, 5, 6]) {
    let q = 0;
    let c = 0;
    // Whether the classical side is doing a birthday search is a fact about the
    // runs, not about the label: count the trials in which it actually found a
    // period from a collision. Against the control that count is zero — measured,
    // 0 of 40 at each of n = 4, 5, 6 — because a permutation never collides, so
    // the search exhausts the domain and returns nothing. Labelling that bar
    // "birthday (classical)" and printing a 2^(n/2) bound beside a measured 2^n
    // named an algorithm the row had not run.
    let cFound = 0;
    for (let i = 0; i < trials; i++) {
      const t = await makeTarget(racedId, n);
      q += quantumPeriodSearch(t.table, n, t.m, rng).queries;
      const cr = classicalPeriodSearch(t.table, n, rng);
      c += cr.queries;
      if (cr.period !== null) cFound++;
    }
    out.appendChild(renderRaceRow(n, q / trials, c / trials, trials, cFound));
    status.textContent = `Completed n = ${n}…`;
    await wait(0);
  }
  status.textContent = `Done — ${trials} trials at each width, against ${racedLabel}. Every number is a measured mean.`;
  btn.disabled = false;
}

function renderRaceRow(
  n: number,
  quantum: number,
  classical: number,
  trials: number,
  classicalFoundPeriod: number,
): HTMLElement {
  // A birthday bound describes the cost of finding a collision. If no trial
  // found one, quoting the bound and calling the bar "birthday" both describe an
  // algorithm that did not run — the classical side proved injectivity instead.
  const isBirthdaySearch = classicalFoundPeriod > 0;
  const row = make('div', 'race-row');
  const head = make('div', 'race-row-head');
  head.appendChild(make('h3', undefined, `n = ${n}  (domain 2^${n} = ${1 << n})`));
  head.appendChild(
    make(
      'span',
      'race-ratio',
      isBirthdaySearch
        ? `classical / quantum = ${(classical / quantum).toFixed(2)}× · ${trials} trials · birthday bound 2^(n/2) ≈ ${Math.pow(2, n / 2).toFixed(1)}`
        : `classical / quantum = ${(classical / quantum).toFixed(2)}× · ${trials} trials · no collision found in any trial, so no birthday bound applies — the reference here is the whole domain, 2^${n} = ${1 << n}`,
    ),
  );
  row.appendChild(head);

  const max = Math.max(quantum, classical, 1);
  for (const [label, value, cls] of [
    ['Simon (quantum)', quantum, ''],
    [isBirthdaySearch ? 'birthday (classical)' : 'exhaustive (classical)', classical, 'classical'],
  ] as const) {
    const bar = make('div', `race-bar ${cls}`.trim());
    bar.appendChild(make('span', 'bar-label', label));
    const track = make('span', 'bar-track');
    const fill = make('span', 'bar-fill');
    fill.style.width = `${(value / max) * 100}%`;
    track.appendChild(fill);
    bar.appendChild(track);
    bar.appendChild(make('span', 'bar-value', formatMean(value)));
    row.appendChild(bar);
  }
  row.appendChild(
    make(
      'p',
      'panel-note',
      isBirthdaySearch
        ? `Mean oracle queries. The quantum row is one query per Simon round; the classical row is one query per distinct input tried. A collision gave the classical side its candidate in ${classicalFoundPeriod} of ${trials} trials.`
        : `Mean oracle queries. The quantum row is one query per Simon round; the classical row is one query per distinct input tried. This f is injective, so it never collides: in 0 of ${trials} trials did the classical side find a period, and it had to read all ${1 << n} inputs to establish that. This row is a proof-of-absence comparison, not a period-finding race — the birthday bound governs neither side of it.`,
    ),
  );
  return row;
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

function renderAll(): void {
  renderMeters();
  renderVerdict();
  renderEquations();
  renderMatrix();
  renderCandidates();
  renderInterference();
  renderArithmetic();
}

function resetRun(): void {
  state.system = newSystem(state.n);
  state.measurements = [];
  state.rejectedCandidates = [];
  state.lastRound = null;
  state.selectedY = null;
  state.status = 'idle';
  state.solved = null;
  renderCircuit(-1);
  renderAll();
  syncButtons();
}

async function rebuild(): Promise<void> {
  const token = supersede();
  state.busy = true;
  syncButtons();
  const target = await makeTarget(state.targetId, state.n);
  if (token !== runToken) return; // a newer selection took over while we awaited
  state.target = target;
  renderSelectors();
  renderTargetCard();
  resetRun();
  state.busy = false;
  syncButtons();
}

function wireControls(): void {
  el('measure').addEventListener('click', () => void measureOnce());
  el('run-all').addEventListener('click', () => void runToVerdict());
  el('reset').addEventListener('click', () => {
    supersede();
    state.busy = false;
    resetRun();
  });
  el('new-secret').addEventListener('click', () => void rebuild());
  el('race-run').addEventListener('click', () => void runRacePanel());

  const peek = el<HTMLButtonElement>('peek');
  peek.addEventListener('click', () => {
    const box = el('secret-box');
    const open = box.hidden;
    box.hidden = !open;
    peek.setAttribute('aria-expanded', String(open));
    peek.textContent = open ? 'Hide the secret' : 'Peek at the secret';
  });
}

async function boot(): Promise<void> {
  renderSelectors();
  renderCircuit(-1);
  wireControls();
  await rebuild();
}

void boot();
