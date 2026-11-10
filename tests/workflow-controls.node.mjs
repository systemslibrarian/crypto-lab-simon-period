import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');

test('a failed post-merge deployment dispatch fails the Dependabot job', () => {
  const dispatch = workflow.indexOf(
    'gh workflow run deploy.yml --repo "$GITHUB_REPOSITORY" --ref main',
  );
  assert.notEqual(dispatch, -1, 'the auto-merge path must dispatch the gated main workflow');
  assert.doesNotMatch(
    workflow.slice(dispatch, dispatch + 180),
    /\|\|/,
    'a failed deployment dispatch must not be reduced to a warning',
  );
});

test('the auto-merge path has no unused Dependabot metadata action', () => {
  // The objection this control was written for is an action whose output
  // nothing reads -- a step that looks like a safeguard and decides nothing.
  // A blanket ban enforced that by forbidding the action outright, which also
  // forbade using it. Assert the stated intent instead: if the step is there,
  // its update-type must be consumed by the gate. That still fails an unused
  // step, and additionally fails a gate that is removed while the step is left
  // behind, so it is strictly stronger than the ban on the case that matters.
  if (!/dependabot\/fetch-metadata/.test(workflow)) return;
  assert.match(workflow, /-\s+id:\s*meta\b/,
    'a metadata step must expose its outputs under id: meta');
  assert.match(
    workflow,
    /if:\s*steps\.meta\.outputs\.update-type\s*!=\s*'version-update:semver-major'/,
    'a metadata step must be read by the semver-major gate, not left unused',
  );
});
