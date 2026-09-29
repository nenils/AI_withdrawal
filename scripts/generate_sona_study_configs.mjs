import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'public/HAIC_study/assets/config.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const components = structuredClone(source.components);

delete components.mastermind_control;
delete components.mastermind_advisor;
delete components.mastermind_judge;

components.mastermind = {
  type: 'website',
  path: 'HAIC_study/assets/mastermind_withdrawal.html',
  instructionLocation: 'aboveStimulus',
  description: 'Four complete Mastermind games for the current longitudinal study part.',
  response: [{
    id: 'played-game',
    prompt: 'Complete all four games to continue.',
    required: true,
    type: 'shortText',
    location: 'sidebar',
  }],
  style: { minHeight: '760px' },
  withSidebar: true,
  sidebarWidth: 320,
};

components['session-state'] = {
  type: 'questionnaire',
  description: 'Brief repeated measures for the session just completed.',
  responseDividers: true,
  responseOrder: 'random',
  instructionLocation: 'aboveStimulus',
  instruction: '## Your experience in this session\nPlease answer with the four games you just completed in mind.',
  response: [
    ['state-responsibility', 'Thinking through the task was mainly my responsibility.'],
    ['state-mental-effort', 'Solving the games required a great deal of mental effort.'],
    ['state-confidence-independent', 'I feel confident that I could solve similar games without AI support.'],
    ['state-ownership', 'The guesses made during this session felt like my own decisions.'],
    ['state-prefer-ai', 'For another session of this task, I would prefer to have AI support available.'],
  ].map(([id, prompt]) => ({
    id,
    prompt,
    required: true,
    type: 'likert',
    leftLabel: 'Strongly disagree',
    rightLabel: 'Strongly agree',
    numItems: 7,
  })),
  style: { width: '75%', maxWidth: '960px', margin: '0 auto' },
};

components['sona-completion'] = {
  type: 'website',
  path: 'HAIC_study/assets/sona_completion.html',
  description: 'Server-side SONA credit granting for the current part.',
  response: [{
    id: 'sonaCreditGranted',
    prompt: 'SONA credit confirmation',
    required: true,
    type: 'shortText',
    location: 'sidebar',
  }],
  style: { minHeight: '420px' },
  withSidebar: true,
  sidebarWidth: 280,
};

const library = {
  $schema: 'https://raw.githubusercontent.com/revisit-studies/study/v2.2.0/src/parser/LibraryConfigSchema.json',
  description: 'Shared components for the four-part SONA AI-support withdrawal study.',
  components,
  sequences: {},
};

const libraryDir = path.join(root, 'public/libraries/haic-withdrawal');
fs.mkdirSync(libraryDir, { recursive: true });
fs.writeFileSync(path.join(libraryDir, 'config.json'), `${JSON.stringify(library, null, 2)}\n`);

const shortMeasures = ['$haic-withdrawal.components.session-state'];
const oneTimeMeasures = [
  '$haic-withdrawal.components.control-mails-short',
  '$haic-withdrawal.components.control-game-llm-experience',
  '$haic-withdrawal.components.demographics',
];
const finalMeasures = [
  '$haic-withdrawal.components.cognitive_responsibility',
  '$haic-withdrawal.components.cognitive-load-intrinsic',
  '$haic-withdrawal.components.cognitive-load-extraneous',
  '$haic-withdrawal.components.cognitive-load-germane',
  '$haic-withdrawal.components.common-method-bias',
  '$haic-withdrawal.components.Ownership',
  '$haic-withdrawal.components.control-trust-willingness',
];

for (let part = 1; part <= 4; part += 1) {
  const partComponents = part === 1
    ? ['$haic-withdrawal.components.introduction', '$haic-withdrawal.components.game-tutorial-video']
    : [];
  partComponents.push('mastermind-part', ...shortMeasures);
  if (part === 1) partComponents.push(...oneTimeMeasures);
  if (part === 4) partComponents.push(...finalMeasures);
  partComponents.push('sona-completion-part');

  const config = {
    $schema: 'https://raw.githubusercontent.com/revisit-studies/study/v2.2.0/src/parser/StudyConfigSchema.json',
    studyMetadata: {
      ...source.studyMetadata,
      title: `AI Support Withdrawal in Mastermind - Part ${part}`,
      version: `v-4-sona-part-${part}`,
      description: `Part ${part} of the four-part SONA experiment on the introduction and withdrawal of AI support.`,
    },
    uiConfig: {
      ...source.uiConfig,
      urlParticipantIdParam: 'sona_id',
      numSequences: 1,
      studyEndMsg: part === 4
        ? 'Thank you. Part 4 and the full study are complete, and your SONA credit has been granted.'
        : `Thank you. Part ${part} is complete, and your SONA credit has been granted. SONA will provide access to the next part after the configured separation.`,
    },
    importedLibraries: ['haic-withdrawal'],
    components: {
      'mastermind-part': {
        baseComponent: '$haic-withdrawal.components.mastermind',
        parameters: { partNumber: part },
      },
      'sona-completion-part': {
        baseComponent: '$haic-withdrawal.components.sona-completion',
        parameters: { partNumber: part },
      },
    },
    sequence: { order: 'fixed', components: partComponents },
  };

  const outputDir = path.join(root, `public/HAIC_part_${part}`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}
