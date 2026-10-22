import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:800,height:500}});
p.setDefaultTimeout(200000);
await p.goto('http://127.0.0.1:5244/?t=0.45&hud=0&hero=1&mixer=0.55',{waitUntil:'load',timeout:200000});
await p.waitForTimeout(6000);
await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(()=>{
  const n=window.__nn;
  const out={ hasFreeze: typeof window.__game?.freeze, avatarType: n.avatar?.constructor?.name,
    hasGroup: !!n.avatar?.group, groupY0: n.avatar?.group?.position?.y,
    playerY: n.player?.y };
  try { window.__game.freeze(true); out.froze = window.__game.paused; } catch(e){ out.freezeErr=String(e); }
  const a=n.avatar; if(a?.group){ a.group.position.y = 1.15; }
  out.groupY1 = a?.group?.position?.y;
  return out;
}),null,1));
await p.waitForTimeout(1500);
console.log('after 1.5s:', JSON.stringify(await p.evaluate(()=>({
  paused: window.__game.paused, groupY: window.__nn.avatar?.group?.position?.y,
  playerY: window.__nn.player?.y }))));
await b.close();
