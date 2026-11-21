// Smoke test: the page loads, the demo plays in WAVESET, GRANULAR and SAMPLER, a few TIME-STRETCH modes play, the
// floating windows open, sessions of keys and waveform touches play, nothing throws. Works on the preview page and on
// the offline build (pass its URL; with a second argument vNN it also checks the version the offline page carries).
const { chromium } = require(process.env.PW||'/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const URL=process.argv[2]||'http://localhost:8765/preview.html', VER=process.argv[3]||'';
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  let pass=0, fail=0; const ok=(c,t)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+t); };
  const ctx=await browser.newContext({viewport:{width:1180,height:820}}); const page=await ctx.newPage(); const errs=[];
  page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|fonts|favicon|404|net::/.test(m.text())) errs.push(m.text()); });
  const W=ms=>page.waitForTimeout(ms);
  await page.goto(URL); await W(1500);
  if(VER) ok(await page.evaluate(v=>{ const m=document.querySelector('meta[name="crgt-offline"]'); return !!m && m.content===v; },VER),'the offline page carries '+VER);
  await page.click('#demo'); await W(900);
  await page.evaluate(()=>{ const w=document.querySelector('#fw-gest'); if(w && !w.hidden) document.querySelector('#fw-gest .fw-x').click(); });
  const sounding=async key=>{ await page.keyboard.down(key); await W(450); const s=await page.evaluate(()=>{ const st=__ws.inst[0].st; return st?{on:!!st.on,pk:Math.max(st.pkL||0,st.pkR||0)}:{on:false,pk:0}; }); await page.keyboard.up(key); await W(350); return s; };
  for(const [name,n] of [['WAVESET',1],['GRANULAR',2],['SAMPLER',3]]){
    await page.click('#seg-eng button:nth-child('+n+')'); await W(400);
    const s=await sounding('a'); ok(s.on && s.pk>0.001,`${name} plays a key (peak ${s.pk.toFixed(3)})`);
  }
  await page.click('#seg-eng button:nth-child(1)'); await W(300);
  for(const m of ['ps','basic','general','spectral']){
    await page.selectOption('#sel-ts',m); await W(300);
    const s=await sounding('s'); ok(s.on && s.pk>0.001,`TIME-STRETCH ${m.toUpperCase()} plays (peak ${s.pk.toFixed(3)})`);
  }
  await page.selectOption('#sel-ts','off'); await W(200);
  // the waveform plays by touch
  const wb=await page.locator('#wave').boundingBox();
  await page.mouse.move(wb.x+wb.width*0.4,wb.y+wb.height*0.4); await page.mouse.down(); await W(350);
  const t=await page.evaluate(()=>!!(__ws.inst[0].st&&__ws.inst[0].st.on)); await page.mouse.up(); await W(250);
  ok(t,'a touch on the waveform plays');
  // the floating windows
  for(const [btn,win] of [['#open-lfo','#fw-lfo'],['#gest-btn','#fw-gest']]){
    const has=await page.evaluate(b=>!!document.querySelector(b),btn); if(!has){ ok(false,'button '+btn+' is there'); continue; }
    await page.evaluate(b=>document.querySelector(b).click(),btn); await W(300);
    ok(await page.evaluate(w=>{ const e=document.querySelector(w); return !!e && !e.hidden && e.getBoundingClientRect().height>40; },win),win+' opens');
    await page.evaluate(w=>{ const x=document.querySelector(w+' .fw-x'); if(x) x.click(); },win); await W(150);
  }
  // the AUDIO window and its readout
  await page.click('#eng'); await W(300);
  ok(await page.evaluate(()=>!document.querySelector('#rate-pop').hidden && /AUDIOWORKLET/.test(document.querySelector('#lat-rows').textContent)),'the AUDIO window opens and names the engine');
  await page.keyboard.press('Escape'); await W(150);
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
