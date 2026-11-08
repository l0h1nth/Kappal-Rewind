import { expect, test } from '@playwright/test';
import { setup, initial, vessel, settledMapView } from './fixtures';

const route = (vessel = 'T007') => ({dataset_id:'builtin', vessel_id:vessel,
  start:'2026-11-02T03:30:00Z',end:'2026-11-02T03:59:59Z',point_count:5,max_points:20000,simplified:false,
  segments:[[[13.07,80.33],[13.071,80.331]],[[13.072,80.332],[13.073,80.333]],[[13.074,80.334]]]});
const paths = (page: import('@playwright/test').Page) => page.locator('path.vessel-full-route');
async function select(page: import('@playwright/test').Page,id='T007') {
  const input=page.getByRole('combobox',{name:'Search vessel ID'});
  await input.fill(id);await page.getByRole('option',{name:new RegExp(id)}).click();
}

test('ships point north/east and keep Leaflet identity on the first pointer selection',async({page})=>{
  const server=await setup(page);const marker=page.getByTitle('Vessel T007');
  await expect(marker.locator('svg.ship-icon')).toHaveCount(1);
  await expect(marker.locator('.ship-hull')).toHaveAttribute('d',/^M12 1C/);
  await expect(marker.locator('.vessel-glyph')).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.getByTitle('Vessel T012').locator('.vessel-glyph')).toHaveCSS('transform','matrix(0, 1, -1, 0, 0, 0)');
  const element=await marker.elementHandle();const hull=await marker.locator('.ship-hull').boundingBox();
  await page.mouse.click(hull!.x+hull!.width/2,hull!.y+hull!.height/2);
  await expect(marker).toHaveClass(/is-selected/);await expect(page.getByText('T007',{exact:true}).first()).toBeVisible();
  server.send({...initial,second:1,vessels:[vessel('T007',13.08281,80.3589,90)]});
  await expect(marker.locator('.vessel-glyph')).toHaveCSS('transform','matrix(0, 1, -1, 0, 0, 0)');
  expect(await element!.evaluate(e=>e===document.querySelector('[title="Vessel T007"]'))).toBe(true);
});

test('route is opt-in, selected only, gap-safe, cached and stable across frames and navigation',async({page})=>{
  const server=await setup(page);const requests:string[]=[];
  await page.route('**/api/datasets/builtin/route?*',r=>{requests.push(r.request().url());return r.fulfill({json:route(new URL(r.request().url()).searchParams.get('vessel_id')!)});});
  await select(page);const toggle=page.getByRole('checkbox',{name:'Show full route'});
  await expect(toggle).not.toBeChecked();expect(requests).toHaveLength(0);await expect(paths(page)).toHaveCount(0);
  const map=await page.locator('.leaflet-container').elementHandle();await toggle.check();
  await expect(paths(page)).toHaveCount(3);await expect(page.getByText(/5 recorded positions/)).toBeVisible();
  expect(requests).toHaveLength(1);const original=await paths(page).first().elementHandle();const pathData=await paths(page).first().getAttribute('d');
  await expect(page.locator('path.vessel-trail')).toHaveCount(2);
  server.send({...initial,playing:true,second:1,vessels:[vessel('T007',13.08281,80.3589),initial.vessels[1]]});
  await expect(page.getByRole('button',{name:'Pause'})).toBeEnabled();
  expect(await original!.evaluate(e=>e===document.querySelector('path.vessel-full-route'))).toBe(true);
  expect(await paths(page).first().getAttribute('d')).toBe(pathData);expect(requests).toHaveLength(1);
  await toggle.uncheck();await expect(paths(page)).toHaveCount(0);await toggle.check();await expect(paths(page)).toHaveCount(3);expect(requests).toHaveLength(1);
  await select(page,'T012');await expect(paths(page)).toHaveCount(3);expect(requests).toHaveLength(2);expect(requests[1]).toContain('vessel_id=T012');
  const scale=page.locator('.leaflet-control-scale-line').first();const before=await scale.textContent();
  await page.getByRole('button',{name:'Zoom in'}).click();await settledMapView(page);
  await expect(scale).not.toHaveText(before!);
  expect(await map!.evaluate(e=>e===document.querySelector('.leaflet-container'))).toBe(true);
  expect(server.errors).toEqual([]);
});

test('changing selection clears old route immediately and ignores a late obsolete response',async({page})=>{
  const server=await setup(page);let release!:()=>void;let arrived!:()=>void;
  const waiting=new Promise<void>(resolve=>arrived=resolve);const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/datasets/builtin/route?*',async r=>{
    const id=new URL(r.request().url()).searchParams.get('vessel_id')!;
    if(id==='T007'){arrived();await gate;}
    await r.fulfill({json:route(id)}).catch(()=>{});
  });
  await select(page);await page.getByRole('checkbox',{name:'Show full route'}).check();await waiting;
  await expect(page.getByText('Loading full route…')).toBeVisible();await select(page,'T012');
  await expect(paths(page)).toHaveCount(3);release();await expect(page.locator('.vessel-panel h2')).toHaveText('T012');
  // A gap removes the current marker, not the inspected historical route or choice.
  server.send({...initial,second:600,vessels:[initial.vessels[0]]});
  await expect(page.getByText('No observation at this time.',{exact:true})).toBeVisible();await expect(paths(page)).toHaveCount(3);
  await page.getByRole('checkbox',{name:'Show full route'}).uncheck();await expect(paths(page)).toHaveCount(0);
});

test('route errors and invalid or oversized payloads recover without affecting replay',async({page})=>{
  const server=await setup(page);let requests=0;
  await page.route('**/api/datasets/builtin/route?*',r=>{
    requests++;
    return requests===1?r.fulfill({status:422,json:{detail:'Full route exceeds the 20,000-position display limit.'}}):
      r.fulfill({json:requests===2?{...route(),point_count:20001}:route()});
  });
  await select(page);await page.getByRole('checkbox',{name:'Show full route'}).check();
  await expect(page.getByRole('alert')).toContainText('20,000');await expect(paths(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Retry route'}).click();await expect(page.getByRole('alert')).toContainText('Invalid route response');
  await page.getByRole('button',{name:'Retry route'}).click();await expect(paths(page)).toHaveCount(3);
  expect(server.commands).toEqual([]);await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
});


test('route checkbox and its label stay comfortable on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page);await select(page);
  const toggle=page.getByRole('checkbox',{name:'Show full route'});
  await expect(toggle).toHaveCSS('width','20px');await expect(toggle).toHaveCSS('height','20px');
  expect((await toggle.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
