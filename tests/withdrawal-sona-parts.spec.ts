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
    expect(config.components).not.toHaveProperty('willingness-part');
    expect(config.sequence.components.at(-1)).toBe('sona-completion-part');

    const sequence = config.sequence.components.map((component: string | { id: string }) => (
      typeof component === 'string' ? component : component.id
    ));
    expect(sequence).toEqual([
      ...(partNumber === 1 ? [
        '$haic-withdrawal.components.introduction',
        '$haic-withdrawal.components.game-tutorial-video',
      ] : []),
      'mastermind-part',
      '$haic-withdrawal.components.cognitive_responsibility',
      '$haic-withdrawal.components.nasa-tlx',
      ...(partNumber === 1 ? ['$haic-withdrawal.components.demographics'] : []),
      ...(partNumber === 4 ? ['willingness-by-condition', '$haic-withdrawal.components.Ownership'] : []),
      'sona-completion-part',
    ]);
  }
});

for (const condition of ['control', 'advisor', 'judge']) {
  test(`Part 4 questionnaire flow for ${condition}`, async ({ page }) => {
    await page.route('**/api/withdrawal/state', async (route) => {
      await route.fulfill({ json: {
        ...stateForPart(4), condition, partGameComplete: true,
      } });
    });
    await page.route('**/api/withdrawal/events', async (route) => {
      await route.fulfill({ json: { accepted: route.request().postDataJSON().events.length } });
    });
    await page.route('**/api/sona/complete-part', (route) => route.fulfill({ json: { credited: true, studyCompleted: true } }));
    await page.goto(`/HAIC_part_4/?sona_id=questionnaire-${condition}`);
    await expect(page.getByText(/Component.*willingness-part.*not used deterministically/)).toHaveCount(0);
    await expect(page.frameLocator('iframe').getByText("This session's games are complete")).toBeVisible();
    await page.getByRole('textbox').fill('MM-SESSION-4-COMPLETE');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText('Thinking through the task was mainly my responsibility.')).toBeVisible();
    for (const radio of await page.getByRole('radio', { name: '7', exact: true }).all()) {
      await radio.click();
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('slider')).toHaveCount(6);
    await expect(page.getByText('How mentally demanding was the task?', { exact: false })).toBeVisible();
    for (const dimension of ['Mental Demand', 'Physical Demand', 'Temporal Demand', 'Performance', 'Effort', 'Frustration']) {
      await expect(page.getByText(dimension, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText('Perfect', { exact: true })).toBeVisible();
    await expect(page.getByText('Failure', { exact: true })).toBeVisible();
    for (const slider of await page.getByRole('slider').all()) {
      await slider.focus();
      await slider.press('ArrowRight');
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (condition !== 'control') {
      await expect(page.getByRole('heading', { name: 'Willingness to depend' })).toBeVisible();
      for (const radio of await page.getByRole('radio', { name: '7', exact: true }).all()) {
        await radio.click();
      }
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Your guesses and decisions' })).toBeVisible();
    await expect(page.getByText('This was my task-solving process.')).toBeVisible();
    await expect(page.getByText(/interaction with the AI system/i)).toHaveCount(0);
    for (const radio of await page.getByRole('radio', { name: '7', exact: true }).all()) await radio.click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.frameLocator('iframe').getByText('Your final SONA credit has been granted.', { exact: false })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  });
}

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

test('new tutorial video loads in Session 1 instructions', async ({ page }) => {
  await page.goto('/HAIC_part_1/?sona_id=video-browser-test');
  await expect(page.getByRole('heading', { name: 'Mastermind Study', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(0);
});

test('demographics include student and non-employment categories', async ({ request }) => {
  const response = await request.get('/libraries/haic-withdrawal/config.json');
  expect(response.ok()).toBeTruthy();
  const library = await response.json();
  const jobSector = library.components.demographics.response.find(
    (item: { id: string }) => item.id === 'demographics-job-sector',
  );

  expect(jobSector.options).toContain('Student');
  expect(jobSector.options).toContain('Not currently employed');
  expect(library.components.demographics.response.some((item: { id: string }) => item.id === 'bot-check-day-after-monday')).toBeTruthy();
  const income = library.components.demographics.response.find((item: { id: string }) => item.id === 'demographics-household-income');
  expect(income.options[0]).toContain('\u20ac');
  expect(JSON.stringify(income.options)).not.toContain('$');
  expect(library.components['sona-completion'].response[0]).toMatchObject({ type: 'reactive', hidden: true, required: true });
});

test('all scheduled scale items are randomized except demographics', async ({ request }) => {
  const response = await request.get('/libraries/haic-withdrawal/config.json');
  const { components } = await response.json();
  for (const name of ['cognitive_responsibility', 'nasa-tlx', 'control-trust-willingness', 'Ownership']) {
    expect(components[name].responseOrder).toBe('random');
  }
  expect(components.demographics.responseOrder).toBe('fixed');
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
      await expect(page.locator('.responseBlock-sidebar').getByText('Feedback pegs', { exact: true })).toBeVisible();
      await expect(page.locator('.responseBlock-sidebar').getByText(/A correct color in the correct position/)).toBeVisible();
      await expect(page.locator('.responseBlock-sidebar').getByText(/A correct color in a different position/)).toBeVisible();
    }
    await expect(page.getByText(/error loading config/i)).toHaveCount(0);
  });
}
