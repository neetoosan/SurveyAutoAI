import type { AnswerRecord, PlannedAnswer, RespondentProfile } from '@/types/respondent';
import type { SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import { generateStructured, type GeminiUsage } from './gemini';

const SYSTEM_INSTRUCTION = `You generate test input for a survey QA harness.

The operator runs this against a form they own in order to exercise its
branching, required-field enforcement, and validation rules. Your answers are
test fixtures, not claims about a real person.

Rules:
- Answer strictly in the requested JSON schema.
- Refer to questions by the exact questionId given. Never invent ids.
- Option indexes are 0-based over the options array as given.
- Stay consistent with the answers already recorded this session. If an earlier
  answer rules out a later question, answer it the way the form intends for
  that path (for example "N/A") rather than contradicting yourself.
- Set "uncertain": true whenever the question is ambiguous or you cannot map the
  respondent's intent onto the available options. A flagged answer is more
  useful to the operator than a confident wrong one.
- matrixSelections, when needed, is a JSON object encoded as a string, mapping
  each row's elementRefId to a 0-based column index.`;

/** Questions per request. Large batches risk a truncated JSON response. */
export const DEFAULT_BATCH_SIZE = 12;

interface PlanOptions {
  apiKey: string;
  model?: string;
  schema: SurveyDOMSchema;
  respondent: RespondentProfile;
  /** Answers already recorded this session, for cross-page consistency. */
  memory: AnswerRecord[];
  batchSize?: number;
  signal?: AbortSignal;
}

export interface PlanResult {
  answers: PlannedAnswer[];
  usage: GeminiUsage;
  calls: number;
}

/** Trim the schema to what the planner needs; DOM refs stay local. */
function projectQuestion(q: SurveyQuestion) {
  return {
    questionId: q.id,
    label: q.label,
    description: q.description,
    type: q.type,
    required: q.required,
    options: q.options?.map((o, i) => ({ index: i, label: o.label })),
    rows: q.rows?.map((r) => ({ elementRefId: r.elementRefId, label: r.label })),
    scale: q.scale,
    constraints: q.constraints,
  };
}

function projectMemory(memory: AnswerRecord[]) {
  return memory.map((m) => ({
    question: m.questionLabel,
    answer:
      m.value.textAnswer ??
      m.value.likertValue ??
      m.value.selectedOptionIndex ??
      m.value.selectedOptionIndexes,
  }));
}

export function buildPrompt(
  schema: SurveyDOMSchema,
  respondent: RespondentProfile,
  memory: AnswerRecord[],
  batch: SurveyQuestion[],
): string {
  return [
    `TEST RESPONDENT: ${respondent.name}`,
    `INTENT: ${respondent.intent}`,
    `TRAITS: ${JSON.stringify(respondent.traits)}`,
    respondent.textStyle ? `TEXT STYLE: ${JSON.stringify(respondent.textStyle)}` : '',
    '',
    `FORM: "${schema.title}" (${schema.platform}), page ${schema.page.pageIndex + 1}`,
    '',
    memory.length
      ? `PREVIOUS ANSWERS IN THIS SESSION (STRICT ANTI-CONTRADICTION ENFORCED):\n${JSON.stringify(projectMemory(memory), null, 1)}\nCRITICAL: Ensure 100% logical cohesion with past answers. Never contradict any previous response given above.`
      : 'PREVIOUS ANSWERS IN THIS SESSION: none, this is the first page.',
    '',
    `QUESTIONS TO ANSWER:\n${JSON.stringify(batch.map(projectQuestion), null, 1)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

interface RawAnswer extends Omit<PlannedAnswer, 'matrixSelections'> {
  matrixSelections?: string | null;
}

/** The schema carries matrixSelections as a JSON string; widen it back out. */
function normalize(raw: RawAnswer): PlannedAnswer {
  const { matrixSelections, ...rest } = raw;
  let parsed: Record<string, number> | null = null;
  if (matrixSelections) {
    try {
      parsed = JSON.parse(matrixSelections) as Record<string, number>;
    } catch {
      parsed = null;
    }
  }
  return { ...rest, matrixSelections: parsed };
}

export async function planAnswers(options: PlanOptions): Promise<PlanResult> {
  const {
    apiKey,
    model,
    schema,
    respondent,
    memory,
    batchSize = DEFAULT_BATCH_SIZE,
    signal,
  } = options;

  const questions = schema.page.questions;
  const answers: PlannedAnswer[] = [];
  const usage: GeminiUsage = { promptTokens: 0, responseTokens: 0 };
  let calls = 0;

  // Memory grows as batches land so later questions see earlier decisions.
  const runningMemory: AnswerRecord[] = [...memory];

  for (let start = 0; start < questions.length; start += batchSize) {
    const batch = questions.slice(start, start + batchSize);
    const result = await generateStructured<{ answers: RawAnswer[] }>({
      apiKey,
      model,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt: buildPrompt(schema, respondent, runningMemory, batch),
      signal,
    });

    calls++;
    usage.promptTokens += result.usage.promptTokens;
    usage.responseTokens += result.usage.responseTokens;

    const batchAnswers = (result.data.answers ?? []).map(normalize);
    answers.push(...batchAnswers);

    for (const answer of batchAnswers) {
      const question = batch.find((q) => q.id === answer.questionId);
      if (!question) continue;
      runningMemory.push({
        questionId: question.id,
        questionLabel: question.label,
        questionType: question.type,
        value: answer,
        rationale: answer.rationale,
        filledAt: Date.now(),
      });
    }
  }

  return { answers: reconcile(answers, questions), usage, calls };
}

/**
 * Drop answers the planner invented and clamp option indexes into range, so a
 * model slip surfaces as a finding instead of a fill-time exception.
 */
function reconcile(answers: PlannedAnswer[], questions: SurveyQuestion[]): PlannedAnswer[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();

  return answers.filter((answer) => {
    const question = byId.get(answer.questionId);
    if (!question || seen.has(answer.questionId)) return false;
    seen.add(answer.questionId);

    const optionCount = question.options?.length ?? 0;
    if (answer.selectedOptionIndex != null && optionCount > 0) {
      answer.selectedOptionIndex = Math.min(
        Math.max(answer.selectedOptionIndex, 0),
        optionCount - 1,
      );
    }
    if (answer.selectedOptionIndexes && optionCount > 0) {
      answer.selectedOptionIndexes = answer.selectedOptionIndexes
        .filter((i) => i >= 0 && i < optionCount)
        .filter((i, pos, arr) => arr.indexOf(i) === pos);
    }
    if (answer.likertValue != null && question.scale) {
      answer.likertValue = Math.min(
        Math.max(answer.likertValue, question.scale.min),
        question.scale.max,
      );
    }
    return true;
  });
}
