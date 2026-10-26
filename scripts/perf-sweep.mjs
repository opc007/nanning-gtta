/**
 * One configuration per page load, so a context loss in one measurement does
 * not take the rest of the sweep with it.
 *
 *   node scripts/perf-sweep.mjs baseline|noshadow|nobloom|nopeds|nointerior|novehicles
 *
 * One configuration per page load, so a context loss in one measurement does
 * not take the rest of the sweep with it.
 */
import { chromium } from 'playwright';
const MODE = process.argv[2] ?? 'baseline';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:640,height:400} });
p.setDefaultTimeout(250000);
await p.goto('http://127.0.0.1:5244/?t=0.79&hud=0',{waitUntil:'load',timeout:250000});
await p.waitForTimeout(7000);
await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(3000);
await p.bringToFront();

if (MODE === 'noshadow') {
  await p.evaluate(()=>{ window.__game.renderer.shadowMap.enabled = false; });
} else if (MODE === 'nobloom') {
  await p.evaluate(()=>{ const e=window.__game; e.renderer.info.autoReset = true; void e; });
} else if (MODE === 'nopeds') {
  await p.evaluate(()=>{ window.__game.peds.clear?.(); const w=window.__game; void w; });
} else if (MODE === 'novehicles') {
  await p.evaluate(()=>{ window.__game.vehicles.clear?.(); });
} else if (MODE === 'nointerior') {
  await p.evaluate(()=>{ window.__game.scene.traverse(o=>{ if(o.name==='interiors') o.visible=false; }); });
}

const r = await p.evaluate(()=>new Promise(res=>{
  const t=[]; const t0=performance.now();
  const tick=()=>{ t.push(performance.now());
    if(performance.now()-t0<8000) requestAnimationFrame(tick);
    else { const d=[]; for(let i=1;i<t.length;i++) d.push(t[i]-t[i-1]); d.sort((a,b)=>a-b);
      const perf = window.__game.perf;
      res({ frames:t.length, fps:+((t.length/((performance.now()-t0)/1000))).toFixed(2),
            frameMs:+d[Math.floor(d.length/2)].toFixed(0),
            perfFrameMs:+perf.frameMs.toFixed(0), draws:perf.drawCalls, tris:perf.triangles,
            geos:perf.geometries, texs:perf.textures }); } };
  requestAnimationFrame(tick);
}));
console.log(MODE.padEnd(12), JSON.stringify(r));
await b.close();
