'use strict';
// A game as the screen sees it (SPEC §10): lobby → stage (countdown, play) → over (stage clear,
// stage lost, all clear, or the versus result) → next stage / retry / rematch. Used directly for
// solo play and by the room host; a guest runs a mirror (role 'guest') that follows the host's events.
//
//   phase: 'lobby' | 'count' | 'play' | 'over'
const C=require('./config.cjs'),Sim=require('./sim.cjs'),AI=require('./ai.cjs'),R=require('./rng.cjs');

function create({role='solo',mySlot=0,mode='coop',startStage=1,arena=0,cpuLevel=1,seed=(Math.random()*1e9)>>>0,playMs=C.VERSUS.playMs}={}){
  return {role,mySlot,mode,startStage,arena,cpuLevel,playMs,seed,rng:R.rng(seed),roster:[],world:null,stage:0,phase:'lobby',
    enemyBrains:{},playerBrains:{},out:[],result:null,totals:{}};
}
// Co-op: only the people who came (1–4). Versus: always 2v2, empty seats are computer players.
function fillBots(humans,{mode='coop'}={}){
  const list=humans.map(h=>({...h,kind:'human'}));
  if(mode==='versus'){const taken=new Set(list.map(h=>h.slot));for(let slot=0;slot<4;slot++)if(!taken.has(slot))list.push({slot,kind:'bot',owner:'local',name:'电脑'+(slot+1)});}
  return list.sort((a,b)=>a.slot-b.slot);
}
function setRoster(g,list){g.roster=list.map(r=>({...r,team:g.mode==='versus'?C.teamOfSlot(r.slot):0}));}
const ownerOf=(g,r)=>r.owner||(r.slot===g.mySlot||r.kind==='bot'?'local':'remote');
function startGame(g){g.totals={};g.result=null;startStage(g,g.mode==='versus'?0:g.startStage,{});}
function startStage(g,no,carry){
  g.stage=no;g.enemyBrains={};g.playerBrains={};g.result=null;
  const seed=(g.rng()*4294967296)>>>0;
  g.world=Sim.createWorld({mode:g.mode,stage:no,arena:g.arena,seed,cpuLevel:g.cpuLevel,playMs:g.playMs,carry,authority:g.role!=='guest',
    roster:g.roster.map(r=>({slot:r.slot,team:r.team,kind:r.kind,owner:ownerOf(g,r),name:r.name}))});
  for(const r of g.roster)if(r.kind==='bot')g.playerBrains[r.slot]=AI.create(g.cpuLevel,seed+r.slot,'player');
  g.phase='count';
  if(g.role!=='guest')g.out.push({type:'stage',no,mode:g.mode,arena:g.arena,seed,cpu:g.cpuLevel,playMs:g.playMs,carry,
    roster:g.roster.map(r=>({slot:r.slot,kind:r.kind,name:r.name,signature:r.signature||''}))});
}
// Host / solo: what comes after the over screen.
function next(g){
  const r=g.result;if(!r||g.role==='guest')return;
  if(r.kind==='clear'&&!r.allClear){
    const carry={};for(const [slot,c] of Object.entries(r.carry||{}))carry[slot]=c.lives>0?c:{lives:C.PLAYER.lives,stars:0};
    startStage(g,g.stage+1,carry);
  }else if(r.kind==='fail')startStage(g,g.stage,{});
  else startGame(g);
}
// A seat whose player left becomes a computer player (host / solo).
function takeOver(g,slot){
  const r=g.roster.find(x=>x.slot===slot);if(!r)return;r.kind='bot';r.owner='local';r.name=(r.name||'玩家')+'（电脑接管）';
  const p=g.world&&Sim.player(g.world,slot);if(p){p.kind='bot';p.owner='local';g.playerBrains[slot]=AI.create(g.cpuLevel,g.world.seed+slot,'player');}
  g.out.push({type:'takeover',slot,name:r.name});
}
// input: {dx, dy, fire} for this machine's own tank. Everything that happened is appended to
// g.out (the host broadcasts it, solo play shows it); the events of this step are returned.
function step(g,dt,input={dx:0,dy:0}){
  const from=g.out.length,w=g.world,mine=()=>g.out.slice(from);
  if(!w||g.phase==='lobby'||g.phase==='over')return mine();
  const inputs={};
  if(g.phase==='play'&&Sim.player(w,g.mySlot))inputs[g.mySlot]=input;
  const enemyInputs={};
  if(g.role!=='guest'&&g.phase==='play'){
    for(const p of w.players)if(p.kind==='bot')inputs[p.slot]=AI.playerInput(w,p,g.playerBrains[p.slot]||(g.playerBrains[p.slot]=AI.create(g.cpuLevel,w.seed+p.slot,'player')));
    for(const e of w.enemies)enemyInputs[e.id]=AI.enemyInput(w,e,g.enemyBrains[e.id]||(g.enemyBrains[e.id]=AI.create(g.cpuLevel,w.seed*31+e.id)));
  }
  const events=Sim.step(w,dt,inputs,enemyInputs);
  if(w.t>=0&&g.phase==='count')g.phase='play';
  if(g.role!=='guest'&&w.result&&g.phase==='play')finish(g,w.result);
  for(const e of events)g.out.push(e);
  return mine();
}
// Host / solo: the stage just ended. The same result object rides in this step's 'end' event.
function finish(g,r){
  r.stage=g.stage;r.mode=g.mode;
  for(const s of r.stats){const t=g.totals[s.slot]||(g.totals[s.slot]={slot:s.slot,name:s.name,team:s.team,normal:0,fast:0,rapid:0,armor:0,items:0,deaths:0,kills:0});for(const k of ['normal','fast','rapid','armor','items','deaths','kills'])t[k]+=s[k];t.name=s.name;}
  r.allClear=r.kind==='clear'&&g.stage>=C.STAGES;r.totals=Object.values(g.totals);
  g.result=r;g.phase='over';
}
// Host: a guest asked for something.
function request(g,slot,e){
  const w=g.world;if(!w||g.phase!=='play')return;const p=Sim.player(w,slot);if(!p)return;
  if(e.type==='req-fire'){
    const t=Math.max(w.t-300,Math.min(w.t,+e.t||w.t)),x=+e.x,y=+e.y;
    // The origin must be near where the host last saw that tank.
    const ok=Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-p.x)+Math.abs(y-p.y)<1.5&&[0,1,2,3].includes(e.dir);
    const b=ok&&Sim.fire(w,p,{t,x,y,dir:e.dir,localId:e.localId});
    if(!b)g.out.push({type:'reject',owner:slot,localId:e.localId});
    g.out.push(...w.out.splice(0));
  }else if(e.type==='req-hit'){if(Sim.claimHit(w,slot,e.id,e.life))g.out.push(...w.out.splice(0));}
}
// Guest: the host's events.
function receive(g,e){
  if(e.type==='stage'){
    g.mode=e.mode;g.arena=e.arena;g.cpuLevel=e.cpu;g.playMs=e.playMs;
    g.roster=e.roster.map(r=>({...r,team:g.mode==='versus'?C.teamOfSlot(r.slot):0,owner:r.slot===g.mySlot?'local':'remote'}));
    g.stage=e.no;g.result=null;g.enemyBrains={};g.playerBrains={};
    g.world=Sim.createWorld({mode:e.mode,stage:e.no,arena:e.arena,seed:e.seed,cpuLevel:e.cpu,playMs:e.playMs,carry:e.carry||{},authority:false,
      roster:g.roster.map(r=>({slot:r.slot,team:r.team,kind:r.kind,owner:r.owner,name:r.name}))});
    g.phase='count';return;
  }
  if(e.type==='takeover'){const r=g.roster.find(x=>x.slot===e.slot);if(r){r.kind='bot';r.name=e.name;}const p=g.world&&Sim.player(g.world,e.slot);if(p)p.kind='bot';return;}
  const w=g.world;if(!w)return;
  if(e.type==='reject'){if(e.owner===g.mySlot)Sim.apply(w,e);return;}
  Sim.apply(w,e);
  if(e.type==='end'){g.result=e.result;g.phase='over';}
}
module.exports={create,fillBots,setRoster,startGame,startStage,next,takeOver,step,request,receive};
