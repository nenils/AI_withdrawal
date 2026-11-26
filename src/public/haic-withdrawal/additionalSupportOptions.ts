export const supportReasons = [
  { value: 'second_opinion', label: 'I wanted a second opinion to check whether I had overlooked something.' },
  { value: 'frustrated_stuck', label: 'I felt frustrated or stuck and did not know how to proceed.' },
  { value: 'time', label: 'I wanted to complete the task more quickly.' },
  { value: 'accuracy', label: 'I wanted to improve the accuracy of my guesses.' },
  { value: 'previous_ai_performance', label: 'I wanted to match the performance I had achieved earlier when AI support was available.' },
];

export const supportTypes = [
  { value: 'external_ai', label: 'An external AI tool or chatbot, such as ChatGPT, Claude, or Gemini' },
  { value: 'internet', label: 'Internet searches, websites, or online explanations' },
  { value: 'other_person', label: 'Help from another person' },
  { value: 'solver_software', label: 'A dedicated code-solving program or other software' },
  { value: 'own_notes', label: 'My own notes, paper, or other written materials' },
  { value: 'other', label: 'Other support' },
];

export function toggleSupportChoice(selected: string[], value: string): string[] {
  if (selected.includes(value)) return selected.filter((item) => item !== value);
  if (value === 'prefer_not_to_say') return [value];
  return [...selected.filter((item) => item !== 'prefer_not_to_say'), value];
}
