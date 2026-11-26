import { expect, test } from 'vitest';
import { supportReasons, supportTypes, toggleSupportChoice } from '../../public/haic-withdrawal/additionalSupportOptions';

test('reasons contain exactly the five agreed substantive choices', () => {
  expect(supportReasons.map((option) => option.value)).toEqual(['second_opinion', 'frustrated_stuck', 'time', 'accuracy', 'previous_ai_performance']);
  expect(supportTypes.map((option) => option.value)).toContain('own_notes');
});

test('prefer not to say excludes substantive choices in both directions', () => {
  expect(toggleSupportChoice(['time', 'accuracy'], 'prefer_not_to_say')).toEqual(['prefer_not_to_say']);
  expect(toggleSupportChoice(['prefer_not_to_say'], 'time')).toEqual(['time']);
  expect(toggleSupportChoice(['prefer_not_to_say'], 'prefer_not_to_say')).toEqual([]);
});

test('substantive choices support multiple selections and removal', () => {
  expect(toggleSupportChoice(['time'], 'accuracy')).toEqual(['time', 'accuracy']);
  expect(toggleSupportChoice(['time', 'accuracy'], 'time')).toEqual(['accuracy']);
});
