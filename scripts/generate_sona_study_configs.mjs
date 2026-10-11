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

components.cognitive_responsibility.responseOrder = 'fixed';
components.cognitive_responsibility.instruction = '## Your experience in this session\nPlease answer with the four Mastermind games you just completed in mind.';
components.Ownership.instruction = '## Your guesses and decisions\nThink about the four Mastermind games you just completed, your guesses, decisions, and outcomes. Indicate how strongly you agree or disagree with each statement.';
components['control-trust-willingness'].responseOrder = 'fixed';
components['control-trust-willingness'].instruction = '## Willingness to depend\nThink about the AI support you experienced during this study. Indicate how strongly you agree or disagree with each statement.';

components['nasa-tlx'] = {
  type: 'questionnaire',
  description: 'Raw NASA-TLX: six unweighted workload ratings on a 0-100 scale.',
  responseDividers: true,
  responseOrder: 'fixed',
  instructionLocation: 'aboveStimulus',
  instruction: '## Workload in this session\nRate your experience across the four Mastermind games you just completed.',
  response: [
    ['mental-demand', 'Mental Demand', 'How mentally demanding was the task?'],
    ['physical-demand', 'Physical Demand', 'How physically demanding was the task?'],
    ['temporal-demand', 'Temporal Demand', 'How hurried or rushed was the pace of the task?'],
    ['performance', 'Performance', 'How successful were you in accomplishing what you were asked to do?'],
    ['effort', 'Effort', 'How hard did you have to work to accomplish your level of performance?'],
    ['frustration', 'Frustration', 'How insecure, discouraged, irritated, stressed, and annoyed were you?'],
  ].map(([dimension, prompt, secondaryText]) => ({
    id: `nasa-tlx-${dimension}`,
    prompt,
    secondaryText,
    required: true,
    type: 'slider',
    tlxStyle: true,
    withBar: false,
    step: 5,
    spacing: 5,
    startingValue: 50,
    options: [
      { label: dimension === 'performance' ? 'Perfect' : 'Very Low', value: 0 },
      { label: dimension === 'performance' ? 'Failure' : 'Very High', value: 100 },
    ],
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
  description: 'Shared components for the four-part SONA Mastermind study.',
  components,
  sequences: {},
};

const libraryDir = path.join(root, 'public/libraries/haic-withdrawal');
fs.mkdirSync(libraryDir, { recursive: true });
fs.writeFileSync(path.join(libraryDir, 'config.json'), `${JSON.stringify(library, null, 2)}\n`);

const repeatedMeasures = [
  '$haic-withdrawal.components.cognitive_responsibility',
  '$haic-withdrawal.components.nasa-tlx',
];
const finalMeasures = [
  {
    id: 'willingness-by-condition',
    order: 'dynamic',
    functionPath: 'haic-withdrawal/willingness.ts',
  },
  '$haic-withdrawal.components.Ownership',
];

for (let part = 1; part <= 4; part += 1) {
  const partComponents = part === 1
    ? ['$haic-withdrawal.components.introduction', '$haic-withdrawal.components.game-tutorial-video']
    : [];
  partComponents.push('mastermind-part', ...repeatedMeasures);
  if (part === 1) partComponents.push('$haic-withdrawal.components.demographics');
  if (part === 4) partComponents.push(...finalMeasures);
  partComponents.push('sona-completion-part');

  const config = {
    $schema: 'https://raw.githubusercontent.com/revisit-studies/study/v2.2.0/src/parser/StudyConfigSchema.json',
    studyMetadata: {
      ...source.studyMetadata,
      title: `Longitudinal Mastermind Study - Part ${part}`,
      version: `v-5-sona-part-${part}`,
      description: `Part ${part} of the four-part SONA Mastermind study.`,
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
      ...(part === 4 ? {
        'willingness-part': {
          baseComponent: '$haic-withdrawal.components.control-trust-willingness',
        },
      } : {}),
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
