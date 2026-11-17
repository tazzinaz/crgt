// CRGT Host bridge: Web MIDI for CRGT inside the iPad app, on top of the iPad's own MIDI (CoreMIDI): IDAM MIDI Host
// (a Mac by cable), USB and Bluetooth devices, the Wi-Fi network session, and other iPad apps through the CRGT port.
// Injected by the app before the page's own scripts. The app answers
//   window.webkit.messageHandlers.crgtHost.postMessage({op, ...})  (a promise: reply or error)
// and calls window.__crgtHost.rx(batch) / .ports(status) / .update(info) / .status(info).
// This file is the source: host/tools/embed_bridge.py copies it into BridgeScript.swift.
(function(){
  'use strict';
  const wk=window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.crgtHost;
  if(!wk || window.CRGT_HOST) return;
  const INFO=/*HOST_INFO*/null || {};
  const call=(op,a)=>{ try{ return Promise.resolve(wk.postMessage(Object.assign({op},a||{}))); }catch(e){ return Promise.reject(e); } };
  const post=(op,a)=>{ try{ const p=wk.postMessage(Object.assign({op},a||{})); if(p && p.catch) p.catch(()=>{}); }catch(e){} };

  class MIDIConnectionEvent extends Event { constructor(type,init){ super(type,init); this.port=(init && init.port)||null; } }
  class MIDIMessageEvent extends Event { constructor(type,init){ super(type,init); this.data=(init && init.data)||new Uint8Array(0); } }
  if(!('MIDIConnectionEvent' in window)) window.MIDIConnectionEvent=MIDIConnectionEvent;
  if(!('MIDIMessageEvent' in window)) window.MIDIMessageEvent=MIDIMessageEvent;

  // on<type> as browsers have it: one handler, called in turn with the listeners; `after` runs when one is set
  function onProp(proto,type,after){
    Object.defineProperty(proto,'on'+type,{configurable:true,enumerable:true,
      get(){ return (this._on && this._on[type])||null; },
      set(f){ const o=this._on||(this._on={}), w=this._onw||(this._onw={});
        o[type]=typeof f==='function'?f:null;
        if(o[type] && !w[type]){ w[type]=e=>{ const h=o[type]; if(h) h.call(this,e); }; EventTarget.prototype.addEventListener.call(this,type,w[type]); }
        if(o[type] && after) after.call(this); } });
  }

  const S={sysex:false};
  let access=null, opening=null, upd=null, last=null;
  const ports=new Map();

  function changed(p){
    p.dispatchEvent(new MIDIConnectionEvent('statechange',{port:p}));
    if(access) access.dispatchEvent(new MIDIConnectionEvent('statechange',{port:p}));
  }
  class MIDIPort extends EventTarget {
    constructor(d){ super(); this._d=d; this._c='closed'; }
    get id(){ return this._d.id; }
    get name(){ return this._d.name||null; }
    get manufacturer(){ return this._d.manufacturer||null; }
    get version(){ return this._d.version||null; }
    get type(){ return this._d.type; }
    get state(){ return this._d.state; }
    get connection(){ return this._c; }
    open(){ if(this._c==='closed'){ this._c=this._d.state==='connected'?'open':'pending'; changed(this); } return Promise.resolve(this); }
    close(){ if(this._c!=='closed'){ this._c='closed'; changed(this); } return Promise.resolve(this); }
  }
  onProp(MIDIPort.prototype,'statechange');
  class MIDIInput extends MIDIPort {
    addEventListener(t,l,o){ super.addEventListener(t,l,o); if(t==='midimessage' && l) this.open(); }
  }
  onProp(MIDIInput.prototype,'midimessage',function(){ this.open(); });

  // a byte list made of whole MIDI messages, as MIDIOutput.send wants it
  function check(a){
    let i=0;
    while(i<a.length){
      const s=a[i];
      if(s<0x80) throw new TypeError('MIDIOutput.send: byte '+i+' is not a status byte (running status is not allowed).');
      if(s===0xF0){
        if(!S.sysex) throw new DOMException('System exclusive needs requestMIDIAccess({sysex:true}).','InvalidAccessError');
        let j=i+1; while(j<a.length && a[j]<0x80) j++;
        if(j>=a.length || a[j]!==0xF7) throw new TypeError('MIDIOutput.send: a system exclusive message does not end with F7.');
        i=j+1; continue;
      }
      if(s===0xF7) throw new TypeError('MIDIOutput.send: F7 without a system exclusive message before it.');
      const n=s>=0xF4?0:(s===0xF1||s===0xF3)?1:s===0xF2?2:((s&0xF0)===0xC0||(s&0xF0)===0xD0)?1:2;
      for(let k=1;k<=n;k++) if(i+k>=a.length || a[i+k]>=0x80) throw new TypeError('MIDIOutput.send: a message is cut short at byte '+(i+k)+'.');
      i+=1+n;
    }
  }
  class MIDIOutput extends MIDIPort {
    send(data,ts){
      const a=Array.from(data||[],x=>{ const n=Number(x); if(!(n>=0 && n<=255) || n!==Math.floor(n)) throw new TypeError('MIDIOutput.send: '+x+' is not a byte.'); return n; });
      check(a);
      if(this._d.state!=='connected') throw new DOMException('The MIDI output '+(this.name||this.id)+' is not connected.','InvalidStateError');
      if(this._c!=='open') this.open();
      if(!a.length) return;
      const delay=(typeof ts==='number' && ts>0)?Math.max(0,ts-performance.now()):0;
      post('send',{id:this.id,data:a,delay});
    }
    clear(){}
  }
  class MIDIAccess extends EventTarget {
    constructor(){ super(); this._i=new Map(); this._o=new Map(); }
    get inputs(){ return this._i; }
    get outputs(){ return this._o; }
    get sysexEnabled(){ return S.sysex; }
  }
  onProp(MIDIAccess.prototype,'statechange');

  // the ports the app lists now: new ones appear, missing ones turn disconnected (and come back with the same id)
  function applyPorts(list,quiet){
    if(!access) return;
    const seen=new Set();
    for(const d of (Array.isArray(list)?list:[])){
      if(!d || typeof d.id!=='string' || (d.type!=='input' && d.type!=='output')) continue;
      seen.add(d.id);
      const nd={id:d.id,type:d.type,name:String(d.name||''),manufacturer:String(d.manufacturer||''),version:String(d.version||''),state:'connected'};
      let p=ports.get(d.id);
      if(!p){ p=d.type==='input'?new MIDIInput(nd):new MIDIOutput(nd); ports.set(d.id,p); (d.type==='input'?access._i:access._o).set(d.id,p); if(!quiet) changed(p); continue; }
      const was=p._d.state; p._d=nd;
      if(was!=='connected'){ if(p._c==='pending') p._c='open'; if(!quiet) changed(p); }
    }
    for(const p of ports.values()) if(!seen.has(p.id) && p._d.state==='connected'){
      p._d=Object.assign({},p._d,{state:'disconnected'}); if(p._c==='open') p._c='pending'; changed(p); }
  }
  // MIDI from the app: [[portId, byte, byte, ...], ...]
  function rx(batch){
    if(!Array.isArray(batch)) return;
    for(const m of batch){
      if(!Array.isArray(m) || m.length<2) continue;
      const p=ports.get(m[0]); if(!p || p.type!=='input' || p._c!=='open') continue;
      if(m[1]===0xF0 && !S.sysex) continue;
      const data=new Uint8Array(m.length-1); for(let k=1;k<m.length;k++) data[k-1]=m[k];
      p.dispatchEvent(new MIDIMessageEvent('midimessage',{data}));
    }
  }
  function requestMIDIAccess(opts){
    if(opts && opts.sysex) S.sysex=true;      // only CRGT runs in this app: nothing to ask
    if(access) return Promise.resolve(access);
    if(opening) return opening;
    opening=call('midi',{sysex:S.sysex}).then(r=>{
      access=new MIDIAccess(); applyPorts(r && r.ports,true); opening=null; last=r||null; return access;
    },err=>{ opening=null; throw new DOMException('MIDI could not start on this iPad'+(err?': '+(err.message||err):'')+'.','NotSupportedError'); });
    return opening;
  }
  Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,writable:true,value:requestMIDIAccess});
  // MIDI needs no permission here
  try{ const P=navigator.permissions;
    if(P && typeof P.query==='function'){ const q=P.query.bind(P);
      Object.defineProperty(P,'query',{configurable:true,writable:true,value:d=>(d && d.name==='midi')?Promise.resolve(Object.assign(new EventTarget(),{name:'midi',state:'granted',onchange:null})):q(d)}); } }catch(e){}

  const host={
    name:'CRGT Host', version:String(INFO.version||''), build:String(INFO.build||''),
    status:()=>call('status'),                                        // {network:{on,name,peers}, virtual, inputs, outputs, page, update}
    bluetooth:mode=>call('bluetooth',{mode:mode==='peripheral'?'peripheral':'central'}),
    network:on=>call('network',{on:!!on}),                           // the Wi-Fi network session, for a Mac's Audio MIDI Setup
    reload:()=>call('reload'),                                        // into the newest CRGT kept by the app
    checkUpdate:()=>call('update'),
    updateReady:()=>upd,                                              // {version} once a newer CRGT is downloaded
    lastStatus:()=>last
  };
  Object.defineProperty(window,'CRGT_HOST',{value:Object.freeze(host),configurable:false,writable:false,enumerable:false});
  const fire=(t,d)=>{ try{ window.dispatchEvent(new CustomEvent(t,{detail:d})); }catch(e){} };
  Object.defineProperty(window,'__crgtHost',{configurable:false,writable:false,enumerable:false,value:Object.freeze({
    rx,
    ports:r=>{ last=r||null; applyPorts(r && r.ports,false); fire('crgthoststatus',r||{}); },
    status:r=>{ last=Object.assign({},last||{},r||{}); fire('crgthoststatus',last); },
    update:d=>{ upd=d||{}; fire('crgthostupdate',upd); }
  })});
})();
