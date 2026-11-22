// v47: positions in gesture loops follow the LOOP; clips B (one at a time, launched like Ableton clips) beside the
// layers A; COPY and PASTE of a layer or clip. Runs on the preview page.
const { chromium } = require(process.env.PW||'/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const URL=process.argv[2]||'http://localhost:8765/preview.html';
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  let pass=0, fail=0; const ok=(c,t)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+t); };
  const ctx=await browser.newContext({viewport:{width:1180,height:1500}}); const page=await ctx.newPage(); const errs=[];
  page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|fonts|favicon|404|net::/.test(m.text())) errs.push(m.text()); });
  const W=ms=>page.waitForTimeout(ms), ev=(f,a)=>page.evaluate(f,a);
  await page.goto(URL); await W(1500);
  await page.click('#demo'); await W(900);
  await ev(()=>{ const w=document.querySelector('#fw-gest'); if(w.hidden) document.querySelector('#gest-btn').click(); });
  await W(200);
  const st=(i)=>ev(i=>{ const J=__ws.inst[i], G=J.G; return {act:G.act,nq:G.nq,play:G.play,sel:G.sel,pos:J.P.pos,
    L:G.layers.map(L=>({id:L.id,cl:L.cl,run:L.run,len:L.len,n:L.src?L.src.ev.length:0,name:__ws.gest.name(J,L),notes:[...L.notes],mute:L.mute}))}; },i);
  const wave=await page.locator('#wave').boundingBox();
  const touchAt=async(fx,ms)=>{ await page.mouse.move(wave.x+wave.width*fx,wave.y+wave.height*0.45); await page.mouse.down(); await W(ms||120); await page.mouse.up(); };
  const posEv=(i,li)=>ev(([i,li])=>__ws.inst[i].G.layers[li].src.ev.filter(e=>e.k==='p'&&e.key==='pos').map(e=>e.v),[i,li]);

  // ---------- 1. a take made with LOOP off plays at the same fraction of the loop when LOOP is on ----------
  await page.click('#g-rec'); await W(150);
  await touchAt(0.75,150); await W(900);
  await page.click('#g-rec'); await W(300);   // the take ends and loops (it sets MAIN)
  let s=await st(0);
  ok(s.L.length===1 && !s.L[0].cl && s.L[0].len>500 && s.play,`a take of the waveform loops as layer ${s.L[0]&&s.L[0].name} (${s.L[0]&&Math.round(s.L[0].len)} ms)`);
  const v0=(await posEv(0,0))[0];
  ok(v0>0.6 && v0<0.9,`with LOOP off the position is kept as a fraction of the file (${v0&&v0.toFixed(3)})`);
  await W(1400);
  s=await st(0); ok(Math.abs(s.pos-v0)<1e-6,`the loop plays it there (${s.pos.toFixed(3)})`);
  await ev(()=>{ const J=__ws.inst[0]; J.P.ls=0.2; J.P.le=0.6; __ws.send({type:'params',p:{ls:0.2,le:0.6}}); });
  await page.click('#lp-on'); await W(60);
  s=await st(0); const want=0.2+0.4*v0;
  ok(Math.abs(s.pos-want)<1e-6,`LOOP on: the position moves at once to the same fraction of the loop (${s.pos.toFixed(3)}, want ${want.toFixed(3)})`);
  await W(1400);
  s=await st(0); ok(Math.abs(s.pos-want)<1e-6,'and stays there as the loop comes round');
  await ev(()=>{ const J=__ws.inst[0]; J.P.ls=0.4; J.P.le=0.8; __ws.send({type:'params',p:{ls:0.4,le:0.8}}); __ws.inst[0]; });
  await page.click('#lp-on'); await W(40); await page.click('#lp-on'); await W(60);
  s=await st(0); ok(Math.abs(s.pos-(0.4+0.4*v0))<1e-6,`moving the loop takes the position along (${s.pos.toFixed(3)})`);
  await page.click('#lp-on'); await W(60);
  s=await st(0); ok(Math.abs(s.pos-v0)<1e-6,`LOOP off: back at its place in the file (${s.pos.toFixed(3)})`);
  await page.click('#g-play'); await W(200);   // stop

  // ---------- 2. a take made inside the LOOP plays at the same fraction of the file when LOOP is off ----------
  await page.keyboard.press('2'); await W(300);
  await page.click('#demo'); await W(900);
  await ev(()=>{ const J=__ws.inst[1]; J.P.ls=0.2; J.P.le=0.6; __ws.send({type:'params',p:{ls:0.2,le:0.6}}); });
  await page.click('#lp-on'); await W(100);
  await page.click('#g-rec'); await W(150);
  await touchAt(0.5,150); await W(700);
  await page.click('#g-rec'); await W(300);
  const pAbs=await ev(()=>__ws.inst[1].P.pos), v1=(await posEv(1,0))[0];
  ok(Math.abs(v1-(pAbs-0.2)/0.4)<1e-6 && v1>0 && v1<1,`with LOOP on the position is kept as a fraction of the loop (${v1.toFixed(3)} of it, at ${pAbs.toFixed(3)} of the file)`);
  await W(1100);
  await page.click('#lp-on'); await W(60);
  s=await st(1); ok(Math.abs(s.pos-v1)<1e-6,`LOOP off: it plays at that fraction of the whole file (${s.pos.toFixed(3)})`);
  await page.click('#g-play'); await W(150);

  // extra fingers (taps) follow the loop too
  const tp=await ev(async()=>{
    const J=__ws.inst[1], G=J.G, L=G.layers[0];
    J.P.loop=true; J.P.ls=0.5; J.P.le=1; __ws.send({type:'params',p:{loop:true,ls:0.5,le:1}});
    L.src=Object.assign({},L.src,{ev:L.src.ev.concat([{k:'ton',id:'x1',pos:0.5,t:5},{k:'toff',id:'x1',t:L.src.S-5}]).sort((a,b)=>a.t-b.t)}); __ws.gest.refit(1,0);
    document.querySelector('#g-play').click();
    await new Promise(r=>setTimeout(r,250));
    const t=[...J.taps.values()].find(x=>x.loop); return t?t.pos:null;
  });
  ok(tp!==null && Math.abs(tp-0.75)<1e-6,`an extra finger recorded at the middle plays at the middle of the loop (${tp})`);
  await page.click('#g-play'); await W(150);

  // ---------- 3. takes from before v47 open where they sounded ----------
  const old=await ev(async()=>{
    const snap=__ws.gest.snapshot(), x=JSON.parse(JSON.stringify(snap));
    // player 3: LOOP on 0.2–0.6 and a take whose positions all lie inside it; player 4: one outside it
    for(const [k,vals] of [[2,[0.3,0.5]],[3,[0.1,0.5]]]){
      const p=x.inst[k]; p.P=Object.assign({},x.inst[0].P,{loop:true,ls:0.2,le:0.6}); p.sample=x.inst[0].sample;
      p.G={sync:'1',sel:0,layers:[{sync:'free',mute:false,src:{S:1000,ph0:null,kt:{pos:1},q:null,ev:[{k:'p',key:'pos',v:vals[0],t:10},{k:'p',key:'pos',v:vals[1],t:500}],take:null}}]};
    }
    await __ws.gest.restore(x);
    return [2,3].map(k=>__ws.inst[k].G.layers[0].src.ev.map(e=>+e.v.toFixed(4)));
  });
  ok(JSON.stringify(old[0])==='[0.25,0.75]',`an older take inside the loop becomes fractions of the loop (${JSON.stringify(old[0])})`);
  ok(JSON.stringify(old[1])==='[0.1,0.5]',`an older take reaching outside it stays in fractions of the file (${JSON.stringify(old[1])})`);
  const sv=await ev(()=>__ws.gest.snapshot().inst[2].G.layers[0].src.pr);
  ok(sv===1,'new sessions mark their takes as loop-relative');

  // ---------- 4. clips: one at a time, with the layers A ----------
  await page.keyboard.press('5'); await W(300);
  await page.click('#demo'); await W(900);
  const rec=async(key,ms)=>{ await page.keyboard.down(key); await W(ms); await page.keyboard.up(key); };
  await page.click('#g-rec'); await W(120); await rec('a',300); await W(700); await page.click('#g-rec'); await W(250);   // A1 (sets MAIN)
  const main=await ev(()=>__ws.M.len);
  await page.click('#g-addc'); await W(150);
  s=await st(4); ok(s.L.length===2 && s.L[1].cl && s.L[1].name==='B1' && s.L[1].len===0,'+ in row B adds clip B1, armed');
  await rec('s',300); await W(main-350); await page.click('#g-rec'); await W(300);
  s=await st(4); const b1=s.L[1];
  ok(b1.len>0 && s.act===b1.id && b1.run && s.L[0].run,`B1's take ends and it plays with A1 (act ${s.act})`);
  await page.click('#g-addc'); await W(150); await rec('d',300);
  s=await st(4); ok(!s.L[1].run && s.act===s.L[2].id,'recording B2: B1 stops when the take starts');
  await W(main-350); await page.click('#g-rec'); await W(300);
  s=await st(4); ok(s.L[2].run && s.act===s.L[2].id && !s.L[1].run && s.L[0].run,'B2 plays when its take ends; A1 goes on');
  // layers A always play; notes of the playing clip sound with them
  const noteSets=await ev(async()=>{ const seen={a:false,b1:false,b2:false}; const J=__ws.inst[4], G=J.G;
    for(let k=0;k<160;k++){ await new Promise(r=>setTimeout(r,10)); const [A,B1,B2]=G.layers; if(A.notes.size) seen.a=true; if(B1.notes.size) seen.b1=true; if(B2.notes.size) seen.b2=true; } return seen; });
  ok(noteSets.a && noteSets.b2 && !noteSets.b1,`over a turn: A1 and B2 sound, B1 is silent (${JSON.stringify(noteSets)})`);
  // LAUNCH · MAIN: tap B1 (select), tap again (launch): it waits for MAIN
  const chipsB=page.locator('#g-clips .gc.cl');
  await chipsB.nth(0).click(); await W(80);
  s=await st(4); ok(s.sel===1 && s.act===s.L[2].id && !s.nq,'a tap on B1 selects it and launches nothing');
  await chipsB.nth(0).click(); await W(40);
  s=await st(4);
  const at=await ev(()=>{ const G=__ws.inst[4].G, M=__ws.M; return G.nq?{at:G.nq.at,ph:((G.nq.at-M.origin)/M.len)}:null; });
  ok(!!at && Math.abs(at.ph-Math.round(at.ph))<1e-6 && s.act===s.L[2].id,`the second tap queues B1 for the next turn of MAIN (turn ${at&&at.ph.toFixed(3)})`);
  ok(await chipsB.nth(0).evaluate(b=>b.classList.contains('q')),'B1 shows it is waiting');
  await ev(at=>new Promise(r=>{ const f=()=>performance.now()>at+30?r():setTimeout(f,5); f(); }),at.at);
  s=await st(4); ok(s.act===s.L[1].id && s.L[1].run && !s.L[2].run && !s.nq,'at the turn B1 plays and B2 stops');
  const st1=await ev(at=>{ const L=__ws.inst[4].G.layers[1]; return (L.start-at)%L.len; },at.at);
  ok(Math.abs(st1)<1e-6,`B1 starts from its beginning at the turn (offset ${st1.toFixed(4)} ms)`);
  // LAUNCH · NOW
  await page.selectOption('#g-lq','now'); await W(50);
  await chipsB.nth(1).click(); await W(40); await chipsB.nth(1).click(); await W(40);
  s=await st(4); ok(s.act===s.L[2].id && s.L[2].run && !s.L[1].run,'LAUNCH · NOW: B2 takes over at once');
  // a tap on the clip that plays stops it: only the layers A go on
  await chipsB.nth(1).click(); await W(40);
  s=await st(4); ok(s.act===0 && !s.L[2].run && s.L[0].run && s.play,'a tap on the playing clip stops it; A1 goes on');
  // LAUNCH · END with a clip playing: waits for the end of its turn
  await chipsB.nth(1).click(); await W(40);   // B2 again, now
  await page.selectOption('#g-lq','end'); await W(30);
  await chipsB.nth(0).click(); await W(40); await chipsB.nth(0).click(); await W(30);
  const endAt=await ev(()=>{ const G=__ws.inst[4].G, C=G.layers[2]; return G.nq?{at:G.nq.at,end:C.start+C.len}:null; });
  ok(!!endAt && Math.abs(endAt.at-endAt.end)<1e-6,'LAUNCH · END: B1 waits for the end of B2\'s turn');
  await chipsB.nth(0).click(); await W(30);
  s=await st(4); ok(!s.nq && s.act===s.L[2].id,'a third tap cancels the launch');
  await page.selectOption('#g-lq','main'); await W(30);
  // STOP keeps the clip; PLAY brings it back with A1
  await page.click('#g-play'); await W(100);
  s=await st(4); ok(!s.play && s.act===s.L[2].id,'STOP: the clip launched last is kept');
  await page.click('#g-play'); await W(100);
  s=await st(4); ok(s.play && s.L[0].run && s.L[2].run && !s.L[1].run,'PLAY: A1 and B2 again');
  // the tab says what plays
  const tabTxt=await ev(()=>__ws.inst[4].tabState.textContent);
  ok(/A1/.test(tabTxt) && /B2/.test(tabTxt) && !/B1/.test(tabTxt),`the player's tab names A1 and B2 (${tabTxt})`);

  // ---------- 5. COPY and PASTE ----------
  await page.locator('#g-chips .gc:not(.add)').nth(0).click(); await W(60);   // select A1
  await page.click('#g-copy'); await W(60);
  ok(await ev(()=>!!__ws.gest.buf && __ws.gest.buf.name==='A1'),'COPY takes A1');
  ok(/PASTE A1/.test(await page.textContent('#g-paste')),'PASTE names what it holds');
  await page.click('#g-paste'); await W(150);
  s=await st(4); const a1n=s.L[0].n, b3=s.L[3];
  ok(s.L.length===4 && b3 && b3.cl && b3.name==='B3' && b3.n===a1n && s.sel===3,`PASTE on A1 itself makes a new clip, B3, a copy of A1 (${b3&&b3.n} events), selected`);
  ok(!b3.run && s.act===s.L[2].id,'the new clip waits to be launched; B2 plays on');
  const same=await ev(()=>{ const G=__ws.inst[4].G, a=G.layers[0].src, b=G.layers[3].src; return a!==b && a.ev===b.ev && a.S===b.S; });
  ok(same,'the copy shares the take (takes are never changed in place) but is a layer of its own');
  // paste A1 into B1, then UNDO
  await chipsB.nth(0).click(); await W(60);
  const b1n=(await st(4)).L[1].n;
  await page.click('#g-paste'); await W(150);
  s=await st(4); ok(s.L[1].n===a1n && s.L.length===4,'PASTE on B1 puts the copy in place of what it had');
  await ev(()=>__ws.gest.undo()); await W(150);
  s=await st(4); ok(s.L[1].n===b1n && s.L.length===4 && s.act===s.L[2].id,'UNDO brings B1 back, and B2 still plays (launches are not undone)');
  // edit the copy: it is independent of A1
  await chipsB.nth(2).click(); await W(60);
  const indep=await ev(()=>{ const G=__ws.inst[4].G, L=G.layers[3]; L.src=Object.assign({},L.src,{ev:L.src.ev.slice(1)}); return G.layers[0].src.ev.length-L.src.ev.length; });
  ok(indep===1,'changing the copy leaves A1 as it was');
  // paste into another player
  await page.keyboard.press('6'); await W(300);
  await page.click('#g-paste'); await W(200);
  s=await st(5); ok(s.L.length===1 && !s.L[0].cl && s.L[0].n===a1n,`PASTE into an empty player makes it layer A1 there (${s.L[0]&&s.L[0].name})`);
  ok(/PASTE 5·A1/.test(await page.textContent('#g-paste')),'PASTE names the player the copy came from');
  await page.keyboard.press('5'); await W(300);

  // ---------- 6. the clip that plays leads its controls; sessions keep clips ----------
  const lead=await ev(()=>{ const J=__ws.inst[4], G=J.G, A=G.layers[0], B=G.layers[2];
    A.src=Object.assign({},A.src,{ev:A.src.ev.concat([{k:'p',key:'vol',v:0.3,t:1}]).sort((a,b)=>a.t-b.t),kt:Object.assign({},A.src.kt,{vol:9e8})});
    B.src=Object.assign({},B.src,{ev:B.src.ev.concat([{k:'p',key:'vol',v:0.7,t:2}]).sort((a,b)=>a.t-b.t),kt:Object.assign({},B.src.kt,{vol:5})});
    return null; });
  const owner=await ev(async()=>{ const J=__ws.inst[4], G=J.G; document.querySelector('#g-play').click(); await new Promise(r=>setTimeout(r,50)); document.querySelector('#g-play').click(); await new Promise(r=>setTimeout(r,80)); return [G.own.get('vol')===G.layers[2], G.own.get('vol')===G.layers[0]]; });
  ok(owner[0],'the playing clip leads a control it recorded, even when the layer recorded it later');
  const ses=await ev(async()=>{ const x=JSON.parse(JSON.stringify(__ws.gest.snapshot())); const g=x.inst[4].G; await __ws.gest.restore(x); const G=__ws.inst[4].G;
    return {saved:g.layers.map(l=>l.cl),ai:g.ai,cl:G.layers.map(L=>L.cl),act:G.act===G.layers[2].id,lq:__ws.M.lq}; });
  ok(JSON.stringify(ses.cl)==='[false,true,true,true]' && ses.act && ses.ai===2,`a session keeps the clips and the clip that plays (${JSON.stringify(ses)})`);
  // COPY PLAYER keeps them too
  const cp=await ev(async()=>{ __ws.plCopy(); document.querySelector('#tab-list').querySelectorAll('.tab-sel')[6].click(); await new Promise(r=>setTimeout(r,200)); __ws.plPaste(); const G=__ws.inst[6].G; return {cl:G.layers.map(L=>L.cl),act:!!G.act && G.layers.findIndex(L=>L.id===G.act)}; });
  ok(JSON.stringify(cp.cl)==='[false,true,true,true]' && cp.act===2,`COPY PLAYER takes the clips and which one plays (${JSON.stringify(cp)})`);

  // ---------- 7. the window at phone width ----------
  await page.setViewportSize({width:390,height:844}); await W(300);
  const fit=await ev(()=>{ const w=document.querySelector('#fw-gest'), r=w.getBoundingClientRect(); const bad=[...w.querySelectorAll('button:not([hidden]),select')].filter(b=>{ const q=b.getBoundingClientRect(); return q.width && (q.right>r.right+1 || q.left<r.left-1); }).length; return {w:r.width,vw:innerWidth,bad,sw:document.documentElement.scrollWidth}; });
  ok(fit.bad===0 && fit.sw<=fit.vw,`at phone width every control stays inside the window (${JSON.stringify(fit)})`);
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
