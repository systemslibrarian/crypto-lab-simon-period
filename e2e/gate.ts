import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old `prepare()`
 *     pushed `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it —
 *     and here the block is not decorative: `main.ts` reads
 *     `matchMedia('(prefers-reduced-motion: reduce)')` directly and drops the
 *     per-step circuit delay from 110ms to 0 and the run-to-verdict delay from
 *     90ms to 0. The injected stylesheet could not affect that at all, so the
 *     old gate ran the ANIMATED code path while claiming to have suppressed
 *     motion. This gate emulates the preference for real, asserts it took
 *     effect, and injects nothing.
 *
 *  2. IT ASSEMBLED A DOCUMENT NO VISITOR CAN REACH. The old `prepare()` did
 *     this, verbatim:
 *
 *         document.querySelectorAll('details').forEach(d => d.open = true)
 *         document.querySelectorAll('[hidden],[role="tabpanel"]').forEach(el => {
 *           el.removeAttribute('hidden')
 *           el.style.display = ''
 *           el.classList.add('active', 'is-active', 'open')
 *         })
 *
 *     On this page `hidden` is how two mutually exclusive states are kept apart:
 *     `#secret-box` ships hidden behind the "Peek at the secret" toggle, and
 *     `#exploit` ships hidden until a period is actually recovered. Stripping it
 *     rendered the key-recovery panel — with its ✓/✗ marks against a period that
 *     had not been found — beside a "Peek at the secret" button whose
 *     `aria-expanded` still said `false` and whose panel was open. This gate
 *     never touches `hidden`, `display`, `open` or `class`; the secret is
 *     revealed by clicking `#peek` and the exploit panel by actually recovering
 *     a period.
 *
 *  3. IT SCANNED ONCE, AT THE END. `driveDemos()` walked all four targets, three
 *     widths, both interference grids, a reset and a 120-run race — and then
 *     `prepare()` overwrote the page and `scan()` looked exactly once. Every
 *     state it built was thrown away unmeasured. The narrow test was worse: it
 *     drove, scanned, toggled the theme and scanned again WITHOUT RE-DRIVING, so
 *     the light-theme scan measured whatever the dark drive had left behind.
 *     This drive scans after every single step, in {dark, light} x {1280, 380}.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The old gate asserted on
 *     `violations` alone and never looked at `incomplete`, which is the only
 *     bucket `aria-prohibited-attr` and `aria-required-children` ever reach —
 *     and this page has `aria-label` on bare `<span class="break-tag">`
 *     elements, which is exactly that shape.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR ARITHMETIC-CONTRAST ORACLE. axe has
 *     no rule for 1.4.10 or 1.4.11 at all, and its `color-contrast` rule
 *     declines to judge the shared top bar because `--cl-ink` is a
 *     `color-mix()`. `contrast.ts` and `nontext.ts` supply all three, and
 *     `nontext.ts` is called from `scan()` so it runs at every driven state
 *     rather than once against a page nobody can load.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are NOT enough, and that is the point of this shape. A transition is
 * a real animation with a duration, and axe sampling a colour mid-transition
 * reads a value that exists in no state of the page — `.btn` here transitions
 * `background-color` and `border-color` over 150ms and `.amp-cell` transitions
 * `background-color` over 250ms, so a scan two frames after a click would judge
 * a blend of the old fill and the new one. `document.getAnimations()` reports
 * transitions as well as `@keyframes`, so waiting on it waits for both.
 *
 * Transitions drain in waves, not in one batch — a hover restyles a button,
 * which restyles its child — so a poll for "nothing running right now" can exit
 * through a gap between waves. Require quiescence to hold for several
 * consecutive frames instead. It is bounded, so a permanently-running animation
 * fails the run rather than hanging it.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' },
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * `style.css` cannot currently be in that shape, and the assertion is what makes
 * that a measurement rather than a reading. Its reduced-motion block was read
 * declaration by declaration: it sets `scroll-behavior: auto` on `html` and
 * clamps `animation-duration` and `transition-duration` to 0.001ms universally,
 * and touches nothing else — no `opacity`, no `transform`, no `display`. The
 * file declares no `@keyframes` at all, and its only `opacity` declaration is
 * `#app .btn:disabled { opacity: 1 }`. The check runs in every state anyway,
 * because all of that is a property of the current stylesheet rather than of the
 * page.
 *
 * `aria-hidden` subtrees are excluded; see the note on `ariaHidden` in
 * `contrast.ts` for what this lab hides and why each one was checked by hand.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Anything hidden from sight must also be hidden from the KEYBOARD.
 *
 * `opacity: 0`, `visibility: hidden` on an ancestor that a descendant re-shows,
 * a zero-height wrapper with `overflow: hidden` — none of these remove a control
 * from the tab order the way `display: none` and the `hidden` attribute do. The
 * result is a focus stop on a control the reader cannot see, which is a 2.4.7
 * and 2.4.3 failure and is invisible to a source grep. So this probes the DOM:
 * every focusable element that `checkVisibility()` says is not visible is asked
 * to take focus, and any that succeeds is reported.
 *
 * This lab hides two panels — `#secret-box` and `#exploit` — with the `hidden`
 * attribute, which does remove them, and `boot` proves separately that the
 * attribute is not being outranked by a class. This check is what would catch a
 * later change from `hidden` to a CSS fade, which looks identical on screen.
 */
async function expectHiddenIsUnfocusable(page: Page, label: string): Promise<void> {
  const reachable = await page.evaluate(() => {
    const FOCUSABLE =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    const active = document.activeElement;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.checkVisibility?.({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      el.focus();
      if (document.activeElement === el) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` +
            `.${(el.getAttribute('class') ?? '').trim()}`,
        );
      }
    }
    (active as HTMLElement | null)?.focus?.();
    return Array.from(new Set(out));
  });
  expect(
    reachable,
    `controls that are invisible but still focusable in state: ${label}`,
  ).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page is
 * created.
 *
 * This matters more here than in most labs: every exhibit on the page is
 * rendered by `renderAll()` from `main.ts`, and a throw part-way through it
 * leaves the earlier panels painted and the later ones stale — a plausible page
 * that a scan reports green. `makeTarget()` is async, so a rejected promise
 * would leave the target card reading "—" with no error on screen at all.
 * Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * This lab's hero is a `<header class="cl-hero">` INSIDE `<main id="app">`,
 * which scopes it out of the banner role on its own — and this copy of
 * `index.html` also carries the NEWER `dedupeBanner()`, which uses
 * `closest('main, article, aside, nav, section')` and would demote it anyway.
 * Two independent mechanisms produce the same outcome, so asserting the OUTCOME
 * rather than either mechanism is what catches a change to the nesting.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * An explicit role on a list REPLACES its implicit `list` role, orphaning every
 * `<li>` inside it and firing axe's `listitem` rule once per child.
 *
 * A markup grep cannot see this reliably, because a role is often assigned as a
 * JS property in an element-creation helper rather than as an HTML attribute.
 * The DOM can. `role="list"` is the one benign case — redundant but harmless —
 * though it has its own cost: a redundant `role="list"` makes axe apply
 * `aria-required-children`, which fails whenever the list is empty, and lists on
 * this page ARE empty at first paint and after every Reset. This page carries
 * three of them (`.breaks`, `.honesty-list`, `.amp-legend`), all statically
 * populated in `index.html`, which is why they are safe here.
 */
export async function assertListRolesIntact(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list')
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`,
      ),
  );
  expect(broken, 'an explicit non-list role on a list deletes its list semantics').toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. That assertion is load-bearing here rather
 * than ceremonial: `main.ts` branches on `matchMedia('(prefers-reduced-motion:
 * reduce)')` to choose its step delay, so if the emulation silently failed, the
 * drive would be racing a 110ms-per-step animation and every "wait for the
 * result" would be waiting on the wrong thing.
 *
 * The theme is seeded through `localStorage` rather than by clicking the toggle,
 * which pins down a real failure mode as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. If those keys drift apart
 * the theme silently stops persisting, and this boot fails on `data-theme`
 * rather than quietly scanning dark twice. (This lab has no toggle of its own,
 * so the shared bar's is the only writer.)
 *
 * The defaults are asserted at length because the whole page is built by
 * `main.ts` at load: `boot()` calls `renderSelectors()`, `renderCircuit(-1)`,
 * `wireControls()` and then AWAITS `rebuild()`, which builds the Even-Mansour
 * function table. A navigation that resolves proves nothing — a `makeTarget()`
 * that threw would leave the target card reading "—", the selectors empty and
 * both run buttons disabled, and an empty page is exactly what a scan reports as
 * perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the whole
  // test timeout and reports nothing useful. 20s turns that silent hang into a
  // named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect',
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListRolesIntact(page);

  // The `hidden` attribute really removes an element. `[hidden]` has specificity
  // (0,1,0) — identical to a class — so any later `.foo { display: … }` beats it
  // and the attribute silently does nothing. This lab hides `#secret-box` and
  // `#exploit` with it, and `style.css` carries an explicit
  // `[hidden] { display: none !important }` for exactly that reason. Measured
  // from a live element rather than inferred from the CSS.
  expect(
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.hidden = true;
      document.body.appendChild(probe);
      const display = getComputedStyle(probe).display;
      probe.remove();
      return display;
    }),
    'the hidden attribute must actually hide (it is how the secret and exploit panels are hidden)',
  ).toBe('none');

  // The skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run says
  // nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('main#app')).toHaveCount(1);

  // ── The page really booted: main.ts got as far as awaiting a target ──────
  await expect(page.locator('#seg-target button')).toHaveCount(4);
  await expect(page.locator('#seg-width button')).toHaveCount(3);
  await expect(page.locator('#circuit li')).toHaveCount(4);
  await expect(page.locator('#target-name')).toHaveText('Even-Mansour');

  // ── Every shipped default, asserted rather than assumed ─────────────────
  // The old gate never scanned this state at all: it drove all four targets and
  // three widths before looking once.
  await expect(
    page.locator('#seg-target button[data-target="even-mansour"]'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#seg-width button[data-width="5"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#verdict')).toHaveClass('verdict');
  await expect(page.locator('#verdict-text')).toHaveText('Not started');
  await expect(page.locator('#rank-value')).toHaveText('0 / 4 needed');
  await expect(page.locator('#tally-queries')).toHaveText('0');
  await expect(page.locator('#tally-candidates')).toHaveText('31 (everything)');
  await expect(page.locator('#eq-list')).toHaveText('No measurements yet.');
  await expect(page.locator('#matrix-wrap')).toHaveText('Empty — no equations yet.');
  await expect(page.locator('#before-note')).toHaveText('Run a measurement to populate this.');
  await expect(page.locator('#grid-before .amp-cell')).toHaveCount(0);
  await expect(page.locator('#grid-after .amp-cell')).toHaveCount(0);
  await expect(page.locator('#arith-body')).toHaveText('Pick a cell in either grid.');
  await expect(page.locator('#race-status')).toHaveText('Not run yet.');
  await expect(page.locator('#race-out .race-row')).toHaveCount(0);

  // Both run buttons are ENABLED at first paint, and both panels are shut. A
  // gate that assumed either would be scanning the wrong half of the lab.
  await expect(page.locator('#measure')).toBeEnabled();
  await expect(page.locator('#run-all')).toBeEnabled();
  await expect(page.locator('#peek')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#secret-box')).toBeHidden();
  await expect(page.locator('#exploit')).toBeHidden();

  // ── Two disclosures, both shut ──────────────────────────────────────────
  // The gate this replaces opened both from script before its only scan.
  await expect(page.locator('#app details')).toHaveCount(2);
  await expect(page.locator('#app details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. The shapes at risk
 * here are `.amp-grid`, a `repeat(8, minmax(0, 1fr))` grid of amplitude cells —
 * the `minmax(0, …)` is what stops each track taking its min-content as its
 * automatic minimum, and it is one edit away from being a bare `1fr` — the
 * `.cmp` comparison table at `width: 100%` inside its `.table-wrap` scroller,
 * the `.matrix` bit grid, and the monospace equation lines in `.eq-list`.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. The
    // `.cmp` table inside `.table-wrap` and the `.matrix` inside `.matrix-wrap`
    // are both such decoys at 380px.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1). If
 * it holds no focusable content it needs `tabindex="0"`, so it becomes a focus
 * target arrow keys can then scroll.
 *
 * This lab handles three of its four cases in the markup — `.matrix-wrap`,
 * `.table-wrap` and `.exploit-rows` all ship `role="region"`/`tabindex="0"` with
 * a label. The fourth, `#eq-list`, is the one this oracle exists for: it is a
 * `role="log"` under `max-height: 21rem; overflow-y: auto`, so it does not
 * overflow at the shipped default and only starts scrolling once enough
 * equations have been measured. That is a state a drive has to BUILD, which is
 * why this runs at every step rather than once.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}` +
          `.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`,
  ).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run. It
 * is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the committed
 * workflow, and a run with it set prints every finding as it happens and then
 * fails at the end, so a green collection run cannot be mistaken for a green
 * gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function expectScrollersReachableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectScrollersReachable(page, label);
  try {
    await expectScrollersReachable(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * The 1.4.11 ratchet, soft-wrapped the same way as every other oracle here.
 *
 * The wrapper is written out longhand rather than folded into a neighbour
 * because of how this oracle died elsewhere in this fleet:
 * `expectNoNewNonTextFailures` had been called from inside
 * `expectScrollersReachableSoft`, AFTER that function's `if (!COLLECTING) return`
 * guard, so in a strict run — which is every run in CI and every run anyone reads
 * as a pass — the guard returned first and `nontext.ts` never executed at all.
 * It is called from `scan()` here, at every driven state, and this repo's
 * baseline was captured by that live path.
 */
async function expectNoNewNonTextFailuresSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoNewNonTextFailures(page, label);
  try {
    await expectNoNewNonTextFailures(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

async function expectNoHorizontalOverflowSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoHorizontalOverflow(page, label);
  try {
    await expectNoHorizontalOverflow(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

async function expectHiddenIsUnfocusableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectHiddenIsUnfocusable(page, label);
  try {
    await expectHiddenIsUnfocusable(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast, and
 * the arithmetic text walk cannot reach a control's boundary or a `::before`
 * glyph, because a pseudo-element is not an element and owns no text node.
 *
 * The control-boundary half is what found the five failures fixed in `9fc1c8a`,
 * and it keeps finding them at every driven state — including the ones a hand
 * measurement cannot reach, such as a `.amp-cell` variant that only exists once
 * a measurement has populated the grids, or the `:hover` a reader is left in
 * after clicking.
 *
 * The remaining backlog here is the shared Crypto Lab top bar, byte-identical in
 * every repo in the fleet and not this one's to change, so this does not block on
 * it. A check that merely logs is not a gate, though, so it ratchets: anything
 * NOT in the baseline fails, anything in the baseline that got WORSE fails, and
 * anything in the baseline that has been FIXED fails until its entry is deleted.
 * That last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)',
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Eight assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those ratios
 *    arithmetically. Everything else in that bucket is a real result axe simply
 *    could not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less element hides, and `aria-required-children`,
 *    which is where an empty `role="list"` hides. Both shapes are present on
 *    this page: `<span class="break-tag" aria-label="Implemented in this demo">`
 *    is a bare span carrying a label, and `.amp-legend` is a `role="list"` whose
 *    children are `role="listitem"` spans.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 *  - invisible-but-focusable controls — WCAG 2.4.3/2.4.7.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads exactly
  // like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of axe-core
  // 4.12's 105 rule definitions; the chained form executes 4.
  //
  // Confirmed here by experiment rather than by reading: `<html lang="en">` was
  // changed to `<html>` and the full drive re-run against the identical page. The
  // merged form below failed on `html-has-lang` (SC 3.1.1, tagged `wcag2a`) at
  // the very first state. See the commit message for the measured before/after.
  //
  // The landmark four are still wanted because they are best-practice rather than
  // WCAG-tagged, so `withTags` alone does not reach them — and this page has the
  // shape they catch: a sticky `<header role="banner">` above a `<main id="app">`
  // that itself contains a `<header class="cl-hero">` with an
  // `<aside class="cl-hero-why">` inside it.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await expectNoNewNonTextFailuresSoft(page, label);
  await expectScrollersReachableSoft(page, label);
  await expectNoHorizontalOverflowSoft(page, label);
  await expectHiddenIsUnfocusableSoft(page, label);
}

// ── The drive ───────────────────────────────────────────────────────────────

async function chooseTarget(page: Page, id: string, name: string): Promise<void> {
  await page.locator(`#seg-target button[data-target="${id}"]`).click();
  // `rebuild()` is async — it awaits `makeTarget()` — so the pressed state and
  // the card's name land at different times. Wait on the name, which is written
  // by `renderTargetCard()` after the table is actually built.
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
  // n−1 isolates a period; the control has none and its rank runs to n, so the
  // threshold the meter prints is target-shaped. Asserting the threshold rather
  // than the button waits for `rebuild()` to have finished re-rendering.
  const control = await page
    .locator('#seg-target button[data-target="no-period"]')
    .getAttribute('aria-pressed');
  await expect(page.locator('#rank-value')).toContainText(
    `/ ${control === 'true' ? n : n - 1} needed`,
  );
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE UNTOUCHED PAGE IS SCANNED FIRST. `boot` asserts the shipped defaults
 *    and the first scan measures them. The gate this replaces drove all four
 *    targets and three widths before it looked at anything, so the state every
 *    reader sees first was the one state it never measured.
 *
 *  - EVERY BRANCH OF THE TARGET FORK. The four targets are not four skins of one
 *    result: Even-Mansour and CBC-MAC end `is-broken` with a red exploit panel,
 *    the textbook function ends with a `neutral` exploit that must NOT read as
 *    an alarm, and the control ends `is-safe` with a proof of absence. Those are
 *    four different renderings of the verdict panel and four different
 *    ink-on-tint pairs.
 *
 *  - THE STATES ONLY A DRIVE CAN BUILD. `#eq-list` is a `role="log"` under a
 *    21rem cap: it does not scroll at the shipped default and only becomes a
 *    2.1.1 case once enough equations have been measured, which is why the
 *    widest setting is driven to a full verdict. The interference grids do not
 *    exist until a measurement has run, and the per-outcome arithmetic has two
 *    different renderings — a cancelled outcome and a surviving one.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `#app .btn:hover` swaps
 *    its border to `--accent` and its fill to `--accent-soft`, `.amp-cell:hover`
 *    swaps its border to `--accent`, and `.seg button:hover` does the same. A
 *    reader is in one of those states for as long as the pointer stays where it
 *    was when they clicked, which is the normal case. Playwright leaves the
 *    mouse where it clicked, so these are scanned deliberately rather than by
 *    accident.
 *
 *  - THE DISABLED STATE IS DRIVEN. `#measure` and `#run-all` both disable once a
 *    run finishes, and `#app .btn:disabled` re-colours the ink AND the fill
 *    rather than dimming with opacity — which is the right way round, and worth
 *    measuring rather than assuming, because muting only the ink is the common
 *    version of this bug.
 *
 *  - NO FIXED TIMEOUTS. The old drive ended with `waitForTimeout(400)`. Every
 *    wait here is on a real completion signal: a verdict class, an equation
 *    count, the target card's name, the race caption, a button re-enabling.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('first paint, nothing measured, Even-Mansour at n=5');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('skip link focused, slid into view');

  // ── The secret panel, both ways ─────────────────────────────────────────
  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeVisible();
  await expect(page.locator('#peek')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#peek')).toHaveText('Hide the secret');
  // The pointer is still on #peek: this is the hovered rendering of a ghost
  // button, which is the state a reader occupies immediately after clicking.
  await scanAt('secret revealed, and #peek still hovered after the click');

  await page.locator('#peek').click();
  await expect(page.locator('#secret-box')).toBeHidden();
  await scanAt('secret hidden again');

  // ── One measurement: the grids, the equation log and the matrix appear ──
  await page.locator('#measure').click();
  await expect(page.locator('#eq-list .eq')).toHaveCount(1);
  await expect(page.locator('#verdict')).toHaveClass(/is-working/);
  await expect(page.locator('#grid-after .amp-cell').first()).toBeVisible();
  await scanAt('one measurement — grids populated, one equation, verdict working');

  // ── Both renderings of the per-outcome arithmetic ───────────────────────
  // A cancelled outcome and a surviving one are two different result panels,
  // and `.arith-result.kills` / `.lives` are two different ink-on-tint pairs.
  const zeroCell = page.locator('#grid-after .amp-cell.zero').first();
  await expect(zeroCell).toBeVisible();
  await zeroCell.click();
  await expect(page.locator('.arith-result.kills')).toBeVisible();
  await scanAt('a cancelled outcome selected, its paths summed to zero');

  const liveCell = page.locator('#grid-after .amp-cell.pos, #grid-after .amp-cell.neg').first();
  await expect(liveCell).toBeVisible();
  await liveCell.click();
  await expect(page.locator('.arith-result.lives')).toBeVisible();
  await scanAt('a surviving outcome selected, and the cell still hovered');

  await page.locator('#grid-before .amp-cell').first().click();
  await scanAt('an input cell in the before-grid selected');

  // ── Run Even-Mansour to a verdict: the flagship break ───────────────────
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/, { timeout: 60_000 });
  await expect(page.locator('#exploit')).toBeVisible();
  await expect(page.locator('#exploit .mark')).not.toHaveCount(0);
  // Both run buttons are now disabled — the disabled rendering, which
  // `#app .btn:disabled` paints with a different ink AND a different fill.
  await expect(page.locator('#measure')).toBeDisabled();
  await expect(page.locator('#run-all')).toBeDisabled();
  await scanAt('Even-Mansour broken, key recovered, both run buttons disabled');

  // ── Reset: back to idle with the same target and secret ─────────────────
  await page.locator('#reset').click();
  await expect(page.locator('#verdict-text')).toHaveText('Not started');
  await expect(page.locator('#eq-list')).toHaveText('No measurements yet.');
  await expect(page.locator('#exploit')).toBeHidden();
  await expect(page.locator('#measure')).toBeEnabled();
  await scanAt('reset to the un-run state, exploit panel closed again');

  // ── A fresh secret, which rebuilds the target table ─────────────────────
  await page.locator('#new-secret').click();
  await expect(page.locator('#target-name')).toHaveText('Even-Mansour');
  await expect(page.locator('#measure')).toBeEnabled();
  await scanAt('a new secret drawn for the same target');

  // ── The narrowest width, and the multi-candidate list ───────────────────
  await chooseWidth(page, 4);
  await page.locator('#measure').click();
  await expect(page.locator('#eq-list .eq')).toHaveCount(1);
  await expect(page.locator('#cand-list .cand').first()).toBeVisible();
  await scanAt('n=4, one equation, several candidate periods still standing');

  // ── CBC-MAC at the widest width, driven to a forgery ────────────────────
  // n=6 is also what makes #eq-list overflow its 21rem cap, which is the only
  // state in which that role="log" is a WCAG 2.1.1 case at all.
  await chooseTarget(page, 'cbc-mac', 'CBC-MAC');
  await chooseWidth(page, 6);
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-broken/, { timeout: 60_000 });
  await expect(page.locator('#exploit')).toBeVisible();
  await scanAt('CBC-MAC forged at n=6, equation log long enough to scroll');

  // ── The textbook target: a recovered period that breaks nothing ─────────
  await chooseTarget(page, 'textbook', 'Textbook 2-to-1');
  await page.locator('#run-all').click();
  await expect(page.locator('#exploit')).toHaveClass(/neutral/, { timeout: 60_000 });
  await scanAt('textbook 2-to-1 solved — the neutral verdict, not an alarm');

  // ── The control: a proof of absence, the is-safe rendering ──────────────
  await chooseTarget(page, 'no-period', 'No period (control)');
  await chooseWidth(page, 5);
  await page.locator('#run-all').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-safe/, { timeout: 60_000 });
  await expect(page.locator('#tally-candidates')).toHaveText('0 — none possible');
  await scanAt('the control: rank n reached, no period exists, is-safe');

  // ── A partially-collected run, which is the in-progress verdict ─────────
  await page.locator('#reset').click();
  await page.locator('#measure').click();
  await expect(page.locator('#verdict')).toHaveClass(/is-working/);
  await scanAt('the control, partially collected — the in-progress verdict');

  // ── Both expert disclosures, opened through their own summaries ─────────
  const shut = page.locator('#app details:not([open]) > summary');
  await expect(shut).toHaveCount(2);
  for (let i = 0; i < 2; i++) await shut.first().click();
  await expect(page.locator('#app details:not([open])')).toHaveCount(0);
  await scanAt('both expert disclosures open');

  // ── The measured race, a real computation over 120 attack runs ──────────
  // Wait for the caption AND the re-enabled button, not just the third row: the
  // row lands first and the caption lands after, so scanning on the row count
  // alone runs the oracles against a DOM still being written.
  await page.locator('#race-run').click();
  await expect(page.locator('#race-out .race-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.locator('#race-status')).toContainText('Done —', { timeout: 120_000 });
  await expect(page.locator('#race-run')).toBeEnabled();
  await scanAt('the measured race, three widths, against the control');

  // ── Hover, explicitly, on each of the three button shapes ───────────────
  await page.locator('#seg-target button[data-target="even-mansour"]').hover();
  await scanAt('an unselected segment hovered');

  await chooseTarget(page, 'even-mansour', 'Even-Mansour');
  await page.locator('#seg-target button[data-target="even-mansour"]').hover();
  await scanAt('the SELECTED segment hovered — the control that says which mode is on');

  await page.locator('#run-all').hover();
  await scanAt('the secondary run button hovered');

  await page.locator('a.btn-primary').hover();
  await scanAt('the hero primary button hovered');

  await page.locator('.wayfinder a').first().hover();
  await scanAt('a wayfinder link hovered');
}
