import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:640,height:400} });
p.setDefaultTimeout(250000);
await p.goto('http://127.0.0.1:5244/?t=0.79&hud=0',{waitUntil:'load',timeout:250000});
await p.waitForTimeout(7000); await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(3000);

const res = await p.evaluate(async () => {
  const out=[]; const R=window.__game.renderer, S=window.__game.scene;
  const sun = S.children.find(o=>o.isDirectionalLight);
  const frameMs = () => window.__game.perf?.frameMs;
  async function measure(label, frames=5){
    const t=[]; let last=performance.now();
    await new Promise(res=>{ let n=0;
      const tick=()=>{ const now=performance.now(); t.push(now-last); last=now;
        if(++n>=frames) return res(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick); });
    t.shift();
    const med=t.sort((a,b)=>a-b)[Math.floor(t.length/2)];
    out.push({label, medMs:Math.round(med), frames:t.map(x=>Math.round(x)).join(',')});
  }
  await measure('baseline');

  // 1) tiny shadow map
  sun.shadow.mapSize.set(128,128); if(sun.shadow.map){sun.shadow.map.dispose(); sun.shadow.map=null;}
  await measure('shadowMap 128');

  // 2) basic PCF instead of PCFSoft
  R.shadowMap.type = 1; // PCFShadowMap
  S.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true); }});
  await measure('PCF (not soft)');

  // 3) tight shadow frustum
  const c=sun.shadow.camera; c.left=-20;c.right=20;c.top=20;c.bottom=-20;c.near=1;c.far=400;c.updateProjectionMatrix();
  await measure('frustum +/-20');

  // 4) shadows fully off
  R.shadowMap.enabled=false; S.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true); }});
  await measure('shadows off');

  // 5) shadows back on, but nothing casts
  R.shadowMap.enabled=true; R.shadowMap.type=1; S.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true); }});
  S.traverse(o=>{ o.castShadow=false; });
  await measure('shadows on, no casters');
  return out;
});
console.log(JSON.stringify(res,null,1));
await b.close();
