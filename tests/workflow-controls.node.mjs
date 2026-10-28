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
  assert.doesNotMatch(workflow, /dependabot\/fetch-metadata/);
});
