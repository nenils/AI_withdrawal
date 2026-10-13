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
  responseOrder: 'fixed',
  response: [{
    id: 'played-game',
    prompt: 'Complete all four games to continue.',
    required: true,
    type: 'shortText',
    location: 'sidebar',
  }, {
    id: 'peg-feedback-guide',
    type: 'textOnly',
    location: 'sidebar',
    prompt: '**Feedback pegs**\n\n**Black peg:** A correct color in the correct position.\n\n**White peg:** A correct color in a different position.\n\nFeedback pegs do not indicate which positions they refer to.',
  }],
  style: { minHeight: '760px' },
  withSidebar: true,
  sidebarWidth: 320,
};

components.cognitive_responsibility.responseOrder = 'random';
components.demographics.responseOrder = 'fixed';
components.demographics.response.push({
  id: 'bot-check-day-after-monday',
  prompt: 'What day of the week is the day after Monday? Please answer in lowercase.',
  required: true,
  type: 'shortText',
  placeholder: 'Enter the weekday',
});
components.demographics.response.find((item) => item.id === 'demographics-household-income').options =
  components.demographics.response.find((item) => item.id === 'demographics-household-income').options.map((option) => option.replaceAll('$ ', '\u20ac '));
components.Ownership.responseOrder = 'random';
components.cognitive_responsibility.instruction = '## Your experience in this session\nPlease answer with the four Mastermind games you just completed in mind.';
components.Ownership.instruction = '## Your guesses and decisions\nThink about the four Mastermind games you just completed, your guesses, decisions, and outcomes. Indicate how strongly you agree or disagree with each statement.';
components['control-trust-willingness'].responseOrder = 'random';
components['control-trust-willingness'].instruction = '## Willingness to depend\nThink about the AI support you experienced during this study. Indicate how strongly you agree or disagree with each statement.';

components['nasa-tlx'] = {
  type: 'questionnaire',
  description: 'Raw NASA-TLX: six unweighted workload ratings on a 0-100 scale.',
  responseDividers: true,
  responseOrder: 'random',
  instructionLocation: 'aboveStimulus',
  instruction: '## Workload in this session\nRate your experience across the four Mastermind games you just completed.',
  response: [
    ['mental-demand', 'How mentally demanding was the task?'],
    ['physical-demand', 'How physically demanding was the task?'],
    ['temporal-demand', 'How hurried or rushed was the pace of the task?'],
    ['performance', 'How successful were you in accomplishing what you were asked to do?'],
    ['effort', 'How hard did you have to work to accomplish your level of performance?'],
    ['frustration', 'How insecure, discouraged, irritated, stressed, and annoyed were you?'],
  ].map(([dimension, question]) => ({
    id: `nasa-tlx-${dimension}`,
    prompt: question,
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
    prompt: '',
    required: true,
    type: 'reactive',
    hidden: true,
    location: 'belowStimulus',
  }],
  style: { minHeight: '420px' },
  withSidebar: false,
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
