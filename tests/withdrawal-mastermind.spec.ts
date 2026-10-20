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

  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
  await expect(page.getByText(/AI Advisor|AI Judge/)).toHaveCount(0);
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

  await expect(page.locator('#supportPanel')).toBeHidden();
  await expect(page.locator('#conditionBadge')).toHaveCount(0);
  await expect(page.locator('#supportNotice')).toHaveCount(0);
  await expect(page.locator('#phaseModal')).toHaveCount(0);
  await expect(page.getByText(/assigned condition|support (has been )?withdrawn/i)).toHaveCount(0);
});

for (const condition of ['advisor', 'judge'] as const) {
  test(`supports contextual AI chat for ${condition}`, async ({ page }) => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    await page.route('**/api/rl/predict', (route) => route.fulfill({ json: { guess: ['Blue', 'Green', 'Red', 'Yellow'] } }));
    await page.route('**/api/llm/chat', (route) => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      return route.fulfill({ json: { choices: [{ message: { content: payload.messages[0].role === 'system' ? 'Use the feedback to compare possible positions.' : 'Suggested guess: Blue, Green, Red, Yellow.' } }] } });
    });
    await openGame(page, activeState({ condition, currentSession: 2, supportAvailable: true, supportPhase: 'supported' }));
    await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible();
    if (condition === 'judge') {
      for (const peg of await page.locator('#currentGuess button').all()) await peg.click();
    }
    await expect(page.locator('#sendChat')).toBeEnabled();
    await page.getByLabel('Message AI').fill('Why would I move a color?');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#chatHistory')).toContainText('Use the feedback to compare possible positions.');
    await page.getByLabel('Message AI').fill('Can you explain that further?');
    await page.getByRole('button', { name: 'Send message' }).click();
    const isChat = (request: typeof requests[number]) => ['Why would I move a color?', 'Can you explain that further?'].includes(request.messages.at(-1)!.content);
    await expect.poll(() => requests.filter(isChat).length).toBe(2);
    const chats = requests.filter(isChat);
    expect(chats[1].messages.some((message) => message.role === 'assistant')).toBeTruthy();
    expect(chats[0].messages[0].content).not.toMatch(/withdraw|AI Advisor|AI Judge|session/i);
    expect(chats[0].messages[0].content).toContain(condition === 'advisor' ? 'autonomy is HIGH' : 'autonomy is LOW');
    await page.screenshot({ path: `/tmp/withdrawal-chat-${condition}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Message AI')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: `/tmp/withdrawal-chat-${condition}-mobile.png`, fullPage: true });
  });
}

test('shows and records a session confirmation code after four games', async ({ page }) => {
  await openGame(page, activeState({
    partGameComplete: true,
  }));

  await expect(page.getByText('MM-SESSION-1-COMPLETE', { exact: true })).toBeVisible();
  await expect(page.getByText('This session\'s games are complete', { exact: true })).toBeVisible();
});

for (const fail of [false, true]) {
  test(`low-autonomy review never offers an RL replacement (LLM failure: ${fail})`, async ({ page }) => {
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    await page.route('**/api/rl/predict', (route) => route.fulfill({ json: { guess: ['Red', 'Yellow', 'Purple', 'Orange'] } }));
    await page.route('**/api/llm/chat', (route) => {
      requests.push(route.request().postDataJSON());
      return fail
        ? route.fulfill({ status: 503, json: { detail: 'LLM unavailable' } })
        : route.fulfill({ json: { choices: [{ message: { content: 'Compare your proposal with the previous feedback.' } }] } });
    });
    await openGame(page, activeState({ condition: 'judge', currentSession: 2, supportAvailable: true, supportPhase: 'supported' }));
    for (const peg of await page.locator('#currentGuess button').all()) await peg.click();
    await page.getByRole('button', { name: 'Review current guess' }).click();
    await expect(page.locator('#aiOutput')).toContainText(fail ? 'AI feedback is unavailable' : 'Compare your proposal');
    await expect(page.locator('#applyAI')).toBeHidden();
    expect(await page.locator('#currentGuess button').evaluateAll((pegs) => pegs.map((peg) => peg.getAttribute('title')))).toEqual(['Blue', 'Blue', 'Blue', 'Blue']);
    await expect(page.locator('#aiOutput')).not.toContainText('Red');
    const system = requests[0].messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('autonomy is LOW');
    expect(system.content).toContain('Do NOT output a full four-color guess');
    expect(system.content).toContain('for your feedback calibration only: [Red, Yellow, Purple, Orange]');
    expect(requests[0].messages.at(-1)!.content).toContain('feedback only');
  });
}

test('low-autonomy strategy chat works with an empty or partial guess before review', async ({ page }) => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  let reviewRequests = 0;
  await page.route('**/api/rl/predict', (route) => {
    reviewRequests += 1;
    return route.fulfill({ json: { guess: ['Blue', 'Green', 'Red', 'Yellow'] } });
  });
  await page.route('**/api/llm/chat', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: 'Compare the possible feedback outcomes of your choices.' } }] } });
  });
  await openGame(page, activeState({ condition: 'judge', currentSession: 2, supportAvailable: true, supportPhase: 'supported' }));
  await page.getByRole('button', { name: 'Review current guess' }).click();
  await expect(page.locator('#aiOutput')).toContainText('Complete your proposed guess');
  await page.getByLabel('Message AI').fill('How can I approach this game strategically?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#chatHistory')).toContainText('Compare the possible feedback outcomes');
  await expect(page.locator('#sendChat')).toBeEnabled();
  await page.locator('#currentGuess button').first().click();
  await page.getByLabel('Message AI').fill('How should I interpret a white peg?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(reviewRequests).toBe(0);
  for (const request of requests) {
    expect(request.messages[0].content).toContain('autonomy is LOW');
    expect(request.messages[0].content).toContain('answer strategy questions without requiring one');
    expect(request.messages[0].content).not.toContain("Human's current proposal:");
  }
  await expect(page.locator('#applyAI')).toBeHidden();
});

test('high-autonomy chat refines and prefills its prediction with the same system policy', async ({ page }) => {
  const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  await page.route('**/api/rl/predict', (route) => route.fulfill({ json: { guess: ['Blue', 'Green', 'Red', 'Yellow'] } }));
  await page.route('**/api/llm/chat', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { choices: [{ message: { content: requests.length === 1
      ? 'Test these colors. PREDICTION: [Blue, Green, Red, Yellow]'
      : 'Try the revised order. PREDICTION: [Green, Blue, Yellow, Red]' } }] } });
  });
  await openGame(page, activeState({ condition: 'advisor', currentSession: 2, supportAvailable: true, supportPhase: 'supported' }));
  await expect(page.locator('#applyAI')).toBeVisible();
  await expect(page.locator('#sendChat')).toBeEnabled();
  await page.getByLabel('Message AI').fill('Please reconsider that ordering.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#chatHistory')).toContainText('Try the revised order.');
  expect(await page.locator('#currentGuess button').evaluateAll((pegs) => pegs.map((peg) => peg.getAttribute('title')))).toEqual(['Green', 'Blue', 'Yellow', 'Red']);
  for (const request of requests) {
    expect(request.messages[0].role).toBe('system');
    expect(request.messages[0].content).toContain('autonomy is HIGH');
    expect(request.messages[0].content).toContain('REFINE your prediction');
  }
  expect(requests[1].messages.some((message) => message.role === 'assistant' && message.content.includes('Test these colors.'))).toBeTruthy();
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

test('controls remain locked until automatic advice after a submitted guess finishes', async ({ page }) => {
  const initial = activeState({ condition: 'advisor', currentSession: 4, supportAvailable: true, supportPhase: 'supported' });
  let calls = 0;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/rl/predict', (route) => route.fulfill({ json: { guess: ['Blue', 'Green', 'Red', 'Yellow'] } }));
  await page.route('**/api/llm/chat', async (route) => {
    calls += 1;
    if (calls === 2) await pending;
    await route.fulfill({ json: { choices: [{ message: { content: 'PREDICTION: [Blue, Green, Red, Yellow]' } }] } });
  });
  await page.route('**/api/withdrawal/guess', (route) => route.fulfill({ json: {
    ...initial, attempt: 1, feedback: { black: 1, white: 1 }, roundFinished: false,
    game: { ...initial.game, guesses: [{ attempt: 1, guess: ['Blue', 'Green', 'Red', 'Yellow'], feedback: { black: 1, white: 1 } }] },
  } }));
  await openGame(page, initial);
  await expect(page.locator('#submitGuess')).toBeEnabled();
  await expect(page.locator('#applyAI')).toBeVisible();
  await page.locator('#submitGuess').click();
  await expect.poll(() => calls).toBe(2);
  await expect(page.locator('#sendChat')).toBeDisabled();
  await expect(page.locator('#submitGuess')).toBeDisabled();
  await expect(page.locator('#askAI')).toBeDisabled();
  release!();
  await expect(page.locator('#sendChat')).toBeEnabled();
});
