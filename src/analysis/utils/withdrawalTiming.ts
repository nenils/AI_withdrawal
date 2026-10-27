import { ParticipantData } from '../../parser/types';

export function withdrawalGameplayDurationMs(participant: ParticipantData, part: number): number | null {
  for (const stored of Object.values(participant.answers || {})) {
    const raw = stored.answer?.mastermindGame_state;
    if (typeof raw !== 'string') continue;
    try {
      const state = JSON.parse(raw);
      if (!Array.isArray(state.completedSessions)) continue;
      const session = state.completedSessions.find((item: { session: number }) => item.session === part);
      if (!session) continue;
      const start = Date.parse(session.startedAt);
      const end = Date.parse(session.completedAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
    } catch {
      // Missing or malformed historical state must not become a page-time estimate.
    }
  }
  return null;
}
