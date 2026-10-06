import { expect, Page, test } from '@playwright/test';

type StudyState = {
  participantId: string;
  condition: 'control' | 'advisor' | 'judge';
  currentSession: number;
  totalSessions: number;
  serverTime: string;
  completed: boolean;
  completedAt: string | null;
  completedSessions: unknown[];
  creditedParts: number[];
  partGameComplete: boolean;
  partCredited: boolean;
  supportAvailable: boolean;
  supportPhase: string;
  storage: string;
  game: {
    session: number;
    round: number;
    rounds: unknown[];
    guesses: unknown[];
    startedAt: string;
  };
};

async function openGame(page: Page, state: StudyState, uploadedEvents?: Array<Record<string, unknown>>) {
  await page.route('**/api/withdrawal/state', async (route) => {
    await route.fulfill({ json: state });
  });
  await page.route('**/api/withdrawal/events', async (route) => {
    const payload = route.request().postDataJSON();
    uploadedEvents?.push(...payload.events);
    await route.fulfill({ json: { accepted: payload.events.length } });
  });
  await page.goto('/HAIC_study/assets/mastermind_withdrawal.html?id=test-frame');
  await page.evaluate(({ currentSession }) => {
    window.postMessage({
      type: '@REVISIT_COMMS/STUDY_DATA',
      iframeId: 'test-frame',
      message: {
        partNumber: currentSession,
        __revisit: { participantId: 'browser-test-participant' },
      },
    }, '*');
  }, { currentSession: state.currentSession });
}

function activeState(overrides: Partial<StudyState>): StudyState {
  const session = overrides.currentSession || 1;
  return {
    participantId: 'browser-test-participant',
    condition: 'advisor',
    currentSession: session,
    totalSessions: 4,
    serverTime: new Date().toISOString(),
    completed: false,
    completedAt: null,
    completedSessions: [],
    creditedParts: [],
    partGameComplete: false,
    partCredited: false,
    supportAvailable: false,
    supportPhase: 'pre_introduction',
    storage: 'memory',
    game: {
      session,
      round: 1,
      rounds: [],
      guesses: [],
      startedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

test('shows Advisor tools without disclosing the manipulation', async ({ page }) => {
  await openGame(page, activeState({
    supportAvailable: true,
    supportPhase: 'introduced',
    game: {
      session: 1,
      round: 4,
      rounds: [],
      guesses: [],
      startedAt: new Date().toISOString(),
    },
  }));

  await expect(page.getByRole('heading', { name: 'AI Advisor' })).toBeVisible();
  await expect(page.locator('#conditionBadge')).toHaveCount(0);
  await expect(page.locator('#supportNotice')).toHaveCount(0);
  await expect(page.locator('#phaseModal')).toHaveCount(0);
  await expect(page.getByText(/assigned condition|support is now available|withdrawn/i)).toHaveCount(0);
});

test('hides Judge tools without announcing the withdrawal', async ({ page }) => {
  await openGame(page, activeState({
    condition: 'judge',
    currentSession: 4,
    supportAvailable: false,
    supportPhase: 'withdrawn',
    game: {
      session: 4,
      round: 2,
      rounds: [],
      guesses: [],
      startedAt: new Date().toISOString(),
    },
  }));

  await expect(page.getByRole('heading', { name: 'AI Judge' })).toBeHidden();
  await expect(page.locator('#conditionBadge')).toHaveCount(0);
  await expect(page.locator('#supportNotice')).toHaveCount(0);
  await expect(page.locator('#phaseModal')).toHaveCount(0);
  await expect(page.getByText(/assigned condition|support (has been )?withdrawn/i)).toHaveCount(0);
});

test('shows and records a session confirmation code after four games', async ({ page }) => {
  await openGame(page, activeState({
    partGameComplete: true,
  }));

  await expect(page.getByText('MM-SESSION-1-COMPLETE', { exact: true })).toBeVisible();
  await expect(page.getByText('This session\'s games are complete', { exact: true })).toBeVisible();
});

test('uploads mouse and privacy-preserving keyboard activity', async ({ page }) => {
  const uploadedEvents: Array<Record<string, unknown>> = [];
  await openGame(page, activeState({}), uploadedEvents);

  await page.mouse.move(140, 180);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.keyboard.press('a');
  await page.keyboard.press('ArrowLeft');

  await expect.poll(() => uploadedEvents.length, { timeout: 7000 }).toBeGreaterThan(0);
  const mouseEvents = uploadedEvents.filter((entry) => ['mouseMove', 'mouseDown', 'mouseUp', 'click'].includes(String(entry.type)));
  const keyEvents = uploadedEvents.filter((entry) => ['keyDown', 'keyUp'].includes(String(entry.type)));

  expect(mouseEvents.length).toBeGreaterThan(0);
  expect(keyEvents.length).toBeGreaterThanOrEqual(4);
  expect(keyEvents.some((entry) => (entry.data as { category?: string }).category === 'character')).toBeTruthy();
  expect(keyEvents.some((entry) => (entry.data as { action?: string }).action === 'ArrowLeft')).toBeTruthy();
  expect(JSON.stringify(keyEvents)).not.toContain('"key":"a"');
  expect(JSON.stringify(keyEvents)).not.toContain('"code":"KeyA"');
});
