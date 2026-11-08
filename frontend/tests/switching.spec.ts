import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { setup, initial, metadata, vessel, settledMapView } from './fixtures';
import type { ReplayFrame } from '../src/types';

const A = 'a'.repeat(32), B = 'b'.repeat(32);
const meta = (id: string) => ({ ...metadata, dataset_id: id, name: `${id[0]}.csv`,
  start: '2024-01-01T00:00:00Z', end: id === A ? '2024-01-01T00:00:04Z' : '2024-01-01T00:00:02Z',
  vessel_ids: id === A ? ['LONDON'] : ['TOKYO', 'TOKYO2'],
  recording_seconds: id === A ? 5 : 3, vessel_count: id === A ? 1 : 2, record_count: 5,
  bounds: id === A ? { south: 51.49, north: 51.52, west: -.12, east: -.08 }
    : { south: 35.66, north: 35.69, west: 139.69, east: 139.72 } });
const record = (id: string) => ({ dataset_id: id, original_filename: `${id[0]}.csv`, imported_at: null,
  accepted_row_count: 5, vessel_count: meta(id).vessel_count, duration_seconds: meta(id).recording_seconds,
  start: meta(id).start, end: meta(id).end,
  validation: { source_row_count: 5, discarded_row_count: 0, exact_duplicate_rows: 0, conflicting_duplicate_rows: 0,
    heading_normalizations: 0, missing_observation_seconds: 0, gap_count: 0, naive_timestamp_rows: 5, offset_timestamp_rows: 0, naive_timezone: 'UTC' } });
const frame = (id: string): ReplayFrame => ({ ...initial, dataset_id: id, timestamp: meta(id).start,
  duration_seconds: meta(id).recording_seconds, vessels: id === A ? [vessel('LONDON', 51.505, -.1)]
    : [vessel('TOKYO', 35.675, 139.705), vessel('TOKYO2', 35.677, 139.707)] });
const replay = (page: Page, id: string) => page.getByRole('button', { name: `Replay ${id[0]}.csv (${id.slice(0, 8)})`, exact: true });
const position = (page: Page) => page.getByRole('slider', { name: 'Replay position' });
const play = (page: Page) => page.getByRole('button', { name: '▶ Play', exact: true });

async function prepare(page: Page) {
  const builtin = await setup(page);
  const opened: string[] = [], sockets = new Map<string, WebSocketRoute>();
  await page.route('**/api/datasets', route => route.fulfill({ json: [record(A), record(B)] }));
  await page.route('**/api/datasets/*', route => route.fulfill({ json: record(route.request().url().includes(A) ? A : B) }));
  await page.route('**/api/replay/*/meta', route => route.fulfill({ json: meta(route.request().url().includes(A) ? A : B) }));
  await page.routeWebSocket('**/ws/replay*', route => {
    const id = new URL(route.url()).searchParams.get('dataset_id') ?? 'builtin';
    opened.push(id); sockets.set(id, route);
    let state = id === 'builtin' ? { ...initial, dataset_id: 'builtin' } : frame(id);
    route.onMessage(message => {
      const c = JSON.parse(message.toString());
      if (c.type === 'play') state = { ...state, playing: state.second < state.duration_seconds - 1 };
      if (c.type === 'pause') state = { ...state, playing: false };
      if (c.type === 'set_speed') state = { ...state, speed: c.speed };
      if (c.type === 'seek') state = { ...state, second: c.second, playing: state.playing && c.second < state.duration_seconds - 1 };
      if (c.type === 'reset') state = { ...state, second: 0, playing: false };
      state = { ...state, timestamp: new Date(Date.parse(id === 'builtin' ? metadata.start : meta(id).start) + state.second * 1000).toISOString() };
      route.send(JSON.stringify(state));
    });
    route.send(JSON.stringify(state));
  });
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh recordings' }).click();
  await expect(replay(page, A)).toBeVisible();
  await page.getByRole('tab', { name: 'Replay', exact: true }).click();
  return { builtin, opened, sockets };
}
async function choose(page: Page, id: string) {
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  await replay(page, id).click();
}
async function builtin(page: Page) {
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  await page.getByRole('button', { name: 'Replay built-in assignment' }).click();
}
async function loaded(page: Page, id: string) {
  await expect(page.getByLabel('Current recording')).toContainText(id);
  await expect(position(page)).toHaveAttribute('max', String(meta(id).recording_seconds - 1));
  await expect(play(page)).toBeEnabled();
}

test('playing builtin → London → Tokyo → builtin resets state and refits the existing map only on dataset change', async ({ page }) => {
  const server = await prepare(page);
  const map = await page.locator('.leaflet-container').elementHandle();
  await page.getByTitle('Vessel T012').click(); await play(page).click();
  await page.getByLabel('Playback speed').selectOption('10');
  await choose(page, A); await loaded(page, A);
  await expect(page.getByLabel('Playback speed')).toHaveValue('1');
  await expect(position(page)).toHaveValue('0');
  await expect(page.locator('footer')).toContainText('Select a vessel');
  await expect(page.getByTitle('Vessel T012')).toHaveCount(0);
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  for (const id of [A, B]) {
    if (id === B) { await choose(page, id); await loaded(page, id); }
    const marker = (await page.getByTitle(id === A ? 'Vessel LONDON' : 'Vessel TOKYO', { exact: true }).boundingBox())!;
    expect(marker.x).toBeGreaterThan(box.x); expect(marker.x + marker.width).toBeLessThan(box.x + box.width);
    expect(marker.y).toBeGreaterThan(box.y); expect(marker.y + marker.height).toBeLessThan(box.y + box.height);
    const target = page.getByTitle(id === A ? 'Vessel LONDON' : 'Vessel TOKYO', { exact: true });
    await target.click();
    await expect(target).toHaveClass(/is-selected/);
    await expect(page.getByRole('complementary', { name: 'Vessel details' }).getByRole('heading', { level: 2 }))
      .toHaveText(id === A ? 'LONDON' : 'TOKYO');
  }
  await expect(page.locator('.vessel-marker')).toHaveCount(2);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + 150, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-pan-anim|leaflet-zoom-anim/);
  const view = await settledMapView(page);
  server.sockets.get(B)!.send(JSON.stringify({ ...frame(B), second: 1, timestamp: '2024-01-01T00:00:01Z' }));
  await expect(position(page)).toHaveValue('1');
  await expect(page.locator('.leaflet-map-pane')).toHaveAttribute('style', view!);
  await builtin(page);
  await expect(page.getByLabel('Current recording')).toContainText('Built-in assignment');
  await expect(position(page)).toHaveAttribute('max', '1799');
  await expect(page.getByTitle('Vessel T012')).toBeVisible();
  expect(await map!.evaluate(el => el === document.querySelector('.leaflet-container'))).toBe(true);
  expect(server.opened).toEqual([A, B, 'builtin']); expect(server.builtin.errors).toEqual([]);
});

test('metadata failure preserves a playing session and vessel selection; retry succeeds', async ({ page }) => {
  const server = await prepare(page);
  await page.getByTitle('Vessel T012').click(); await play(page).click();
  await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ status: 404, json: { detail: 'Dataset not found' } }));
  await choose(page, A);
  await expect(page.getByRole('alert')).toContainText('Dataset not found');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('footer')).toContainText('T012 selected'); expect(server.opened).toEqual([]);
  await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ json: meta(A) }));
  await page.getByRole('button', { name: 'Retry recording' }).click(); await loaded(page, A);
});

test('rapid selections ignore late metadata; choosing current recording cancels a pending switch', async ({ page }) => {
  const server = await prepare(page);
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/replay/${A}/meta`, async route => { await held; await route.fulfill({ json: meta(A) }); });
  await choose(page, A);
  await expect(page.getByText('Loading recording… Current replay continues until metadata is ready.')).toBeVisible();
  await choose(page, B); await loaded(page, B); release();
  await expect(page.getByLabel('Current recording')).toContainText(B); expect(server.opened).toEqual([B]);
  let releaseAgain = () => {}; const heldAgain = new Promise<void>(resolve => { releaseAgain = resolve; });
  await page.route(`**/api/replay/${A}/meta`, async route => { await heldAgain; await route.fulfill({ json: meta(A) }); });
  await page.getByTitle('Vessel TOKYO', { exact: true }).click(); await play(page).click();
  await choose(page, A); await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); await expect(replay(page, B)).toBeEnabled(); await choose(page, B);
  await expect(page.getByText('Loading recording… Current replay continues until metadata is ready.')).toHaveCount(0);
  releaseAgain(); await expect(page.locator('footer')).toContainText('TOKYO selected');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled(); expect(server.opened).toEqual([B]);
});

test('timeline drafts and queued old socket callbacks cannot leak into another recording', async ({ page }) => {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    Object.assign(window, { oldSockets: sockets });
    window.WebSocket = new Proxy(WebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        sockets.push(socket);
        return socket;
      },
    });
  });
  await prepare(page);
  await page.evaluate(() => {
    const socket = (window as unknown as { oldSockets: WebSocket[] }).oldSockets[0];
    Object.assign(window, { queuedMessage: socket.onmessage!.bind(socket) });
  });
  await position(page).scrollIntoViewIfNeeded();
  const box = (await position(page).boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2); await page.mouse.down();
  await expect(page.getByText('Seek preview', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Recordings', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await replay(page, A).evaluate(button => (button as HTMLButtonElement).click());
  await page.mouse.up(); await loaded(page, A);
  await expect(page.getByText('Seek preview', { exact: false })).toHaveCount(0);
  await page.evaluate(old => {
    const callback = (window as unknown as { queuedMessage: (event: MessageEvent) => void }).queuedMessage;
    callback(new MessageEvent('message', { data: JSON.stringify(old) }));
  }, { ...initial, second: 999, playing: true });
  await expect(position(page)).toHaveValue('0'); await expect(page.getByTitle('Vessel T012')).toHaveCount(0);
  await expect(page.getByTitle('Vessel LONDON')).toBeVisible();
});

test('uploaded controls use dynamic endpoints and reject frames for a different dataset', async ({ page }) => {
  const server = await prepare(page); await choose(page, A); await loaded(page, A);
  for (const speed of ['2', '5', '10', '1']) {
    await page.getByLabel('Playback speed').selectOption(speed); await expect(page.getByLabel('Playback speed')).toHaveValue(speed);
  }
  await position(page).focus(); await position(page).press('End'); await expect(position(page)).toHaveValue('4');
  await expect(play(page)).toBeDisabled(); await position(page).press('Home'); await expect(position(page)).toHaveValue('0');
  await play(page).click(); await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Reset' }).click(); await expect(position(page)).toHaveValue('0');
  server.sockets.get(A)!.send(JSON.stringify(frame(B)));
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('error');
  await expect(page.locator('.vessel-marker')).toHaveCount(0);
});


test('vessel search replaces metadata IDs and clears the filter after switching', async ({ page }) => {
  await prepare(page);
  await expect(page.getByLabel('Search vessel ID')).toBeVisible();
  await page.getByLabel('Search vessel ID').fill('t012');
  await page.getByRole('listbox', { name: 'Matching vessels' }).getByRole('option').click();
  await expect(page.locator('.vessel-panel h2')).toHaveText('T012');
  await choose(page, A); await loaded(page, A);
  await expect(page.getByLabel('Search vessel ID')).toBeVisible();
  await expect(page.getByLabel('Search vessel ID')).toHaveValue('');
  await page.getByLabel('Search vessel ID').click();
  await page.getByRole('listbox', { name: 'Matching vessels' }).getByRole('option', { name: /LONDON/ }).click();
  await expect(page.getByTitle('Vessel LONDON')).toHaveClass(/is-selected/);
  await choose(page, B); await loaded(page, B);
  await expect(page.getByLabel('Search vessel ID')).toBeVisible();
  await page.getByLabel('Search vessel ID').click();
  await expect(page.getByRole('listbox', { name: 'Matching vessels' })).not.toContainText('LONDON');
  await page.getByLabel('Search vessel ID').fill('tokyo2');
  await page.getByRole('listbox', { name: 'Matching vessels' }).getByRole('option').click();
  await expect(page.locator('.vessel-panel h2')).toHaveText('TOKYO2');
});

test('current recording information shows exact metadata, timezone and optional validation counts', async ({ page }) => {
  await prepare(page);
  const info = page.getByLabel('Recording information', { exact: true });
  await expect(info.locator('summary')).toContainText('About this recording');
  await info.locator('summary').click();
  await expect(info).toContainText('tracks.csv');
  await expect(info).toContainText('Recording start · IST (Asia/Kolkata)');
  await expect(info).toContainText('02 Nov 2026, 09:00:00');
  await expect(info).toContainText('Detailed validation counts are unavailable');
  await page.route(`**/api/datasets/${A}`, route => route.fulfill({ json: { ...record(A),
    validation: { ...record(A).validation, source_row_count: 7, naive_timestamp_rows: 7,
      discarded_row_count: 2, exact_duplicate_rows: 2, missing_observation_seconds: 0 } } }));
  await choose(page, A); await loaded(page, A);
  await expect(info.locator('summary')).toHaveText('About this recording');
  await info.locator('summary').click();
  await expect(info).toContainText('a.csv');
  await expect(info.locator('time').first()).toHaveText('01 Jan 2024, 05:30:00');
  await expect(info.locator('time').last()).toHaveText('01 Jan 2024, 05:30:04');
  await expect(info.locator('dl div').filter({ has: page.getByText('Discarded duplicate observations', { exact: true }) }).locator('dd')).toHaveText('2');
});

test('late recording information cannot replace another recording and metadata failure can retry locally', async ({ page }) => {
  await prepare(page);
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/datasets/${A}`, async route => { await held; await route.fulfill({ json: record(A) }); });
  await choose(page, A); await loaded(page, A);
  await page.route(`**/api/datasets/${B}`, route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  await choose(page, B); await loaded(page, B);
  const info = page.getByLabel('Recording information', { exact: true });
  await info.locator('summary').click();
  await expect(info).toContainText('Validation counts unavailable'); release();
  await expect(info).toContainText('b.csv'); await expect(info).not.toContainText('a.csv');
  await page.route(`**/api/datasets/${B}`, route => route.fulfill({ json: record(B) }));
  await page.getByRole('button', { name: 'Retry recording information' }).click();
  await expect(info).toContainText('Missing vessel-seconds');
  await expect(play(page)).toBeEnabled();
});


test('uploaded metadata completing in Recordings waits for a visible map before fitting', async ({ page }) => {
  const server = await prepare(page);
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/replay/${A}/meta`, async route => { await held; await route.fulfill({ json: meta(A) }); });
  await choose(page, A);
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); release();
  await expect(page.getByLabel('Current recording')).toContainText(A);
  await expect(page.locator('.leaflet-container')).not.toBeVisible();
  await page.getByRole('tab', { name: 'Replay', exact: true }).click();
  await expect.poll(async () => {
    const map = (await page.locator('.leaflet-container').boundingBox())!;
    const boat = (await page.getByTitle('Vessel LONDON').boundingBox())!;
    return boat.x > map.x && boat.x + boat.width < map.x + map.width && boat.y > map.y && boat.y + boat.height < map.y + map.height;
  }).toBe(true);
  expect(server.builtin.errors).toEqual([]);
});
