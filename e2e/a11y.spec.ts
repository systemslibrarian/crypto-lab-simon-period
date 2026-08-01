import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Axe only checks what is in the DOM, so an unscanned state is an ungated
 * state. This walks every exhibit into the states a visitor can actually
 * reach — all four targets, all three widths, the recovered-period verdict, the
 * proved-no-period verdict, the secret reveal, the interference grids, the
 * per-outcome arithmetic in both its cancelled and surviving forms, and the
 * measured race — before anything is scanned.
 */
async function chooseTarget(page: Page, id: string, name: string): Promise<void> {
  await page.locator(`#seg-target button[data-target="${id}"]`).click();
  await expect(page.locator('#target-name')).toHaveText(name);
  await expect(page.locator(`#seg-target button[data-target="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
}

async function chooseWidth(page: Page, n: number): Promise<void> {
  await page.locator(`#seg-width button[data-width="${n}"]`).click();
  await expect(page.locator(`#seg-width button[data-width="${n}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rank-value')).toContainText(`/ ${n - 1} needed`);
}

async function driveDemos(page: Page): Promise<void> {
  // Exhibit 1 — Even-Mansour, the flagship break: run it to a verdict so the
  // key-recovery panel with its ✓/✗ marks is on screen.
  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeVisible();
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/, { timeout: 60_000 });
  await expect(page.locator('#exploit')).toBeVisible();

  // Exhibit 2 — the interference grids, and the arithmetic for both a cancelled
  // outcome and a surviving one. Those are two different result renderings.
  const after = page.locator('#grid-after .amp-cell');
  await expect(after.first()).toBeVisible();
  const zeroCell = page.locator('#grid-after .amp-cell.zero').first();
  if (await zeroCell.count()) {
    await zeroCell.click();
    await expect(page.locator('.arith-result.kills')).toBeVisible();
  }
  const liveCell = page.locator('#grid-after .amp-cell.pos, #grid-after .amp-cell.neg').first();
  await liveCell.click();
  await expect(page.locator('.arith-result.lives')).toBeVisible();
  await page.locator('#grid-before .amp-cell').first().click();

  // Exhibit 3 — the linear system, at a narrower width so the matrix and the
  // multi-candidate chip list are both exercised.
  await chooseWidth(page, 4);
  await page.locator('#measure').click();
  await expect(page.locator('#eq-list .eq')).toHaveCount(1);
  await page.locator('#measure').click();
  await expect(page.locator('#matrix-wrap .matrix')).toBeVisible();

  // Exhibit 4 — CBC-MAC, the forgery, at the widest setting.
  await chooseTarget(page, 'cbc-mac', 'CBC-MAC');
  await chooseWidth(page, 6);
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/, { timeout: 60_000 });

  // Exhibit 5 — the textbook target, whose verdict must NOT read as an alarm.
  await chooseTarget(page, 'textbook', 'Textbook 2-to-1');
  await page.locator('#run-all').click();
  await expect(page.locator('#exploit')).toHaveClass(/neutral/, { timeout: 60_000 });

  // Exhibit 6 — the control: no period, the "safe" verdict styling.
  await chooseTarget(page, 'no-period', 'No period (control)');
  await chooseWidth(page, 5);
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-safe/, { timeout: 60_000 });

  // Reset back to a partially-collected state so the in-progress verdict and
  // the multi-candidate list are also in the DOM when the scan runs.
  await page.locator('#reset').click();
  await page.locator('#measure').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-working/);

  // Exhibit 7 — the measured race, a real computation over 120 attack runs.
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
}

async function prepare(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  });
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true));
    document.querySelectorAll<HTMLElement>('[hidden],[role="tabpanel"]').forEach((el) => {
      el.removeAttribute('hidden');
      el.style.display = '';
      el.classList.add('active', 'is-active', 'open');
    });
  });
  await page.waitForTimeout(400);
}

async function scan(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([]);
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.');
  await driveDemos(page);
  await prepare(page);
  await scan(page);
});

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.');
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await driveDemos(page);
  await prepare(page);
  await scan(page);
});

test('no WCAG A/AA violations — narrow viewport, both themes', async ({ page }) => {
  // The layout stacks below 640px and the amplitude grid drops to four columns;
  // stacked is a different rendering, so it is a different scan.
  await page.setViewportSize({ width: 380, height: 900 });
  await page.goto('.');
  await driveDemos(page);
  await prepare(page);
  await scan(page);
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await prepare(page);
  await scan(page);
});
