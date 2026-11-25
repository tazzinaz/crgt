// v48: long files. WAV and AIFF headers and samples of every kind read right; a long WAV is read in pieces at its own
// rate and kept as 16 bits by the page, the float copy moved to the engine, once for every player on it; it plays,
// draws, slices and anti-aliases; it comes back after a reload, and goes into and out of a session .zip.
// node t_long48.js [url]   (writes a 4-minute WAV next to this file's work folder)
const { chromium } = require(process.env.PW||'/home/claude/.npm-global/lib/node_modules/@playwright/mcp/node_modules/playwright');
const fs=require('fs'), os=require('os'), path=require('path');
const URL=process.argv[2]||'http://localhost:8765/preview.html';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'crgt-long-'));
// a 4-minute stereo 16-bit WAV at 44.1 kHz: a tone in each channel, plucks every half second
function longWav(file,secs){
  const sr=44100, n=sr*secs, data=Buffer.alloc(n*4), h=Buffer.alloc(44);
  for(let i=0;i<n;i++){ const t=i/sr, e=Math.exp(-((t%0.5))*6), l=Math.sin(2*Math.PI*220*t)*0.5*e, r=Math.sin(2*Math.PI*330*t)*0.4*e;
    data.writeInt16LE(Math.round(l*32767),i*4); data.writeInt16LE(Math.round(r*32767),i*4+2); }
  h.write('RIFF',0); h.writeUInt32LE(36+data.length,4); h.write('WAVE',8); h.write('fmt ',12); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(2,22);
  h.writeUInt32LE(sr,24); h.writeUInt32LE(sr*4,28); h.writeUInt16LE(4,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(data.length,40);
  fs.writeFileSync(file,Buffer.concat([h,data]));
}
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--autoplay-policy=no-user-gesture-required']});
  let pass=0, fail=0; const ok=(c,t)=>{ c?pass++:fail++; console.log((c?'PASS ':'FAIL ')+t); };
  const ctx=await browser.newContext({viewport:{width:1180,height:820}}); let page=await ctx.newPage(); const errs=[];
  const hook=p=>{ p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error'&&!/ERR_TUNNEL|fonts|favicon|404|net::/.test(m.text())) errs.push(m.text()); }); };
  hook(page);
  const W=ms=>page.waitForTimeout(ms), ev=(f,a)=>page.evaluate(f,a);
  await page.goto(URL); await W(1500);

  // ---------- 1. headers and sample formats ----------
  const fmts=await ev(async()=>{
    const N=64, ref=i=>Math.sin(i*0.3)*0.7, refR=i=>Math.cos(i*0.2)*0.5;
    const mk=(kind,o)=>{
      const ch=o.ch, B=o.bits>>3, ba=B*ch, body=new DataView(new ArrayBuffer(N*ba));
      for(let i=0;i<N;i++) for(let c=0;c<ch;c++){ const v=c?refR(i):ref(i), p=i*ba+c*B, le=o.le;
        if(o.flt){ if(B===4) body.setFloat32(p,v,le); else body.setFloat64(p,v,le); }
        else if(B===1){ if(kind==='wav') body.setUint8(p,Math.round(v*127)+128); else body.setInt8(p,Math.round(v*127)); }
        else if(B===2) body.setInt16(p,Math.round(v*32767),le);
        else if(B===3){ let s=Math.round(v*8388607); if(s<0) s+=16777216; const b=[s&255,(s>>8)&255,(s>>16)&255]; if(!le) b.reverse(); for(let k=0;k<3;k++) body.setUint8(p+k,b[k]); }
        else body.setInt32(p,Math.round(v*2147483647),le); }
      const u8=x=>new Uint8Array(x), str=s=>u8(s.split('').map(c=>c.charCodeAt(0)));
      if(kind==='wav'){
        const ext=!!o.ext, fl=ext?40:16, f=new DataView(new ArrayBuffer(fl)); f.setUint16(0,ext?0xFFFE:(o.flt?3:1),true); f.setUint16(2,ch,true); f.setUint32(4,44100,true); f.setUint32(8,44100*ba,true); f.setUint16(12,ba,true); f.setUint16(14,o.bits,true);
        if(ext){ f.setUint16(16,22,true); f.setUint16(24,o.flt?3:1,true); }
        const junk=new Uint8Array(13), parts=[str('RIFF'),new Uint8Array(4),str('WAVE'),str('JUNK'),u8(new Uint32Array([13]).buffer),junk,new Uint8Array(1),str('fmt '),u8(new Uint32Array([fl]).buffer),u8(f.buffer),str('data'),u8(new Uint32Array([N*ba]).buffer),u8(body.buffer)];
        return new Blob(parts);
      }
      const comm=new DataView(new ArrayBuffer(o.comp?22+6:18)); comm.setUint16(0,ch); comm.setUint32(2,N); comm.setUint16(6,o.bits);
      comm.setUint8(8,0x40); comm.setUint8(9,0x0E); comm.setUint32(10,0xAC440000); // 44100 as 80-bit extended
      if(o.comp){ for(let k=0;k<4;k++) comm.setUint8(18+k,o.comp.charCodeAt(k)); comm.setUint8(22,4); for(let k=0;k<4;k++) comm.setUint8(23+k,o.comp.charCodeAt(k)); }
      const be32=v=>{ const d=new DataView(new ArrayBuffer(4)); d.setUint32(0,v); return u8(d.buffer); };
      const cl=comm.byteLength, parts=[str('FORM'),be32(0),str(o.comp?'AIFC':'AIFF'),str('COMM'),be32(cl),u8(comm.buffer)]; if(cl&1) parts.push(new Uint8Array(1));
      parts.push(str('SSND'),be32(8+N*ba),be32(0),be32(0),u8(body.buffer));
      return new Blob(parts);
    };
    const cases=[['wav',{ch:2,bits:16,le:true}],['wav',{ch:1,bits:24,le:true}],['wav',{ch:2,bits:32,le:true}],['wav',{ch:2,bits:32,le:true,flt:true}],['wav',{ch:1,bits:64,le:true,flt:true}],
      ['wav',{ch:2,bits:8,le:true}],['wav',{ch:2,bits:24,le:true,ext:true}],['wav',{ch:3,bits:16,le:true}],
      ['aif',{ch:2,bits:16,le:false}],['aif',{ch:1,bits:24,le:false}],['aif',{ch:2,bits:16,le:true,comp:'sowt'}],['aif',{ch:2,bits:32,le:false,flt:true,comp:'fl32'}]];
    const out=[];
    for(const [kind,o] of cases){
      const b=mk(kind,o), h=await __ws.long.pcmHead(b);
      if(!h){ out.push({c:kind+' '+JSON.stringify(o),err:'no header'}); continue; }
      const C=Math.min(2,h.ch), ch=Array.from({length:C},()=>new Float32Array(N));
      __ws.long.pcmPiece(await b.slice(h.off,h.off+N*h.ba).arrayBuffer(),h,N,ch,0);
      let e=0; for(let i=0;i<N;i++){ e=Math.max(e,Math.abs(ch[0][i]-ref(i))); if(C>1) e=Math.max(e,Math.abs(ch[1][i]-refR(i))); }
      out.push({c:kind+' '+(o.comp||'')+(o.flt?' float':'')+' '+o.bits+'-bit '+o.ch+' ch'+(o.ext?' (extensible)':''),sr:h.sr,frames:h.frames,err:e});
    }
    return out;
  });
  for(const f of fmts) ok(f.sr===44100 && f.frames===64 && f.err<(f.c.includes('8-bit')?0.01:2e-4),`${f.c}: header and samples read right (largest error ${typeof f.err==='number'?f.err.toExponential(1):f.err})`);
  const bad=await ev(async()=>{ const b=new Blob([new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,2,0,2,0,68,172,0,0,0,0,0,0,4,0,4,0,100,97,116,97,0,0,0,0])]); return await __ws.long.pcmHead(b); });
  ok(bad===null,'a compressed WAV (ADPCM) is left to the decoder');

  // ---------- 2. a long WAV: read in pieces, 16 bits in the page, float in the engine ----------
  const file=path.join(DIR,'long four.wav'); longWav(file,240);
  await page.click('#demo'); await W(300);
  await page.keyboard.down('a'); await W(200); await page.keyboard.up('a'); await W(400);   // the engine runs
  await page.setInputFiles('#file',file);
  await page.waitForFunction(()=>{ const S=__ws.inst[0].sample; return S && S.name==='long four.wav'; },null,{timeout:120000});
  await W(800);
  let s=await ev(()=>{ const S=__ws.inst[0].sample; return {sr:S.sr,len:S.len,type:S.chans[0].constructor.name,cs:S.cs,peak:S.peak,n:S.an.map(a=>a.n),id:__ws.inst[0].sampleId,sids:__ws.long.sids.length}; });
  ok(s.sr===44100 && s.len===44100*240,`read at its own rate, every frame (${s.sr} Hz, ${s.len} frames)`);
  ok(s.type==='Int16Array' && s.cs>0 && Math.abs(s.cs*32767-s.peak)<1e-9,`the page keeps it as 16 bits, scaled to its peak (step ${s.cs.toExponential(3)})`);
  ok(/^w[0-9a-f]+-\d+$/.test(s.id),`its id comes from its size and three pieces (${s.id})`);
  ok(s.n[0]>40000 && s.n[1]>40000,`wavesets found in both channels (${s.n.join(' / ')})`);
  const tone=await ev(async()=>{ const J=__ws.inst[0]; let pk=0; document.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA'})); for(let k=0;k<12;k++){ await new Promise(r=>setTimeout(r,50)); if(J.st) pk=Math.max(pk,J.st.pkL||0,J.st.pkR||0); } document.dispatchEvent(new KeyboardEvent('keyup',{key:'a',code:'KeyA'})); return pk; });
  ok(tone>0.02,`a key plays it (peak ${tone.toFixed(3)})`);
  // a second player on the same file: nothing new for the engine
  await page.keyboard.press('2'); await W(300);
  await page.setInputFiles('#file',file);
  await page.waitForFunction(()=>{ const S=__ws.inst[1].sample; return S && S.name==='long four.wav'; },null,{timeout:120000}); await W(500);
  s=await ev(()=>({same:__ws.inst[0].sample===__ws.inst[1].sample,sids:__ws.long.sids}));
  ok(s.same && s.sids.length<=2,`a second player on it shares it, in the page and in the engine (${s.sids.length} samples in the engine)`);
  // drawn close up and far out, from its 16 bits
  const shot=()=>ev(()=>{ const c=document.querySelector('#wave-c'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let h=0, lit=0; for(let i=0;i<d.length;i+=4){ if(d[i+3]) lit++; h=(h*31+d[i]+d[i+1]*7+d[i+2]*13)>>>0; } return {lit,h,spp:(__ws.inst[1].view.v1-__ws.inst[1].view.v0)*__ws.inst[1].sample.len/c.width}; });
  const drawn=[await shot()]; for(let k=1;k<=16;k++){ await page.click('#z-in'); await W(60); if(k===6||k===16){ await W(300); drawn.push(await shot()); } }
  await page.click('#z-fit'); await W(200);
  ok(drawn.every(x=>x.lit>1000) && new Set(drawn.map(x=>x.h)).size===3 && drawn[2].spp<1.5,`the waveform draws far out, nearer and sample by sample from its 16 bits (${drawn.map(x=>x.spp.toFixed(1)+' per px').join(' / ')})`);
  // SAMPLER SLICE finds slices in it; ANTI-ALIAS makes its copies once
  await page.click('#seg-eng button:nth-child(3)'); await W(300);
  const sl=await ev(async()=>{ const b=[...document.querySelectorAll('#seg-spMode button')].find(x=>/SLICE/i.test(x.textContent)); if(b) b.click(); await new Promise(r=>setTimeout(r,1500)); return {n:(__ws.inst[1].P.spSl||[]).length,mode:__ws.inst[1].P.spMode}; });
  ok(sl.mode==='slice' && sl.n>=8,`SAMPLER SLICE finds the plucks (${sl.n} slices)`);
  await page.click('#seg-eng button:nth-child(2)'); await W(300);
  await page.click('#seg-grAA button:nth-child(2)'); await W(900);
  const aa=await ev(()=>({mips:__ws.long.mips,sid:__ws.inst[1].sample.sid,on:__ws.inst[1].P.grAA,page:!!__ws.inst[1].sample.mips}));
  ok(aa.on && aa.mips.length===1 && aa.mips[0]===aa.sid && !aa.page,`ANTI-ALIAS copies are made once and moved to the engine; the page keeps none (${JSON.stringify(aa)})`);
  const gtone=await ev(async()=>{ const J=__ws.inst[1]; let pk=0; document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK'})); for(let k=0;k<12;k++){ await new Promise(r=>setTimeout(r,50)); if(J.st) pk=Math.max(pk,J.st.pkL||0,J.st.pkR||0); } document.dispatchEvent(new KeyboardEvent('keyup',{key:'k',code:'KeyK'})); return pk; });
  ok(gtone>0.005,`a high note plays it through them (peak ${gtone.toFixed(3)})`);
  await page.click('#seg-grAA button:nth-child(1)'); await W(200);
  await page.click('#seg-eng button:nth-child(1)'); await W(200);
  // the engine lets go of a sample no player has
  await ev(()=>{ document.querySelector('#demo').click(); }); await W(200);
  await page.keyboard.press('1'); await W(300); await ev(()=>{ document.querySelector('#demo').click(); }); await W(400);
  s=await ev(()=>({sids:__ws.long.sids,demo:__ws.inst[0].sample.sid}));
  ok(s.sids.length===1 && s.sids[0]===s.demo,`with no player on it the engine drops it (${JSON.stringify(s.sids)})`);
  // back on player 1, then reload: it comes back from storage, read in pieces
  await page.setInputFiles('#file',file);
  await page.waitForFunction(()=>{ const S=__ws.inst[0].sample; return S && S.name==='long four.wav'; },null,{timeout:120000});
  await W(5000);
  const kept=await ev(async()=>{ const db=await new Promise((res,rej)=>{ const r=indexedDB.open('wavesetPlayer'); r.onsuccess=()=>res(r.result); r.onerror=rej; });
    const all=await new Promise(res=>{ const q=db.transaction('samples').objectStore('samples').getAll(); q.onsuccess=()=>res(q.result); }); return all.map(r=>r.blob?'blob':'bytes'); });
  ok(kept.includes('blob'),`it is stored as the file, not as bytes in memory (${kept.join(', ')})`);
  await page.close(); page=await ctx.newPage(); hook(page);
  await page.goto(URL);
  await page.waitForFunction(()=>{ const S=window.__ws && __ws.inst[0].sample; return S && S.name==='long four.wav'; },null,{timeout:120000});
  s=await page.evaluate(()=>{ const S=__ws.inst[0].sample; return {len:S.len,sr:S.sr}; });
  ok(s.len===44100*240 && s.sr===44100,'after a reload it comes back whole');
  // into a session .zip and out of it again
  const zipOk=await page.evaluate(async()=>{
    const z=await __ws.long.zip(__ws.gest.snapshot('Long')), ent=await __ws.unzipBlob(z), keys=[...ent.keys()], wk=keys.find(k=>/\.wav$/.test(k));
    if(!wk) return {keys};
    const a=new Uint8Array(await ent.get(wk).slice(1000000,1000064).arrayBuffer());
    const S=__ws.inst[0].sample; return {keys,size:ent.get(wk).size,zip:z.size,head:Array.from(a.slice(0,4))};
  });
  ok(zipOk.size===44+44100*240*4 && zipOk.keys.includes('session.json'),`a session .zip holds the whole file (${zipOk.size} bytes) without reading it into memory`);
  const fs2=require('fs'); const back=fs2.readFileSync(file).subarray(1000000,1000004);
  ok(JSON.stringify(Array.from(back))===JSON.stringify(zipOk.head),'and the bytes in it are the file\'s');
  // a sample stored as bytes by an earlier version comes back read in pieces too
  const old=await page.evaluate(async()=>{
    const db=await new Promise((res,rej)=>{ const r=indexedDB.open('wavesetPlayer'); r.onsuccess=()=>res(r.result); r.onerror=rej; });
    const all=await new Promise(res=>{ const q=db.transaction('samples').objectStore('samples').getAll(); q.onsuccess=()=>res(q.result); });
    const rec=all.find(r=>r.blob && r.blob.size>40e6); if(!rec) return {err:'no stored file'};
    const bytes=await rec.blob.arrayBuffer();
    await new Promise((res,rej)=>{ const tx=db.transaction('samples','readwrite'); tx.objectStore('samples').put({name:'old way.wav',type:'audio/wav',bytes,date:Date.now()},'hOLDSTYLE'); tx.oncomplete=res; tx.onerror=rej; });
    const snap=JSON.parse(JSON.stringify(__ws.gest.snapshot('')));
    snap.inst[3].sample={id:'hOLDSTYLE',name:'old way.wav'};
    await __ws.restoreSession(snap,id=>__ws.long.fromIdb(id));
    const S=__ws.inst[3].sample; return S?{len:S.len,sr:S.sr,name:__ws.inst[3].sampleName}:{err:'not restored'};
  });
  ok(old.len===44100*240 && old.sr===44100,`a long sample stored as bytes by an earlier version is read in pieces too (${JSON.stringify(old)})`);
  ok(errs.length===0,'no page errors'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
  await browser.close(); try{ fs.rmSync(DIR,{recursive:true,force:true}); }catch(e){}
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})();
