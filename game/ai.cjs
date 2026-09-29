'use strict';
// Computer tanks (SPEC §8). Two kinds of brain, both giving the same {dx, dy, fire} a keyboard
// gives, and both reading only what a player could see (no tanks hidden in the rug):
//   enemy  — co-op attackers: head for the snack jar, turn on players nearby, shoot through
//            bricks in the way; the level sets how often they fire and how straight they go
//   player — computer players (versus seats, and co-op seats whose player left): in versus they
//            attack the other team's jar, in co-op they hunt enemies; they never shoot their own
//            jar or a teammate standing in the line of fire
const C=require('./config.cjs'),Sim=require('./sim.cjs'),Nav=require('./nav.cjs'),R=require('./rng.cjs');
const {T,BW,TANK}=C;
const LEVELS=[
  // aim: chance per frame (60 Hz) to look down all four lines for a player or the jar
  {name:'简单',think:[800,1600],fire:[2400,4000],base:0.3,hunt:0.1,aim:0.002},
  {name:'普通',think:[500,1100],fire:[1600,2800],base:0.45,hunt:0.2,aim:0.006},
  {name:'困难',think:[300,700],fire:[1000,1900],base:0.6,hunt:0.3,aim:0.015},
];
const DXY=[[0,-1],[1,0],[0,1],[-1,0]];
const between=(rng,[a,b])=>a+rng()*(b-a);
const aligned=v=>Math.abs(v*2-Math.round(v*2))<0.08;

// Route fields, cached per terrain version (the host's terrain only changes through shots).
function baseField(w,team){
  const k='base'+team;w._nav=w._nav||{};const c=w._nav[k];if(c&&c.v===w.version)return c.f;
  const base=w.bases.find(b=>b.team===team);if(!base)return null;
  const f=Nav.field(w.terrain,Nav.baseTargets(w.terrain,base));w._nav[k]={v:w.version,f};return f;
}
function towards(w,x,y){return Nav.field(w.terrain,[Nav.nearestNode(x,y)]);}

// What a bullet fired from (x, y) along dir meets first: {kind:'brick'|'steel'|'base'|'edge'|'tank', tank, team, dist}.
function lineOfFire(w,x,y,dir,self){
  const [dx,dy]=DXY[dir];
  for(let d=0.4;d<30;d+=0.25){
    const px=x+dx*d,py=y+dy*d;if(px<0||py<0||px>C.W||py>C.H)return {kind:'edge',dist:d};
    for(const t of Sim.tanks(w))if(t!==self&&Math.abs(t.x-px)<TANK.half+0.1&&Math.abs(t.y-py)<TANK.half+0.1)return {kind:'tank',tank:t,dist:d};
    for(const i of Sim.bricksIn(px,py,0.12,0.12)){const v=w.terrain[i];
      if(v===T.brick)return {kind:'brick',dist:d};if(v===T.steel)return {kind:'steel',dist:d};
      if(v===T.base||v===T.wreck){const b=w.bases.find(b=>Math.abs(b.x-px)<1&&Math.abs(b.y-py)<1);return {kind:'base',team:b?b.team:-1,dist:d};}}
  }
  return {kind:'edge',dist:30};
}
const seen=(w,t,side)=>Sim.visibility(w,t,side)!=='hidden';
function nearest(list,x,y){let best=null,bd=Infinity;for(const t of list){const d=Math.abs(t.x-x)+Math.abs(t.y-y);if(d<bd){bd=d;best=t;}}return best;}
// A direction whose line of fire meets `ok` (a tank or base we want), or -1.
function aimAt(w,t,ok){for(let d=0;d<4;d++){const hit=lineOfFire(w,t.x,t.y,d,t);if(ok(hit))return d;}return -1;}

function create(level=1,seed=1,kind='enemy'){return {L:LEVELS[Math.max(0,Math.min(2,level))],kind,rng:R.rng(seed),dir:2,next:0,fireAt:0,mode:'base',last:null,stuckMs:0,wander:0,goal:null,goalAt:0};}

// One frame of input for enemy `e` (host only).
function enemyInput(w,e,brain){
  const L=brain.L,rng=brain.rng,out={dx:0,dy:0,fire:false};
  // Aim: a visible player or the jar straight ahead → turn and shoot.
  if(rng()<L.aim){
    const d=aimAt(w,e,h=>(h.kind==='tank'&&h.tank.slot!==undefined&&h.tank.alive&&seen(w,h.tank,'e'))||h.kind==='base');
    if(d>=0){brain.dir=d;out.fire=true;}
  }
  if(w.t>=brain.next&&(aligned(e.x)&&aligned(e.y)||brain.stuckMs>250)){
    brain.next=w.t+between(rng,L.think);
    const r=rng();
    if(brain.stuckMs>250||brain.wander>0){brain.dir=Math.floor(rng()*4);brain.wander=0;out.fire=true;}
    else if(r<L.base){const f=baseField(w,0);const d=f&&Nav.nextDir(f,e.x,e.y);if(d!==null&&d!==undefined)brain.dir=d;}
    else if(r<L.base+L.hunt){const p=nearest(w.players.filter(p=>p.alive&&seen(w,p,'e')),e.x,e.y);if(p){const d=Nav.nextDir(towards(w,p.x,p.y),e.x,e.y);if(d!==null)brain.dir=d;}}
    else brain.dir=Math.floor(rng()*4);
  }
  // Bricks right ahead on the way: shoot them.
  const ahead=lineOfFire(w,e.x,e.y,brain.dir,e);if(ahead.kind==='brick'&&ahead.dist<1.2)out.fire=true;
  if(w.t>=brain.fireAt){brain.fireAt=w.t+between(rng,L.fire);out.fire=true;}
  [out.dx,out.dy]=DXY[brain.dir];
  track(brain,e);return out;
}
function track(brain,t){
  const moved=brain.last?Math.abs(t.x-brain.last.x)+Math.abs(t.y-brain.last.y):1;
  brain.stuckMs=moved<0.005?brain.stuckMs+1000/60:0;brain.last={x:t.x,y:t.y};
}

// One frame of input for computer player `p`.
function playerInput(w,p,brain){
  const L=brain.L,rng=brain.rng,out={dx:0,dy:0,fire:false};
  if(!p.alive||w.t<0)return out;
  const side=Sim.sideOfTank(w,p);
  const foes=w.mode==='versus'?w.players.filter(q=>q.alive&&q.team!==p.team&&seen(w,q,side)):w.enemies.filter(e=>seen(w,e,side));
  const safe=h=>!(h.kind==='base'&&h.team===p.team)&&!(h.kind==='tank'&&h.tank.slot!==undefined&&(w.mode==='coop'||h.tank.team===p.team));
  // Shoot what we want straight ahead in any direction.
  const want=h=>(h.kind==='tank'&&foes.includes(h.tank))||(w.mode==='versus'&&h.kind==='base'&&h.team!==p.team);
  if(rng()<0.25+L.aim*0.3){const d=aimAt(w,p,want);if(d>=0){brain.dir=d;out.fire=true;}}
  if(w.t>=brain.next&&(aligned(p.x)&&aligned(p.y)||brain.stuckMs>250)){
    brain.next=w.t+between(rng,L.think)*0.6;
    if(brain.stuckMs>250){brain.dir=Math.floor(rng()*4);}
    else{
      let f=null;
      if(w.mode==='versus')f=baseField(w,1-p.team);
      else{const e=nearest(foes,p.x,p.y);if(e){if(!brain.goal||w.t>=brain.goalAt){brain.goal=towards(w,e.x,e.y);brain.goalAt=w.t+700;}f=brain.goal;}
        else{const base=w.bases[0];f=towards(w,base.x-2,base.y-2.5);}}
      const d=f&&Nav.nextDir(f,p.x,p.y);if(d!==null&&d!==undefined)brain.dir=d;
    }
  }
  const ahead=lineOfFire(w,p.x,p.y,brain.dir,p);
  if(ahead.kind==='brick'&&ahead.dist<1.2)out.fire=true;
  if(out.fire&&!safe(ahead))out.fire=false;
  [out.dx,out.dy]=DXY[brain.dir];
  track(brain,p);return out;
}
module.exports={LEVELS,create,enemyInput,playerInput,lineOfFire,baseField};
