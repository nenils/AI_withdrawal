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
  if (!response.ok) {
    const deploymentHint = response.status === 404 || response.status === 503
      ? ' The researcher should verify that haic-api is updated and submission_integrity.sql has been applied in the configured Supabase project.'
      : '';
    throw new Error(`Session data could not be verified (HTTP ${response.status}). Please retry.${deploymentHint}`);
  }
  return response.json();
}
