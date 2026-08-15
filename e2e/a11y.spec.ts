import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate for Simon's Period.
 *
 * FOUR CONFIGURATIONS: {dark, light} x {1280, 380}. Each boots the page fresh,
 * asserts the shipped defaults, and drives the whole lab, scanning after EVERY
 * step: the arrival state, where nothing has been measured, both grids are
 * empty, the equation log reads "No measurements yet.", the secret and exploit
 * panels are behind the `hidden` attribute and both expert disclosures are shut;
 * the skip link focused; the secret revealed and hidden again through `#peek`;
 * one measurement, which is what brings the interference grids into existence;
 * a cancelled outcome and a surviving one selected, which are two different
 * renderings of the per-outcome arithmetic; Even-Mansour run to a full break
 * with its recovered-key panel and both run buttons disabled; Reset; a fresh
 * secret; n=4 with several candidate periods still standing; CBC-MAC forged at
 * n=6, which is also the width that makes `#eq-list` overflow its cap; the
 * textbook target, whose verdict must NOT read as an alarm; the control, which
 * ends in a proof of absence; a partially-collected run; both disclosures opened
 * through their own summaries; the measured race over 120 attack runs; and each
 * of the page's button shapes hovered, including the SELECTED segment — the
 * control that says which mode is on.
 *
 * How the spec this replaces faked passing — worth naming, because the mechanism
 * is the durable part:
 *
 *  - it injected `animation:none!important; transition:none!important` through
 *    `addStyleTag`, which BYPASSES this lab's own reduced-motion handling rather
 *    than exercising it. `main.ts` branches on
 *    `matchMedia('(prefers-reduced-motion: reduce)')` to choose its step delay,
 *    and a stylesheet cannot reach that branch — so the old gate ran the
 *    ANIMATED code path while reporting that it had suppressed motion;
 *  - it stripped `hidden` from every element, added `active is-active open` to
 *    each, and set `open` on both `<details>`, assembling a document no visitor
 *    can reach: the recovered-key panel rendered against a period that had not
 *    been found, beside a "Peek at the secret" button whose `aria-expanded`
 *    still read `false`;
 *  - it drove all four targets, three widths, both grids, a reset and a 120-run
 *    race — and then scanned ONCE, after `waitForTimeout(400)`, so every state
 *    it built was overwritten before anything measured it. The state a reader
 *    sees FIRST was the one state it never looked at;
 *  - its narrow test drove at 380px, scanned, toggled the theme and scanned
 *    again WITHOUT RE-DRIVING, so the light-theme scan measured whatever the
 *    dark drive had left on the page;
 *  - it asserted on axe's `violations` only. `incomplete` is the only bucket
 *    `aria-prohibited-attr` and `aria-required-children` ever reach, and this
 *    page carries the shapes both rules look for;
 *  - and it had no oracle at all for 1.4.10 reflow, 1.4.11 non-text contrast, or
 *    composited 1.4.3 contrast — which axe declines to judge wherever a
 *    `color-mix()` is involved, as it is throughout the shared top bar.
 *
 * See `gate.ts` for why nothing is injected, why no panel is force-revealed, why
 * the lab's defaults are asserted rather than assumed, and why `violations` is
 * not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_200_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_200_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
