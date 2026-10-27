import { expect, test } from 'vitest';
import { LocalStorageEngine } from '../engines/LocalStorageEngine';
import { SequenceAssignment, StorageObject, StorageObjectType } from '../engines/types';

class StudySelectionEngine extends LocalStorageEngine {
  requestedStudies: string[] = [];

  protected async _getAllSequenceAssignments(studyId: string) {
    this.requestedStudies.push(studyId);
    const count = studyId === 'HAIC_part_1' ? 9 : 3;
    return Array.from({ length: count }, (_, index) => ({
      participantId: `participant-${index}`,
    } as SequenceAssignment));
  }

  protected async _getFromStorage<T extends StorageObjectType>(prefix: string, _type: T, studyId?: string) {
    if (studyId !== 'HAIC_part_1') throw new Error('Wrong study selected');
    return { participantId: prefix.split('/')[1] } as unknown as StorageObject<T>;
  }
}

test('analysis uses the explicitly requested study even if another session was active', async () => {
  const engine = new StudySelectionEngine();
  await engine.initializeStudyDb('HAIC_part_4');
  const participants = await engine.getAllParticipantsData('HAIC_part_1');
  expect(engine.requestedStudies).toEqual(['HAIC_part_1']);
  expect(participants).toHaveLength(9);
});

test('participant ID discovery still defaults to the active study when none is supplied', async () => {
  const engine = new StudySelectionEngine();
  await engine.initializeStudyDb('HAIC_part_4');
  expect(await engine.getAllParticipantIds()).toHaveLength(3);
  expect(engine.requestedStudies).toEqual(['HAIC_part_4']);
});
