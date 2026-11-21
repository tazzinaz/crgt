// v44: the waveform full screen. A button at the right of POSITION's header turns POSITION into a layer that fills
// the screen above the keyboard (all of it with KEYS hidden), to play the sample by touch; floating windows stay on
// top; the same button or Esc brings the page back as it was. v45: one symbol at a time on the button.
const { chromium } = require(process.env.PW||'/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const URL=process.argv[2]||'http://localhost:8765/preview.html';
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  let pass=0, fail=0; const ok=(c,t)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+t); };
  const ctx=await browser.newContext({viewport:{width:1180,height:820}}); const page=await ctx.newPage(); const errs=[];
  page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|fonts|favicon|404/.test(m.text())) errs.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(1400);
  await page.click('#demo'); await page.waitForTimeout(900);
  const W=ms=>page.waitForTimeout(ms);
  await page.evaluate(()=>{ const w=document.querySelector('#fw-gest'); if(w && !w.hidden) document.querySelector('#fw-gest .fw-x').click(); });
  const geo=()=>page.evaluate(()=>{ const p=document.querySelector('.p-wave'), r=p.getBoundingClientRect(), w=document.querySelector('#wave').getBoundingClientRect(), d=document.querySelector('#dock'), c=document.querySelector('#wave-c');
    return {full:p.classList.contains('full'),t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right),wh:Math.round(w.height),ch:c.height,
      dockT:d.hidden?innerHeight:Math.round(d.getBoundingClientRect().top),ih:innerHeight,iw:innerWidth,btn:document.querySelector('#wave-full').getAttribute('aria-pressed')}; });
  // ---- the button
  const b=await page.evaluate(()=>{ const e=document.querySelector('#wave-full'), h=document.querySelector('.p-wave .ph').getBoundingClientRect(), r=e.getBoundingClientRect();
    return {label:e.getAttribute('aria-label'),icon:!!e.querySelector('svg.wf-in'),inHead:r.top>=h.top-1&&r.bottom<=h.bottom+1,right:Math.round(h.right-r.right)}; });
  ok(b.label==='Waveform full screen' && b.icon && b.inHead && b.right<30,'a full-screen button with its icon, at the right of POSITION\'s header');
  // v45: one symbol at a time, the four corners only (out to enter, in to leave)
  const shown=()=>page.evaluate(()=>[...document.querySelectorAll('#wave-full svg')].filter(s=>getComputedStyle(s).display!=='none'&&s.getBoundingClientRect().height>0).map(s=>s.getAttribute('class')+(s.querySelector('rect')?'+rect':'')).join(','));
  let sh=await shown(); ok(sh==='wf-in','one symbol on the button, the four corners only: '+sh);
  const g0=await geo();
  // ---- full screen
  await page.click('#wave-full'); await W(450);
  let g=await geo();
  sh=await shown(); ok(sh==='wf-out','in full screen: one symbol, the corners pointing in: '+sh);
  ok(g.full && g.btn==='true' && g.t===0 && g.l===0 && g.r===g.iw && Math.abs(g.b-g.dockT)<=1,`POSITION fills the screen above the keyboard (0–${g.b} of ${g.ih}, keys from ${g.dockT})`);
  ok(g.wh>g0.wh*2.2 && g.ch>g0.ch*2,`the waveform takes the room: ${g0.wh} → ${g.wh} px tall, drawn at the new size`);
  ok(await page.evaluate(()=>/full screen/i.test(document.querySelector('#msg').textContent)),'the message line says how to come back');
  ok(await page.evaluate(()=>getComputedStyle(document.querySelector('#page')).overflowY==='hidden'),'the page behind does not scroll');
  // play it by touch: the gold handle goes where the finger is, and the touch plays
  const wb=await page.locator('#wave').boundingBox();
  await page.mouse.move(wb.x+wb.width*0.62,wb.y+wb.height*0.35); await page.mouse.down(); await W(300);
  const t=await page.evaluate(()=>({pos:__ws.inst[0].P.pos,on:!!(__ws.inst[0].st&&__ws.inst[0].st.on)}));
  await page.mouse.up(); await W(200);
  ok(Math.abs(t.pos-0.62)<0.03 && t.on,`a finger on it plays from there (position ${t.pos.toFixed(3)}, sounding)`);
  // the keys still play under it
  await page.keyboard.down('a'); await W(250); const k=await page.evaluate(()=>__ws.inst[0].st?__ws.inst[0].st.held:0); await page.keyboard.up('a'); await W(300);
  ok(k>=1,'the keys still play under it');
  // KEYS hidden: all the screen
  await page.evaluate(()=>document.querySelector('#keys-btn').click()); await W(350);
  g=await geo(); ok(g.full && g.b===g.ih,`KEYS hidden: the whole screen (to ${g.b})`);
  await page.evaluate(()=>document.querySelector('#keys-btn').click()); await W(350);
  g=await geo(); ok(Math.abs(g.b-g.dockT)<=1,'KEYS back: above the keys again');
  // floating windows stay above it
  await page.evaluate(()=>document.querySelector('#gest-btn').click()); await W(300);
  const top=await page.evaluate(()=>{ const r=document.querySelector('#fw-gest .fw-h').getBoundingClientRect(), e=document.elementFromPoint(r.left+30,r.top+r.height/2); return !!(e && e.closest('#fw-gest')); });
  ok(top,'the GESTURE window opens above it');
  await page.evaluate(()=>document.querySelector('#fw-gest .fw-x').click()); await W(150);
  // the engine can change in full screen
  await page.click('#seg-eng button:nth-child(3)'); await W(400);
  g=await geo(); ok(g.full && await page.evaluate(()=>__ws.inst[0].P.eng)==='sp','SAMPLER chosen in full screen: it stays full screen');
  await page.click('#seg-eng button:nth-child(1)'); await W(400);
  // ---- back: the button, Esc
  await page.click('#wave-full'); await W(450);
  g=await geo(); ok(!g.full && g.btn==='false' && Math.abs(g.wh-g0.wh)<=2,'the button again: back to the page, the waveform its usual size');
  const lay=await page.evaluate(()=>{ const o=document.querySelector('.p-out').getBoundingClientRect(), w=document.querySelector('.p-wave').getBoundingClientRect(); return {beside:Math.abs(o.top-w.top)<2 && o.left>w.right, same:Math.abs(o.bottom-w.bottom)<=2}; });
  ok(lay.beside && lay.same,'the rack is as it was (OUTPUT beside POSITION, as tall)');
  await page.click('#wave-full'); await W(300); await page.keyboard.press('Escape'); await W(400);
  ok(!(await geo()).full,'Esc brings the page back too');
  // not kept: a reload starts with the page
  await page.click('#wave-full'); await W(300); await page.reload(); await W(1400);
  ok(!(await geo()).full,'after a reload the page is back');
  // phone width
  await page.setViewportSize({width:400,height:860}); await W(400);
  await page.evaluate(()=>document.querySelector('#wave-full').click()); await W(400);
  g=await geo(); const over=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  ok(g.full && g.r===400 && Math.abs(g.b-g.dockT)<=1 && g.wh>200 && over<=0,`400 px: full screen above the keys, waveform ${g.wh} px tall, nothing wider than the screen`);
  await page.evaluate(()=>document.querySelector('#wave-full').click()); await W(200);
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
