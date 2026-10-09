/**
 * Response schema handed to Gemini's structured-output mode. Keeping the
 * planner's output shape pinned here means a malformed model response fails
 * at the API boundary rather than inside the fill engine.
 */
export const plannedAnswersResponseSchema = {
  type: 'OBJECT',
  properties: {
    answers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          questionId: { type: 'STRING' },
          selectedOptionIndex: { type: 'INTEGER', nullable: true },
          selectedOptionIndexes: { type: 'ARRAY', items: { type: 'INTEGER' }, nullable: true },
          likertValue: { type: 'INTEGER', nullable: true },
          textAnswer: { type: 'STRING', nullable: true },
          matrixSelections: { type: 'STRING', nullable: true },
          rationale: { type: 'STRING' },
          uncertain: { type: 'BOOLEAN', nullable: true },
        },
        required: ['questionId', 'rationale'],
      },
    },
  },
  required: ['answers'],
} as const;
