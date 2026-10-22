import { chromium } from 'playwright';
const cfg = process.argv[2] || 'baseline';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:640,height:400} });
p.setDefaultTimeout(280000);
await p.goto('http://127.0.0.1:5244/?t=0.79&hud=0',{waitUntil:'load',timeout:280000});
await p.waitForTimeout(7000); await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(3000);
// Apply the config once, then let everything settle before measuring.
await p.evaluate((cfg)=>{
  const R=window.__game.renderer, S=window.__game.scene;
  const sun=S.children.find(o=>o.isDirectionalLight);
  if(cfg==='noshadow') R.shadowMap.enabled=false;
  else if(cfg==='shmap128'){ sun.shadow.mapSize.set(128,128); if(sun.shadow.map){sun.shadow.map.dispose(); sun.shadow.map=null;} }
  else if(cfg==='shmap256'){ sun.shadow.mapSize.set(256,256); if(sun.shadow.map){sun.shadow.map.dispose(); sun.shadow.map=null;} }
  else if(cfg==='pcf') R.shadowMap.type=1;
  else if(cfg==='frustum20'){ const c=sun.shadow.camera; c.left=-20;c.right=20;c.top=20;c.bottom=-20;c.updateProjectionMatrix(); }
  else if(cfg==='nocasters'){ S.traverse(o=>{ if(o.isMesh||o.isInstancedMesh) o.castShadow=false; }); }
}, cfg);
await p.waitForTimeout(12000);           // settle: let queues drain and recompiles finish
const med = await p.evaluate(async ()=>{
  const t=[]; let last=performance.now();
  await new Promise(res=>{ let n=0;
    const tick=()=>{ const now=performance.now(); t.push(now-last); last=now;
      if(++n>=8) return res(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick); });
  const s=t.slice(2).sort((a,b)=>a-b);
  return { med:Math.round(s[Math.floor(s.length/2)]), all:t.map(x=>Math.round(x)) };
});
console.log(cfg.padEnd(12), JSON.stringify(med));
await b.close();
