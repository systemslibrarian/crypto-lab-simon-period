/**
 * Functional coverage for the claims simon-period makes on screen.
 *
 * The a11y suite drives every exhibit into every reachable state but reads none
 * of the output, so no verdict, equation or failure path was asserted. These
 * tests read the rendered DOM and check the page against itself and against the
 * GF(2) arithmetic redone here: the period in the verdict must be the one the
 * secret panel is holding, every outcome the interference grid cancels must be
 * a y with y·s = 1 and every survivor a y with y·s = 0, every measured equation
 * must satisfy y·s = 0, the recovered key must reproduce the cipher's own
 * answer, and the forged MAC tag must equal what the real MAC returns.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto('.');
  await expect(page.locator('#run-all')).toBeVisible();
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

async function textOf(locator: Locator): Promise<string> {
  return flat(await locator.innerText());
}

function capture(haystack: string, re: RegExp, what: string): string {
  const m = haystack.match(re);
  expect(m, `${what} not found in: ${haystack.slice(0, 400)}`).not.toBeNull();
  return m![1]!;
}

const fromBits = (bits: string): number => parseInt(bits, 2);

/** GF(2) inner product of two bit vectors given as numbers. */
function dot(a: number, b: number): number {
  let v = a & b;
  let parity = 0;
  while (v) {
    parity ^= v & 1;
    v >>>= 1;
  }
  return parity;
}

async function chooseTarget(page: Page, id: string, name: string): Promise<void> {
  await page.locator(`#seg-target button[data-target="${id}"]`).click();
  await expect(page.locator('#target-name')).toHaveText(name);
  await expect(page.locator(`#seg-target button[data-target="${id}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

async function chooseWidth(page: Page, n: number): Promise<void> {
  await page.locator(`#seg-width button[data-width="${n}"]`).click();
  await expect(page.locator(`#seg-width button[data-width="${n}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#rank-value')).toContainText(`/ ${n - 1} needed`);
}

/**
 * Run to a terminal verdict.
 *
 * Terminal state is read from the verdict text, not its class: the non-breaking
 * "Period recovered" outcome deliberately reuses the neutral `is-working`
 * styling, so only the icon and the wording separate it from "Collecting
 * equations". The tests below assert that separation explicitly.
 */
async function runAll(page: Page): Promise<void> {
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toContainText(/BROKEN|Period recovered|NO PERIOD/, {
    timeout: 60_000,
  });
}

/** The after-measurement grid: each outcome's bit label and whether it cancelled. */
async function afterGrid(page: Page): Promise<Array<{ y: string; zero: boolean; sign: string }>> {
  return page.locator('#grid-after .amp-cell').evaluateAll((cells) =>
    cells.map((cell) => ({
      y: cell.querySelector('.amp-y')!.textContent!.trim(),
      zero: cell.classList.contains('zero'),
      sign: cell.querySelector('.amp-sign')!.textContent!.trim(),
    })),
  );
}

// ---------------------------------------------------------------------------
// Exhibit 1 — Even-Mansour
// ---------------------------------------------------------------------------

test('even-mansour: the recovered key is the held key, and it reproduces the cipher', async ({
  page,
}) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');

  // The secret is not on screen until asked for — the circuit never reads it.
  await expect(page.locator('#secret-box')).toBeHidden();
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeVisible();
  const secret = await textOf(page.locator('#secret-box'));
  expect(secret).toContain('The circuit below never reads this — it only ever queries f.');
  const k1 = capture(secret, /whitening key k₁ ([01]+)/, 'k₁');
  const k2 = capture(secret, /whitening key k₂ ([01]+)/, 'k₂');

  await runAll(page);

  const verdict = await textOf(page.locator('#verdict'));
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/);
  const s = capture(verdict, /BROKEN — period s = ([01]+)/, 'period');
  expect(verdict).toContain(`Verified against f over all ${1 << s.length} inputs`);
  expect(verdict).toContain('f(x) = f(x ⊕ s) everywhere');

  // The queries the verdict counts are the equations the log holds.
  const queries = Number(capture(verdict, /(\d+) quer(?:y|ies) spent/, 'query count'));
  await expect(page.locator('#eq-list .eq')).toHaveCount(queries);

  // Rank reached exactly what the page said it needed.
  expect(await textOf(page.locator('#rank-value'))).toBe(`${s.length - 1} / ${s.length - 1} needed`);

  // One surviving candidate, and it is the period.
  const cands = await textOf(page.locator('#cand-list'));
  expect(cands).toContain('Exactly one candidate survives');
  await expect(page.locator('#cand-list .cand.solo')).toHaveCount(1);
  await expect(page.locator('#cand-list .cand.solo')).toHaveText(s);

  // The exploit: the recovered key halves are the held ones, and the predicted
  // ciphertext is the cipher's own answer.
  const exploit = await textOf(page.locator('#exploit'));
  expect(exploit).toContain('Full key recovered — cipher predicted');
  expect(capture(exploit, /recovered k₁ \(= the period\) ✓ ([01]+)/, 'recovered k₁')).toBe(s);
  expect(capture(exploit, /recovered k₁ \(= the period\) ✓ ([01]+)/, 'recovered k₁')).toBe(k1);
  expect(capture(exploit, /derived k₂ = E\(0\) ⊕ P\(k₁\) ✓ ([01]+)/, 'derived k₂')).toBe(k2);
  const block = capture(exploit, /predicted E\(([01]+)\)/, 'predicted block');
  const predicted = capture(exploit, /predicted E\([01]+\) ✓ ([01]+)/, 'prediction');
  const real = capture(exploit, new RegExp(`real E\\(${block}\\) ✓ ([01]+)`), 'real ciphertext');
  expect(predicted).toBe(real);
  expect(exploit).toContain('the derived key reproduces all 32 blocks of the cipher');
  // Nothing in the recovery panel may be marked as failing.
  expect(exploit).not.toContain('✗');
});

test('cbc-mac: the forged tag is the tag the real MAC returns, for a message never queried', async ({
  page,
}) => {
  await chooseTarget(page, 'cbc-mac', 'CBC-MAC');
  await runAll(page);

  await expect(page.locator('#verdict')).toHaveClass(/is-broken/);
  const verdict = await textOf(page.locator('#verdict'));
  expect(verdict).toMatch(/BROKEN — period s = [01]+/);

  const exploit = await textOf(page.locator('#exploit'));
  expect(exploit).toContain('Forgery accepted by the real MAC');
  const queried = capture(exploit, /queried: MAC\(α₀ ‖ ([01]+)\)/, 'queried message');
  const forgedMsg = capture(exploit, /forged: MAC\(α₁ ‖ ([01]+)\)/, 'forged message');
  const forgedTag = capture(exploit, /forged: MAC\(α₁ ‖ [01]+\) ✓ ([01]+)/, 'forged tag');
  const realTag = capture(exploit, /what the real MAC returns ✓ ([01]+)/, 'real tag');
  expect(forgedTag).toBe(realTag);
  expect(forgedMsg).not.toBe(queried);
  expect(exploit).toContain('The forged message was never queried, and the tag matches byte for byte');
  expect(exploit).not.toContain('✗');
});

test('textbook target: the period is recovered, and the verdict is not dressed as a break', async ({
  page,
}) => {
  await chooseTarget(page, 'textbook', 'Textbook 2-to-1');
  await runAll(page);

  const verdict = await textOf(page.locator('#verdict'));
  const s = capture(verdict, /Period recovered — s = ([01]+)/, 'period');
  // Recovering a period in a function with no key is not an alarm.
  expect(verdict).not.toContain('BROKEN');
  await expect(page.locator('#verdict')).not.toHaveClass(/is-broken/);
  // The completed state must still be legible as completed: "Collecting
  // equations" is the only other thing wearing this styling.
  expect(verdict).toContain('✓');
  expect(verdict).not.toContain('Collecting equations');
  expect(verdict).toContain('Verified against f over all 32 inputs');
  await expect(page.locator('#exploit')).toHaveClass(/neutral/);

  const exploit = await textOf(page.locator('#exploit'));
  expect(capture(exploit, /recovered s ✓ ([01]+)/, 'recovered s')).toBe(s);
  expect(capture(exploit, /true s ✓ ([01]+)/, 'true s')).toBe(s);
  expect(exploit).toContain('Nothing about f was searched, guessed, or brute-forced');
});

test('no-period control: the absence is proved exhaustively, not assumed from a timeout', async ({
  page,
}) => {
  await chooseTarget(page, 'no-period', 'No period (control)');
  const n = 5;
  await chooseWidth(page, n);
  await runAll(page);

  await expect(page.locator('#verdict')).toHaveClass(/is-safe/);
  const verdict = await textOf(page.locator('#verdict'));
  expect(verdict).toContain('NO PERIOD — nothing to find');
  expect(verdict).toContain(`The rank reached n = ${n}`);
  expect(verdict).toContain('That is a proof, not a timeout.');
  // Rank n, one past the n−1 a period would have needed.
  expect(await textOf(page.locator('#rank-value'))).toBe(`${n} / ${n - 1} needed`);

  const exploit = await textOf(page.locator('#exploit'));
  expect(exploit).toContain('Confirmed: no period exists');
  // Every non-zero candidate was tested, and none held.
  expect(Number(capture(exploit, /candidate periods tested (\d+)/, 'candidates tested'))).toBe(
    (1 << n) - 1,
  );
  expect(Number(capture(exploit, /periods that hold for all x ✓ (\d+)/, 'periods found'))).toBe(0);
  expect(exploit).toContain('Checked exhaustively against the function itself, not inferred');
  // No period means no exploit panel dressed as a break.
  await expect(page.locator('#exploit')).toHaveClass(/neutral/);
});

// ---------------------------------------------------------------------------
// The mechanism: interference and the linear system
// ---------------------------------------------------------------------------

test('interference: the grid cancels exactly the outcomes with y·s = 1, and the arithmetic adds up', async ({
  page,
}) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  const n = 5;
  await chooseWidth(page, n);
  await runAll(page);

  const s = fromBits(capture(await textOf(page.locator('#verdict')), /period s = ([01]+)/, 'period'));
  const cells = await afterGrid(page);
  expect(cells).toHaveLength(1 << n);

  // The claim the whole algorithm rests on, checked outcome by outcome: an
  // outcome with y·s = 1 must cancel, and anything that survives must be a
  // valid equation, i.e. y·s = 0. (The converse is not claimed: this target
  // does not satisfy Simon's promise exactly, so a preimage class larger than
  // a clean pair can cancel outcomes that are orthogonal to s as well.)
  for (const cell of cells) {
    const y = fromBits(cell.y);
    if (dot(y, s) === 1) {
      expect(cell.zero, `outcome ${cell.y} has y·s = 1 and must cancel`).toBe(true);
      expect(cell.sign).toBe('0');
    }
    if (!cell.zero) {
      expect(dot(y, s), `surviving outcome ${cell.y} must satisfy y·s = 0`).toBe(0);
      expect(['+', '−', '-']).toContain(cell.sign);
    }
  }
  // At least half the outcomes are impossible, and at least one is not.
  expect(cells.filter((c) => c.zero).length).toBeGreaterThanOrEqual(1 << (n - 1));
  expect(cells.some((c) => !c.zero)).toBe(true);

  /** Read the selected outcome's per-path arithmetic. */
  const arithmetic = async (): Promise<{
    y: number;
    paths: Array<{ x: number; sign: number }>;
    sum: number;
    text: string;
  }> => {
    const text = await textOf(page.locator('#arith'));
    const y = fromBits(capture(text, /Outcome y = ([01]+)\./, 'selected outcome'));
    const paths = [...text.matchAll(/x=([01]+) → ([+−-])1/g)].map((m) => ({
      x: fromBits(m[1]!),
      sign: m[2]! === '+' ? 1 : -1,
    }));
    const sum = Number(capture(text, /= ([+−-]?\d+) /, 'sum').replace('−', '-').replace('+', ''));
    return { y, paths, sum, text };
  };

  /** Every path's sign is (−1)^(x·y), the sum is the sum, and s pairs them up. */
  const checkArithmetic = (a: { y: number; paths: Array<{ x: number; sign: number }>; sum: number }): void => {
    expect(a.paths.length).toBeGreaterThanOrEqual(2);
    for (const path of a.paths) {
      expect(path.sign, `sign of x=${path.x.toString(2)} must be (−1)^(x·y)`).toBe(
        dot(path.x, a.y) ? -1 : 1,
      );
      // The inputs still in the superposition are a coset containing x ⊕ s.
      expect(
        a.paths.some((other) => other.x === (path.x ^ s)),
        `x=${path.x.toString(2)} has no partner at x ⊕ s`,
      ).toBe(true);
    }
    expect(a.sum, 'the printed sum must be the sum of the printed terms').toBe(
      a.paths.reduce((acc, p) => acc + p.sign, 0),
    );
  };

  // A cancelled outcome: the terms must genuinely add to zero.
  await page.locator('#grid-after .amp-cell.zero').first().click();
  const killed = await arithmetic();
  checkArithmetic(killed);
  expect(killed.sum).toBe(0);
  expect(killed.text).toContain('The paths cancel exactly.');
  expect(killed.text).toContain('This outcome has probability zero');
  await expect(page.locator('.arith-result.kills')).toBeVisible();
  await expect(page.locator('.arith-result.lives')).toHaveCount(0);

  // A surviving outcome: the terms must reinforce, and y·s = 0.
  await page.locator('#grid-after .amp-cell.pos, #grid-after .amp-cell.neg').first().click();
  const live = await arithmetic();
  checkArithmetic(live);
  expect(dot(live.y, s)).toBe(0);
  expect(Math.abs(live.sum)).toBe(live.paths.length);
  expect(live.text).toContain('The paths reinforce.');
  expect(live.text).toContain('This outcome survives');
  await expect(page.locator('.arith-result.lives')).toBeVisible();
  await expect(page.locator('.arith-result.kills')).toHaveCount(0);
});

test('the linear system: every measured equation satisfies y·s = 0, and the rank only grows', async ({
  page,
}) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  const n = 4;
  await chooseWidth(page, n);

  // Nothing measured yet: no equations, no rank, every vector still possible.
  expect(await textOf(page.locator('#verdict'))).toContain('Not started');
  expect(await textOf(page.locator('#rank-value'))).toBe(`0 / ${n - 1} needed`);
  await expect(page.locator('#eq-list .eq')).toHaveCount(0);
  expect(await textOf(page.locator('#eq-list'))).toContain('No measurements yet.');
  expect(await textOf(page.locator('#cand-list'))).toContain(
    `Every non-zero vector — ${(1 << n) - 1} of them — is still possible.`,
  );

  const rank = async (): Promise<number> =>
    Number(capture(await textOf(page.locator('#rank-value')), /^(\d+) \//, 'rank'));

  let previous = 0;
  const seen: string[] = [];
  for (let round = 1; round <= 12; round++) {
    await page.locator('#measure').click();
    await expect(page.locator('#eq-list .eq')).toHaveCount(round);
    const current = await rank();
    // Rank is monotone and can climb by at most one per measurement.
    expect(current, `round ${round}`).toBeGreaterThanOrEqual(previous);
    expect(current - previous, `round ${round}`).toBeLessThanOrEqual(1);

    const rows = await page.locator('#eq-list .eq').allInnerTexts();
    expect(rows).toHaveLength(round);
    const last = flat(rows[round - 1]!);
    seen.push(capture(last, /y = ([01]+)/, `y of round ${round}`));
    // A row is either new information, a repeat, or the useless y = 0.
    const flag = capture(last, /(NEW|REDUNDANT|y = 0, NO INFO)$/, `flag of round ${round}`);
    if (flag === 'NEW') expect(current, `round ${round}`).toBe(previous + 1);
    else expect(current, `round ${round}`).toBe(previous);

    previous = current;
    if (await page.locator('#verdict.is-broken').count()) break;
  }

  const verdict = await textOf(page.locator('#verdict'));
  const s = fromBits(capture(verdict, /period s = ([01]+)/, 'period'));
  // Every outcome the machine returned is orthogonal to the period. That is
  // the only thing a measurement is allowed to be.
  for (const y of seen) {
    expect(dot(fromBits(y), s), `measured y = ${y} must satisfy y·s = 0`).toBe(0);
  }

  // The reduced matrix reports the same rank the counter does.
  const matrix = await textOf(page.locator('#matrix-wrap'));
  expect(matrix).toContain(`Rank ${previous} of ${n}`);
  expect(previous).toBe(n - 1);
});

test('reset and width: a new setting starts from nothing rather than keeping a stale verdict', async ({
  page,
}) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await chooseWidth(page, 4);
  await runAll(page);
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/);
  await expect(page.locator('#grid-after .amp-cell')).toHaveCount(16);

  // Reset clears the run, not just the verdict.
  await page.locator('#reset').click();
  expect(await textOf(page.locator('#verdict'))).toContain('Not started');
  expect(await textOf(page.locator('#verdict'))).not.toContain('BROKEN');
  expect(await textOf(page.locator('#rank-value'))).toBe('0 / 3 needed');
  await expect(page.locator('#eq-list .eq')).toHaveCount(0);
  // The exploit panel is taken off screen rather than left standing.
  await expect(page.locator('#exploit')).toBeHidden();

  // Widening restarts at the new domain size.
  await runAll(page);
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/);
  await chooseWidth(page, 6);
  expect(await textOf(page.locator('#verdict'))).toContain('Not started');
  expect(await textOf(page.locator('#rank-value'))).toBe('0 / 5 needed');
  await expect(page.locator('#eq-list .eq')).toHaveCount(0);

  await runAll(page);
  await expect(page.locator('#grid-after .amp-cell')).toHaveCount(64);
  const s = capture(await textOf(page.locator('#verdict')), /period s = ([01]+)/, 'period');
  expect(s).toHaveLength(6);
});

// ---------------------------------------------------------------------------
// Exhibit 7 — the measured race
// ---------------------------------------------------------------------------

test('the race is measured, and every headline ratio is the two numbers beside it', async ({
  page,
}) => {
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });

  const rows = await page.locator('#race-out .race-row').allInnerTexts();
  const widths = [4, 5, 6];
  rows.forEach((raw, i) => {
    const row = flat(raw);
    const n = widths[i]!;
    expect(row).toContain(`n = ${n} (domain 2^${n} = ${1 << n})`);

    const ratio = Number(capture(row, /classical \/ quantum = ([\d.]+)×/, `ratio for n=${n}`));
    const quantum = Number(capture(row, /Simon \(quantum\) ([\d.]+)/, `quantum mean for n=${n}`));
    const classical = Number(capture(row, /birthday \(classical\) ([\d.]+)/, `classical mean for n=${n}`));
    const birthday = Number(capture(row, /birthday bound 2\^\(n\/2\) ≈ ([\d.]+)/, `bound for n=${n}`));

    // The headline ratio is the two measured means, not a stated constant.
    expect(ratio, `ratio for n=${n}`).toBeCloseTo(classical / quantum, 1);
    // The cited bound is sqrt(2^n), computed rather than tabulated.
    expect(birthday, `bound for n=${n}`).toBeCloseTo(Math.sqrt(1 << n), 1);
    expect(quantum, `quantum mean for n=${n}`).toBeGreaterThan(0);
    expect(row).toContain('trials');
    expect(row).toContain('Mean oracle queries.');
  });

  // The advantage must widen with n — that is the point of the exhibit.
  const ratios = rows.map((raw) =>
    Number(capture(flat(raw), /classical \/ quantum = ([\d.]+)×/, 'ratio')),
  );
  expect(ratios[2]).toBeGreaterThan(ratios[0]!);
});
