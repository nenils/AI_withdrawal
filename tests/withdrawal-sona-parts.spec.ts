import { expect, test } from '@playwright/test';

function stateForPart(partNumber: number) {
  return {
    participantId: `sona-route-${partNumber}`,
    condition: 'control',
    currentSession: partNumber,
    totalSessions: 4,
    serverTime: new Date().toISOString(),
    completed: false,
    completedAt: null,
    completedSessions: [],
    creditedParts: Array.from({ length: partNumber - 1 }, (_, index) => index + 1),
    partGameComplete: false,
    partCredited: false,
    supportAvailable: false,
    supportPhase: 'never_supported',
    storage: 'memory',
    game: {
      session: partNumber,
      round: 1,
      rounds: [],
      guesses: [],
      startedAt: new Date().toISOString(),
    },
  };
}

test('four unique SONA study configs are published', async ({ request }) => {
  const seenPaths = new Set<string>();

  for (let partNumber = 1; partNumber <= 4; partNumber += 1) {
    const path = `/HAIC_part_${partNumber}/config.json`;
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    const config = await response.json();

    expect(seenPaths.has(path)).toBeFalsy();
    seenPaths.add(path);
    expect(config.uiConfig.urlParticipantIdParam).toBe('sona_id');
    expect(config.studyMetadata.title).toBe(`Longitudinal Mastermind Study - Part ${partNumber}`);
    expect(config.studyMetadata.description).not.toMatch(/condition|withdraw|support/i);
    expect(config.components['mastermind-part'].parameters.partNumber).toBe(partNumber);
    expect(config.components['sona-completion-part'].parameters.partNumber).toBe(partNumber);
    expect(config.sequence.components.at(-1)).toBe('sona-completion-part');

    const sequence = config.sequence.components as string[];
    expect(sequence.includes('$haic-withdrawal.components.demographics')).toBe(partNumber === 1);
    expect(sequence.includes('$haic-withdrawal.components.sus')).toBe(partNumber === 3);
  }
});

test('shared SONA assets and component library are published', async ({ request }) => {
  for (const path of [
    '/libraries/haic-withdrawal/config.json',
    '/HAIC_study/assets/mastermind_withdrawal.html',
    '/HAIC_study/assets/sona_completion.html',
  ]) {
    const response = await request.get(path);
    expect(response.ok(), path).toBeTruthy();
  }
});

for (let partNumber = 1; partNumber <= 4; partNumber += 1) {
  test(`SONA Part ${partNumber} route renders`, async ({ page }) => {
    await page.route('**/api/withdrawal/state', async (route) => {
      await route.fulfill({ json: stateForPart(partNumber) });
    });
    await page.route('**/api/withdrawal/events', async (route) => {
      await route.fulfill({ json: { accepted: 1 } });
    });
    await page.goto(`/HAIC_part_${partNumber}/?sona_id=sona-route-${partNumber}`);

    if (partNumber === 1) {
      await expect(page.getByRole('heading', { name: 'Mastermind Study', exact: true })).toBeVisible({ timeout: 15000 });
    } else {
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Mastermind' })).toBeVisible({ timeout: 15000 });
    }
    await expect(page.getByText(/error loading config/i)).toHaveCount(0);
  });
}
