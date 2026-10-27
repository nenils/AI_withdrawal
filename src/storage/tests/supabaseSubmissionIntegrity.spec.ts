import { beforeEach, expect, test, vi } from 'vitest';
import { SupabaseStorageEngine } from '../engines/SupabaseStorageEngine';
import { ParticipantData } from '../../parser/types';
import { withdrawalPartStatus } from '../withdrawalPartStatus';

const mocks = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn(), annotations: vi.fn(), upsert: vi.fn() }));
vi.mock('../withdrawalPartStatus', () => ({ withdrawalPartStatus: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: { from: () => mocks },
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: mocks.annotations, upsert: mocks.upsert };
      return query;
    },
  }),
}));

const original = { participantId: 'p1', answers: { form: { answer: { cr1: '4' } } }, participantTags: [], rejected: false, completed: true } as unknown as ParticipantData;
class IntegrityEngine extends SupabaseStorageEngine {
  realtimeCompleted = false;

  constructor() { super(); this.studyId = 'HAIC_part_2'; this.currentParticipantId = 'p1'; }

  async verifyStudyDatabase() {}

  protected async _completeCurrentParticipantRealtime() { this.realtimeCompleted = true; }

  read() { return this._getFromStorage('participants/p1', 'participantData'); }

  write(data: ParticipantData) { return this._pushToStorage('participants/p1', 'participantData', data); }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withdrawalPartStatus).mockResolvedValue({ locked: true, submitted: true, credited: true, submission: original, submittedAt: '2026-10-27T12:00:00Z' });
  mocks.annotations.mockResolvedValue({ data: null, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});

test('analysis reads preserved answers rather than a later working file', async () => {
  expect((await new IntegrityEngine().read()).answers).toEqual(original.answers);
  expect(mocks.download).not.toHaveBeenCalled();
});

test('late answer changes cannot upload or modify annotations', async () => {
  await new IntegrityEngine().write({ ...original, answers: {} });
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
});

test('researcher tags remain editable without rewriting original answers', async () => {
  await new IntegrityEngine().write({ ...original, participantTags: ['review'] });
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
    docId: 'participantAnnotations_p1', data: { participantTags: ['review'], rejected: false },
  }));
});

test('researcher rejection can be undone independently of immutable answers', async () => {
  mocks.annotations.mockResolvedValue({ data: { data: { rejected: { reason: 'review' } } }, error: null });
  await new IntegrityEngine().write(original);
  expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ data: { participantTags: [], rejected: false } }));
});

test('an upload racing with the server lock is treated as preserved, not retried forever', async () => {
  vi.mocked(withdrawalPartStatus).mockResolvedValueOnce({ locked: false, credited: false, submitted: false, submission: null, submittedAt: null });
  mocks.upload.mockResolvedValue({ error: { message: 'Session is locked' } });
  await expect(new IntegrityEngine().write(original)).resolves.toBeUndefined();
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(withdrawalPartStatus).toHaveBeenCalledTimes(2);
});

test('the end page recognizes credit without another questionnaire upload', async () => {
  const engine = new IntegrityEngine();
  await expect(engine.verifyCompletion()).resolves.toBe(true);
  expect(engine.realtimeCompleted).toBe(true);
  expect(mocks.upload).not.toHaveBeenCalled();
});

test('status verification failure cannot silently permit an upload', async () => {
  vi.mocked(withdrawalPartStatus).mockRejectedValueOnce(new Error('Unavailable'));
  await expect(new IntegrityEngine().write(original)).rejects.toThrow('Unavailable');
  expect(mocks.upload).not.toHaveBeenCalled();
});
