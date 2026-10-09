 # SurveyAutoAI: Browser Extension Engineering Roadmap & Architectural Specification

An end-to-end engineering blueprint for building a production-grade, AI-driven browser extension (Manifest V3) that intelligently inspects, evaluates, and auto-fills web surveys (Google Forms, Typeform, Qualtrics, SurveyMonkey, and custom forms) using autonomous persona calibration.

---

## 1. System Architecture & Component Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CHROME BROWSER RUNTIME                          │
│                                                                        │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │                      Side Panel / Popup UI                    │   │
│   │   - Persona Selector & Configurator                           │   │
│   │   - Autonomous vs Step-by-Step Approval Mode                  │   │
│   │   - Live Execution Log & Token Monitor                        │   │
│   └──────────────────────────────┬────────────────────────────────┘   │
│                                  │ (chrome.runtime messaging)         │
│                                  ▼                                    │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │             Background Service Worker (MV3 Orchestrator)      │   │
│   │   - API Key & Persona Vault (chrome.storage.sync)             │   │
│   │   - Survey Session State Machine & Memory Vector Store        │   │
│   │   - Gemini 3 Flash / REST Gateway with Exponential Backoff    │   │
│   └──────────────────────────────┬────────────────────────────────┘   │
│                                  │ (chrome.tabs.sendMessage)          │
│                                  ▼                                    │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │                   Injected Content Script                     │   │
│   │   ┌───────────────────────┐       ┌───────────────────────┐   │   │
│   │   │ Survey Platform Heuristic│    │ DOM Interaction Engine│   │   │
│   │   │ - Google Forms Adapter│       │ - Human Typing Jitter │   │   │
│   │   │ - Typeform Adapter    │       │ - Event Dispatcher    │   │   │
│   │   │ - Qualtrics Adapter   │       │ - Synthetic Mouse Path│   │   │
│   │   │ - Generic DOM Scraper │       │ - Honeypot Trap Filter│   │   │
│   │   └───────────────────────┘       └───────────────────────┘   │   │
│   └───────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ HTTPS / REST
                                   ▼
                     ┌───────────────────────────┐
                     │ Google Gemini API Engine  │
                     │ - Structured JSON Schema  │
                     │ - Zero-Shot Coherence     │
                     └───────────────────────────┘
```

---

## 2. Core Technical Stack Recommendation

| Layer | Recommended Technology | Justification |
| :--- | :--- | :--- |
| **Extension Framework** | **WXT** or **Plasmo** (TypeScript + Vite) | Provides hot module replacement (HMR), first-class MV3 manifest generation, multi-browser targeting (Chrome, Firefox, Edge, Safari), and automated packaging. |
| **UI Layer** | **React 19** + **Tailwind CSS** + **Lucide Icons** | Component-driven UI ideal for the Chrome SidePanel API; lightweight and responsive within narrow viewport constraints (360px–420px). |
| **State Management** | **Zustand** with Chrome Storage Sync Persistence | Minimal boilerplate, asynchronous storage adapters, cross-context synchronization between content scripts and side panels. |
| **AI Inference** | **Google Gemini 3 Flash** (`gemini-3-flash-preview`) | Fast sub-second latency, long context window for multi-page surveys, and strict structured JSON Schema output enforcement. |
| **DOM Automation** | Native Synthetic Event Dispatcher + MutationObserver | No heavy external dependencies; utilizes native `Event`, `MouseEvent`, `InputEvent`, and shadow DOM traversals. |

---

## 3. Phase-by-Phase Implementation Roadmap

```
Week 1-2      Week 3-5         Week 6-7         Week 8-9         Week 10-11       Week 12+
───┼─────────────┼────────────────┼────────────────┼────────────────┼───────────────┼───►
   │             │                │                │                │               │
Phase 1       Phase 2          Phase 3          Phase 4          Phase 5         Phase 6
Manifest V3   Universal DOM    Cognitive        Human Stealth    SidePanel UX    QA, Security &
Foundation    Scraping Core    Persona Engine   & Emulation      & Review Mode   Web Store Launch
```

---

### Phase 1: Manifest V3 Scaffolding & Architecture Foundation (Weeks 1–2)

#### Objectives
Establish the build tooling, secure message-passing channels, permission boundaries, and encrypted storage.

#### Milestones & Deliverables
1. **Repository Setup**: Initialize WXT with TypeScript, ESLint, Prettier, and Tailwind CSS.
2. **Manifest V3 Configuration**:
   ```json
   {
     "manifest_version": 3,
     "name": "SurveyAutoAI - Autonomous Survey Assistant",
     "version": "1.0.0",
     "permissions": [
       "activeTab",
       "storage",
       "sidePanel",
       "scripting"
     ],
     "host_permissions": [
       "https://generativelanguage.googleapis.com/*",
       "https://docs.google.com/forms/*",
       "https://*.typeform.com/*",
       "https://*.qualtrics.com/*",
       "https://*.surveymonkey.com/*"
     ],
     "background": { "service_worker": "entrypoints/background.ts" },
     "side_panel": { "default_path": "entrypoints/sidepanel.html" },
     "content_scripts": [{
       "matches": ["<all_urls>"],
       "js": ["entrypoints/content.ts"],
       "run_at": "document_idle"
     }]
   }
   ```
3. **Secure API Key Management**:
   - WebCrypto-based local encryption for user-provided Gemini API keys.
   - Storage synchronization across devices via `chrome.storage.sync`.
4. **Strongly Typed RPC Messaging Bridge**:
   - Implement type-safe message passing between SidePanel, Background Service Worker, and Content Script:
     ```typescript
     export type MessageContract = 
       | { type: 'SCAN_PAGE_REQUEST' }
       | { type: 'SCAN_PAGE_RESPONSE'; payload: SurveyDOMSchema }
       | { type: 'FILL_QUESTION_COMMAND'; payload: AnswerPayload }
       | { type: 'SUBMIT_STEP_COMMAND' };
     ```

---

### Phase 2: Universal DOM Survey Parser Engine (Weeks 3–5)

#### Objectives
Detect, isolate, and normalize questions, options, scale bounds, and input types across diverse survey frameworks.

#### Platform Adapters to Implement
1. **Google Forms Adapter (`google-forms.ts`)**:
   - Question containers: `div[role="listitem"]` or `.geS5n`
   - Question Title: `.M7eMe`
   - Radio buttons: `div[role="radio"]`
   - Checkboxes: `div[role="checkbox"]`
   - Linear Scales: `.vQES8d` rating groups
   - Short/Long text: `input.whsOnd`, `textarea.KHxj8b`
2. **Typeform Adapter (`typeform.ts`)**:
   - Active block detection: `div[data-qa="block-wrapper"]`
   - Key-shortcut binding listeners (`Enter`, `A-Z` triggers)
   - Dynamic step-by-step progress tracking
3. **Qualtrics Adapter (`qualtrics.ts`)**:
   - Matrix tables: `.Matrix`
   - Single choice / Multi choice: `.ChoiceStructure`
   - Slider scales: `.horizontalbar`
4. **Generic Fallback Scraper (`generic-form.ts`)**:
   - Semantic scanning of `<form>`, `<fieldset>`, `<legend>`, `<label>`, `<input>`, `<select>`, `<textarea>`.
   - Heuristic label matching: scans `aria-labelledby`, preceding headings (`h1-h4`), and parent text nodes.

#### Standardized Question Representation Schema
```typescript
export interface SurveyQuestion {
  id: string;                      // Stable DOM identifier or hash
  index: number;
  label: string;                   // Clean question prompt
  description?: string;            // Secondary instructions/subtitles
  type: 'likert' | 'radio' | 'checkbox' | 'dropdown' | 'text' | 'textarea' | 'matrix';
  required: boolean;
  options?: Array<{ label: string; elementRefId: string }>;
  scale?: { min: number; max: number; minLabel?: string; maxLabel?: string };
  domRef: string;                  // Unique query-path or custom data-id
}
```

---

### Phase 3: Cognitive Persona & Memory Engine (Weeks 6–7)

#### Objectives
Synthesize consistent, non-contradictory answers governed by realistic human profiles and previous survey decisions.

#### Key Features
1. **Persona Schema & Presets**:
   - Demographic profile (Age, Profession, Income, Tech Proficiency, Location).
   - Core Biases & Preferences (e.g., "Prefers local open-source software over SaaS", "Extremely price-conscious").
   - Communication Style (Sentence structure, tone, typical vocabulary, length).
2. **In-Flight Session Memory (Anti-Contradiction)**:
   - Maintains a chronological log of all previously answered questions in the active session.
   - Example: If Question 2 asks *"Do you own a car?"* and the persona answers *"No"*, the engine ensures Question 8 (*"What brand of motor oil do you purchase?"*) is answered with *"N/A / Do not own a vehicle"*.
3. **Gemini 3 Flash Structured Prompting**:
   ```typescript
   const prompt = {
     contents: [{
       parts: [{
         text: `You are answering a live survey acting strictly as this persona:
${JSON.stringify(personaProfile)}

SURVEY CONTEXT:
Title: "${surveyMeta.title}"
Previous Answers Log:
${JSON.stringify(sessionMemory)}

QUESTIONS TO ANSWER:
${JSON.stringify(batchOfQuestions)}

Respond in valid JSON matching the requested schema. Ensure 100% logical cohesion with past answers.`
       }]
     }],
     generationConfig: {
       responseMimeType: "application/json",
       responseSchema: {
         type: "OBJECT",
         properties: {
           answers: {
             type: "ARRAY",
             items: {
               type: "OBJECT",
               properties: {
                 questionId: { type: "STRING" },
                 selectedOptionIndex: { type: "INTEGER", nullable: true },
                 selectedOptionIndexes: { type: "ARRAY", items: { type: "INTEGER" }, nullable: true },
                 likertValue: { type: "INTEGER", nullable: true },
                 textAnswer: { type: "STRING", nullable: true },
                 rationale: { type: "STRING" }
               },
               required: ["questionId"]
             }
           }
         },
         required: ["answers"]
       }
     }
   };
   ```

---

### Phase 4: Human-Grade DOM Emulation & Anti-Bot Protection (Weeks 8–9)

#### Objectives
Prevent platform bot-detection, honeypot traps, and event cancellation by accurately mimicking genuine human browser interaction.

#### Tactical Implementations
1. **Complete Event Lifecycle Dispatching**:
   - Modern frameworks (React, Angular, Vue) ignore simple `element.value = "xyz"` assignments.
   - Dispatch the complete event pipeline:
     ```typescript
     async function simulateHumanInput(inputEl: HTMLInputElement | HTMLTextAreaElement, text: string) {
       inputEl.focus();
       inputEl.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
       
       let currentVal = '';
       for (const char of text) {
         currentVal += char;
         inputEl.value = currentVal;
         inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));
         // Non-linear typing delay: 40ms to 120ms with randomized variance
         await sleep(gaussianRandom(40, 120));
       }
       
       inputEl.dispatchEvent(new Event('change', { bubbles: true }));
       inputEl.blur();
     }
     ```
2. **Synthetic Mouse & Click Simulation**:
   - Trigger `pointerdown` ➔ `mousedown` ➔ `focus` ➔ `pointerup` ➔ `mouseup` ➔ `click`.
   - Scroll target element into viewport using smooth, staggered behaviors before clicking.
3. **Honeypot & Hidden Field Detection**:
   - Automatically ignore form inputs with `type="hidden"`, CSS `opacity: 0`, `visibility: hidden`, `display: none`, or zero bounding rect dimensions.
4. **CAPTCHA & Cloudflare Detection (Safety Tripwires)**:
   - Inspect page for reCAPTCHA, hCaptcha, Turnstile, or Arkose frames.
   - Trigger an immediate pause, sound a chime, and notify the user via the SidePanel to complete the verification challenge manually.

---

### Phase 5: Side Panel UX, Review Flow & Controls (Weeks 10–11)

#### Objectives
Deliver a streamlined, transparent control center using Chrome's native `SidePanel` API.

#### UX Modules
1. **Control Dashboard**:
   - **Active Survey Status**: Detected engine (e.g., "Google Forms recognized - 12 questions").
   - **Persona Manager**: Quick toggle pills (DevOps Engineer, College Student, Executive, Custom).
   - **Execution Modes**:
     - *Autonomous Speedrun*: Automatically fills and navigates pages.
     - *Supervised / Review Mode*: Highlights proposed answers in yellow on the actual webpage; requires user click to confirm.
2. **Confidence & Rationale Inspector**:
   - Shows the AI's internal reasoning behind each generated answer before insertion.
3. **Receipt Exporter**:
   - Generates and downloads a `.json` or `.csv` record of all questions, answers, and timestamps upon survey completion.

---

### Phase 6: QA, Compliance, Chrome Web Store Launch (Weeks 12+)

#### Objectives
Thoroughly test across major survey software, pass Google Web Store security review, and launch.

#### Deliverables & Quality Gates
1. **Automated End-to-End Fixture Suite**:
   - Playwright test runner executing the extension against live mock Google Forms, Typeform surveys, and complex nested conditional forms.
2. **Permission Minimization**:
   - Strict adherence to Chrome Web Store Least Privilege principle:
     - Prefer `activeTab` instead of universal broad `<all_urls>` web injection where feasible.
     - Isolate Gemini API communications within the Background Service Worker.
3. **Privacy Policy & Disclaimers**:
   - Plain-language data disclosure: zero logging of user survey data; all API calls routed directly to user-managed Gemini keys.
   - User terms outlining ethical survey engagement and policy compliance.

---

## 4. Key Performance Indicators (KPIs) for Success

- **DOM Extraction Accuracy**: $\ge 96\%$ of form inputs correctly typed and mapped on major survey platforms.
- **Answer Logical Consistency**: Zero intra-survey contradictions over a standard 20-question questionnaire.
- **Input Acceptance Rate**: $\ge 99\%$ of synthetic input triggers successfully accepted by React/Vue controlled form inputs.
- **Latency**: Under 1.8 seconds total round-trip time per 5 questions using Gemini 3 Flash.