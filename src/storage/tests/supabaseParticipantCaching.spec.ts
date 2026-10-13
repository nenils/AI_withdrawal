import { beforeEach, expect, test, vi } from 'vitest';
import { SupabaseStorageEngine } from '../engines/SupabaseStorageEngine';

const storage = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

class TestEngine extends SupabaseStorageEngine {
  async verifyStudyDatabase() { }

  readParticipant() { return this._getFromStorage('participants/test', 'participantData'); }

  writeParticipant() { return this._pushToStorage('participants/test', 'participantData', {} as never); }

  cacheParticipant() { return this._cacheStorageObject('participants/test', 'participantData'); }
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.download.mockResolvedValue({ data: new Blob(['{}']), error: null });
  storage.upload.mockResolvedValue({ error: null });
});

test('participant reads bypass browser cache', async () => {
  await new TestEngine().readParticipant();
  expect(storage.download).toHaveBeenCalledWith(expect.any(String), {}, { cache: 'no-store' });
});

test('participant uploads use zero cache duration', async () => {
  await new TestEngine().writeParticipant();
  expect(storage.upload).toHaveBeenCalledWith(expect.any(String), expect.any(Blob), { upsert: true, cacheControl: '0' });
});

test('completion does not download and reupload participant data for caching', async () => {
  await new TestEngine().cacheParticipant();
  expect(storage.download).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
});
