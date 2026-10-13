import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/workspace/.home/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle','--no-sandbox']});
const p = await b.newPage({ viewport:{width:1000,height:620}});
p.setDefaultTimeout(180000);
await p.goto(`http://127.0.0.1:4173/?hud=0&t=${process.env.T||'0.45'}`,{waitUntil:'load'});
await p.waitForTimeout(5000); await p.evaluate(()=>window.__skipSplash?.()); await p.waitForTimeout(3000);
console.log('KIT', JSON.stringify(await p.evaluate(async ()=>{
  const n=window.__nn; const k=await n.interiors.useKenneyKit();
  const out={swapped:k, buckets:[]};
  const seen=new Set();
  n.scene.traverse(o=>{ if(!o.isInstancedMesh||seen.has(o.uuid)||o.count===0) return; seen.add(o.uuid);
    const m=o.material; out.buckets.push({n:o.count, map:!!m.map, vc:m.vertexColors}); });
  return out; })));
// find where steamer/pot/case props are and frame them close up
const spots = await p.evaluate(()=>{ const n=window.__nn, want=new Set(['steamer','pot','case','grill']);
  const hits=[]; for(const q of n.interiors.props()){ if(want.has(q.prop)) hits.push(q); }
  const g={}; for(const h of hits){ (g[h.shopId] ||= []).push(h); }
  return Object.entries(g).map(([sid,ps])=>({sid, props:ps.map(q=>q.prop), x:+ps[0].x.toFixed(1), z:+ps[0].z.toFixed(1)})); });
console.log('SPOTS', JSON.stringify(spots));
for (const s of spots.slice(0,3)) {
  await p.evaluate(([x,z])=>{ window.__nn.player.x=x; window.__nn.player.z=z; },[s.x,s.z]);
  await p.waitForTimeout(1600);
  await p.screenshot({path:`/workspace/kit2-${s.sid}.png`,timeout:180000});
  console.log('  →',s.sid,s.props.join(','));
}
await b.close();
