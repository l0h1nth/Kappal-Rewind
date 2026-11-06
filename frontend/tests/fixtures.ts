import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { Metadata, ReplayFrame, Vessel } from '../src/types';

// Small synthetic frames test UI behavior; real CSV/network checks are separate.
export const metadata: Metadata = {
  start: '2026-11-02T03:30:00Z', end: '2026-11-02T03:59:59Z',
  recording_seconds: 1800, vessel_count: 20, record_count: 35780,
  bounds: { south: 13.03159, north: 13.109132, west: 80.29829, east: 80.371457 },
};
export const vessel = (id: string, lat: number, lon: number, heading = 0): Vessel => ({
  id, lat, lon, heading, speed_knots: 5,
  trail_segments: [[[lat - .001, lon - .001], [lat, lon]]],
});
export const initial: ReplayFrame = {
  type: 'state', second: 0, duration_seconds: 1800, playing: false, speed: 1,
  timestamp: metadata.start, vessels: [vessel('T007', 13.082801, 80.358893, 0), vessel('T012', 13.055, 80.32, 90)],
};

export async function setup(page: Page, options: { metadataError?: boolean; tileError?: boolean; metadata?: Metadata; frame?: ReplayFrame; autoRespond?: boolean; sendInitial?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/meta', route => route.fulfill({
    status: options.metadataError ? 503 : 200, json: options.metadata ?? metadata,
  }));
  // Tests never download/prefetch OpenStreetMap tiles.
  await page.route('https://tile.openstreetmap.org/**', route => options.tileError ? route.abort() : route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'),
  }));
  let socket: WebSocketRoute;
  let connections = 0;
  let state = options.frame ?? initial;
  const commands: unknown[] = [];
  await page.routeWebSocket('**/ws/replay', route => {
    socket = route;
    connections++;
    state = options.frame ?? initial;
    route.onMessage(message => {
      const command = JSON.parse(message.toString());
      commands.push(command);
      if (options.autoRespond === false) return;
      switch (command.type) {
        case 'play': state = { ...state, playing: state.second < state.duration_seconds - 1 }; break;
        case 'pause': state = { ...state, playing: false }; break;
        case 'set_speed': state = { ...state, speed: command.speed }; break;
        case 'seek': state = { ...state, second: command.second, playing: state.playing && command.second < state.duration_seconds - 1 }; break;
        case 'reset': state = { ...state, second: 0, playing: false }; break;
      }
      state = { ...state, timestamp: new Date(Date.parse(metadata.start) + state.second * 1000).toISOString() };
      route.send(JSON.stringify(state));
    });
    if (options.sendInitial !== false) route.send(JSON.stringify(options.frame ?? initial));
  });
  await page.goto('/');
  if (options.sendInitial === false) await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
  else await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  return { send: (frame: unknown) => {
      if (typeof frame === 'object' && frame !== null && 'type' in frame && frame.type === 'state') state = frame as ReplayFrame;
      socket.send(JSON.stringify(frame));
    },
    sendRaw: (text: string) => socket.send(text),
    close: () => socket.close(), connections: () => connections, commands, errors };
}

