import { describe, expect, it } from 'vitest';
import {
  customPersonaToProfile,
  deleteCustomPersona,
  loadCustomPersonas,
  resolveRespondent,
  saveCustomPersona,
  type CustomPersona,
} from '@/storage/personas';
import { buildPrompt } from '@/ai/planner';
import type { SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import type { AnswerRecord } from '@/types/respondent';

describe('Custom Personas', () => {
  const samplePersona: CustomPersona = {
    id: 'persona-ux-dev',
    name: 'DevOps Lead Alex',
    description: 'Senior platform engineer focused on security and automation.',
    demographics: {
      age: 38,
      profession: 'Staff DevOps Engineer',
      income: '$180,000',
      education: "Master's in Computer Science",
      location: 'Berlin, Germany',
      techProficiency: 'expert',
    },
    biasesAndPreferences: [
      'Strongly prefers open-source software over proprietary SaaS',
      'Extremely privacy-conscious; avoids sharing phone numbers',
    ],
    communicationStyle: {
      tone: 'technical and concise',
      length: 'terse',
      customInstructions: 'Keep answers direct and cite security reasoning where possible.',
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it('transforms CustomPersona to RespondentProfile with rich traits', () => {
    const profile = customPersonaToProfile(samplePersona);
    expect(profile.id).toBe('persona-ux-dev');
    expect(profile.name).toBe('DevOps Lead Alex');
    expect(profile.traits.profession).toBe('Staff DevOps Engineer');
    expect(profile.traits.techProficiency).toBe('expert');
    expect(profile.traits.biasesAndPreferences).toContain('Strongly prefers open-source software');
    expect(profile.traits.specialInstructions).toContain('Keep answers direct');
    expect(profile.intent).toContain('Staff DevOps Engineer');
    expect(profile.textStyle?.length).toBe('terse');
    expect(profile.textStyle?.tone).toBe('technical and concise');
  });

  it('saves, loads, and deletes custom personas in storage', async () => {
    await saveCustomPersona(samplePersona);
    let personas = await loadCustomPersonas();
    expect(personas.some((p) => p.id === 'persona-ux-dev')).toBe(true);

    const loaded = personas.find((p) => p.id === 'persona-ux-dev')!;
    expect(loaded.name).toBe('DevOps Lead Alex');

    // Update persona
    await saveCustomPersona({ ...loaded, name: 'Alex Updated' });
    personas = await loadCustomPersonas();
    expect(personas.find((p) => p.id === 'persona-ux-dev')?.name).toBe('Alex Updated');

    // Delete persona
    await deleteCustomPersona('persona-ux-dev');
    personas = await loadCustomPersonas();
    expect(personas.some((p) => p.id === 'persona-ux-dev')).toBe(false);
  });

  it('resolveRespondent resolves presets and custom personas seamlessly', async () => {
    // Preset
    const presetProfile = await resolveRespondent('happy-path');
    expect(presetProfile.name).toBe('Happy path');

    // Custom
    await saveCustomPersona(samplePersona);
    const customProfile = await resolveRespondent('persona-ux-dev');
    expect(customProfile.name).toBe('DevOps Lead Alex');

    // Unknown ID throws
    await expect(resolveRespondent('non-existent-id')).rejects.toThrow(
      'Unknown respondent preset or custom persona ID',
    );
  });
});

describe('Anti-Contradiction Session Memory in Planner', () => {
  const dummySchema: SurveyDOMSchema = {
    platform: 'google-forms',
    title: 'Automotive & Lifestyle Survey',
    url: 'https://docs.google.com/forms/d/e/1FAIpQ/viewform',
    origin: 'https://docs.google.com/forms/d/e/1FAIpQ',
    page: { pageIndex: 1, questions: [], hasNext: false, hasSubmit: true },
    skipped: [],
    scannedAt: Date.now(),
  };

  const dummyRespondent = {
    id: 'test-resp',
    name: 'Car Owner Persona',
    intent: 'Owns an electric vehicle',
    traits: { vehicleType: 'EV' },
  };

  const batch: SurveyQuestion[] = [
    {
      id: 'q-oil-brand',
      index: 0,
      label: 'What brand of motor oil do you purchase?',
      type: 'text',
      required: true,
      domRef: 'ref-oil',
    },
  ];

  it('includes previous session answers and anti-contradiction directive on multi-page forms', () => {
    const memory: AnswerRecord[] = [
      {
        questionId: 'q-car-owner',
        questionLabel: 'Do you own an internal combustion engine vehicle?',
        questionType: 'radio',
        value: { textAnswer: 'No, electric vehicle only' },
        filledAt: Date.now() - 10000,
      },
    ];

    const prompt = buildPrompt(dummySchema, dummyRespondent, memory, batch);

    expect(prompt).toContain('PREVIOUS ANSWERS IN THIS SESSION (STRICT ANTI-CONTRADICTION ENFORCED)');
    expect(prompt).toContain('No, electric vehicle only');
    expect(prompt).toContain('CRITICAL: Ensure 100% logical cohesion with past answers');
  });

  it('states none when on the first page with no prior memory', () => {
    const prompt = buildPrompt(dummySchema, dummyRespondent, [], batch);
    expect(prompt).toContain('PREVIOUS ANSWERS IN THIS SESSION: none, this is the first page');
  });
});
