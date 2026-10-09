import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

/**
 * The E2E build is a separate artifact so the production one stays assertable.
 * chrome.permissions.request raises a native Chrome dialog that Playwright
 * cannot dismiss, so the E2E build ships with the local fixture origin already
 * granted; the request call then resolves true without prompting and the rest
 * of the registration flow is exercised unchanged.
 */
const E2E = process.env.SAQA_E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  outDir: E2E ? '.output-e2e' : '.output',
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'SurveyAutoAI QA Harness',
    description:
      'Parse, exercise, and validate survey forms you own. Generates test respondents and verifies branching, required-field, and validation logic.',
    version: '0.1.0',
    permissions: ['activeTab', 'tabs', 'storage', 'sidePanel', 'scripting', 'downloads'],
    // Only the Gemini endpoint is granted up front. Access to a form's own
    // origin is requested at registration time, so the browser's permission
    // system -- not just this extension's bookkeeping -- enforces the gate.
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      ...(E2E ? ['http://127.0.0.1:5599/*'] : []),
    ],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'Open SurveyAutoAI QA Harness',
      default_icon: {
        16: '/icons/icon-16.png',
        32: '/icons/icon-32.png',
        48: '/icons/icon-48.png',
        128: '/icons/icon-128.png',
      },
    },
    icons: {
      16: '/icons/icon-16.png',
      32: '/icons/icon-32.png',
      48: '/icons/icon-48.png',
      128: '/icons/icon-128.png',
    },
    side_panel: { default_path: 'sidepanel.html' },
  },
});
