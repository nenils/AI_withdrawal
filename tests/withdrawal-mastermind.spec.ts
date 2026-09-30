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

async function openGame(page: Page, state: StudyState) {
  await page.route('**/api/withdrawal/state', async (route) => {
    await route.fulfill({ json: state });
  });
  await page.route('**/api/withdrawal/events', async (route) => {
    await route.fulfill({ json: { accepted: 1 } });
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
