/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy — hand-measure before acting on it.
 *
 * IT IS EMPTY, AND THAT IS THE POINT — this is the terminal state of the
 * ratchet, not an unrun check. Reaching it took two passes:
 *
 *  - `9fc1c8a` fixed five control boundaries by hand in a browser:
 *    `--border-strong` itself in both themes, `.btn-secondary` overriding it
 *    with a decorative `--accent-line`, and `.btn-primary` and the SELECTED
 *    `.seg` segment each painting their border the same colour as their own
 *    accent fill. That pass also moved the shared top bar's `.cl-btn` onto
 *    `--cl-ink`, which is why the two entries every other repo in this fleet
 *    carries here are absent.
 *  - the gate then found three MORE at states no hand measurement reaches,
 *    because the controls do not exist until a measurement has been run: every
 *    `<button class="amp-cell">` in the two interference grids drew its edge
 *    from `--border`, the surface-divider token — `.zero` and `.empty` at
 *    1.37:1 dark / 1.42:1 light, and `.pos` at 1.68:1 dark / 2.08:1 light
 *    against the panel behind them, where 3:1 is required.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this same
 * path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
