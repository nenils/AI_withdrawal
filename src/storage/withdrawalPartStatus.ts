import { ParticipantData } from '../parser/types';

export interface WithdrawalPartStatus {
  locked: boolean;
  credited: boolean;
  submitted: boolean;
  submission: ParticipantData | null;
  submittedAt: string | null;
}

export async function withdrawalPartStatus(participantId: string, partNumber: number, recordVisit = false, includeSubmission = false): Promise<WithdrawalPartStatus> {
  const response = await fetch('/api/withdrawal/part-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId, partNumber, recordVisit, includeSubmission }),
  });
  if (!response.ok) throw new Error('Your session status could not be verified. Please keep this tab open and retry.');
  return response.json();
}
