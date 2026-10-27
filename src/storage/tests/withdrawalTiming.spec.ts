import { expect, test } from 'vitest';
import { ParticipantData } from '../../parser/types';
import { withdrawalGameplayDurationMs } from '../../analysis/utils/withdrawalTiming';

test('gameplay duration uses the requested completed session, not a short return visit', () => {
  const participant = { answers: { game: {
    startTime: 1000, endTime: 4668,
    answer: { mastermindGame_state: JSON.stringify({
      currentSession: 3,
      completedSessions: [{ session: 2, startedAt: '2026-10-23T20:02:24.676Z', completedAt: '2026-10-23T20:03:52.361Z' }],
    }) },
  } } } as unknown as ParticipantData;
  expect(withdrawalGameplayDurationMs(participant, 2)).toBe(87685);
  expect(withdrawalGameplayDurationMs(participant, 3)).toBeNull();
});

test('missing or corrupt server timestamps are never replaced with page duration', () => {
  for (const raw of ['invalid', '{}', '{"completedSessions":[{"session":2}]}']) {
    const participant = { answers: { game: { startTime: 1000, endTime: 4668, answer: { mastermindGame_state: raw } } } } as unknown as ParticipantData;
    expect(withdrawalGameplayDurationMs(participant, 2)).toBeNull();
  }
});
