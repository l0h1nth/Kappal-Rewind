import { expect, test, type Page } from '@playwright/test';
import { setup, initial, metadata, vessel, settledMapView } from './fixtures';

async function positions(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => { const r=document.querySelector(selector)!.getBoundingClientRect();return {top:r.top+scrollY,bottom:r.bottom+scrollY,left:r.left,width:r.width}; };
    const map=rect('.map-card'),timeline=rect('.timeline');
    return {map,timeline,gap:timeline.top-map.bottom};
  });
}
for (const [width,height] of [[1440,900],[1280,800],[768,1024],[390,844]]) {
  test(`independent map/timeline column and recording dialog stay stable at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height});
    const long='LONG-VESSEL-'.repeat(12);
    const server=await setup(page,{metadata:{...metadata,vessel_count:21,vessel_ids:[...metadata.vessel_ids,long]}});
    await page.evaluate(()=>document.fonts.ready);
    const mapElement=await page.locator('.leaflet-container').elementHandle();
    const assertGap=async()=>{
      const measured=await positions(page);expect(measured.gap).toBeGreaterThanOrEqual(16);expect(measured.gap).toBeLessThanOrEqual(24.5);
      expect(Math.abs(measured.map.left-measured.timeline.left)).toBeLessThan(1);
      expect(Math.abs(measured.map.width-measured.timeline.width)).toBeLessThan(1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      return measured;
    };
    const empty=await assertGap();
    await page.getByTitle('Vessel T007').click();const selected=await assertGap();expect(selected.timeline.top).toBeCloseTo(empty.timeline.top,0);
    await page.route('**/api/datasets/builtin/route?*',r=>r.fulfill({json:{dataset_id:'builtin',vessel_id:'T007',start:metadata.start,end:metadata.end,point_count:2,max_points:20000,simplified:false,segments:[[[13.082801,80.358893],[13.083,80.359]]]}}));
    await page.getByRole('checkbox',{name:'Show full route'}).check();await expect(page.locator('path.vessel-full-route')).toHaveCount(1);
    const route=await assertGap();expect(route.timeline.top).toBeCloseTo(empty.timeline.top,0);
    const action=page.getByRole('button',{name:'About this recording',exact:true});await action.click();
    const info=page.getByRole('dialog',{name:'Recording information',exact:true});await expect(info).toBeVisible();
    const close=info.getByRole('button',{name:'Close',exact:true});await expect(close).toBeFocused();
    const opened=await assertGap();expect(opened.timeline.top).toBeCloseTo(empty.timeline.top,0);
    expect(await info.locator('.recording-summary').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)).toBe(width<=540?1:2);
    await close.press('Tab');await expect(info.getByRole('region',{name:'Recording details',exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');await expect(close).toBeFocused();
    await close.press('Escape');await expect(info).not.toBeVisible();await expect(action).toBeFocused();
    const closed=await assertGap();expect(closed.timeline.top).toBeCloseTo(empty.timeline.top,0);
    await action.click();await close.click();await expect(action).toBeFocused();
    await page.getByRole('button',{name:'▶ Play',exact:true}).click();await expect(page.getByRole('button',{name:'Pause'})).toBeEnabled();await assertGap();
    server.send({...initial,second:1799,timestamp:metadata.end,playing:false});
    await expect(page.getByRole('region',{name:'Playback controls'})).toContainText('Finished');await assertGap();
    server.send({...initial,vessels:[...initial.vessels,vessel(long,13.06,80.33)]});
    const search=page.getByRole('combobox',{name:'Search vessel ID'});await search.fill(long);await search.press('ArrowDown');await search.press('Enter');
    await expect(page.locator('.vessel-panel h2')).toHaveText(long);await assertGap();
    expect(await mapElement!.evaluate(e=>e===document.querySelector('.leaflet-container'))).toBe(true);
    expect(server.connections()).toBe(1);expect(server.errors).toEqual([]);
  });
}

test('dialog internally scrolls without clipping its close action on a short mobile screen',async({page})=>{
  await page.setViewportSize({width:390,height:480});await setup(page);
  await page.getByRole('button',{name:'About this recording',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recording information',exact:true});
  const box=(await dialog.boundingBox())!;expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(480);
  const body=dialog.locator('.recording-info-body');expect(await body.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await body.focus();await body.press('PageDown');await expect.poll(()=>body.evaluate(e=>e.scrollTop)).toBeGreaterThan(0);await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
});

test('dialog opening and viewport resize retain selected vessel, map identity and user camera',async({page})=>{
  const server=await setup(page);const marker=page.getByTitle('Vessel T007');await marker.click();
  await page.getByRole('button',{name:'Zoom in'}).click();const map=page.locator('.leaflet-container');const node=await map.elementHandle();
  const box=(await map.boundingBox())!;await page.mouse.move(box.x+70,box.y+70);await page.mouse.down();await page.mouse.move(box.x+120,box.y+110,{steps:8});await page.mouse.up();
  const camera=await settledMapView(page);const scale=await page.locator('.leaflet-control-scale-line').first().textContent();
  await page.getByRole('button',{name:'About this recording',exact:true}).click();await page.keyboard.press('Escape');
  expect(await settledMapView(page)).toBe(camera);
  await page.setViewportSize({width:768,height:1024});await settledMapView(page);
  await expect(page.locator('.leaflet-control-scale-line').first()).toHaveText(scale!);await expect(marker).toHaveClass(/is-selected/);
  expect(await node!.evaluate(e=>e===document.querySelector('.leaflet-container'))).toBe(true);expect(server.connections()).toBe(1);
});
