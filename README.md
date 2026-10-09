# SurveyAutoAI QA Harness

An MV3 browser extension that parses, exercises, and validates **survey forms you own**.

It reads a form's structure into a normalized schema, asks Gemini to generate a
test respondent that probes a specific path through it, previews the proposed
answers in-page, fills them, and reports what the form did in response —
branching that never fired, required fields that did not enforce, length limits
that truncated silently, validation that fired when it should not have.

Runs are exportable as JSON or CSV so a failing run can be attached to a ticket.

---

## Scope & Emulation Profiles

SurveyAutoAI provides dual-mode execution to balance realistic human survey interaction with high-speed testing:

| Feature | Human Stealth Profile (Default) | Instant Profile (Testing/Fast) |
| :--- | :--- | :--- |
| **Typing Simulation** | Character-by-character with 40–120ms Gaussian delay, inter-word hesitations, and punctuation pauses. | Complete event lifecycle dispatched immediately without artificial sleep gaps. |
| **Mouse Interaction** | Synthetic mouse path, randomized landing within element rect, realistic button hold delay (40–100ms). | Instant synthetic event sequence. |
| **Viewport Scrolling** | Smooth decelerated scroll into view with human saccade pause. | Instant scroll. |
| **Honeypot Traps** | Automatically detected (off-screen, zero dimensions, opacity 0, clip-rects) and strictly avoided. | Automatically detected and avoided. |
| **Safety Tripwires** | Real-time monitoring for reCAPTCHA, hCaptcha, Turnstile, and Arkose frames. Pauses execution and sounds alert chime. | Monitored; execution halts on challenge. |

Modern frameworks (React, Angular, Vue) track state via internal prototype setters; SurveyAutoAI writes through native prototype descriptors and fires the complete event pipeline (`focus`, `keydown`, `beforeinput`, `input`, `keyup`, `change`, `blur`) so that controlled components register every synthetic interaction cleanly.

### The ownership gate

`src/ownership/guard.ts` is the load-bearing safety property, and it is backed by
Chrome's own permission system rather than by this extension's bookkeeping alone.

A fresh install has **no access to any page**. `host_permissions` contains only
the Gemini endpoint; page access sits in `optional_host_permissions`. Registering
a form in the side panel does two things in one user gesture:

1. calls `chrome.permissions.request` for that origin, and
2. records an attestation — basis (owner / administrator / written permission),
   optional note, timestamp.

Both are then required before **either** a scan or a fill will run. Requiring the
attestation record as well as the grant means a permission handed out broadly in
`chrome://extensions` does not bypass registration. Revoking removes the record
*and* drops the host permission.

Submitting is gated a third time: the panel must echo back a single-use token the
background issued for that run, so an accidental submit against a live form takes
a deliberate second action.

Google Forms, Typeform and SurveyMonkey put every form on one shared origin, so
for those the attestation key keeps the form path
(`https://docs.google.com/forms/d/e/<id>`) rather than the origin alone —
registering one Google Form does not register all of them. See
`attestationKeyFor`.

---

## Getting started

```bash
npm install        # runs `wxt prepare` via postinstall
npm run dev        # launches Chrome with the extension and HMR
npm run build      # production build into .output/chrome-mv3
npm run zip        # packaged artifact for the Web Store
```

Then in the side panel:

1. **Paste a Gemini API key.** It is verified against the API before being
   stored, and calls go straight from the extension to Google.
2. **Register** the form as one you own. Chrome will ask to grant access to that
   site; nothing — not even a scan — works before this.
3. **Scan** the form. Nothing is modified.
4. **Plan** answers with a test respondent, **Preview** them as an in-page
   overlay, then **Fill**.
5. **Next page** / **Submit** (two-step confirmation), then export the run.

### API key storage

Two honest modes, because encrypting a key with a second key kept beside it
protects nothing:

- **Passphrase mode** — AES-GCM under a PBKDF2-derived key (310k iterations,
  SHA-256). The passphrase is never persisted, so the key is unreadable at rest.
  Costs one unlock per browser session.
- **Plain mode** — readable by anything that can reach extension storage. The UI
  says so rather than implying otherwise.

Either way the key lives in `storage.local`, not `storage.sync`: pushing a
credential through a profile-sync channel widens its exposure for no gain.

---

## Test respondents

Each preset targets a class of form defect (`src/ai/respondents.ts`):

| Preset | Probes |
| :--- | :--- |
| **Happy path** | Baseline. Plausible, internally consistent answers throughout. |
| **Required only** | Optional fields that are wrongly enforced. |
| **Max-length boundary** | Silent truncation; upper scale bounds; last-option handling. |
| **Min-length boundary** | Over-strict validation at the lower bound. |
| **Branch explorer** | Conditional logic the baseline run never reaches. |
| **Unicode and symbols** | Encoding and escaping end to end — CJK, RTL, emoji, quotes, angle brackets. |

Cross-page consistency is maintained by feeding recorded answers back into each
subsequent planning call, so a respondent that answered "No" to *do you own a
car* answers the motor-oil question on the next page accordingly instead of
contradicting itself.

The planner sets `uncertain: true` when it cannot map its intent onto the
options available; that surfaces as a `PLANNER_UNCERTAIN` finding rather than a
confident wrong answer. Option indexes and scale values are clamped into range
before any fill, so a model slip becomes a finding instead of an exception.

---

## Architecture

```
src/
  entrypoints/
    background.ts        MV3 orchestrator: state machine, ownership checks,
                         Gemini calls, run persistence, submit tokens
    content.ts           Injected on demand via activeTab + scripting
    sidepanel/           React 19 + Tailwind 4 control panel
  adapters/              Platform detection and DOM normalization
    base.ts              Ref stamping, visibility rules, accessible-name resolution
    google-forms.ts      role=listitem containers, .M7eMe titles, linear scales
    typeform.ts          One active block at a time; drives branching block by block
    qualtrics.ts         .QuestionOuter, matrix tables, sliders
    generic-form.ts      Semantic fallback; groups radios/checkboxes by name
  ai/
    gemini.ts            REST gateway, exponential backoff with full jitter
    planner.ts           Batched structured prompting with running memory
    respondents.ts       Test-respondent presets
  dom/
    emulation.ts         Gaussian typing jitter, synthetic mouse simulation, smooth scrolling
    tripwire.ts          Anti-bot safety tripwires (CAPTCHA/Turnstile) & honeypot filtering
    audio.ts             Synthesized Web Audio alert chime for challenge detections
    fill.ts              Apply answers, collect findings, read validation errors
    highlight.ts         Review overlay in a shadow root
  ownership/guard.ts     Attestation gate
  storage/               Key vault, run history, Zustand panel store
```

### Permissions

`host_permissions` contains **only** the Gemini endpoint. Page access lives in
`optional_host_permissions` and is requested per-origin at registration time.
The content script is declared with **no `matches`** and registered at runtime,
then injected with `chrome.scripting.executeScript`. So `<all_urls>` never
appears as a granted permission, which matters for Web Store review.

For review: `downloads` backs the run exporter, `storage` the vault and run
history, `sidePanel` the UI, `scripting` the on-demand injection, and `tabs` lets
the panel show which form is in the active tab before any access is granted.

---

## Finding codes

| Code | Severity | Meaning |
| :--- | :--- | :--- |
| `REQUIRED_UNANSWERED` | error | A required question got no planned answer. |
| `FILL_FAILED` | error | The target element could not be driven; message carries the cause. |
| `CAPTCHA_TRIPWIRE` | error | A bot verification challenge was detected; automated execution paused. |
| `FORM_VALIDATION_ERROR` | warning | The form surfaced its own error text. |
| `CONSTRAINT_VIOLATION` | warning | A control failed `checkValidity()` after the fill. |
| `ORPHAN_ANSWER` | warning | The planner answered a question id that is not on the page. |
| `ADVANCE_NO_EFFECT` | warning | Next/Submit changed nothing and surfaced no message. |
| `NO_NEXT_CONTROL` / `NO_SUBMIT_CONTROL` | error | The adapter found no navigation control. |
| `PLANNER_UNCERTAIN` | info | The model flagged low confidence. |
| `HONEYPOT_TRAP` | info | A hidden or off-screen trap field was detected and protected from fills. |
| `HIDDEN_INPUT` | info | A non-interactive input was skipped, not filled. |

---

## Testing

```bash
npm test          # vitest: adapters + fill engine against tests/fixtures (happy-dom)
npm run test:e2e  # builds both variants, then playwright against a real Chromium
npm run compile   # tsc --noEmit
```

Current state: **24 unit tests, 11 E2E tests, all passing**; `tsc --noEmit`
clean.

`npm run test:e2e` produces two builds. The E2E one (`SAQA_E2E=1`, output
`.output-e2e/`) pre-grants `http://127.0.0.1:5599/*`, because
`chrome.permissions.request` raises a native Chrome dialog that Playwright
cannot dismiss; with the grant already in place that call resolves `true`
without prompting and the rest of the registration flow runs unchanged. One test
reads the *production* manifest off disk to assert it stays narrow.

`tests/fixtures/mock-survey.html` is a two-page form with real required-field
enforcement, a conditional second page, a hidden CSRF field, and an off-screen
honeypot — enough to assert that the harness reports traps rather than filling
them.

The E2E suite asserts the gate actually blocks (an unregistered scan is refused),
that registering both records the attestation and obtains the host permission,
that a dry run paints the overlay without writing, that a real fill drives every
answer type while leaving the honeypot empty, that an empty page's advance is
reported as blocked by the form's own validation, and that submit rejects a stale
confirmation token.

Note: `npm test` needs the layout stub in `tests/unit/helpers.ts` — happy-dom
does no layout, so every `getBoundingClientRect()` is zero and the visibility
filter would otherwise drop the whole form.

---

## Known gaps

- **Model id.** `DEFAULT_MODEL` in `src/ai/gemini.ts` is
  `gemini-3-flash-preview`, taken from the original roadmap. Google renames
  preview models often; if planning fails with a 404, set a current id there.
- **Adapter selectors.** The Google Forms, Typeform and Qualtrics adapters use
  obfuscated class names (`.M7eMe`, `.vQES8d`, `.ChoiceStructure`) that those
  vendors change without notice. Only the generic adapter is covered by tests;
  the platform adapters need fixtures captured from live forms you own, which
  is the main remaining work before this is dependable on them.
- **Matrix support** is implemented for Qualtrics only, and its column-header
  alignment heuristic is untested against a real matrix question.
- **Typeform paging** returns one question per scan by design, so a full run
  there is scan → plan → fill → advance in a loop; the side panel does not yet
  automate that loop.
