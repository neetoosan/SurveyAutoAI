import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

// package.json sets "type": "module", so there is no __dirname here.
/** The E2E build (SAQA_E2E=1), which pre-grants the fixture origin. */
export const EXTENSION_PATH = fileURLToPath(
  new URL('../../.output-e2e/chrome-mv3', import.meta.url),
);

/** The production build, asserted on separately to prove it stays narrow. */
export const PROD_MANIFEST_PATH = fileURLToPath(
  new URL('../../.output/chrome-mv3/manifest.json', import.meta.url),
);

export const FIXTURE_URL = 'http://127.0.0.1:5599/mock-survey.html';

interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  background: Worker;
  /** The form under test, left as the active tab. */
  formPage: Page;
  /**
   * sidepanel.html opened as an ordinary tab.
   *
   * Requests have to originate here rather than in the service worker:
   * chrome.runtime.sendMessage never delivers to a listener in the sending
   * context, so a call made inside background.ts would never reach its own
   * onMessage handler.
   */
  panel: Page;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    if (!existsSync(EXTENSION_PATH)) {
      throw new Error(
        `Build the E2E variant first (npm run build:e2e): ${EXTENSION_PATH} is missing.`,
      );
    }

    // A persistent context is required: MV3 extensions do not load otherwise.
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });

    await use(context);
    await context.close();
  },

  background: async ({ context }, use) => {
    // The worker may already be running by the time the fixture is requested.
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },

  formPage: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(FIXTURE_URL);
    await use(page);
  },

  panel: async ({ context, extensionId, formPage }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    // The background resolves its target with {active: true}, so the form has
    // to be the active tab while the panel drives it from the background.
    await formPage.bringToFront();

    await use(page);
  },
});

/**
 * Click the panel's real register button.
 *
 * chrome.permissions.request only works inside a user gesture, so the grant has
 * to come from an actual click rather than an evaluate() call.
 */
export async function register(panel: Page): Promise<void> {
  const button = panel.getByRole('button', { name: 'Register this form' });
  await button.waitFor({ state: 'visible' });
  await button.click();
  await panel.getByText('Registered.').waitFor({ state: 'visible' });
}

/** Send a panel request and return the background's envelope. */
export async function request<T = any>(
  panel: Page,
  message: Record<string, unknown>,
): Promise<{ ok: boolean; data: T; error?: string }> {
  return panel.evaluate((msg) => chrome.runtime.sendMessage(msg), message);
}

export { expect } from '@playwright/test';
