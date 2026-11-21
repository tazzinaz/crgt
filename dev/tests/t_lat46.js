// v46: latency. ATTACK starts at 2 ms (down to 1 ms); a note's sound leaves the engine within a block and reaches half
// its level within a few ms; the engine loads from crgt-dsp.js when blob: scripts are refused, ScriptProcessor's LOW
// blocks are 1024 samples; a key press reads no layout (the touched key, a kept keyboard rectangle) and still gets
// the right note and velocity; the AUDIO window times TOUCH → SOUND.
// Needs crgt-dsp.js (python3 dev/build.py --dsp) served next to the preview page.
const { chromium } = require(process.env.PW||'/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const URL=process.argv[2]||'http://localhost:8765/preview.html';
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  let pass=0, fail=0; const ok=(c,t)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+t); };
  const errs=[];
  async function open(o={}){
    const ctx=await browser.newContext({viewport:o.vp||{width:1180,height:820},hasTouch:true}); const page=await ctx.newPage();
    page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|fonts|favicon|404|crgt-dsp/.test(m.text())) errs.push(m.text()); });
    await page.addInitScript(o=>{
      const c=AudioNode.prototype.connect; AudioNode.prototype.connect=function(d,...a){ if(d instanceof AudioDestinationNode && (this instanceof AudioWorkletNode || this instanceof ScriptProcessorNode)) window.__eng=this; return c.call(this,d,...a); };
      const pm=MessagePort.prototype.postMessage; window.__on=[]; MessagePort.prototype.postMessage=function(m,...a){ if(m&&m.type==='on') window.__on.push(m); return pm.call(this,m,...a); };
      if(o.refuse){ const am=AudioWorklet.prototype.addModule; AudioWorklet.prototype.addModule=function(u,...a){ if(!window.__eng && o.refuse.some(p=>String(u).startsWith(p)||String(u).includes(p))) return Promise.reject(new DOMException('refused by the test','SecurityError')); return am.call(this,u,...a); }; }
    },{refuse:o.refuse||null});
    await page.goto(URL); await page.waitForTimeout(1300); await page.click('#demo'); await page.waitForTimeout(900);
    await page.evaluate(()=>{ const w=document.querySelector('#fw-gest'); if(w && !w.hidden) document.querySelector('#fw-gest .fw-x').click(); });
    return {ctx,page};
  }
  // the output's first 300 ms after a key press: when the first sample leaves the engine (ms after the press reached the
  // page) and how much sound there is from 2 to 10 ms after it (the sample's own shape decides the rest, so this is
  // compared with the same note played with a near-instant attack)
  async function onset(page,key){
    await page.evaluate(async()=>{
      if(window.__tap) return;
      const ctx=__ws.ctx, src=`registerProcessor('lat-tap',class extends AudioWorkletProcessor{constructor(){super();this.arm=-1;this.buf=null;this.port.onmessage=e=>{this.arm=e.data;this.buf=new Float32Array(Math.round(sampleRate*0.3));this.n=0;};}
        process(i){const x=i[0]&&i[0][0]; if(this.buf&&x){ if(this.n<this.buf.length){ for(let k=0;k<x.length&&this.n<this.buf.length;k++){ if(currentFrame+k>=this.arm) this.buf[this.n++]=Math.abs(x[k])+Math.abs(i[0][1]?i[0][1][k]:0); } } else { this.port.postMessage(this.buf); this.buf=null; } } return true;}});`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
      const tap=new AudioWorkletNode(ctx,'lat-tap'); window.__eng.connect(tap); window.__tap=tap;
      window.addEventListener('keydown',e=>{ if(e.repeat) return; window.__res=null; tap.port.onmessage=m=>{ window.__res=m.data; }; tap.port.postMessage(Math.round(ctx.currentTime*ctx.sampleRate)); },true);
    });
    const out=[];
    for(let r=0;r<4;r++){
      await page.keyboard.down(key); await page.waitForTimeout(400); await page.keyboard.up(key); await page.waitForTimeout(650);
      const a=await page.evaluate(()=>{ const b=window.__res, sr=__ws.ctx.sampleRate; if(!b) return null; let first=-1,pk=0; for(let k=0;k<b.length;k++){ if(first<0&&b[k]>1e-4) first=k; }
        let e=0; for(let k=first+Math.round(0.002*sr);k<first+Math.round(0.010*sr)&&k<b.length;k++) e+=b[k];
        return {first:first/sr*1000,e}; });
      if(a && a.first>=0) out.push(a);
    }
    out.sort((x,y)=>x.e-y.e); return out.length?out[out.length>>1]:{first:-1,e:0};
  }
  const W=(p,ms)=>p.waitForTimeout(ms);

  // ---- ATTACK, the defaults, the engine from blob:
  {
    const {ctx,page}=await open();
    const a=await page.evaluate(()=>({atk:__ws.inst[0].P.atk,min:__ws.spec('atk').min,def:__ws.def('atk')}));
    ok(a.atk===0.002 && a.def===0.002 && a.min===0.001,`ATTACK starts at 2 ms and goes down to 1 ms (${a.atk*1000} ms, min ${a.min*1000} ms)`);
    await page.keyboard.down('d'); await W(page,250); await page.keyboard.up('d'); await W(page,700);
    const e=await page.evaluate(()=>({how:__ws.engHow,from:__ws.engFrom}));
    ok(e.how==='AudioWorklet' && e.from==='blob',`the engine runs in the AudioWorklet, loaded from a blob: URL (${e.how}, ${e.from})`);
    const same=await page.evaluate(async()=>{ const r=await fetch('crgt-dsp.js'); return r.ok && (await r.text())===__ws.dsp; });
    ok(same,'crgt-dsp.js is exactly the code the page sends to the AudioWorklet');
    for(const [eng,n] of [['ws',1],['sp',3]]){
      await page.click('#seg-eng button:nth-child('+n+')'); await W(page,350);
      const o=await onset(page,'a');
      const setA=v=>page.evaluate(v=>{ __ws.inst[0].P.atk=v; __ws.send({type:'params',p:{atk:v}}); },v);
      await setA(0.0005); const o0=await onset(page,'a'); await setA(0.01); const o10=await onset(page,'a'); await setA(0.002);
      const name=eng==='ws'?'WAVESET':'SAMPLER';
      ok(o.first>=0 && o.first<4,`${name}: the note leaves the engine ${o.first.toFixed(1)} ms after the press (within one block)`);
      ok(o.e>=o0.e*0.85,`${name}: from 2 to 10 ms it is ${Math.round(o.e/o0.e*100)}% as loud as with a near-instant attack (the old 10 ms ATTACK: ${Math.round(o10.e/o0.e*100)}%)`);
    }
    await page.click('#seg-eng button:nth-child(1)'); await W(page,300);
    // ---- a key press: the touched key, a velocity from the kept rectangle
    const cdp=await ctx.newCDPSession(page);
    const tapAt=async(x,y)=>{ await page.evaluate(()=>{ window.__on=[]; }); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]}); await W(page,80); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await W(page,120); return page.evaluate(()=>window.__on[0]||null); };
    const keyBox=sel=>page.evaluate(sel=>{ const e=document.querySelector(sel), r=e.getBoundingClientRect(); return {x:r.left+r.width/2,t:r.top,b:r.bottom,n:+e.dataset.note}; },sel);
    let laid=0; await page.evaluate(()=>{ const g=Element.prototype.getBoundingClientRect, f=document.elementFromPoint; window.__lay=0; window.__arm=false;
      Element.prototype.getBoundingClientRect=function(){ if(window.__arm) window.__lay++; return g.call(this); }; document.elementFromPoint=function(...a){ if(window.__arm) window.__lay++; return f.apply(this,a); };
      document.querySelector('#keys').addEventListener('pointerdown',()=>{ window.__arm=true; setTimeout(()=>{ window.__arm=false; },0); },{capture:true}); });
    const wk=await keyBox('#keys .wk[data-note="60"]'), bk=await keyBox('#keys .bk[data-note="61"]');
    await tapAt(wk.x,wk.t+4); await W(page,100);   // the first press after loading may read the rectangle once
    await page.evaluate(()=>{ window.__lay=0; });
    const w1=await tapAt(wk.x,wk.t+4), w2=await tapAt(wk.x,wk.b-4), b1=await tapAt(bk.x,bk.t+(bk.b-bk.t)*0.5);
    laid=await page.evaluate(()=>window.__lay);
    ok(w1&&w1.note===60 && w2&&w2.note===60 && b1&&b1.note===61,`the touched key plays: white C ${w1&&w1.note}, ${w2&&w2.note}, black C♯ ${b1&&b1.note}`);
    ok(w1.vel<0.36 && w2.vel>0.95 && Math.abs(b1.vel-0.65)<0.05,`velocity from where the finger lands: top ${w1.vel.toFixed(2)}, bottom ${w2.vel.toFixed(2)}, middle of a black key ${b1.vel.toFixed(2)}`);
    ok(laid===0,`a key press reads no layout before the note goes (${laid} reads)`);
    // a new window size renews the rectangle
    await page.setViewportSize({width:900,height:1000}); await W(page,400);
    const wk2=await keyBox('#keys .wk[data-note="60"]'), w3=await tapAt(wk2.x,wk2.b-4), w4=await tapAt(wk2.x,wk2.t+4);
    ok(w3&&w3.note===60&&w3.vel>0.95 && w4&&w4.vel<0.36,`after the window changes size the velocity still follows the finger (${w3&&w3.vel.toFixed(2)}, ${w4&&w4.vel.toFixed(2)})`);
    await page.setViewportSize({width:1180,height:820}); await W(page,400);
    // ---- TOUCH → SOUND in the AUDIO window
    await page.click('#eng'); await W(page,300);
    const k2=await keyBox('#keys .wk[data-note="64"]');
    for(let i=0;i<3;i++) await tapAt(k2.x,k2.b-10);
    await W(page,200);
    const r=await page.evaluate(()=>({tot:document.querySelector('#lat-total').textContent,rows:document.querySelector('#lat-rows').innerText,vis:document.querySelector('#lat-now').getBoundingClientRect().height>0}));
    ok(r.vis && /≈ \d/.test(r.tot) && /touch → CRGT\s+\d/.test(r.rows) && /engine\s+2\.\d\sms/.test(r.rows) && /AUDIOWORKLET/.test(r.rows),`AUDIO shows TOUCH → SOUND ${r.tot}: ${r.rows.replace(/\s+/g,' ').slice(0,160)}`);
    ok(!/attack/.test(r.rows) && !/stretch/.test(r.rows),'with ATTACK at 2 ms and no TIME-STRETCH, nothing more is named');
    await page.evaluate(()=>{ __ws.inst[0].P.atk=0.02; __ws.send({type:'params',p:{atk:0.02}}); }); await page.selectOption('#sel-ts','basic'); await W(page,200);
    await tapAt(k2.x,k2.b-10); await W(page,200);
    const r2=await page.evaluate(()=>document.querySelector('#lat-rows').innerText);
    ok(/attack\s+20\s?ms/.test(r2) && /stretch/.test(r2),'a long ATTACK and TIME-STRETCH are named with what they add');
    await page.selectOption('#sel-ts','off');
    // HELP off keeps the readout (a status), hides the explanation
    const help=await page.evaluate(()=>{ document.documentElement.classList.add('nohelp'); document.body.classList.add('nohelp'); const a=document.querySelector('#lat-now').getBoundingClientRect().height>0, d=getComputedStyle(document.querySelector('#lat-desc')).display; document.documentElement.classList.remove('nohelp'); document.body.classList.remove('nohelp'); return {a,d}; });
    ok(help.a,'the readout stays with HELP off');
    // phone width: the window fits
    await page.setViewportSize({width:390,height:844}); await W(page,300);
    const fit=await page.evaluate(()=>{ const p=document.querySelector('#rate-pop').getBoundingClientRect(), rr=document.querySelector('#lat-rows').getBoundingClientRect(); return p.left>=0 && p.right<=innerWidth && rr.right<=p.right+1 && document.documentElement.scrollWidth<=innerWidth; });
    ok(fit,'at phone width the readout fits in the AUDIO window');
    await ctx.close();
  }
  // ---- blob: refused: the engine comes from crgt-dsp.js
  {
    const {ctx,page}=await open({refuse:['blob:']});
    await page.keyboard.down('d'); await W(page,300); await page.keyboard.up('d'); await W(page,800);
    const e=await page.evaluate(()=>({how:__ws.engHow,from:__ws.engFrom,on:!!__ws.nodeReady}));
    ok(e.how==='AudioWorklet' && e.from==='file' && e.on,`blob: scripts refused: the AudioWorklet loads crgt-dsp.js instead (${e.how}, ${e.from})`);
    const o=await onset(page,'a');
    ok(o.first>=0 && o.first<4,`and answers as quickly (first sample ${o.first.toFixed(1)} ms after the press)`);
    await ctx.close();
  }
  // ---- both refused: ScriptProcessor, 1024-sample blocks at LOW, named in the readout
  {
    const {ctx,page}=await open({refuse:['blob:','crgt-dsp.js']});
    await page.keyboard.down('d'); await W(page,300); await page.keyboard.up('d'); await W(page,900);
    const e=await page.evaluate(()=>({how:__ws.engHow,bs:window.__eng&&window.__eng.bufferSize}));
    ok(e.how==='ScriptProcessor' && e.bs===1024,`no AudioWorklet at all: ScriptProcessor in 1024-sample blocks at LOW (was 2048): ${e.how}, ${e.bs}`);
    await page.click('#eng'); await W(page,300);
    const rows=await page.evaluate(()=>document.querySelector('#lat-rows').innerText);
    ok(/engine\s+2[1-4]\sms/.test(rows) && /SCRIPTPROCESSOR/.test(rows),'the readout says the engine runs in long blocks and why: '+rows.replace(/\s+/g,' ').slice(0,120));
    await ctx.close();
  }
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
