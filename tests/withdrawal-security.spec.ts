import fs from 'node:fs';
import { expect, test, Page } from '@playwright/test';
test.skip(process.env.WITHDRAWAL_SECURITY_TESTS !== '1', 'Run with playwright.security.config.ts and its isolated Supabase environment.');

async function mockSupabase(page: Page) {
  const sequenceRows = new Map<string, unknown>();
  const files = new Map<string, string>();
  const archived: Array<{ studyId: string; configHash: string }> = [];
  const bindings: string[] = [];
  const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })).toString('base64url')}.signature`;
  await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '127.0.0.1' } }));
  await page.route('https://test.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (url.pathname === '/auth/v1/signup') return route.fulfill({ json: { user, access_token: token, refresh_token: 'refresh-token', expires_in: 3600, token_type: 'bearer' } });
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/study_researchers') return route.fulfill({ json: [] });
    if (url.pathname === '/rest/v1/revisit') {
      if (request.method() === 'POST') {
        const row = request.postDataJSON();
        sequenceRows.set(row.docId, row);
        return route.fulfill({ status: 201, body: '' });
      }
      if (url.searchParams.get('docId') === 'eq.metadata') {
        return route.fulfill({ json: [{ data: { dataCollectionEnabled: true, studyNavigatorEnabled: true, analyticsInterfacePubliclyAccessible: true } }] });
      }
      return route.fulfill({ json: [...sequenceRows.values()] });
    }
    if (url.pathname.includes('/storage/v1/object/')) {
      const file = url.pathname.split('/revisit/')[1];
      if (request.method() === 'POST') {
        files.set(file, request.postData() || '{}');
        return route.fulfill({ json: { Key: file } });
      }
      const value = files.get(file);
      return value ? route.fulfill({ contentType: 'application/json', body: value }) : route.fulfill({ status: 404, json: { message: 'Object not found' } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route('**/api/study/archive-config', async (route) => {
    const payload = route.request().postDataJSON();
    archived.push(payload);
    const approved = JSON.parse(fs.readFileSync('services/haic_api/study_configs.json', 'utf8'))[payload.studyId.replace(/^(prod-|dev-)/, '')];
    expect(payload.configHash).toBe(approved.hash);
    return route.fulfill({ json: { saved: true } });
  });
  await page.route('**/api/withdrawal/access', (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    bindings.push(route.request().postDataJSON().participantId);
    return route.fulfill({ json: { authorized: true } });
  });
  await page.route('**/api/withdrawal/state', (route) => route.fulfill({ json: {
    participantId: 'debug-secure-browser', condition: 'control', currentSession: 4, totalSessions: 4,
    partGameComplete: false, supportAvailable: false, supportPhase: 'never_supported',
    completedSessions: [], creditedParts: [], game: { session: 4, round: 1, guesses: [], rounds: [] },
  } }));
  await page.route('**/api/withdrawal/events', (route) => route.fulfill({ json: { accepted: 100 } }));
  return { archived, bindings, files };
}

test('secure Supabase participant can start while navigation remains locked despite old metadata', async ({ page }) => {
  const records = await mockSupabase(page);
  await page.goto('/HAIC_part_4/?sona_id=debug-secure-browser');
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Mastermind', exact: true })).toBeVisible();
  await expect(page.getByText('Study Browser', { exact: true })).toHaveCount(0);
  expect(records.bindings).toContain('debug-secure-browser');
  expect(records.archived.length).toBeGreaterThan(0);
  expect([...records.files.keys()].some((key) => key.endsWith('debug-secure-browser_participantData'))).toBeTruthy();
});

test('anonymous browser cannot open analysis even when old metadata says public', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/analysis/stats/HAIC_part_4/summary');
  await expect(page.getByText('Researcher Sign-In', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('textbox', { name: /^Password/ })).toBeVisible();
});
