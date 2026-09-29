'use strict';
// One stage (co-op) or one versus game (SPEC §2–§10): driving, bullets, terrain, enemies,
// items, lives, the end.
//
// The world is authoritative on the room host (and in solo play). A guest runs it with
// `authority:false`: it drives its own tank, flies every bullet from the same origin and time,
// and shows where bullets would stop — but terrain, damage, enemies, items and the end change
// only through the host's events (`apply`). Every change an authoritative world makes is also
// pushed to `world.out`, so the host can broadcast exactly what happened.
//
// Who judges a hit: the machine that drives the tank that was hit. The host checks enemies,
// its own tank and computer players; a guest checks its own tank and reports the hit
// ('req-hit'), so a shot you dodged on your own screen never hits you (SPEC §11).
const C=require('./config.cjs'),Maps=require('./maps.cjs'),Grid=require('./rng.cjs');
const {W,H,BW,BH,T,TANK,PLAYER,BULLET,STARS,ENEMY_TYPES,STAGE,ITEM}=C;
const DX=[0,1,0,-1],DY=[-1,0,1,0],EPS=1e-6,SUB=0.1;
const TANK_BLOCK=new Set([T.brick,T.steel,T.water,T.base,T.wreck]),BULLET_BLOCK=new Set([T.brick,T.steel,T.base,T.wreck]);

// ---------------- world ----------------
// roster: [{slot, team, kind:'human'|'bot', owner:'local'|'remote', name}]
// carry: slot → {lives, stars} from the previous stage.
function createWorld({mode='coop',stage=1,arena=0,seed=1,roster=[],authority=true,carry={},cpuLevel=1,playMs=C.VERSUS.playMs}={}){
  const m=Maps.load(mode,mode==='versus'?arena:stage);
  const rng=Grid.rng(seed);
  const w={mode,stage,arena,seed,rng,authority,cpuLevel,playMs,t:-STAGE.countdownMs,terrain:m.terrain,bases:m.bases.map(b=>({...b,dead:false})),
    spawns:m.spawns,enemySpawns:m.enemySpawns,mapName:m.name,
    players:[],enemies:[],bullets:[],ended:[],nextBullet:1,nextEnemy:1,
    queue:mode==='coop'?enemyQueue(stage,rng):[],sent:0,killed:0,warn:null,spawnIdx:0,nextSpawnAt:0,
    item:null,tapeUntil:0,clockUntil:0,teamKills:[0,0],result:null,out:[],requests:[],sparks:[],version:0};
  for(const r of roster)w.players.push(createPlayer(w,r,carry[r.slot]));
  return w;
}
// The twenty enemies of a stage, shuffled by the stage seed.
function enemyQueue(stage,rng){
  const counts=C.WAVES[(stage-1)%C.WAVES.length],q=[];
  C.KINDS.forEach((k,i)=>{for(let n=0;n<counts[i];n++)q.push(k);});
  for(let i=q.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[q[i],q[j]]=[q[j],q[i]];}
  return q;
}
function createPlayer(w,{slot,team=null,kind='human',owner='local',name=''},carry){
  if(team===null)team=w.mode==='versus'?C.teamOfSlot(slot):0;
  const [x,y,dir]=w.spawns[slot];
  return {slot,team,kind,owner,name,x,y,dir,moving:false,alive:true,lives:carry?.lives??PLAYER.lives,stars:carry?.stars??0,
    shieldUntil:PLAYER.spawnShieldMs,frozenUntil:0,respawnAt:0,life:1,slide:0,lastFire:-1e9,
    stats:{normal:0,fast:0,rapid:0,armor:0,items:0,deaths:0,kills:0},checked:0};
}
const player=(w,slot)=>w.players.find(p=>p.slot===slot);
const enemy=(w,id)=>w.enemies.find(e=>e.id===id);
const emit=(w,e)=>{if(w.authority)w.out.push({...e,t:Math.round(w.t)});};
const bi=(bx,by)=>by*BW+bx;
const fieldCap=w=>Math.min(STAGE.fieldMax,STAGE.field+Math.max(0,w.players.length-1));
const speedOfEnemy=e=>ENEMY_TYPES[e.type].speed;
const dirOf=i=>i.dy<0?0:i.dx>0?1:i.dy>0?2:i.dx<0?3:-1;

// ---------------- geometry ----------------
function bricksIn(x,y,hx,hy){
  const out=[];const bx0=Math.max(0,Math.floor((x-hx)*2+EPS)),bx1=Math.min(BW-1,Math.ceil((x+hx)*2-EPS)-1);
  const by0=Math.max(0,Math.floor((y-hy)*2+EPS)),by1=Math.min(BH-1,Math.ceil((y+hy)*2-EPS)-1);
  for(let by=by0;by<=by1;by++)for(let bx=bx0;bx<=bx1;bx++)out.push(bi(bx,by));
  return out;
}
const overlap=(ax,ay,ah,bx,by,bh)=>Math.abs(ax-bx)<ah+bh-EPS&&Math.abs(ay-by)<ah+bh-EPS;
const outside=(x,y,h)=>x-h<-EPS||y-h<-EPS||x+h>W+EPS||y+h>H+EPS;
// A tank's brick under its centre (rug hides, ice slides).
const groundOf=(w,x,y)=>w.terrain[bi(Math.min(BW-1,Math.max(0,Math.floor(x*2))),Math.min(BH-1,Math.max(0,Math.floor(y*2))))];
function tanks(w){return [...w.players.filter(p=>p.alive),...w.enemies];}
function blocked(w,tank,x,y){
  const h=TANK.half;if(outside(x,y,h))return true;
  for(const i of bricksIn(x,y,h,h))if(TANK_BLOCK.has(w.terrain[i]))return true;
  // Other tanks block — unless the two already overlap (fresh spawns drive apart).
  for(const o of tanks(w)){if(o===tank)continue;if(overlap(x,y,h,o.x,o.y,h)&&!overlap(tank.x,tank.y,h,o.x,o.y,h))return true;}
  return false;
}
// Drive `dist` cells along the tank's direction; stops flush against whatever is in the way.
function advance(w,tank,dist){
  const dx=DX[tank.dir],dy=DY[tank.dir];let left=dist,moved=0;
  while(left>EPS){
    const d=Math.min(left,SUB);
    if(!blocked(w,tank,tank.x+dx*d,tank.y+dy*d)){tank.x+=dx*d;tank.y+=dy*d;left-=d;moved+=d;continue;}
    let lo=0,hi=d;for(let k=0;k<14;k++){const m=(lo+hi)/2;if(!blocked(w,tank,tank.x+dx*m,tank.y+dy*m))lo=m;else hi=m;}
    if(lo>1e-4){tank.x+=dx*lo;tank.y+=dy*lo;moved+=lo;}
    break;
  }
  return moved;
}
// One frame of driving (SPEC §2). dir −1 = no key.
function drive(w,tank,dir,speed,dt){
  const dist=speed*dt/1000;
  if(dir>=0){
    if(dir!==tank.dir){
      // A turn: line up on the nearest half cell across the new direction (a U-turn does not).
      if((dir+tank.dir)%2===1){const ax=dir%2===0?'x':'y',snap=Math.round(tank[ax]*2)/2;
        if(Math.abs(snap-tank[ax])>EPS){const old=tank[ax];tank[ax]=snap;if(blocked(w,tank,tank.x,tank.y))tank[ax]=old;}}
      tank.dir=dir;
    }
    advance(w,tank,dist);tank.moving=true;tank.slide=PLAYER.iceSlide;return;
  }
  if(tank.slide>0&&groundOf(w,tank.x,tank.y)===T.ice){const m=advance(w,tank,Math.min(tank.slide,dist));tank.slide=m>0?tank.slide-m:0;tank.moving=m>0;return;}
  tank.slide=0;tank.moving=false;
}

// ---------------- visibility (SPEC §4 rug) ----------------
const sideOfTank=(w,t)=>t.slot!==undefined?(w.mode==='versus'?'t'+t.team:'p'):'e';
const inRug=(w,t)=>groundOf(w,t.x,t.y)===T.rug;
// 'full' | 'ghost' (your own side, in the rug) | 'hidden' (the other side, in the rug)
function visibility(w,t,viewerSide){if(!inRug(w,t))return 'full';return sideOfTank(w,t)===viewerSide?'ghost':'hidden';}

// ---------------- bullets (SPEC §3, §5) ----------------
const bulletCap=p=>STARS[Math.min(3,p.stars)].max;
const liveBullets=(w,key)=>w.bullets.filter(b=>!b.done&&b.key===key);
// Fire from a tank. `at` = origin override for a guest's request (host) or a host event (guest).
function fire(w,tank,{id=null,t=w.t,x=null,y=null,dir=null,localId=null}={}){
  const isPlayer=tank.slot!==undefined,key=isPlayer?'p'+tank.slot:'e'+tank.id;
  if(isPlayer){if(!tank.alive||w.t<tank.frozenUntil||liveBullets(w,key).length>=bulletCap(tank))return null;}
  else if(liveBullets(w,key).length>=1||w.t<w.clockUntil)return null;
  const d=dir??tank.dir,ox=(x??tank.x)+DX[d]*BULLET.nose,oy=(y??tank.y)+DY[d]*BULLET.nose;
  const star=isPlayer?STARS[Math.min(3,tank.stars)]:null;
  const speed=BULLET.speed[isPlayer?star.speed:ENEMY_TYPES[tank.type].bullet],pierce=isPlayer&&star.pierce;
  const b={id:id??(w.nextBullet++),key,owner:isPlayer?{p:tank.slot}:{e:tank.id},side:sideOfTank(w,tank),team:isPlayer?tank.team:-1,
    x:ox,y:oy,x0:ox,y0:oy,t0:Math.round(t),dir:d,speed,pierce,done:false};
  if(id!==null&&id>=w.nextBullet)w.nextBullet=id+1;
  if(isPlayer)tank.lastFire=w.t;
  w.bullets.push(b);
  emit(w,{type:'fire',id:b.id,by:b.owner,x:ox,y:oy,dir:d,speed,pierce,side:b.side,team:b.team,t0:b.t0,...(localId!==null?{localId}:{})});
  // Catch up a shot fired in the past (a guest's request / a late event).
  if(w.t>b.t0)flyBullet(w,b,w.t-b.t0);else collideBullet(w,b);
  return b;
}
function flyBullet(w,b,ms){
  let left=b.speed*ms/1000;
  while(left>EPS&&!b.done){const d=Math.min(left,SUB);b.x+=DX[b.dir]*d;b.y+=DY[b.dir]*d;left-=d;collideBullet(w,b);}
}
function endBullet(w,b,what,extra={}){b.done=true;w.ended.push({b,at:w.t});w.sparks.push({x:b.x,y:b.y,t:w.t,what});if(w.authority)emit(w,{type:'hit',id:b.id,what,x:+b.x.toFixed(2),y:+b.y.toFixed(2),...extra});}
function collideBullet(w,b){
  if(b.done)return;
  const h=BULLET.half;
  if(outside(b.x,b.y,0)){endBullet(w,b,'edge');return;}
  // Terrain: the front layer across the bullet's path, half a cell wide (SPEC §4).
  const touch=bricksIn(b.x,b.y,h,h).filter(i=>BULLET_BLOCK.has(w.terrain[i]));
  if(touch.length){
    const along=b.dir%2===0,impact=bricksIn(b.x,b.y,along?0.25:h,along?h:0.25);
    const broken=[],steel=[];let base=null,stopped='steel';
    for(const i of impact){
      const t=w.terrain[i];
      if(t===T.brick){broken.push(i);stopped='brick';}
      else if(t===T.steel&&b.pierce){steel.push(i);stopped='brick';}
      else if(t===T.base&&touch.includes(i)){base=w.bases.find(q=>i===bi(q.bx,q.by)||i===bi(q.bx+1,q.by)||i===bi(q.bx,q.by+1)||i===bi(q.bx+1,q.by+1));}
    }
    if(!w.authority){endBullet(w,b,base?'base':stopped);return;}
    for(const i of [...broken,...steel])w.terrain[i]=T.floor;
    if(broken.length||steel.length)w.version++;
    endBullet(w,b,base?'base':stopped,{bricks:broken,steel});
    if(base&&!base.dead)breakBase(w,base);
    return;
  }
  // Tanks.
  for(const t of tanks(w)){
    if(b.owner.p===t.slot&&t.slot!==undefined)continue;if(b.owner.e===t.id&&t.id!==undefined)continue;
    if(b.side==='e'&&t.slot===undefined)continue;            // enemy bullets pass enemies
    if(!overlap(b.x,b.y,h,t.x,t.y,TANK.half))continue;
    if(w.authority){
      if(t.slot!==undefined&&t.owner==='remote')continue;    // a guest judges its own tank
      endBullet(w,b,'tank',{target:t.slot!==undefined?{p:t.slot}:{e:t.id}});hitTank(w,b,t);return;
    }
    endBullet(w,b,'tank');
    if(t.slot!==undefined&&t.owner==='local'&&t.alive)w.requests.push({type:'req-hit',id:b.id,life:t.life});
    return;
  }
  // Bullets from the other side cancel out.
  for(const o of w.bullets){
    if(o===b||o.done||o.side===b.side)continue;
    if(!overlap(b.x,b.y,h,o.x,o.y,h))continue;
    if(!w.authority){endBullet(w,b,'bullet');o.done=true;return;}
    o.done=true;w.ended.push({b:o,at:w.t});endBullet(w,b,'bullet',{other:o.id});return;
  }
}
function moveBullets(w,dt){
  for(const b of w.bullets.slice().sort((a,c)=>a.id-c.id))if(!b.done)flyBullet(w,b,dt);
  w.bullets=w.bullets.filter(b=>!b.done);
  w.ended=w.ended.filter(e=>w.t-e.at<800);
  w.sparks=w.sparks.filter(s=>w.t-s.t<600);
}

// ---------------- hits (SPEC §6, §7) ----------------
function breakBase(w,base){
  base.dead=true;for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]])w.terrain[bi(base.bx+dx,base.by+dy)]=T.wreck;w.version++;
  emit(w,{type:'base',team:base.team});
}
function shooter(w,b){return b.owner.p!==undefined?player(w,b.owner.p):null;}
function hitTank(w,b,t){
  if(t.slot===undefined){ // an enemy, hit by a player's bullet
    t.hp--;const by=shooter(w,b);
    if(t.hp>0){emit(w,{type:'dmg',id:t.id,hp:t.hp});return;}
    killEnemy(w,t,by,'shot');return;
  }
  if(!t.alive)return;
  const friendly=b.side!=='e'&&(w.mode==='coop'||b.team===t.team);
  if(w.t<t.shieldUntil){emit(w,{type:'shielded',slot:t.slot});return;}
  if(friendly){t.frozenUntil=Math.round(w.t+PLAYER.freezeMs);emit(w,{type:'freeze',slot:t.slot,until:t.frozenUntil,by:b.owner.p??null});return;}
  const by=shooter(w,b);if(by&&w.mode==='versus'){by.stats.kills++;w.teamKills[by.team]++;}
  killPlayer(w,t,b.owner);
}
function killEnemy(w,e,by,why){
  w.enemies=w.enemies.filter(x=>x!==e);w.killed++;
  if(by&&why==='shot')by.stats[e.type]++;
  emit(w,{type:'kill',id:e.id,by:by?by.slot:null,why,etype:e.type,x:+e.x.toFixed(2),y:+e.y.toFixed(2)});
  if(e.flash&&why==='shot')dropItem(w);
}
function killPlayer(w,p,by){
  p.alive=false;p.stars=0;p.stats.deaths++;p.moving=false;
  if(w.mode==='coop')p.lives=Math.max(0,p.lives-1);
  p.respawnAt=w.mode==='versus'||p.lives>0?Math.round(w.t+PLAYER.respawnMs):0;
  emit(w,{type:'die',slot:p.slot,by,lives:p.lives,respawnAt:p.respawnAt,x:+p.x.toFixed(2),y:+p.y.toFixed(2)});
}
function respawn(w,p){
  const [x,y,dir]=w.spawns[p.slot];
  Object.assign(p,{x,y,dir,alive:true,moving:false,slide:0,shieldUntil:Math.round(w.t+PLAYER.spawnShieldMs),frozenUntil:0,respawnAt:0,life:p.life+1});
  emit(w,{type:'spawn',slot:p.slot,x,y,dir,shieldUntil:p.shieldUntil,life:p.life});
}
// Host: a guest says a bullet hit its own tank (SPEC §11).
function claimHit(w,slot,id,life){
  const p=player(w,slot);if(!p||!p.alive||p.life!==life)return false;
  const live=w.bullets.find(b=>b.id===id&&!b.done),old=w.ended.find(e=>e.b.id===id)?.b,b=live||old;
  if(!b||b.owner.p===slot)return false;
  if(live)endBullet(w,live,'tank',{target:{p:slot}});
  hitTank(w,b,p);return true;
}

// ---------------- enemies (SPEC §8) ----------------
const SPAWN_EVERY=[3000,2200,1500];
function spawnEnemies(w){
  if(w.mode!=='coop'||w.t<0)return;
  if(w.warn&&w.t>=w.warn.at){
    const s=w.warn;
    if(tanks(w).some(o=>overlap(s.x,s.y,TANK.half,o.x,o.y,TANK.half))){w.warn=null;return;} // taken: warn again elsewhere
    const type=w.queue[w.sent],order=++w.sent;
    const e={id:w.nextEnemy++,type,x:s.x,y:s.y,dir:2,moving:false,hp:ENEMY_TYPES[type].hp,flash:STAGE.flash.includes(order),order};
    w.enemies.push(e);w.warn=null;w.nextSpawnAt=w.t+(SPAWN_EVERY[w.cpuLevel]??2200);
    emit(w,{type:'enemy',id:e.id,etype:type,x:e.x,y:e.y,flash:e.flash,order});
  }
  if(!w.warn&&w.sent<w.queue.length&&w.enemies.length<fieldCap(w)&&w.t>=w.nextSpawnAt){
    for(let k=0;k<w.enemySpawns.length;k++){
      const [x,y]=w.enemySpawns[(w.spawnIdx+k)%w.enemySpawns.length];
      if(tanks(w).some(o=>overlap(x,y,TANK.half,o.x,o.y,TANK.half)))continue;
      w.spawnIdx=(w.spawnIdx+k+1)%w.enemySpawns.length;w.warn={x,y,at:Math.round(w.t+STAGE.warnMs)};emit(w,{type:'warn',x,y,at:w.warn.at});break;
    }
  }
}

// ---------------- items (SPEC §9) ----------------
function dropItem(w){
  const spots=[];
  for(let iy=2;iy<=2*H-2;iy++)for(let ix=2;ix<=2*W-2;ix++){
    const x=ix/2,y=iy/2;if(bricksIn(x,y,0.45,0.45).every(i=>[T.floor,T.rug,T.ice].includes(w.terrain[i])))spots.push([x,y]);
  }
  if(!spots.length)return;
  const [x,y]=spots[Math.floor(w.rng()*spots.length)],kind=C.ITEMS[Math.floor(w.rng()*C.ITEMS.length)];
  w.item={kind,x,y,until:Math.round(w.t+STAGE.itemMs)};emit(w,{type:'item',kind,x,y,until:w.item.until});
}
function pickItems(w){
  if(!w.item)return;
  if(w.t>=w.item.until){w.item=null;emit(w,{type:'itemgone'});return;}
  const p=w.players.find(p=>p.alive&&overlap(p.x,p.y,TANK.half,w.item.x,w.item.y,ITEM.half));if(!p)return;
  const kind=w.item.kind;w.item=null;p.stats.items++;
  emit(w,{type:'pick',slot:p.slot,kind});useItem(w,p,kind);
}
function useItem(w,p,kind){
  if(kind==='star'){p.stars=Math.min(PLAYER.maxStars,p.stars+1);emit(w,{type:'stars',slot:p.slot,stars:p.stars});}
  else if(kind==='shield'){p.shieldUntil=Math.round(w.t+ITEM.shieldMs);emit(w,{type:'shield',slot:p.slot,until:p.shieldUntil});}
  else if(kind==='fish'){p.lives++;emit(w,{type:'lives',slot:p.slot,lives:p.lives});}
  else if(kind==='clock'){w.clockUntil=Math.round(w.t+ITEM.clockMs);emit(w,{type:'clock',until:w.clockUntil});}
  else if(kind==='boom'){for(const e of w.enemies.slice())killEnemy(w,e,null,'boom');}
  else if(kind==='tape'){
    const ring=w.bases.find(b=>b.team===p.team)?.ring||[];
    for(const i of ring)w.terrain[i]=T.steel;w.tapeUntil=Math.round(w.t+ITEM.tapeMs);w.version++;
    emit(w,{type:'tape',until:w.tapeUntil,ring,team:p.team});
  }
}
function untape(w){
  if(!w.tapeUntil||w.t<w.tapeUntil)return;
  w.tapeUntil=0;const ring=[];for(const b of w.bases)ring.push(...b.ring);
  for(const i of ring)w.terrain[i]=T.brick;w.version++;emit(w,{type:'untape',ring});
}

// ---------------- the end (SPEC §6, §7, §10) ----------------
function checkEnd(w){
  if(w.result)return;
  let r=null;
  if(w.mode==='coop'){
    if(w.bases.some(b=>b.dead))r={kind:'fail',why:'base'};
    else if(w.players.length&&w.players.every(p=>!p.alive&&p.lives<=0))r={kind:'fail',why:'wiped'};
    else if(w.killed>=w.queue.length&&w.queue.length)r={kind:'clear'};
  }else{
    const dead=w.bases.find(b=>b.dead);
    if(dead)r={kind:'versus',winner:'t'+(1-dead.team),why:'base'};
    else if(w.t>=w.playMs){const [a,b]=w.teamKills;r={kind:'versus',winner:a>b?'t0':b>a?'t1':null,why:'time'};}
  }
  if(!r)return;
  r.stats=statsOf(w);r.teamKills=w.teamKills.slice();r.carry=carryOf(w);
  w.result=r;emit(w,{type:'end',result:r});
}
function statsOf(w){return w.players.map(p=>({slot:p.slot,name:p.name,team:p.team,...p.stats}));}
function carryOf(w){const c={};for(const p of w.players)c[p.slot]={lives:p.lives,stars:p.alive?p.stars:0};return c;}

// ---------------- the step ----------------
// inputs: slot → {dx, dy, fire} for tanks this machine drives; enemyInputs: id → {dx, dy, fire}.
function step(w,dt,inputs={},enemyInputs={}){
  w.out.length=0;w.t+=dt;
  if(w.t<0||w.result)return w.out;
  for(const p of w.players){
    if(w.authority&&!p.alive&&p.respawnAt&&w.t>=p.respawnAt)respawn(w,p);
    const i=inputs[p.slot];if(!i||p.owner==='remote')continue;
    if(!p.alive||w.t<p.frozenUntil){p.moving=false;continue;}
    drive(w,p,dirOf(i),PLAYER.speed,dt);
    if(i.fire){
      if(w.authority)fire(w,p);
      else if(liveBullets(w,'p'+p.slot).length<bulletCap(p)){const b=fire(w,p,{id:w.localIds=(w.localIds||0)-1});if(b)w.requests.push({type:'req-fire',x:+p.x.toFixed(3),y:+p.y.toFixed(3),dir:p.dir,t:Math.round(w.t),localId:b.id});}
    }
  }
  if(w.authority){
    spawnEnemies(w);
    const frozen=w.t<w.clockUntil;
    for(const e of w.enemies){const i=enemyInputs[e.id];if(frozen||!i){e.moving=false;continue;}drive(w,e,dirOf(i),speedOfEnemy(e),dt);if(i.fire)fire(w,e);}
  }
  moveBullets(w,dt);
  if(w.authority){pickItems(w);untape(w);checkEnd(w);}
  return w.out;
}

// ---------------- guests: apply the host's events ----------------
function apply(w,e){
  const p=e.slot!==undefined?player(w,e.slot):null;
  switch(e.type){
    case 'fire':{
      if(w.bullets.some(b=>b.id===e.id)||w.ended.some(x=>x.b.id===e.id))break;
      if(e.localId!==undefined&&e.by.p!==undefined&&player(w,e.by.p)?.owner==='local'){
        const mine=w.bullets.find(b=>b.id===e.localId)||w.ended.find(x=>x.b.id===e.localId)?.b;if(mine){mine.id=e.id;break;}
      }
      const b={id:e.id,key:e.by.p!==undefined?'p'+e.by.p:'e'+e.by.e,owner:e.by,side:e.side,team:e.team,x:e.x,y:e.y,x0:e.x,y0:e.y,t0:e.t0,dir:e.dir,speed:e.speed,pierce:e.pierce,done:false};
      w.bullets.push(b);if(w.t>b.t0)flyBullet(w,b,w.t-b.t0);else collideBullet(w,b);break;}
    case 'reject':{w.bullets=w.bullets.filter(b=>b.id!==e.localId);break;}
    case 'hit':{
      const b=w.bullets.find(b=>b.id===e.id);if(b){b.done=true;w.sparks.push({x:e.x,y:e.y,t:w.t,what:e.what});}
      if(e.other!==undefined){const o=w.bullets.find(b=>b.id===e.other);if(o)o.done=true;}
      for(const i of e.bricks||[])w.terrain[i]=T.floor;for(const i of e.steel||[])w.terrain[i]=T.floor;
      if((e.bricks||[]).length||(e.steel||[]).length)w.version++;
      w.bullets=w.bullets.filter(b=>!b.done);break;}
    case 'base':{const b=w.bases.find(b=>b.team===e.team);if(b&&!b.dead){b.dead=true;for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]])w.terrain[bi(b.bx+dx,b.by+dy)]=T.wreck;w.version++;}break;}
    case 'dmg':{const x=enemy(w,e.id);if(x)x.hp=e.hp;break;}
    case 'kill':{const x=enemy(w,e.id);w.enemies=w.enemies.filter(q=>q.id!==e.id);w.killed++;const by=e.by!==null?player(w,e.by):null;if(by&&e.why==='shot')by.stats[e.etype]++;w.sparks.push({x:e.x,y:e.y,t:w.t,what:'boom'});void x;break;}
    case 'enemy':{if(!enemy(w,e.id))w.enemies.push({id:e.id,type:e.etype,x:e.x,y:e.y,dir:2,moving:false,hp:ENEMY_TYPES[e.etype].hp,flash:e.flash,order:e.order});w.sent=Math.max(w.sent,e.order);w.warn=null;break;}
    case 'warn':{w.warn={x:e.x,y:e.y,at:e.at};break;}
    case 'die':{if(p){p.alive=false;p.stars=0;p.lives=e.lives;p.respawnAt=e.respawnAt;p.moving=false;p.stats.deaths++;w.sparks.push({x:e.x,y:e.y,t:w.t,what:'boom'});
      if(e.by?.p!==undefined&&w.mode==='versus'){const k=player(w,e.by.p);if(k){k.stats.kills++;w.teamKills[k.team]++;}}}break;}
    case 'spawn':{if(p)Object.assign(p,{x:e.x,y:e.y,dir:e.dir,alive:true,moving:false,slide:0,shieldUntil:e.shieldUntil,frozenUntil:0,respawnAt:0,life:e.life});break;}
    case 'freeze':{if(p)p.frozenUntil=e.until;break;}
    case 'shield':{if(p)p.shieldUntil=e.until;break;}
    case 'stars':{if(p)p.stars=e.stars;break;}
    case 'lives':{if(p)p.lives=e.lives;break;}
    case 'item':{w.item={kind:e.kind,x:e.x,y:e.y,until:e.until};break;}
    case 'itemgone':{w.item=null;break;}
    case 'pick':{w.item=null;if(p)p.stats.items++;break;}
    case 'clock':{w.clockUntil=e.until;break;}
    case 'tape':{for(const i of e.ring)w.terrain[i]=T.steel;w.tapeUntil=e.until;w.version++;break;}
    case 'untape':{for(const i of e.ring)w.terrain[i]=T.brick;w.tapeUntil=0;w.version++;break;}
    case 'end':{w.result=e.result;break;}
  }
}
// A cheap FNV hash of the terrain, for "every screen ends with the host's terrain".
function hash(terrain){let h=0x811c9dc5;for(let i=0;i<terrain.length;i++){h^=terrain[i];h=Math.imul(h,0x01000193)>>>0;}return h.toString(16);}

module.exports={createWorld,createPlayer,enemyQueue,player,enemy,step,apply,fire,claimHit,hitTank,killPlayer,killEnemy,respawn,useItem,dropItem,
  drive,blocked,bricksIn,visibility,inRug,sideOfTank,tanks,fieldCap,bulletCap,liveBullets,hash,dirOf,DX,DY,SPAWN_EVERY};
