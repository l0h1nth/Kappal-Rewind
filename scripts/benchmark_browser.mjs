// Read-only production UI probe: node scripts/benchmark_browser.mjs BASE RESULTS OUTPUT
import { firefox, expect } from '../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const [base, input, output] = process.argv.slice(2);
if (!base || !input || !output) throw Error('Provide base URL, benchmark results.json and output path');
const cases = JSON.parse(fs.readFileSync(input, 'utf8')).results.filter(r => r.repeat === 0);
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(20000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  const probe={active:false,frames:[],commits:0,gaps:[],latencies:[],arrivals:new Map(),last:performance.now(),click:null,clickMs:[]};window.probe=probe;
  // Count actual production React root commits; animation ticks must not commit React state.
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,
    onCommitFiberRoot:()=>{if(probe.active)probe.commits++;},onCommitFiberUnmount:()=>{},checkDCE:()=>{}};
  window.WebSocket=new Proxy(WebSocket,{construct(Target,args){
    const socket=Reflect.construct(Target,args);
    socket.addEventListener('message',e=>{const frame=JSON.parse(e.data);if(frame.type==='state'&&probe.active){probe.frames.push(frame.second);probe.arrivals.set(frame.timestamp,performance.now());}});
    return socket;
  }});
  function tick(now){if(probe.active)probe.gaps.push(now-probe.last);probe.last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  document.addEventListener('click',event=>{const e=event.target.closest?.('.vessel-marker');if(e&&probe.active)probe.click={id:e.title.slice(7),time:performance.now()};},true);
});
await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')}));
const measurements=[];
try{
  await page.goto(base);await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
  const map=await page.locator('.leaflet-container').elementHandle();
  await page.evaluate(()=>{
    new MutationObserver(()=>{const t=document.querySelector('time[aria-label="Current replay time"]')?.getAttribute('datetime');const began=window.probe.arrivals.get(t);if(began!==undefined)requestAnimationFrame(()=>{if(window.probe.active)window.probe.latencies.push(performance.now()-began);});}).observe(document.querySelector('time[aria-label="Current replay time"]'),{attributes:true,attributeFilter:['datetime']});
    new MutationObserver(()=>{const p=window.probe;const click=p.click;if(click&&document.querySelector('.vessel-panel h2')?.textContent===click.id){p.click=null;requestAnimationFrame(()=>{if(p.active)p.clickMs.push(performance.now()-click.time);});}}).observe(document.querySelector('.vessel-panel'),{childList:true,subtree:true,characterData:true});
  });
  for(const item of cases){
    await page.getByRole('tab',{name:'Recordings',exact:true}).click();
    await page.getByRole('button',{name:`Replay ${item.original_filename ?? (item.case==='original'?'tracks.csv':'source.csv')} (${item.dataset_id.slice(0,8)})`,exact:true}).click();
    await expect(page.getByLabel('Current recording')).toContainText(item.dataset_id);
    await expect(page.locator('.vessel-marker')).toHaveCount(item.vessels);
    const slider=page.getByRole('slider',{name:'Replay position'});
    // Native range input event only sets a test target; all reconstruction is real server work.
    await slider.evaluate(e=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'300');e.dispatchEvent(new Event('input',{bubbles:true}));});
    await expect(slider).toHaveValue('300');await expect(slider).toHaveAttribute('aria-disabled','false');
    for(const speed of [1,10]){
      await page.getByLabel('Playback speed').selectOption(String(speed));
      await page.getByRole('button',{name:'▶ Play',exact:true}).click();await expect(page.getByRole('button',{name:'Pause'})).toBeEnabled();
      await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
      await page.evaluate(()=>{const p=window.probe;p.frames=[];p.commits=0;p.gaps=[];p.latencies=[];p.clickMs=[];p.arrivals.clear();p.last=performance.now();p.active=true;});
      const target=await page.evaluate(()=>{
        for(const e of document.querySelectorAll('.vessel-marker')){
          if(e.classList.contains('is-selected'))continue;
          const b=e.getBoundingClientRect();
          for(const [dx,dy] of [[16,16],[2,16],[30,16],[16,2],[16,30]]){
            const x=b.x+dx,y=b.y+dy;
            if(y>0&&y<innerHeight&&x>0&&x<innerWidth&&document.elementFromPoint(x,y)===e)return {id:e.title.slice(7),x,y};
          }
        }
        return null;
      });
      if(!target)throw Error('No exposed marker for pointer probe');
      await page.mouse.click(target.x,target.y);
      await expect(page.locator('.vessel-panel h2')).toHaveText(target.id);
      await page.waitForTimeout(2500);
      const result=await page.evaluate(()=>{const p=window.probe;p.active=false;return {seconds:p.frames,react_commits:p.commits,animation_frame_gaps_ms:p.gaps,arrival_to_next_frame_ms:p.latencies,click_to_next_frame_ms:p.clickMs,long_task_supported:PerformanceObserver.supportedEntryTypes.includes('longtask')};});
      measurements.push({case:item.case,vessels:item.vessels,speed,...result});
      await page.getByRole('button',{name:'Pause'}).click();await expect(page.getByRole('button',{name:'▶ Play',exact:true})).toBeEnabled();
      console.log(JSON.stringify({case:item.case,speed,frames:result.seconds.length,commits:result.react_commits,max_frame_gap_ms:Math.max(...result.animation_frame_gaps_ms),click_ms:result.click_to_next_frame_ms}));
    }
  }
  await page.getByRole('tab',{name:'Recordings',exact:true}).click();
  await page.getByRole('button',{name:'Replay built-in assignment',exact:true}).click();await expect(page.locator('.vessel-marker')).toHaveCount(20);
  if(!await map.evaluate(e=>e===document.querySelector('.leaflet-container')))throw Error('Map remounted');
  fs.writeFileSync(output,JSON.stringify({measurements,errors,conditions:'Headless Firefox1600x1000; production bundle; mocked tiles; websocket JSON observation and React commit hook; one sampled2.5s interval per speed/dataset; same frontend for both backends'},null,2));
}finally{await browser.close();}
