'use strict';
// LAN room (SPEC §11) over the strict fake host from pet-kit (vendor/pet-kit/testing): one host
// and two guests, each running its own copy of the game with real timers; every human is driven
// by the computer-player brain through the same keyboard-like inputs a person gives.
const test=require('node:test'),assert=require('node:assert/strict');
const {createHub}=require('../vendor/pet-kit/testing/fake-sessions.cjs');
const Net=require('../game/net.js'),Sim=require('../game/sim.cjs'),AI=require('../game/ai.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,ms=5000){const until=Date.now()+ms;while(Date.now()<until){if(fn())return;await sleep(30);}throw Error('timeout: '+label);}
const PROTOCOL={id:'pet-tank',version:1};

function player(sdk,name,{seed=1,look=null,drive=null,playMs=null}={}){
  const errors=[],feed=[],assets=new Map(),seen=[],hashes={};
  let brain=null,world=null;
  const lan=Net.create(sdk,{strict:true,playMs,onAsset:(sig,a)=>assets.set(sig,a),onError:e=>errors.push(e.message),
    onFeed:e=>{feed.push(e);const w=lan.game?.world;
      if(e.type==='fire'&&w&&e.by.p!==undefined&&e.by.p!==lan.mySlot()&&e.localId===undefined)seen.push(w.t-e.t0);
      if(e.type==='end'&&w)hashes[lan.game.stage]=Sim.hash(w.terrain);}});
  const tick=setInterval(()=>{try{
    const w=lan.game?.world;let input={dx:0,dy:0};
    if(w&&drive)input=drive(w,lan)||input;
    else if(w){if(w!==world){world=w;brain=AI.create(2,seed*100+(lan.game.stage||0),'player');}const me=Sim.player(w,lan.mySlot());if(me&&me.alive&&w.t>=0)input=AI.playerInput(w,me,brain);}
    lan.step(1000/60,input);
  }catch(e){errors.push(e.stack);}},1000/60);
  return {lan,errors,feed,assets,seen,hashes,name,stop(){clearInterval(tick);lan.dispose();},
    start:()=>lan.start({name,signature:'toy:'+name,kind:'toy'},look)};
}
const pct=(a,q)=>{const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
const hitsOn=(feed,slot)=>feed.filter(e=>e.type==='die'&&e.slot===slot).length;

test('host + 2 guests play a stage and end with the same terrain and table',{timeout:300000},async()=>{
  const hub=createHub({latency:[5,45],loss:0.03,protocol:PROTOCOL});
  const look=n=>({kind:'toy',species:'cat',color:'#ff8a3d',n});
  const Hs=player(hub.host(),'房主',{seed:1,look:look(1)}),A=player(hub.guest(),'客人甲',{seed:2,look:look(2)}),B=player(hub.guest(),'客人乙',{seed:3,look:look(3)});
  const all=[Hs,A,B];
  try{
    for(const p of all)await p.start();
    await waitFor(()=>all.every(p=>p.lan.lobby().players.length===3),'three humans in every lobby');
    await waitFor(()=>A.assets.size===2&&B.assets.size===2&&Hs.assets.size===2,'looks relayed in the lobby',8000);
    Hs.lan.setSettings({mode:'coop',stage:1,cpu:0});await sleep(400);assert.equal(Hs.lan.phase(),'lobby','nobody ready → no start');
    for(const p of all)p.lan.setReady(true);
    await waitFor(()=>all.every(p=>['count','play'].includes(p.lan.phase())),'the stage on every screen',6000);
    assert.equal(Hs.lan.game.roster.length,3,'co-op: only the people who came');
    const transfers=hub.stats.transfers;
    let maxBytes=0;const sampler=setInterval(()=>{for(const s of [1,2]){const b=Hs.lan.stats().bySlot[s]?.bytesPerSec||0;if(Hs.lan.phase()==='play')maxBytes=Math.max(maxBytes,b);}},1000);
    await waitFor(()=>all.every(p=>p.lan.phase()==='over'),'the stage ends everywhere',240000);
    clearInterval(sampler);await sleep(800);
    const r=Hs.lan.result();assert.ok(r&&['clear','fail'].includes(r.kind),'host has a result: '+r?.kind);
    for(const g of [A,B])assert.deepEqual(g.lan.result(),r,g.name+' agrees on the result and the table');
    for(const g of [A,B])assert.equal(g.hashes[1],Hs.hashes[1],g.name+' ends with the host\'s terrain');
    const seen=[...A.seen,...B.seen];assert.ok(seen.length>10,'others\' bullets seen: '+seen.length);
    assert.ok(pct(seen,0.95)<=150,'others\' bullets show up within 150 ms (p95 '+pct(seen,0.95)+' ms)');
    assert.ok(maxBytes>0&&maxBytes<=12*1024,'bytes per guest '+maxBytes+' B/s');
    assert.equal(hub.stats.transfers,transfers,'no look transfers during the stage');
    assert.equal(hub.stats.backpressure,0,'no send refused by the host');
    for(const p of all)assert.deepEqual(p.errors,[],p.name+' errors');
    // Lives on every screen agree with the host (deaths were judged by whoever was hit).
    for(const s of [0,1,2])for(const g of [A,B])assert.equal(hitsOn(g.feed,s),hitsOn(Hs.feed,s),'deaths of slot '+s+' on '+g.name);
    console.log('result',r.kind,r.why||'','killed',r.stats.map(s=>s.normal+s.fast+s.rapid+s.armor).join('/'),'deaths',r.stats.map(s=>s.deaths).join('/'),'seen p95',pct(seen,0.95),'bytes/guest',maxBytes,'hub',JSON.stringify({sent:hub.stats.sent,dropped:hub.stats.dropped,resync:hub.stats.resync}));
  }finally{all.forEach(p=>p.stop());}
});

test('state age p95 stays under 150 ms on a 1 Mbps / 100 ms link',{timeout:60000},async()=>{
  const hub=createHub({latency:[45,55],bandwidth:125000,protocol:PROTOCOL});
  const Hs=player(hub.host(),'房主'),A=player(hub.guest(),'客人甲',{seed:2});
  try{
    await Hs.start();await A.start();await waitFor(()=>Hs.lan.lobby().players.length===2,'lobby');
    Hs.lan.setReady(true);A.lan.setReady(true);
    await waitFor(()=>A.lan.phase()==='play','play',6000);await sleep(8000);
    const age=A.lan.stats().bySlot[0].stateAgeP95;assert.ok(age<=150,'state age p95 '+age+' ms');
  }finally{Hs.stop();A.stop();}
});

test('a guest leaving is taken over by a computer; the host leaving ends the room',{timeout:60000},async()=>{
  const hub=createHub({latency:[5,30],protocol:PROTOCOL});
  const Hs=player(hub.host(),'房主'),A=player(hub.guest(),'客人甲',{seed:2}),B=player(hub.guest(),'客人乙',{seed:3});
  try{
    for(const p of [Hs,A,B])await p.start();await waitFor(()=>Hs.lan.lobby().players.length===3,'lobby');
    for(const p of [Hs,A,B])p.lan.setReady(true);
    await waitFor(()=>B.lan.phase()==='play','play',8000);
    const slotA=A.lan.mySlot();await A.lan.leave();
    await waitFor(()=>Hs.lan.game.roster.find(r=>r.slot===slotA)?.kind==='bot','host: a computer takes the seat',4000);
    await waitFor(()=>B.lan.game.roster.find(r=>r.slot===slotA)?.kind==='bot','guest B sees the takeover',4000);
    // The computer really drives that tank.
    const p=Sim.player(Hs.lan.game.world,slotA),x0=p.x,y0=p.y;await sleep(1500);
    assert.ok(!p.alive||Math.abs(p.x-x0)+Math.abs(p.y-y0)>0.3,'the taken-over tank moves');
    assert.ok(['play','over'].includes(Hs.lan.phase()),'the stage continues');
    await Hs.lan.leave();await waitFor(()=>B.lan.phase()==='closed','the host leaving closes the room',4000);
  }finally{[Hs,A,B].forEach(p=>p.stop());}
});

test('a shot a guest dodged on its own screen does not hit it; a shot that lands kills it everywhere',{timeout:60000},async()=>{
  const hub=createHub({latency:[90,110],protocol:PROTOCOL});
  let dodge=false;
  const Hs=player(hub.host(),'房主',{drive:()=>({dx:0,dy:0})}),A=player(hub.guest(),'客人甲',{drive:(w,lan)=>dodge?{dx:0,dy:1}:{dx:0,dy:0}});
  try{
    await Hs.start();await A.start();await waitFor(()=>Hs.lan.lobby().players.length===2,'lobby');
    Hs.lan.setSettings({mode:'versus',arena:0});await sleep(300);
    Hs.lan.setReady(true);A.lan.setReady(true);await waitFor(()=>A.lan.phase()==='play'&&Hs.lan.phase()==='play','play',8000);
    const slot=A.lan.mySlot(),hw=Hs.lan.game.world,aw=A.lan.game.world;assert.equal(slot,1);
    const guest=()=>Sim.player(aw,slot),onHost=()=>Sim.player(hw,slot);
    for(const p of hw.players)if(p.kind==='bot')p.kind='idle';          // fixture: the two computer seats sit still
    await waitFor(()=>aw.t>2200&&hw.t>2200,'spawn shields gone',4000);
    // Precondition (fixture): the guest at the end of the open top row, the host tank 12 cells away facing it.
    const hp=Sim.player(hw,0),line=async()=>{Object.assign(guest(),{x:17.5,y:0.5,dir:3});Object.assign(hp,{x:5.5,y:0.5,dir:1});await sleep(500);};
    const shoot=()=>{Sim.fire(hw,hp);Hs.lan.game.out.push(...hw.out.splice(0));};
    // 1. Fire, then the guest drives out of the row just before the bullet reaches it on its own
    //    screen: the bullet reaches it ≈1.37 s after the shot, the guest starts ≈1.09 s and is
    //    clear 0.2 s later. The host shows the guest ≈160 ms behind, still in the row when the
    //    bullet passes — judged by the host this would be a hit (checked by a control run).
    await line();shoot();await sleep(1075);dodge=true;await sleep(1500);dodge=false;
assert.equal(hitsOn(Hs.feed,slot),0,'dodged on its own screen → not hit');assert.equal(onHost().alive,true);
    // 2. The guest stands still in the line of fire: hit, judged by the guest, dead everywhere.
    await line();shoot();
    await waitFor(()=>hitsOn(Hs.feed,slot)===1&&hitsOn(A.feed,slot)===1,'the hit reaches both screens',3000);
    assert.equal(onHost().alive,false);assert.equal(guest().alive,false);
    assert.deepEqual(Hs.errors,[]);assert.deepEqual(A.errors,[]);
  }finally{Hs.stop();A.stop();}
});
