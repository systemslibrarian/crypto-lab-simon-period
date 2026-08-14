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

/**
 * The rank threshold the page is entitled to print, for the target currently
 * selected: n−1 isolates a period, n proves there is none. The control's rank
 * runs to n, so measuring it against an n−1 denominator printed "5 / 4 needed" —
 * a requirement the run had already passed — and this suite used to assert that
 * string verbatim rather than question it.
 */
async function rankGoal(page: Page, n: number): Promise<number> {
  const control = await page
    .locator('#seg-target button[data-target="no-period"]')
    .getAttribute('aria-pressed');
  return control === 'true' ? n : n - 1;
}

async function chooseWidth(page: Page, n: number): Promise<void> {
  await page.locator(`#seg-width button[data-width="${n}"]`).click();
  await expect(page.locator(`#seg-width button[data-width="${n}"]`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#rank-value')).toContainText(`/ ${await rankGoal(page, n)} needed`);
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
  // A break claim has to state the access it needed. Simon's attack lives in the
  // Q2 model, and a verdict that says BROKEN without saying so claims more than
  // this run learned.
  expect(verdict).toContain('Broken in the Q2 model only');
  expect(verdict).toContain('superposition query to the keyed primitive');

  // The queries the verdict counts are the equations the log holds — and the
  // count is labelled as superposition queries, because the full-domain
  // verification the same sentence describes is classical table reads the
  // tally deliberately excludes.
  const queries = Number(capture(verdict, /(\d+) superposition quer(?:y|ies) spent/, 'query count'));
  expect(verdict).toContain('not counted below');
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
  expect(verdict).toContain('Broken in the Q2 model only');

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
  // No key, so nothing to break — and therefore no break qualifier either. The
  // Q2 caveat belongs on the two verdicts that claim a break and nowhere else.
  expect(verdict, 'a keyless function is not broken in any model').not.toContain('Q2');
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
  // The threshold this run was working toward is n, and the meter says n — it
  // used to say `${n} / ${n - 1} needed`, printing a rank past a requirement it
  // claimed was still outstanding. This assertion was the string that pinned it.
  expect(await textOf(page.locator('#rank-value'))).toBe(`${n} / ${n} needed`);
  expect(await textOf(page.locator('#rank-note'))).toContain(`Rank n = ${n}`);
  expect(await textOf(page.locator('#rank-note'))).not.toContain('pinned once the rank reaches n−1');
  expect(await page.locator('#rank-meter').getAttribute('aria-label')).toBe(`Rank ${n} of ${n} needed`);

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

/**
 * Regression — the interference panels described a periodic f while showing an
 * injective one.
 *
 * Reading the output register of an injective f collapses the input register to
 * a SINGLE basis state, so the final Hadamard spreads it evenly over every
 * outcome and nothing cancels. Measured headless over the lab's own engine:
 * 480 of 480 rounds at each of n = 4, 5, 6 against the control had preimage size
 * 1 and zero cancelled outcomes. Both panels nonetheless printed prose written
 * for a periodic target — the arithmetic panel took its "not a clean pair"
 * branch and asserted that f "collided by accident on top of its period" and
 * that "the cancellation still kills every y with y · s = 1", on the one target
 * whose entire job is to show that there is no period and nothing cancels; the
 * grid note announced "0 of 32 outcomes cancelled to exactly zero — they are
 * impossible, not merely unlikely".
 *
 * The suite did not catch it because every test that reads these two panels
 * selects Even-Mansour first, and their assertions — `share >= 2`,
 * `share % 2 === 0`, `zero >= 2^(n-1)`, `paths.length >= 2` — are each false for
 * the control. The scope was the defence.
 */
test('the control target is described as injective, not as a period the panels cannot see', async ({
  page,
}) => {
  const n = 5;
  await chooseTarget(page, 'no-period', 'No period (control)');
  await chooseWidth(page, n);

  let rounds = 0;
  let singlePath = 0;
  for (let i = 0; i < 8; i++) {
    // Proving absence terminates the run at rank n, in ~6 rounds at n = 5, so
    // keep going across resets rather than assuming the button stays live.
    if (await page.locator('#measure').isDisabled()) {
      await page.locator('#reset').click();
      await expect(page.locator('#measure')).toBeEnabled();
    }
    await page.locator('#measure').click();
    await expect(page.locator('#before-note')).toContainText('share that value');
    rounds++;

    // The state: one input in the superposition, nothing cancelled.
    const share = Number(
      capture(await textOf(page.locator('#before-note')), /(\d+) inputs? share that value/, 'preimage size'),
    );
    expect(share, 'an injective f has exactly one preimage per output').toBe(1);
    expect(await page.locator('#grid-before .amp-cell:not(.empty)').count()).toBe(1);
    expect(await page.locator('#grid-after .amp-cell.zero').count(), 'nothing cancels here').toBe(0);

    // The claim: the grid note must not assert an impossibility about a set it
    // just reported as empty.
    const afterNote = await textOf(page.locator('#after-note'));
    expect(afterNote, 'the note explains why nothing cancelled').toContain('None of the 32 outcomes cancelled');
    expect(afterNote).not.toContain('they are impossible');

    // The claim: the arithmetic panel has one path and must say so, without
    // inventing a period, a coset structure, or a cancellation.
    const arith = await textOf(page.locator('#arith-body'));
    const paths = [...arith.matchAll(/x=([01]+) → ([+−-])1/g)];
    expect(paths, 'the panel shows the one contributing path').toHaveLength(1);
    singlePath++;
    for (const forbidden of [
      'collided by accident on top of its period',
      'union of s-cosets',
      'kills every y with y · s = 1',
      'more than a clean pair',
      'The paths reinforce',
      'differ by exactly s',
    ]) {
      expect(arith, `the control's arithmetic panel must not claim: ${forbidden}`).not.toContain(forbidden);
    }
    expect(arith).toContain('only one contributing path');
    expect(arith).toContain('a single term can never sum to zero');
  }

  // Non-vacuous: the state this test exists for has to have actually occurred,
  // in every round, and there has to have been more than zero of them.
  expect(rounds, 'rounds were actually driven').toBeGreaterThanOrEqual(8);
  expect(singlePath, 'every round reached the single-path state under test').toBe(rounds);
});

/**
 * The same two panels, on a periodic target, must keep their periodic prose —
 * so the fix above is a branch and not a blanket rewrite. Even-Mansour collides
 * by accident on top of its period often enough to reach both surviving
 * branches: measured, 153 of 480 rounds at n = 4 and 198 of 480 at n = 6 have a
 * preimage class larger than a clean pair.
 */
test('a periodic target still gets the interference prose written for it', async ({ page }) => {
  const n = 5;
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await chooseWidth(page, n);

  let pairRounds = 0;
  let widerRounds = 0;
  for (let i = 0; i < 30 && (pairRounds === 0 || widerRounds === 0); i++) {
    if (await page.locator('#measure').isDisabled()) {
      await page.locator('#reset').click();
      await expect(page.locator('#measure')).toBeEnabled();
    }
    await page.locator('#measure').click();
    await expect(page.locator('#before-note')).toContainText('share that value');
    const share = Number(
      capture(await textOf(page.locator('#before-note')), /(\d+) inputs? share that value/, 'preimage size'),
    );
    const arith = await textOf(page.locator('#arith-body'));
    expect(await page.locator('#grid-after .amp-cell.zero').count(), 'at least half cancel').toBeGreaterThanOrEqual(
      1 << (n - 1),
    );
    expect(await textOf(page.locator('#after-note'))).toContain('are impossible, not merely unlikely');
    if (share === 2) {
      expect(arith).toContain('The two inputs differ by exactly s');
      pairRounds++;
    } else {
      expect(share, 'a periodic class is a union of s-cosets').toBeGreaterThan(2);
      expect(arith).toContain('holds more than a clean pair');
      widerRounds++;
    }
  }
  // A test that hunts for a rare state must fail when it never turns up.
  expect(pairRounds, 'the clean-pair branch was exercised').toBeGreaterThan(0);
  expect(widerRounds, 'the accidental-collision branch was exercised').toBeGreaterThan(0);
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

/**
 * A before-grid cell is an input basis state x; only the after-grid holds
 * measurement outcomes y. The panel used to run the outcome arithmetic on
 * whatever was clicked, so selecting input x silently relabelled it
 * "Outcome y = x" — the same bits under a different semantic role, with an
 * implied equation about a vector that was never measured. An input click now
 * gets an input explanation, and the outcome arithmetic stays where the
 * outcomes are.
 */
test('a before-grid click is explained as an input, never relabelled as an outcome', async ({
  page,
}) => {
  await page.locator('#measure').click();
  await expect(page.locator('#eq-list .eq')).toHaveCount(1);

  // A surviving input — one of the preimage the collapse kept.
  await page.locator('#grid-before .amp-cell:not(.empty)').first().click();
  let arith = await textOf(page.locator('#arith-body'));
  expect(arith).toContain('Input x =');
  expect(arith).toContain('survived the collapse');
  expect(arith, 'an input must not be presented as an outcome').not.toContain('Outcome y =');
  await expect(page.locator('.arith-result')).toHaveCount(0);

  // A removed input — f(x) is not the observed output.
  await page.locator('#grid-before .amp-cell.empty').first().click();
  arith = await textOf(page.locator('#arith-body'));
  expect(arith).toContain('Input x =');
  expect(arith).toContain('removed this input');
  expect(arith).not.toContain('Outcome y =');

  // An after-grid click still runs the per-outcome arithmetic.
  await page.locator('#grid-after .amp-cell').first().click();
  arith = await textOf(page.locator('#arith-body'));
  expect(arith).toContain('Outcome y =');
  expect(arith).not.toContain('Input x =');
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

  // The caption names the target the numbers came from, and the control is not
  // left dead behind the run.
  expect(await textOf(page.locator('#race-status'))).toBe(
    'Done — 40 trials at each width, against Even-Mansour. Every number is a measured mean.',
  );
  await expect(page.locator('#race-run')).toBeEnabled();
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('Done —', { timeout: 120_000 });
});

/** The race rows as numbers, with the bar geometry that draws them. */
interface RaceRow {
  n: number;
  quantum: number;
  classical: number;
  ratio: number;
  quantumWidth: number;
  classicalWidth: number;
}

/**
 * The headline ratio is computed from the full-precision means, while the bars
 * print theirs to one decimal, so the check is against the interval that
 * rounding admits — not a loose tolerance, the exact one.
 */
function expectRatioIsTheseNumbersDivided(r: RaceRow): void {
  const low = (r.classical - 0.05) / (r.quantum + 0.05);
  const high = (r.classical + 0.05) / (r.quantum - 0.05);
  expect(r.ratio, `n=${r.n}: headline ratio vs the bars it sits above`).toBeGreaterThan(low - 0.005);
  expect(r.ratio, `n=${r.n}: headline ratio vs the bars it sits above`).toBeLessThan(high + 0.005);
}

/**
 * The bars are laid out from the full-precision means against the longer of the
 * pair, while the label on each bar prints to one decimal — so, exactly as for
 * the headline ratio above, the check is the interval that rounding admits and
 * not the rounded value itself. At n = 6 against the control the gap is real:
 * a bar drawn from 12.95 is 20.234% wide where its own label, 13.0, would say
 * 20.313%. Both numbers are honest; only an assertion that confuses them is not.
 */
function expectBarsDrawnToScale(r: RaceRow): void {
  expect(r.classicalWidth === 100 || r.quantumWidth === 100, `n=${r.n}: the longer bar is full width`).toBe(true);
  const maxLow = Math.max(r.quantum - 0.05, r.classical - 0.05, 1);
  const maxHigh = Math.max(r.quantum + 0.05, r.classical + 0.05, 1);
  for (const [label, printed, width] of [
    ['quantum', r.quantum, r.quantumWidth],
    ['classical', r.classical, r.classicalWidth],
  ] as const) {
    const why = `n=${r.n}: ${label} bar length vs the number printed on it`;
    expect(width, why).toBeGreaterThanOrEqual(((printed - 0.05) / maxHigh) * 100);
    expect(width, why).toBeLessThanOrEqual(((printed + 0.05) / maxLow) * 100);
  }
}

async function readRace(page: Page): Promise<RaceRow[]> {
  return page.locator('#race-out .race-row').evaluateAll((rows) =>
    rows.map((row) => {
      const head = row.querySelector('.race-row-head')!.textContent!.replace(/\s+/g, ' ');
      const bars = Array.from(row.querySelectorAll('.race-bar'));
      const value = (i: number): number => Number(bars[i]!.querySelector('.bar-value')!.textContent!.trim());
      const width = (i: number): number =>
        Number.parseFloat((bars[i]!.querySelector('.bar-fill') as HTMLElement).style.width || '0');
      return {
        n: Number(/n = (\d+)/.exec(head)![1]),
        quantum: value(0),
        classical: value(1),
        ratio: Number(/classical \/ quantum = ([\d.]+)×/.exec(head)![1]),
        quantumWidth: width(0),
        classicalWidth: width(1),
      };
    }),
  );
}

test('against the control the classical attacker exhausts the domain, which is the mean it prints', async ({
  page,
}) => {
  // A permutation never collides, so the birthday search never terminates early
  // and costs exactly one query per input: 16, 32, 64. If the classical bar were
  // a plotted 2^(n/2) curve rather than a mean over runs actually performed, it
  // could not print those numbers. This is the exhibit's "measured, not plotted"
  // claim reduced to an exact equality.
  await chooseTarget(page, 'no-period', 'No period (control)');
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('Done —', { timeout: 120_000 });
  expect(await textOf(page.locator('#race-status'))).toContain('against No period (control)');

  for (const r of await readRace(page)) {
    expect(r.classical, `n=${r.n}: every one of the ${1 << r.n} inputs was queried`).toBe(1 << r.n);
    // Proving absence needs the rank to reach n, so at least n rounds.
    expect(r.quantum, `n=${r.n}: proving no period needs rank n`).toBeGreaterThanOrEqual(r.n);
    expect(r.quantum, `n=${r.n}: within the 16n round budget`).toBeLessThanOrEqual(16 * r.n);
    expectRatioIsTheseNumbersDivided(r);
    expectBarsDrawnToScale(r);
  }
});

/**
 * Regression — the race named an algorithm it had not run.
 *
 * Every row labelled its classical bar "birthday (classical)" and printed
 * "birthday bound 2^(n/2) ≈ …" beside it. Against the control that is false in
 * both halves: a permutation never collides, so `classicalPeriodSearch` finds
 * no candidate at all and must read the whole domain. Measured headless: 0 of
 * 40 trials found a period at each of n = 4, 5, 6, and the classical mean is
 * exactly 2^n — 16.0, 32.0, 64.0 — against a quoted "bound" of 4.0, 5.7, 8.0.
 * The row was labelling a proof of injectivity as a birthday search losing to
 * quantum period-finding.
 *
 * The label is now decided by the runs (`classicalFoundPeriod > 0`), not by the
 * target, so this asserts both branches: the control must not carry birthday
 * language, and Even-Mansour must still carry it.
 */
test('no race row calls itself a birthday search unless a collision actually decided one', async ({
  page,
}) => {
  await chooseTarget(page, 'no-period', 'No period (control)');
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('Done —', { timeout: 120_000 });

  const controlRows = await page.locator('#race-out .race-row').allInnerTexts();
  expect(controlRows, 'three widths were raced').toHaveLength(3);
  controlRows.forEach((raw, i) => {
    const row = flat(raw);
    const n = [4, 5, 6][i]!;
    // The row may explain that no birthday bound applies; what it must not do
    // is quote one as this comparison's reference.
    expect(row, `n=${n}: no birthday bound is quoted where no collision was found`).not.toContain(
      'birthday bound 2^(n/2)',
    );
    expect(row, `n=${n}: the bar is not labelled birthday`).not.toContain('birthday (classical)');
    expect(row, `n=${n}: the bar names what was actually run`).toContain('exhaustive (classical)');
    expect(row).toContain('no collision found in any trial');
    expect(row, `n=${n}: the zero count is stated, not implied`).toContain('in 0 of 40 trials');
    expect(row).toContain(`had to read all ${1 << n} inputs`);
    // The number behind the label: the classical side really did spend 2^n.
    const classical = Number(capture(row, /exhaustive \(classical\) ([\d.]+)/, `classical mean n=${n}`));
    expect(classical, `n=${n}: the mean is the whole domain`).toBe(1 << n);
  });

  // The other branch must survive: a target with a period to find is still a
  // birthday search, and still says so.
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('against Even-Mansour', { timeout: 120_000 });
  const emRows = await page.locator('#race-out .race-row').allInnerTexts();
  expect(emRows).toHaveLength(3);
  emRows.forEach((raw, i) => {
    const row = flat(raw);
    const n = [4, 5, 6][i]!;
    expect(row, `n=${n}: a real birthday search keeps its label`).toContain('birthday (classical)');
    expect(row).toContain('birthday bound 2^(n/2)');
    expect(row).not.toContain('exhaustive (classical)');
    // The claim behind the label: a collision decided at least one trial, and
    // the count printed is a real count.
    const found = Number(capture(row, /candidate in (\d+) of 40 trials/, `collision trials n=${n}`));
    expect(found, `n=${n}: the label is earned by trials that found one`).toBeGreaterThan(0);
    expect(found).toBeLessThanOrEqual(40);
    const classical = Number(capture(row, /birthday \(classical\) ([\d.]+)/, `classical mean n=${n}`));
    expect(classical, `n=${n}: a birthday search stops well short of the domain`).toBeLessThan(1 << n);
  });
});

/**
 * Regression — the race read `state.targetId` live inside its trial loop and
 * again when writing its caption, while the target selector stayed enabled
 * throughout. The loop yields the event loop between widths, so a switch landing
 * on one of those boundaries measured the later rows against a different
 * function than the earlier ones and then labelled the whole table with whatever
 * was selected when the last row landed: three rows presented as one experiment
 * that were two. The switch below is queued before the race schedules its own
 * yield, so it lands on exactly that boundary.
 *
 * The discriminator is the classical mean: against the control it is the domain
 * size exactly (16/32/64, per the test above), against Even-Mansour it is single
 * digits. A caption fix alone would not satisfy this.
 */
test('a target switch mid-race cannot retarget or relabel a run already under way', async ({ page }) => {
  await page.evaluate(() => {
    const race = document.getElementById('race-run') as HTMLButtonElement;
    const other = document.querySelector<HTMLButtonElement>('#seg-target button[data-target="no-period"]')!;
    setTimeout(() => other.click(), 0);
    race.click();
  });
  await expect(page.locator('#target-name')).toHaveText('No period (control)');
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('Done —', { timeout: 120_000 });

  expect(await textOf(page.locator('#race-status')), 'the caption names the target actually raced').toContain(
    'against Even-Mansour',
  );
  for (const r of await readRace(page)) {
    expect(r.classical, `n=${r.n}: measured against Even-Mansour, not the control`).toBeLessThan(1 << r.n);
    expectRatioIsTheseNumbersDivided(r);
    expectBarsDrawnToScale(r);
  }
});

/**
 * Regression — two exhibits on one page disagreeing about the same fact.
 *
 * The target card computes whether this instance of f satisfies Simon's promise
 * exactly and prints the answer. The honesty panel asserted the opposite as a
 * property of the construction: "the constructions attacked here do *not*
 * satisfy the promise exactly". Whether they do is a fact about the drawn key,
 * not about Even-Mansour. A complete census over the fixed public permutation —
 * every one of the 15 possible k₁ at n = 4 — finds exactly 2 that make f
 * exactly 2-to-1, so 13.3% of "New secret" presses at n = 4 put the card and the
 * paragraph in flat contradiction.
 *
 * This hunts for that key and FAILS if it never turns up, so it cannot pass by
 * never reaching the state it is about.
 */
test('the promise claim is computed per key, and nothing on the page overrides that row', async ({
  page,
}) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await chooseWidth(page, 4);
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeVisible();

  const contradictions = [
    'do not satisfy the promise exactly',
    'do *not* satisfy the promise exactly',
    'does not satisfy the promise exactly',
  ];

  let exact = 0;
  let colliding = 0;
  for (let i = 0; i < 80 && (exact === 0 || colliding === 0); i++) {
    const card = await textOf(page.locator('#secret-list'));
    const honesty = await textOf(page.locator('#honesty'));
    if (card.includes('promise exactly yes — exactly 2-to-1')) {
      exact++;
      // The moment of contradiction: the card says yes, so nothing else on the
      // page may say no.
      for (const c of contradictions) {
        expect(honesty, `the card says this key IS exactly 2-to-1 while the page says: ${c}`).not.toContain(c);
      }
      expect(honesty, 'the global statement is hedged and points at the row that computes it').toContain(
        'usually collides by accident',
      );
    } else {
      expect(card, 'the card states the alternative rather than going silent').toContain('not a clean pair');
      colliding++;
    }
    await page.locator('#new-secret').click();
    await expect(page.locator('#verdict-text')).toHaveText('Not started');
  }

  expect(exact, 'an exactly-2-to-1 Even-Mansour key turned up (2 of the 15 keys at n = 4)').toBeGreaterThan(0);
  expect(colliding, 'a colliding Even-Mansour key turned up').toBeGreaterThan(0);
});

/**
 * The honesty panel described the simulator's storage as complex numbers. It is
 * one `Float64Array` of real amplitudes — statevector.ts says so in its own
 * header, and no gate in Simon's circuit has an imaginary entry to populate.
 * A page whose honesty section misstates its own implementation is the one place
 * that cannot afford to.
 */
test('the honesty panel describes the simulator the repo actually ships', async ({ page }) => {
  const honesty = await textOf(page.locator('#honesty'));
  expect(honesty, 'no imaginary component is stored').not.toContain('complex numbers');
  expect(honesty).toContain('real amplitudes held in one Float64Array');
  expect(honesty).toContain('There is no imaginary part');
});

// ---------------------------------------------------------------------------
// The counters, and the failure paths
// ---------------------------------------------------------------------------

interface Tally {
  queries: number;
  wasted: number;
  candidates: string;
  rank: number;
  needed: number;
}

async function readTally(page: Page): Promise<Tally> {
  const rankText = await textOf(page.locator('#rank-value'));
  return {
    queries: Number(await textOf(page.locator('#tally-queries'))),
    wasted: Number(await textOf(page.locator('#tally-wasted'))),
    candidates: await textOf(page.locator('#tally-candidates')),
    rank: Number(capture(rankText, /^(\d+) \//, 'rank')),
    needed: Number(capture(rankText, /\/ (\d+) needed/, 'rank target')),
  };
}

/**
 * Every counter on the run panel, cross-checked against every other surface
 * reporting the same quantity. Queries must split exactly into the equations
 * that raised the rank and the ones that taught nothing; the rank appears in
 * four places including the screen-reader label; and the candidate count is
 * forced by the rank rather than tracked separately.
 */
async function assertCountersConsistent(page: Page, n: number): Promise<Tally> {
  const t = await readTally(page);
  const goal = await rankGoal(page, n);
  expect(t.needed, goal === n ? 'proving no period needs rank n' : 'isolating a period needs rank n-1').toBe(goal);
  // The invariant behind the denominator, and the one the old constant hid: the
  // page must never print a rank larger than the threshold it says is needed.
  expect(t.rank, `rank ${t.rank} printed against a stated requirement of ${t.needed}`).toBeLessThanOrEqual(
    t.needed,
  );

  const flags = (await page.locator('#eq-list .eq .eq-flag').allInnerTexts()).map(flat);
  expect(flags.length, 'one equation logged per oracle query').toBe(t.queries);
  const accepted = flags.filter((f) => f === 'NEW').length;
  const noInfo = flags.filter((f) => f === 'y = 0, NO INFO').length;
  const redundant = flags.filter((f) => f === 'REDUNDANT').length;
  expect(accepted + noInfo + redundant, 'every equation carries exactly one known flag').toBe(t.queries);
  expect(accepted, 'the rank is the count of equations that raised it').toBe(t.rank);
  expect(noInfo + redundant, '"taught nothing" is exactly the non-NEW equations').toBe(t.wasted);
  expect(t.rank + t.wasted, 'queries split into rank-raising and wasted').toBe(t.queries);

  // The "no info" flag marks the zero vectors and nothing else.
  const vectors = (await page.locator('#eq-list .eq .eq-body').allInnerTexts()).map((r) =>
    capture(flat(r), /y = ([01]+)/, 'measured vector'),
  );
  expect(vectors).toHaveLength(t.queries);
  expect(vectors.filter((v) => /^0+$/.test(v)).length, 'the y = 0 flag marks exactly the zero vectors').toBe(noInfo);

  // The rank, on all four surfaces that report it.
  expect(
    await page.locator('#matrix-wrap .matrix-row').count(),
    'the reduced matrix has one row per independent equation',
  ).toBe(t.rank);
  expect(await page.locator('#rank-meter span.filled').count(), 'filled meter segments = rank').toBe(t.rank);
  expect(
    await page.locator('#rank-meter').getAttribute('aria-label'),
    'the meter announces the rank it paints, so a screen-reader user is told the same thing',
  ).toBe(`Rank ${t.rank} of ${goal} needed`);
  if (t.rank > 0) {
    expect(await textOf(page.locator('.matrix-caption'))).toContain(`Rank ${t.rank} of ${n}`);
  }

  // The candidate count is forced: the null space holds 2^(n-rank) vectors, one
  // of which is zero and therefore not a period.
  const expected = Math.pow(2, n - t.rank) - 1;
  if (t.queries === 0) expect(t.candidates).toBe(`${expected} (everything)`);
  else if (expected === 0) expect(t.candidates).toBe('0 — none possible');
  else expect(Number(t.candidates), 'candidates = 2^(n-rank) - 1').toBe(expected);
  return t;
}

test('the counters split the queries they report, at every stage of a run', async ({ page }) => {
  const n = 5;
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await chooseWidth(page, n);

  const start = await assertCountersConsistent(page, n);
  expect(start.queries).toBe(0);
  expect(start.rank).toBe(0);

  // Mid-run, after every single round, not merely at the end. Six rounds is
  // deliberately past the four an n = 5 period needs, so the run can and often
  // does finish inside this loop — which is why the loop reads the button's
  // state rather than assuming it is still live.
  for (let round = 1; round <= 6; round++) {
    if (await page.locator('#measure').isDisabled()) break;
    await page.locator('#measure').click();
    await expect(page.locator('#eq-list .eq')).toHaveCount(round);
    await assertCountersConsistent(page, n);
  }

  // Whichever way that ended, the run finishes at a verdict, and the counters
  // are checked again there.
  if (await page.locator('#run-all').isEnabled()) await runAll(page);
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/);
  const end = await assertCountersConsistent(page, n);
  expect(end.rank, 'the period is forced at rank n-1').toBe(n - 1);
  expect(Number(end.candidates)).toBe(1);
  expect(await textOf(page.locator('#verdict'))).toContain(
    `${end.queries} superposition ${end.queries === 1 ? 'query' : 'queries'} spent.`,
  );
});

test('a candidate f refuses is reported as rejected and named, not quietly retried', async ({ page }) => {
  const n = 4;
  await chooseTarget(page, 'no-period', 'No period (control)');
  await chooseWidth(page, n);

  // Stepping one round at a time, the rank must pass through n-1 on its way to
  // n, and at n-1 the system names exactly one candidate. Against an injective
  // f that candidate cannot be a period, so this failure state is always
  // reached — the demo's fail-closed rule made visible.
  let reached = false;
  for (let round = 1; round <= 40 && !reached; round++) {
    await page.locator('#measure').click();
    await expect(page.locator('#eq-list .eq')).toHaveCount(round);
    reached = (await readTally(page)).rank === n - 1;
  }
  expect(reached, 'the rank passes through n-1').toBe(true);

  await expect(page.locator('#verdict')).toHaveClass(/is-rejected/);
  const verdict = await textOf(page.locator('#verdict'));
  expect(verdict).toContain('Candidate rejected by f');
  // The failure names its cause rather than just failing.
  const named = capture(verdict, /The system named ([01, ]+), and f refused/, 'rejected candidate');
  expect(verdict).toContain('f refused to confirm it');
  expect(verdict).toContain('Simon’s algorithm is Las Vegas');

  // The candidate named is the one the live system is still offering, and it is
  // genuinely not a period: the exhaustive check below finds none at all.
  const chips = (await page.locator('#cand-list .cand').allInnerTexts()).map(flat);
  expect(chips, 'exactly one candidate survives at rank n-1').toHaveLength(1);
  expect(named.split(', ')).toContain(chips[0]);
  // Nothing is claimed recovered while a candidate stands rejected.
  await expect(page.locator('#exploit')).toBeHidden();

  // Rejection is not an end state — the run continues and the counters hold.
  await expect(page.locator('#measure')).toBeEnabled();
  await expect(page.locator('#run-all')).toBeEnabled();
  await assertCountersConsistent(page, n);

  await runAll(page);
  await expect(page.locator('#verdict')).toHaveClass(/is-safe/);
  expect(Number(capture(await textOf(page.locator('#exploit')), /periods that hold for all x ✓ (\d+)/, 'periods'))).toBe(
    0,
  );
});

// ---------------------------------------------------------------------------
// The grids, and the state that must not outlive its inputs
// ---------------------------------------------------------------------------

test('the interference grids account for every outcome, and the notes count what is drawn', async ({
  page,
}) => {
  const n = 5;
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await chooseWidth(page, n);
  await page.locator('#measure').click();
  await expect(page.locator('#grid-before .amp-cell')).toHaveCount(1 << n);
  await expect(page.locator('#grid-after .amp-cell')).toHaveCount(1 << n);

  // Before the final Hadamard: the preimage size claimed is the number of cells
  // actually painted as in-superposition.
  const share = Number(
    capture(await textOf(page.locator('#before-note')), /(\d+) inputs? share that value/, 'preimage size'),
  );
  expect(await page.locator('#grid-before .amp-cell:not(.empty)').count(), 'live cells = the preimage claimed').toBe(
    share,
  );
  expect(share, 'a periodic f collapses to at least a pair').toBeGreaterThanOrEqual(2);
  expect(share % 2, 'the preimage class is a union of s-cosets, so it is even').toBe(0);

  // After: cancelled + surviving = every outcome, and the count claimed is drawn.
  const cancelled = Number(
    capture(await textOf(page.locator('#after-note')), /^(\d+) of \d+ outcomes cancelled/, 'cancelled count'),
  );
  const zero = await page.locator('#grid-after .amp-cell.zero').count();
  const pos = await page.locator('#grid-after .amp-cell.pos').count();
  const neg = await page.locator('#grid-after .amp-cell.neg').count();
  expect(zero, 'the cancelled count is the number of zero cells').toBe(cancelled);
  expect(zero + pos + neg, 'every outcome is classified exactly once').toBe(1 << n);
  expect(await textOf(page.locator('#after-note'))).toContain(`of ${1 << n} outcomes cancelled`);
  expect(zero, 'at least half of every outcome set is annihilated').toBeGreaterThanOrEqual(1 << (n - 1));

  // Exactly one outcome is ringed as measured, and it is never a cancelled one:
  // a zero-amplitude outcome is impossible, not merely unlikely.
  await expect(page.locator('#grid-after .amp-cell.measured')).toHaveCount(1);
  await expect(page.locator('#grid-after .amp-cell.measured.zero')).toHaveCount(0);
  expect(
    flat(await page.locator('#grid-after .amp-cell.measured .amp-y').innerText()),
    'the ringed outcome is the one the equation log recorded',
  ).toBe(capture(flat(await page.locator('#eq-list .eq').first().innerText()), /y = ([01]+)/, 'logged y'));
});

test('no verdict outlives the input it was computed from', async ({ page }) => {
  const solve = async (): Promise<void> => {
    await page.locator('#run-all').click();
    await expect(page.locator('#verdict')).toHaveClass(/is-broken/, { timeout: 60_000 });
    await expect(page.locator('#exploit')).toBeVisible();
    // The verdict paints on the last round; the run formally ends a tick later.
    await expect(page.locator('#run-hint')).toContainText('This run is finished');
  };

  const assertRetired = async (n: number): Promise<void> => {
    expect(await textOf(page.locator('#verdict-text')), 'the stale verdict is gone').toBe('Not started');
    await expect(page.locator('#verdict')).not.toHaveClass(/is-broken|is-safe|is-rejected/);
    await expect(page.locator('#exploit'), 'the exploit panel does not outlive its run').toBeHidden();
    await expect(page.locator('#eq-list .eq')).toHaveCount(0);
    await expect(page.locator('#grid-after .amp-cell')).toHaveCount(0);
    await expect(page.locator('#grid-before .amp-cell')).toHaveCount(0);
    expect(await textOf(page.locator('#before-note'))).toBe('Run a measurement to populate this.');
    expect(await textOf(page.locator('#arith-body'))).toBe('Pick a cell in either grid.');
    expect(await textOf(page.locator('#run-hint'))).toContain('One press = one query');
    await expect(page.locator('#measure')).toBeEnabled();
    await expect(page.locator('#run-all')).toBeEnabled();
    const t = await assertCountersConsistent(page, n);
    expect(t.queries).toBe(0);
    expect(t.rank).toBe(0);
  };

  // A new secret — the verdict described the key that has just been replaced.
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await solve();
  const before = await textOf(page.locator('#secret-box'));
  await page.locator('#peek').click();
  await page.locator('#new-secret').click();
  await expect(page.locator('#verdict-text')).toHaveText('Not started');
  expect(await textOf(page.locator('#secret-box')), 'a new secret really is new').not.toBe(before);
  await assertRetired(5);

  // A target change — the verdict described a different function entirely.
  await solve();
  await chooseTarget(page, 'no-period', 'No period (control)');
  await assertRetired(5);
  expect(await textOf(page.locator('#consequence-text')), 'the consequence tracks the new target').toContain(
    'Rank climbs to n instead of stopping at n−1',
  );
});

test('no control is left dead by a completed run', async ({ page }) => {
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await runAll(page);

  // Measure and run-all are disabled *because the run finished*, and the hint
  // says so rather than leaving them silently dead.
  await expect(page.locator('#run-hint')).toContainText('Reset the equations, or take a new secret');
  await expect(page.locator('#measure')).toBeDisabled();
  await expect(page.locator('#run-all')).toBeDisabled();

  // Everything else stays live.
  for (const id of ['peek', 'new-secret', 'reset', 'race-run']) {
    await expect(page.locator(`#${id}`), `#${id} stays usable after a run`).toBeEnabled();
  }
  for (const b of await page.locator('#seg-target button, #seg-width button').all()) {
    await expect(b).toBeEnabled();
  }

  await page.locator('#reset').click();
  await expect(page.locator('#measure')).toBeEnabled();
  await expect(page.locator('#run-all')).toBeEnabled();
  await page.locator('#measure').click();
  await expect(page.locator('#eq-list .eq')).toHaveCount(1);
});

/**
 * The `[hidden]` override trap: the UA rule is only `[hidden] { display: none }`,
 * which any author rule setting a display on the same element silently outranks.
 * Both the secret box and the exploit panel ship the attribute, so every
 * `el.hidden = true` on this page has to actually take the element off screen.
 */
test('no element with the hidden attribute is actually rendered', async ({ page }) => {
  const leaks = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[hidden]'))
      .filter((el) => getComputedStyle(el as HTMLElement).display !== 'none')
      .map((el) => ({
        tag: (el as HTMLElement).tagName.toLowerCase(),
        cls: (el as HTMLElement).className?.toString().slice(0, 60) ?? '',
        display: getComputedStyle(el as HTMLElement).display,
      })),
  );
  expect(leaks, `elements marked hidden that still render: ${JSON.stringify(leaks)}`).toEqual([]);

  // And the attribute is load-bearing on both panels that rely on it.
  await expect(page.locator('#secret-box')).toBeHidden();
  await expect(page.locator('#exploit')).toBeHidden();
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeVisible();
  expect(await page.locator('#peek').getAttribute('aria-expanded')).toBe('true');
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeHidden();
  expect(await page.locator('#peek').getAttribute('aria-expanded')).toBe('false');
});
