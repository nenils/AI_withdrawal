import { expect, test } from 'vitest';
import { LocalStorageEngine } from '../engines/LocalStorageEngine';
import { StorageObject, StorageObjectType } from '../engines/types';

class OrderedEngine extends LocalStorageEngine {
  uploads: unknown[] = [];
  release: (() => void) | undefined;
  firstUpload = new Promise<void>((resolve) => { this.release = resolve; });

  constructor() {
    super();
    this.currentParticipantId = 'participant';
    this.participantData = { participantId: 'participant', answers: {} } as never;
  }

  async verifyStudyDatabase() { }

  protected async _pushToStorage<T extends StorageObjectType>(_prefix: string, _type: T, data: StorageObject<T>) {
    this.uploads.push(structuredClone(data));
    if (this.uploads.length === 1) await this.firstUpload;
  }

  write(value: string) {
    this.participantData!.answers = { item: { answer: { value } } } as never;
    return this._saveAnswers();
  }
}

test('new snapshots cannot overtake older uploads and flush waits for both', async () => {
  const engine = new OrderedEngine();
  const first = engine.write('old');
  await expect.poll(() => engine.uploads.length).toBe(1);
  const second = engine.write('new');
  let flushed = false;
  const flush = engine.flushAnswers().then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  expect(engine.uploads).toHaveLength(1);
  engine.release!();
  await Promise.all([first, second, flush]);
  expect(engine.uploads).toEqual([
    { participantId: 'participant', answers: { item: { answer: { value: 'old' } } } },
    { participantId: 'participant', answers: { item: { answer: { value: 'new' } } } },
  ]);
  expect(flushed).toBe(true);
});
