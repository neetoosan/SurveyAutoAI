import { readFileSync } from 'node:fs';
import { expect, PROD_MANIFEST_PATH, register, request, test } from './fixtures';

/**
 * These exercise the parts of the harness that need a real extension runtime:
 * the permission-backed ownership gate, on-demand content-script injection,
 * and the scan/fill round trip. The planner is not called -- no API key is
 * configured, so these drive the fill engine with a hand-written plan instead.
 */

test('the production build asks for no page access up front', () => {
  // Read from disk rather than the running extension: the loaded build is the
  // E2E variant, which deliberately pre-grants the local fixture origin.
  const manifest = JSON.parse(readFileSync(PROD_MANIFEST_PATH, 'utf8'));

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.host_permissions).toEqual(['https://generativelanguage.googleapis.com/*']);
  expect(manifest.optional_host_permissions).toEqual(['http://*/*', 'https://*/*']);
  expect(manifest.content_scripts).toBeUndefined();
});

test('the extension loads with a service worker', async ({ background, extensionId }) => {
  expect(extensionId).toMatch(/^[a-z]{32}$/);
  const manifest = await background.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
});

test('the gate blocks a scan before the form is registered', async ({ panel }) => {
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  expect(scan.ok).toBe(false);
  expect(scan.error).toContain('No ownership attestation on record');
});

test('registering grants host access and records an attestation', async ({ panel }) => {
  await register(panel);

  const state = (await panel.evaluate(() =>
    chrome.storage.sync.get('saqa.ownedOrigins').then((r) => r['saqa.ownedOrigins']),
  )) as Array<{ origin: string; basis: string }>;
  expect(state).toHaveLength(1);
  expect(state[0]?.origin).toBe('http://127.0.0.1:5599');
  expect(state[0]?.basis).toBe('owner');

  const granted = await panel.evaluate(() =>
    chrome.permissions.contains({ origins: ['http://127.0.0.1:5599/*'] }),
  );
  expect(granted).toBe(true);
});

test('scanning injects the content script on demand and normalizes the form', async ({ panel }) => {
  await register(panel);
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  expect(scan.ok, scan.error).toBe(true);
  expect(scan.data.platform).toBe('generic');
  expect(scan.data.page.questions.length).toBeGreaterThanOrEqual(6);

  const labels = scan.data.page.questions.map((q: { label: string }) => q.label);
  expect(labels.join(' | ')).toContain('full name');

  // The honeypot and the CSRF field must be reported, not offered as questions.
  const reasons = scan.data.skipped.map((s: { reason: string }) => s.reason);
  expect(reasons).toContain('input type=hidden');
  expect(reasons.some((r: string) => r.includes('off-screen'))).toBe(true);
  expect(scan.data.page.questions.some((q: { id: string }) => q.id === 'trap')).toBe(false);
});

test('a dry run highlights without writing to the form', async ({ panel, formPage }) => {
  await register(panel);
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const preview = await request(panel, {
    type: 'FILL_PAGE_REQUEST',
    payload: {
      schema: scan.data,
      answers: [{ questionId: 'full-name', textAnswer: 'Preview only', rationale: 'dry run' }],
      dryRun: true,
    },
  });

  expect(preview.ok, preview.error).toBe(true);
  await expect(formPage.locator('#full-name')).toHaveValue('');
  await expect(formPage.locator('#saqa-review-overlay')).toBeAttached();
});

test('a fill writes every answer type and leaves the honeypot alone', async ({
  panel,
  formPage,
}) => {
  await register(panel);
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const result = await request(panel, {
    type: 'FILL_PAGE_REQUEST',
    payload: {
      schema: scan.data,
      answers: [
        { questionId: 'full-name', textAnswer: 'Ada Lovelace', rationale: 'baseline' },
        { questionId: 'role', selectedOptionIndex: 0, rationale: 'engineering path' },
        { questionId: 'owns_car', selectedOptionIndex: 1, rationale: 'no-car branch' },
        { questionId: 'tools', selectedOptionIndexes: [0, 2], rationale: 'two tools' },
        { questionId: 'satisfaction', likertValue: 7, rationale: 'mid-high' },
        { questionId: 'comments', textAnswer: 'No further comments.', rationale: 'optional' },
      ],
      dryRun: false,
      emulationMode: 'instant',
    },
  });

  expect(result.ok, result.error).toBe(true);
  await expect(formPage.locator('#full-name')).toHaveValue('Ada Lovelace');
  await expect(formPage.locator('#role')).toHaveValue('eng');
  await expect(formPage.locator('[name="owns_car"][value="no"]')).toBeChecked();
  await expect(formPage.locator('[name="tools"][value="git"]')).toBeChecked();
  await expect(formPage.locator('[name="tools"][value="k8s"]')).toBeChecked();
  await expect(formPage.locator('[name="tools"][value="docker"]')).not.toBeChecked();
  await expect(formPage.locator('#satisfaction')).toHaveValue('7');
  await expect(formPage.locator('#comments')).toHaveValue('No further comments.');
  await expect(formPage.locator('#trap')).toHaveValue('');
});

test("advancing an empty page reports the form's own required-field validation", async ({
  panel,
}) => {
  await register(panel);
  await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const nav = await request(panel, { type: 'ADVANCE_PAGE_REQUEST' });

  expect(nav.ok, nav.error).toBe(true);
  expect(nav.data.advanced).toBe(false);
  expect(nav.data.findings.map((f: { code: string }) => f.code)).toContain('FORM_VALIDATION_ERROR');
});

test('a filled page advances to the conditional second page', async ({ panel, formPage }) => {
  await register(panel);
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  await request(panel, {
    type: 'FILL_PAGE_REQUEST',
    payload: {
      schema: scan.data,
      answers: [
        { questionId: 'full-name', textAnswer: 'Ada Lovelace', rationale: 'baseline' },
        { questionId: 'role', selectedOptionIndex: 0, rationale: 'engineering' },
        { questionId: 'owns_car', selectedOptionIndex: 0, rationale: 'yes, to reach page 2' },
      ],
      dryRun: false,
      emulationMode: 'instant',
    },
  });

  const nav = await request(panel, { type: 'ADVANCE_PAGE_REQUEST' });

  expect(nav.ok, nav.error).toBe(true);
  expect(nav.data.advanced).toBe(true);
  await expect(formPage.locator('#page2')).toBeVisible();
  await expect(formPage.locator('#oil-brand')).toBeVisible();
});

test('submit is refused without a matching confirmation token', async ({ panel }) => {
  await register(panel);
  await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const stale = await request(panel, {
    type: 'SUBMIT_REQUEST',
    payload: { confirmToken: 'not-a-real-token' },
  });

  expect(stale.ok).toBe(false);
  expect(stale.error).toContain('token missing or stale');
});

test('a submit token issued for this run opens the gate', async ({ panel, formPage }) => {
  await register(panel);
  await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const token = await request<string>(panel, { type: 'ISSUE_SUBMIT_TOKEN' });
  expect(token.ok, token.error).toBe(true);

  // The fixture's first page has no submit control, so this asserts the gate
  // opened rather than that the form was sent.
  const submitted = await request(panel, {
    type: 'SUBMIT_REQUEST',
    payload: { confirmToken: token.data },
  });

  expect(submitted.ok, submitted.error).toBe(true);
  expect(submitted.data.findings.map((f: { code: string }) => f.code)).toContain(
    'NO_SUBMIT_CONTROL',
  );
  await expect(formPage.locator('#done')).toBeHidden();
});

test('human stealth emulation fills text with natural character pipeline', async ({
  panel,
  formPage,
}) => {
  await register(panel);
  const scan = await request(panel, { type: 'SCAN_PAGE_REQUEST' });

  const result = await request(panel, {
    type: 'FILL_PAGE_REQUEST',
    payload: {
      schema: scan.data,
      answers: [{ questionId: 'full-name', textAnswer: 'Ada', rationale: 'human typing test' }],
      dryRun: false,
      emulationMode: 'human',
    },
  });

  expect(result.ok, result.error).toBe(true);
  await expect(formPage.locator('#full-name')).toHaveValue('Ada');
});

