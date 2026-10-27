import { expect, test } from '@playwright/test';

test.skip(process.env.WITHDRAWAL_INTEGRITY_TESTS !== '1', 'Uses isolated mocked Supabase environment.');

for (const credited of [true, false]) {
  test(`reopening a submitted part does not initialize or save questionnaires (credited=${credited})`, async ({ page }) => {
    const writes: string[] = [];
    const visits: unknown[] = [];
    await page.route('https://test.supabase.co/**', async (route) => {
      if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(route.request().method())) writes.push(route.request().url());
      await route.fulfill({ status: 404, json: { message: 'No data' } });
    });
    await page.route('**/api/withdrawal/part-status', async (route) => {
      visits.push(route.request().postDataJSON());
      await route.fulfill({ json: { locked: true, credited, submitted: true, submission: null } });
    });
    await page.route('**/api/sona/complete-part', (route) => route.fulfill({ json: { credited: true } }));
    await page.goto('/HAIC_part_2/?sona_id=completed-participant');
    await expect(page.getByRole('heading', { name: credited ? 'You have already completed this session.' : 'Your answers have been submitted.' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('slider')).toHaveCount(0);
    expect(visits).toContainEqual(expect.objectContaining({ participantId: 'completed-participant', partNumber: 2, recordVisit: true }));
    expect(writes).toHaveLength(0);
    if (!credited) {
      await page.getByRole('button', { name: 'Retry credit confirmation' }).click();
      await expect(page.getByRole('heading', { name: 'You have already completed this session.' })).toBeVisible();
      expect(writes).toHaveLength(0);
    }
  });
}

test('unavailable session verification fails closed before questionnaire initialization', async ({ page }) => {
  const writes: string[] = [];
  await page.route('https://test.supabase.co/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/withdrawal/part-status', (route) => route.fulfill({ status: 503, json: { detail: 'Unavailable' } }));
  await page.goto('/HAIC_part_2/?sona_id=completed-participant');
  await expect(page.getByRole('heading', { name: 'Error starting study' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('first submission finishes normally without rewriting frozen questionnaire files', async ({ page }) => {
  const rows = new Map<string, { docId: string; data: unknown }>();
  const files = new Map<string, string>();
  let credited = false;
  let original: Record<string, unknown> | null = null;
  let uploadsAfterCredit = 0;
  const participantId = 'first-submission';
  await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '127.0.0.1' } }));
  await page.route('https://test.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (url.pathname.includes('/auth/')) return route.fulfill({ status: 400, json: {} });
    if (url.pathname === '/rest/v1/revisit') {
      const docId = url.searchParams.get('docId')?.replace('eq.', '');
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        rows.set(row.docId, row);
        return route.fulfill({ status: 201, body: '' });
      }
      if (request.method() === 'PATCH') {
        if (docId) rows.set(docId, { docId, data: request.postDataJSON().data });
        return route.fulfill({ status: 204 });
      }
      if (docId === 'metadata') return route.fulfill({ json: [{ data: { dataCollectionEnabled: true, studyNavigatorEnabled: false } }] });
      const selected = docId ? (rows.has(docId) ? [rows.get(docId)] : []) : [...rows.values()];
      return route.fulfill({ json: request.headers().accept?.includes('vnd.pgrst.object') ? selected[0] || {} : selected });
    }
    if (url.pathname.includes('/storage/v1/object/')) {
      const path = url.pathname.split('/revisit/')[1];
      if (request.method() === 'POST') {
        if (credited && path.endsWith('_participantData')) uploadsAfterCredit += 1;
        const contentType = request.headers()['content-type'] || '';
        if (contentType.startsWith('multipart/form-data')) {
          const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { 'Content-Type': contentType } }).formData();
          const file = [...form.values()].find((value) => typeof value !== 'string') as File;
          files.set(path, await file.text());
        } else {
          files.set(path, request.postData() || '{}');
        }
        return route.fulfill({ json: { Key: path } });
      }
      return files.has(path)
        ? route.fulfill({ contentType: 'application/json', body: files.get(path) })
        : route.fulfill({ status: 404, json: { message: 'Object not found' } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/withdrawal/part-status', (route) => route.fulfill({ json: {
    locked: credited, credited, submitted: credited,
    submission: original ? { ...original, completed: credited } : null,
  } }));
  await page.route('**/api/withdrawal/state', (route) => route.fulfill({ json: {
    participantId, condition: 'control', currentSession: 2, partGameComplete: true,
    sessionConfirmationCode: 'MM-S2-0123456789AB', completedSessions: [], creditedParts: [1],
  } }));
  await page.route('**/api/withdrawal/events', (route) => route.fulfill({ json: { accepted: 1 } }));
  await page.route('**/api/sona/complete-part', async (route) => {
    const stored = [...files.entries()].find(([path]) => path.endsWith(`/${participantId}_participantData`));
    expect(stored).toBeDefined();
    original = JSON.parse(stored![1]);
    credited = true;
    await route.fulfill({ json: { credited: true, studyCompleted: false } });
  });
  await page.goto(`/HAIC_part_2/?sona_id=${participantId}`);
  await expect(page.frameLocator('iframe').getByText("This session's games are complete")).toBeVisible();
  await page.getByRole('textbox').fill('MM-S2-0123456789AB');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Thinking through the task was mainly my responsibility.')).toBeVisible();
  await expect(page.getByRole('radio', { name: '7', exact: true })).toHaveCount(5);
  for (const radio of await page.getByRole('radio', { name: '7', exact: true }).all()) await radio.click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveCount(6);
  for (const slider of await page.getByRole('slider').all()) { await slider.focus(); await slider.press('ArrowRight'); }
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.frameLocator('iframe').getByText('Your SONA credit has been granted.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Thank you. Part 2 is complete,', { exact: false })).toBeVisible();
  expect(uploadsAfterCredit).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'You have already completed this session.' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(uploadsAfterCredit).toBe(0);
});

test('analysis separates original gameplay from the short game-page visit', async ({ page }) => {
  const original = {
    participantId: 'timing-example', participantIndex: 1, completed: true, rejected: false, participantTags: [],
    sequence: { orderPath: 'root', order: 'fixed', components: ['mastermind-part', 'end'] },
    metadata: {}, searchParams: {},
    answers: { 'mastermind-part_0': {
      startTime: 1000, endTime: 4668, correctAnswer: [], componentName: 'mastermind-part',
      answer: { mastermindGame_state: JSON.stringify({
        currentSession: 3,
        completedSessions: [{ session: 2, startedAt: '2026-10-23T20:02:24.676Z', completedAt: '2026-10-23T20:03:52.361Z' }],
      }) },
    } },
  };
  await page.route('https://test.supabase.co/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (url.pathname === '/rest/v1/revisit') {
      if (url.searchParams.get('docId') === 'eq.metadata') {
        return route.fulfill({ json: [{ data: { dataCollectionEnabled: true, studyNavigatorEnabled: false, analyticsInterfacePubliclyAccessible: false } }] });
      }
      if (url.searchParams.get('docId')?.startsWith('eq.participantAnnotations_')) return route.fulfill({ json: [] });
      return route.fulfill({ json: [{ data: { participantId: 'timing-example' }, createdAt: '2026-10-23T20:02:24Z' }] });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/withdrawal/part-status', (route) => route.fulfill({ json: {
    locked: true, credited: true, submitted: true, submission: original,
  } }));
  await page.goto('/analysis/stats/HAIC_part_2/table');
  await expect(page.getByText('Gameplay Duration', { exact: true })).toBeVisible();
  await expect(page.getByText('Page Visit Duration', { exact: true })).toBeVisible();
  await expect(page.getByText('timing-example', { exact: true })).toBeVisible();
  await expect(page.getByText('01m 27s', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/withdrawal-gameplay-duration.png', fullPage: true });
});
