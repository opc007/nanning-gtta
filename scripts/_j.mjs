import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:700,height:440}});
p.setDefaultTimeout(250000);
await p.goto('http://127.0.0.1:5244/?t=0.45&hud=0&hero=1&mixer=0.55',{waitUntil:'load',timeout:250000});
await p.waitForTimeout(7000);
await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(2500);
const st = await p.evaluate(()=>{
  const n=window.__nn, a=n.avatar;
  const info={ avatarKeys: Object.keys(a||{}), hasGroup: !!a?.group,
    groupY: a?.group?.position?.y, playerY: n.player?.y, paused: window.__game?.paused };
  window.__game.freeze(true);
  info.pausedAfter = window.__game.paused;
  return info;
});
console.log('STATE', JSON.stringify(st));
const cam = ()=>p.evaluate(()=>{ const n=window.__nn, pl=n.player;
  n.camera.position.set(pl.x-2.9, 1.85, pl.z); n.camera.lookAt(pl.x, 1.4, pl.z); globalThis.freezeCam=true; });
await cam(); await p.waitForTimeout(900);
await p.screenshot({path:'/workspace/j-y0.png'});
const y1 = await p.evaluate(()=>{ const a=window.__nn.avatar; if(a?.group) a.group.position.y=2.5;
  return a?.group?.position?.y; });
console.log('set group y ->', y1);
await cam(); await p.waitForTimeout(900);
await p.screenshot({path:'/workspace/j-y25.png'});
const y2 = await p.evaluate(()=>window.__nn.avatar?.group?.position?.y);
console.log('group y after wait:', y2);
await b.close();
