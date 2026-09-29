'use strict';
// LAN room for the tank game (SPEC §11) on top of pet-kit: seats, lobby, events, state stream,
// looks and budgets come from the kit; this file only decides what the state carries and who
// is authoritative for what.
//
//   host → guests (state, 20 Hz): phase, stage, stage clock, every tank (players and enemies),
//                                  lives and stars, a terrain hash every 2 s
//   guest → host  (state, 20 Hz): its own tank on its own stage clock
//   host → guests (events): stage, fire, hit, dmg, kill, die, spawn, freeze, shielded, enemy,
//                            warn, item, itemgone, pick, stars, shield, lives, clock, tape,
//                            untape, base, end, takeover, reject, grid
//   guest → host  (events): req-fire, req-hit, req-grid
const {Room}=require('../vendor/pet-kit/index.js');
const Game=require('./game.cjs'),Sim=require('./sim.cjs'),C=require('./config.cjs');

const PROTOCOL={id:'pet-tank',version:1},PURPOSE='tank.look.v1';
const INTERP_MS=110,EXTRAP_MS=100,HASH_MS=2000;
const SETTINGS={defaults:{mode:'coop',stage:1,arena:0,cpu:1},
  validate:v=>({mode:C.MODES.includes(v.mode)?v.mode:'coop',stage:Number.isInteger(v.stage)&&v.stage>=1&&v.stage<=C.STAGES?v.stage:1,arena:[0,1].includes(v.arena)?v.arena:0,cpu:[0,1,2].includes(v.cpu)?v.cpu:1})};
const r2=v=>Math.round(v*100);
const flags=(w,p)=>(p.alive?1:0)|(w.t<p.shieldUntil?2:0)|(w.t<p.frozenUntil?4:0);
const packPlayer=(w,p)=>[p.slot,r2(p.x),r2(p.y),p.dir,p.moving?1:0,p.lives,p.stars,flags(w,p)];
const packEnemy=e=>[e.id,r2(e.x),r2(e.y),e.dir,e.moving?1:0,e.hp];

function create(sdk,{onLobby=()=>{},onAsset=()=>{},onConnection=()=>{},onClosed=()=>{},onError=()=>{},onFeed=()=>{},now=()=>Date.now(),strict=false,budgetBytes=12*1024,playMs=null}={}){
  let game=null,host=false,mySlot=null,lastHash=0,hashMiss=0,remote={ph:'lobby',no:0};
  const interp=new Map(),budget=[];
  // Remote tanks are shown INTERP_MS behind, on the stage clock the sender stamped.
  function pushInterp(key,s,t){
    if(!Number.isFinite(t))return;const buf=interp.get(key)||[];const last=buf[buf.length-1];
    if(last&&t<=last.t)return;
    if(last&&Math.hypot(last.s.x-s.x,last.s.y-s.y)>2.5)buf.length=0; // respawned / teleported
    buf.push({t,s});while(buf.length>16)buf.shift();interp.set(key,buf);
  }
  function sample(key,t){
    const buf=interp.get(key);if(!buf?.length)return null;
    let i=buf.length-1;while(i>0&&buf[i-1].t>t)i--;const b=buf[i],a=i>0?buf[i-1]:null;
    let x=b.s.x,y=b.s.y;
    if(a&&a.t<=t&&b.t>=t){const k=(t-a.t)/Math.max(1,b.t-a.t);x=a.s.x+(b.s.x-a.s.x)*k;y=a.s.y+(b.s.y-a.s.y)*k;}
    else if(a&&b.t<t&&b.t-a.t>=20){const k=Math.min(EXTRAP_MS,t-b.t)/(b.t-a.t);x=b.s.x+(b.s.x-a.s.x)*k;y=b.s.y+(b.s.y-a.s.y)*k;}
    return {x:Math.max(0.48,Math.min(C.W-0.48,x)),y:Math.max(0.48,Math.min(C.H-0.48,y)),dir:b.s.d,moving:!!b.s.m,s:b.s};
  }
  function applyInterp(){
    const w=game?.world;if(!w)return;const t=w.t-INTERP_MS;
    for(const p of w.players){if(p.owner!=='remote')continue;const s=sample('p'+p.slot,t);if(!s)continue;
      p.x=s.x;p.y=s.y;p.dir=s.dir;p.moving=s.moving;
      if(!host){p.lives=s.s.l;p.stars=s.s.st;}}
    if(!host)for(const e of w.enemies){const s=sample('e'+e.id,t);if(s){e.x=s.x;e.y=s.y;e.dir=s.dir;e.moving=s.moving;e.hp=s.s.hp;}}
  }
  const feed=e=>{try{onFeed(e);}catch(err){onError(err);}};

  const room=Room.create(sdk,{protocol:PROTOCOL,purpose:PURPOSE,maxPlayers:4,now,strict,settings:SETTINGS,
    budget:{guestBytesPerSec:budgetBytes},onBudget:b=>{budget.push(b);if(budget.length>50)budget.shift();},
    hostState(){
      const w=game?.world,s={ph:game?.phase||'lobby',no:game?.stage||0,at:Math.round(room.hostNow())};
      if(w){s.t=Math.round(w.t);s.p=w.players.map(p=>packPlayer(w,p));s.e=w.enemies.map(packEnemy);
        if(now()-lastHash>=HASH_MS){lastHash=now();s.h=Sim.hash(w.terrain);}}
      return s;
    },
    guestState(){
      const w=game?.world,me=w&&Sim.player(w,mySlot);if(!me||game.phase==='lobby')return null;
      return {no:game.stage,t:Math.round(w.t),x:r2(me.x),y:r2(me.y),d:me.dir,m:me.moving?1:0,l:me.life};
    },
    onState(s,slot){
      if(host){
        const w=game?.world;if(!w||s.no!==game.stage)return;const p=Sim.player(w,slot);
        if(!p||!p.alive||s.l!==p.life)return;              // a report from before the last respawn
        pushInterp('p'+slot,{x:s.x/100,y:s.y/100,d:s.d,m:s.m},s.t);return;
      }
      remote={ph:s.ph,no:s.no};
      const w=game?.world;if(!w||s.no!==game.stage)return;
      if(Number.isFinite(s.t)){const target=s.t+(room.hostNow()-s.at);if(Math.abs(w.t-target)>80)w.t=target;else w.t+=(target-w.t)*0.1;}
      for(const [slot,x,y,d,m,l,st] of s.p||[])if(slot!==mySlot)pushInterp('p'+slot,{x:x/100,y:y/100,d,m,l,st},s.t);
        else{const me=Sim.player(w,slot);if(me){me.lives=l;me.stars=st;}}
      for(const [id,x,y,d,m,hp] of s.e||[])pushInterp('e'+id,{x:x/100,y:y/100,d,m,hp},s.t);
      if(s.h&&game.phase==='play'){if(s.h!==Sim.hash(w.terrain)){if(++hashMiss>=2){hashMiss=0;room.emit({type:'req-grid'});}}else hashMiss=0;}
    },
    onEvent(e,from){
      if(host){
        if(e.type==='req-grid'){const w=game?.world;if(w)room.emit({type:'grid',no:game.stage,terrain:Array.from(w.terrain).join('')});return;}
        if(game)Game.request(game,from,e);return;
      }
      if(!game)return;
      if(e.type==='grid'){const w=game.world;if(w&&e.no===game.stage)for(let i=0;i<w.terrain.length;i++)w.terrain[i]=+e.terrain[i];return;}
      if(e.type==='stage')interp.clear();
      if(e.type==='kill')interp.delete('e'+e.id);
      if(e.type==='spawn')interp.delete('p'+e.slot);
      Game.receive(game,e);feed(e);
    },
    onLobby:l=>onLobby(l),onAsset,onConnection,onClosed,onError,
    onPeerLeft(slot,{inMatch}){interp.delete('p'+slot);if(host&&game&&inMatch&&game.roster.some(r=>r.slot===slot))Game.takeOver(game,slot);},
  });

  function humans(){return room.lobby().players.filter(p=>!p.waiting&&p.online!==false).map(p=>({slot:p.slot,name:p.name,signature:p.signature,look:p.kind,owner:p.slot===0?'local':'remote'}));}
  function startMatch(){
    const st=room.lobby().settings;
    game=Game.create({role:'host',mySlot:0,mode:st.mode,startStage:st.stage,arena:st.arena,cpuLevel:st.cpu,...(playMs?{playMs}:{})});
    Game.setRoster(game,Game.fillBots(humans(),{mode:st.mode}));
    room.setMatch(true);room.setReady(false);Game.startGame(game);flush();
  }
  // Every event is sent on its own: one bad event never holds back the ones after it.
  function flush(){
    const list=game.out.splice(0);
    for(const e of list){
      if(e.type==='stage')interp.clear();
      if(e.type==='spawn'||e.type==='die')interp.delete('p'+e.slot); // old reports belong to the previous tank
      try{room.emit(e);}catch(err){onError(Error(err.message+' in '+JSON.stringify(e).slice(0,200)));}
      feed(e);
    }
  }
  let autoStartAt=0;
  const api={
    PROTOCOL,room,
    async start(profile,asset){
      const r=await room.start(profile,asset);host=r.role==='host';mySlot=host?0:null;
      if(!host)game=Game.create({role:'guest',mySlot:-1});
      return r;
    },
    get game(){return game;},
    isHost:()=>host,
    mySlot:()=>host?0:room.mySlot(),
    step(dt,input){
      if(!host){const s=room.mySlot();if(s!==null&&s!==mySlot){mySlot=s;if(game)game.mySlot=s;}}
      if(host&&(!game||game.phase==='lobby')){
        const l=room.lobby().players,ready=l.length>=2&&l.every(p=>p.ready||p.waiting);
        if(ready&&!autoStartAt)autoStartAt=now()+600;if(!ready)autoStartAt=0;
        if(autoStartAt&&now()>=autoStartAt){autoStartAt=0;startMatch();}
      }
      if(!game)return [];
      applyInterp();
      const out=Game.step(game,dt,input);
      if(host)flush();
      else{game.out.length=0;const w=game.world;if(w&&w.requests.length){for(const r of w.requests.splice(0))room.emit(r);}for(const e of out)feed(e);}
      return out;
    },
    phase:()=>room.connection()==='closed'?'closed':!game?'lobby':host?game.phase:remote.ph==='lobby'?'lobby':game.world?game.phase:remote.ph,
    lobby:()=>room.lobby(),
    setReady:v=>room.setReady(v),
    ready:()=>!!room.lobby().players.find(p=>p.you)?.ready,
    setSettings:s=>room.setSettings(s),
    setProfile:(p,a)=>room.setProfile(p,a),
    next(){if(host&&game){Game.next(game);room.setMatch(true);flush();}},
    toLobby(){if(host){if(game)game.phase='lobby';room.setMatch(false);}},
    result:()=>game?.result||null,
    async leave(){await room.leave();},
    dispose(){room.dispose();},
    closeReason:()=>room.closeReason(),
    stats:()=>({...room.stats(),budget:budget.slice()}),
  };
  return api;
}
module.exports={create,PROTOCOL,PURPOSE,SETTINGS};
