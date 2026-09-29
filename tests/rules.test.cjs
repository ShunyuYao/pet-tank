'use strict';
// Rules (SPEC §1–§10), driven through the simulation's public inputs: direction keys, the fire
// key and time. Fixtures only set up preconditions (terrain, where tanks stand, an item lying on
// the floor); the behaviour under test always comes from inputs. Names match the → markers in
// docs/SPEC.zh-CN.md.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/config.cjs'),Maps=require('../game/maps.cjs'),Nav=require('../game/nav.cjs'),Sim=require('../game/sim.cjs'),AI=require('../game/ai.cjs'),Game=require('../game/game.cjs');
const {T,BW,W,H}=C,DT=1000/60;
const UP={dx:0,dy:-1},DOWN={dx:0,dy:1},LEFT={dx:-1,dy:0},RIGHT={dx:1,dy:0},STOP={dx:0,dy:0};

// A world on an empty floor (the base and its ring stay), the clock at 0, no spawn shields.
function world({mode='coop',slots=[0],clear=true,stage=1,arena=0}={}){
  const w=Sim.createWorld({mode,stage,arena,seed:7,roster:slots.map(slot=>({slot}))});
  if(clear){const keep=new Set(w.bases.flatMap(b=>b.ring));for(let i=0;i<w.terrain.length;i++)if(w.terrain[i]!==T.base&&!keep.has(i))w.terrain[i]=T.floor;}
  w.t=0;w.nextSpawnAt=1e12;for(const p of w.players)p.shieldUntil=0;return w;
}
const cell=(w,x,y,type)=>{for(const [dx,dy] of [[0,0],[1,0],[0,1],[1,1]])w.terrain[(y*2+dy)*BW+x*2+dx]=type;};
const brickAt=(w,bx,by)=>w.terrain[by*BW+bx];
const P=(w,s)=>Sim.player(w,s);
const put=(t,x,y,dir)=>{t.x=x;t.y=y;if(dir!==undefined)t.dir=dir;};
function run(w,ms,inputs={},enemyInputs={}){const ev=[];const n=Math.round(ms/DT);for(let k=0;k<n;k++){const i=typeof inputs==='function'?inputs(k):inputs;ev.push(...Sim.step(w,DT,i,enemyInputs));}return ev;}
function enemyAt(w,x,y,dir=2,type='normal'){const e={id:w.nextEnemy++,type,x,y,dir,moving:false,hp:C.ENEMY_TYPES[type].hp,flash:false,order:0};w.enemies.push(e);return e;}
const tap=(slot,extra={})=>({[slot]:{...STOP,fire:true,...extra}});

// ---------------- §1 ----------------
test('every map is 19×13 cells of 2×2 bricks',()=>{
  for(const rows of [...Maps.COOP,...Maps.VERSUS]){assert.equal(rows.length,H);for(const r of rows)assert.equal(r.length,W);const m=Maps.parse(rows);assert.equal(m.terrain.length,38*26);}
  assert.equal(Maps.COOP.length,6);assert.equal(Maps.VERSUS.length,2);
});
test('every base has its ring of eight bricks',()=>{
  for(let no=1;no<=6;no++){const m=Maps.load('coop',no);assert.equal(m.bases.length,1);assert.equal(m.bases[0].ring.length,8);for(const i of m.bases[0].ring)assert.equal(m.terrain[i],T.brick);assert.equal(m.bases[0].x,9.5);assert.equal(m.bases[0].y,12.5);}
  for(let a=0;a<2;a++){const m=Maps.load('versus',a);assert.equal(m.bases.length,2);assert.deepEqual(m.bases.map(b=>[b.team,b.x]),[[0,0.5],[1,18.5]]);for(const b of m.bases)assert.equal(b.ring.length,8);}
});
test('every spawn point is open floor',()=>{
  const open=(m,x,y)=>Sim.bricksIn(x,y,C.TANK.half,C.TANK.half).every(i=>[T.floor,T.rug,T.ice].includes(m.terrain[i]));
  for(let no=1;no<=6;no++){const m=Maps.load('coop',no);for(const [x,y] of [...m.spawns,...m.enemySpawns])assert.ok(open(m,x,y),'stage '+no+' '+x+','+y);}
  for(let a=0;a<2;a++){const m=Maps.load('versus',a);for(const [x,y] of m.spawns)assert.ok(open(m,x,y),'arena '+a);}
});
test('computer tanks can reach the base on every map',()=>{
  for(let no=1;no<=6;no++){const m=Maps.load('coop',no),f=Nav.field(m.terrain,Nav.baseTargets(m.terrain,m.bases[0]));
    for(const [x,y] of [...m.enemySpawns,...m.spawns])assert.ok(Number.isFinite(f[Nav.nearestNode(x,y)]),'stage '+no+' from '+x+','+y);}
  for(let a=0;a<2;a++){const m=Maps.load('versus',a);
    m.spawns.forEach(([x,y],slot)=>{const foe=m.bases.find(b=>b.team!==C.teamOfSlot(slot));const f=Nav.field(m.terrain,Nav.baseTargets(m.terrain,foe));assert.ok(Number.isFinite(f[Nav.nearestNode(x,y)]),'arena '+a+' slot '+slot);});}
});

// ---------------- §2 ----------------
test('a player tank drives 3 cells/s',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);run(w,1000,{0:RIGHT});assert.ok(Math.abs(p.x-6.5)<0.06,'3 cells in 1 s: '+p.x);
  run(w,300,{0:STOP});assert.ok(Math.abs(p.x-6.5)<0.06,'no key, no drive');
});
test('turning snaps to the nearest half cell',()=>{
  const w=world(),p=P(w,0);put(p,5.3,6.5,1);
  run(w,DT,{0:UP});assert.equal(p.x,5.5,'turning up lines up on x = 5.5');assert.equal(p.dir,0);
  put(p,5.5,6.3,0);run(w,DT,{0:DOWN});assert.ok(Math.abs(p.y-(6.3+0.05))<1e-6,'a U-turn does not snap: '+p.y);
  put(p,5.2,6.5,1);run(w,DT,{0:DOWN});assert.equal(p.x,5,'5.2 → 5.0');
});
test('walls, steel, water and the base block tanks; rug and ice do not',()=>{
  for(const [type,name] of [[T.brick,'bricks'],[T.steel,'steel'],[T.water,'water']]){
    const w=world(),p=P(w,0);put(p,2.5,5.5,1);cell(w,5,5,type);run(w,2000,{0:RIGHT});
    assert.ok(Math.abs(p.x-(5-0.48))<0.01,name+' stops the tank flush: '+p.x);}
  {const w=world(),p=P(w,0);put(p,9.5,9.5,2);run(w,2000,{0:DOWN});assert.ok(p.y<=12-0.48+0.01&&p.y>10,'the base ring and jar stop the tank: '+p.y);}
  for(const type of [T.rug,T.ice]){const w=world(),p=P(w,0);put(p,2.5,5.5,1);cell(w,4,5,type);cell(w,5,5,type);run(w,1500,{0:RIGHT});assert.ok(p.x>6.9,'drives across: '+p.x);}
  {const w=world(),p=P(w,0);put(p,0.5,5.5,3);run(w,500,{0:LEFT});assert.ok(Math.abs(p.x-0.48)<0.01,'the field edge stops it');}
});
test('tanks block each other but overlapping tanks can drive apart',()=>{
  const w=world({slots:[0,1]}),p=P(w,0),q=P(w,1);put(p,2.5,5.5,1);put(q,5.5,5.5,1);
  run(w,2000,{0:RIGHT});assert.ok(Math.abs(q.x-p.x-0.96)<0.01,'stops against the other tank: '+(q.x-p.x));
  put(p,5.3,5.5,3);run(w,500,{0:LEFT});assert.ok(p.x<4.9,'an overlapping tank drives out: '+p.x);
});
test('a tank on ice slides on after the key is released',()=>{
  const w=world(),p=P(w,0);for(let x=2;x<10;x++)cell(w,x,5,T.ice);put(p,2.5,5.5,1);run(w,500,{0:RIGHT});const x0=p.x;run(w,600,{0:STOP});
  assert.ok(Math.abs(p.x-x0-0.6)<0.02,'slides 0.6 cells on ice: '+(p.x-x0));
  const v=world(),q=P(v,0);put(q,2.5,5.5,1);run(v,500,{0:RIGHT});const y0=q.x;run(v,600,{0:STOP});assert.equal(q.x,y0,'no slide on the floor');
});

// ---------------- §3 ----------------
test('bullets fly straight at 8 or 13 cells/s',()=>{
  for(const [stars,speed] of [[0,8],[1,13]]){
    const w=world(),p=P(w,0);p.stars=stars;put(p,2.5,5.5,1);run(w,DT,tap(0));const b=w.bullets[0];const x0=b.x;
    run(w,250,{0:STOP});assert.ok(Math.abs(b.x-x0-speed*0.25)<0.15,stars+' stars: '+(b.x-x0));assert.equal(b.y,5.5,'straight');}
});
test('0 stars allow one bullet on screen, 2 stars allow two',()=>{
  for(const [stars,max] of [[0,1],[2,2]]){
    const w=world(),p=P(w,0);p.stars=stars;put(p,2.5,5.5,1);let most=0,fired=0;
    for(let k=0;k<30;k++){fired+=Sim.step(w,DT,tap(0)).filter(e=>e.type==='fire').length;most=Math.max(most,Sim.liveBullets(w,'p0').length);}
    assert.equal(most,max,stars+' stars: at most '+max+' in the air');assert.equal(fired,max,'presses beyond the cap do nothing');
  }
});
test('1 star makes bullets fast',()=>{const w=world(),p=P(w,0);p.stars=1;put(p,2.5,5.5,1);run(w,DT,tap(0));assert.equal(w.bullets[0].speed,13);p.stars=0;});
test('losing a life drops back to 0 stars',()=>{
  const w=world(),p=P(w,0);p.stars=2;put(p,5.5,8.5,0);const e=enemyAt(w,5.5,3.5,2);Sim.fire(w,e);run(w,1000);
  assert.equal(p.alive,false);assert.equal(p.stars,0);assert.equal(p.lives,2);
});

// ---------------- §4 ----------------
test('a shot breaks only the front layer of bricks',()=>{
  const w=world(),p=P(w,0);cell(w,5,3,T.brick);put(p,5.5,7.5,0);
  run(w,DT,tap(0));run(w,1000);
  assert.deepEqual([brickAt(w,10,6),brickAt(w,11,6),brickAt(w,10,7),brickAt(w,11,7)],[T.brick,T.brick,T.floor,T.floor],'the near row goes, the far row stays');
  run(w,DT,tap(0));run(w,1000);assert.deepEqual([brickAt(w,10,6),brickAt(w,11,6)],[T.floor,T.floor],'the second shot breaks the next row');
  // Off the seam, only the one brick in the bullet's path goes.
  const v=world(),q=P(v,0);cell(v,5,3,T.brick);put(q,5.25,7.5,0);Sim.fire(v,q);run(v,1000);
  assert.deepEqual([brickAt(v,10,7),brickAt(v,11,7)],[T.floor,T.brick]);
});
test('steel stops bullets below 3 stars and breaks at 3 stars',()=>{
  for(const stars of [0,1,2]){const w=world(),p=P(w,0);p.stars=stars;cell(w,5,3,T.steel);put(p,5.5,7.5,0);run(w,DT,tap(0));const ev=run(w,1000);
    assert.equal(brickAt(w,10,7),T.steel,stars+' stars: steel holds');assert.ok(ev.some(e=>e.type==='hit'&&e.what==='steel'));}
  const w=world(),p=P(w,0);p.stars=3;cell(w,5,3,T.steel);put(p,5.5,7.5,0);run(w,DT,tap(0));run(w,1000);
  assert.deepEqual([brickAt(w,10,7),brickAt(w,11,7),brickAt(w,10,6)],[T.floor,T.floor,T.steel],'3 stars break the front layer of steel');
});
test('bullets cross water, tanks do not',()=>{
  const w=world(),p=P(w,0);cell(w,6,5,T.water);cell(w,8,5,T.brick);put(p,4.5,5.5,1);run(w,DT,tap(0));run(w,1000);
  assert.equal(brickAt(w,16,10),T.floor,'the bullet flew over the water and broke the bricks behind it');
  run(w,2000,{0:RIGHT});assert.ok(Math.abs(p.x-(6-0.48))<0.01,'the tank stops at the water');
});
test('a tank in the rug is hidden from the other side',()=>{
  const w=world({slots:[0,1]}),p=P(w,0),e=enemyAt(w,10.5,5.5);cell(w,3,5,T.rug);cell(w,10,5,T.rug);put(p,3.5,5.5);
  assert.equal(Sim.visibility(w,p,'e'),'hidden','enemies cannot see a player in the rug');
  assert.equal(Sim.visibility(w,p,'p'),'ghost','players see a teammate in the rug as a ghost');
  assert.equal(Sim.visibility(w,e,'p'),'hidden','players cannot see an enemy in the rug');
  put(p,5.5,5.5);assert.equal(Sim.visibility(w,p,'e'),'full');
  const v=world({mode:'versus',slots:[0,1,2,3],arena:0}),a=P(v,0);cell(v,6,6,T.rug);put(a,6.5,6.5);
  assert.equal(Sim.visibility(v,a,'t1'),'hidden','versus: the other team cannot see you in the rug');assert.equal(Sim.visibility(v,a,'t0'),'ghost');
});

// ---------------- §5 ----------------
test('two bullets from opposing sides cancel out',()=>{
  const w=world(),p=P(w,0);put(p,2.5,5.5,1);const e=enemyAt(w,12.5,5.5,3);
  run(w,DT,tap(0));Sim.fire(w,e);const ev=run(w,1500);
  assert.ok(ev.some(x=>x.type==='hit'&&x.what==='bullet'),'the bullets met');assert.equal(p.alive,true);assert.equal(w.enemies.length,1,'nobody was hit');
  // Same side: two players' bullets pass each other.
  const v=world({slots:[0,1]}),a=P(v,0),b=P(v,1);put(a,2.5,5.5,1);put(b,12.5,5.5,3);a.shieldUntil=b.shieldUntil=1e9;
  run(v,DT,{0:{...STOP,fire:true},1:{...STOP,fire:true}});const ev2=run(v,1500);assert.ok(!ev2.some(x=>x.what==='bullet'),'teammates\' bullets do not cancel');
});
test('enemy bullets pass through enemy tanks',()=>{
  const w=world(),p=P(w,0);put(p,5.5,10.5,0);const a=enemyAt(w,5.5,2.5,2),b=enemyAt(w,5.5,5.5,2);void b;
  Sim.fire(w,a);run(w,1500);assert.equal(p.alive,false,'the shot went through the other enemy');assert.equal(w.enemies.length,2);
  const v=world(),q=P(v,0);put(q,2.5,5.5,1);Sim.fire(v,q);run(v,1000);assert.equal(q.alive,true,'your own bullet never hits you');
});

// ---------------- §6 ----------------
test('a hit on the base loses the stage in co-op',()=>{
  const w=world(),p=P(w,0);put(p,9.5,9.5,2);run(w,DT,tap(0));run(w,600);run(w,DT,tap(0));const ev=run(w,1000);
  assert.ok(ev.some(e=>e.type==='base'),'the jar fell (even to our own bullet)');assert.deepEqual({kind:w.result.kind,why:w.result.why},{kind:'fail',why:'base'});
});
test('a hit on a team\'s base wins versus for the other team',()=>{
  const w=world({mode:'versus',slots:[0,1,2,3]}),a=P(w,1);put(a,4.5,6.5,3);
  for(let k=0;k<4&&!w.result;k++){run(w,DT,tap(1));run(w,700);}
  assert.equal(w.result?.winner,'t1','blue broke orange\'s jar');assert.equal(w.result.why,'base');
});

// ---------------- §7 ----------------
test('a hit costs a life and respawns 3 s later with a 2 s shield',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);const e=enemyAt(w,9.5,5.5,3);Sim.fire(w,e);const ev=run(w,1000);
  const die=ev.find(x=>x.type==='die');assert.ok(die);assert.equal(p.lives,2);assert.equal(p.alive,false);
  run(w,die.respawnAt-w.t-100);assert.equal(p.alive,false,'still waiting');
  run(w,200);assert.equal(p.alive,true,'back after 3 s');assert.deepEqual([p.x,p.y],[7.5,12.5],'at the spawn');
  assert.ok(p.shieldUntil-w.t>1700&&p.shieldUntil-w.t<=2000,'with a 2 s shield');
  const e2=enemyAt(w,7.5,8.5,2);Sim.fire(w,e2);run(w,700);assert.equal(p.alive,true,'the shield takes the hit');assert.equal(p.lives,2);
});
test('a teammate\'s hit only freezes for 2 s',()=>{
  const w=world({slots:[0,1]}),a=P(w,0),b=P(w,1);put(a,2.5,5.5,1);put(b,8.5,5.5,1);
  run(w,DT,tap(0));const ev=run(w,1000);const f=ev.find(e=>e.type==='freeze');assert.ok(f,'frozen');
  assert.equal(b.alive,true);assert.equal(b.lives,3,'no life lost');
  const x0=b.x;run(w,f.until-w.t-100,{1:RIGHT});assert.equal(b.x,x0,'cannot drive while frozen');
  run(w,Sim.liveBullets(w,'p1').length?0:DT,{1:{...STOP,fire:true}});
  run(w,400,{1:RIGHT});assert.ok(b.x>x0+0.5,'drives again after 2 s');
});
test('when every player is out of lives the stage is lost',()=>{
  const w=world({slots:[0,1]});for(const p of w.players)p.lives=1;
  const kill=p=>{put(p,3.5,5.5,1);const e=enemyAt(w,9.5,5.5,3);Sim.fire(w,e);run(w,900);w.enemies=w.enemies.filter(x=>x!==e);};
  kill(P(w,0));assert.equal(w.result,null,'one player left');assert.equal(P(w,0).respawnAt,0,'out: no respawn');
  kill(P(w,1));assert.deepEqual({kind:w.result.kind,why:w.result.why},{kind:'fail',why:'wiped'});
});

// ---------------- §8 ----------------
test('at most 4 + (players − 1) enemies are on the field, 7 at most',()=>{
  for(const [n,cap] of [[1,4],[2,5],[4,7]]){
    const w=world({slots:[0,1,2,3].slice(0,n)});w.nextSpawnAt=0;for(const p of w.players){p.shieldUntil=1e12;put(p,p.slot*2+1.5,4.5);}
    // Enemies drive down out of the spawn points, so new ones can come in.
    let most=0;for(let k=0;k<60*60;k++){Sim.step(w,DT,{},Object.fromEntries(w.enemies.map(e=>[e.id,DOWN])));most=Math.max(most,w.enemies.length);}
    assert.equal(most,cap,n+' players → '+cap+' enemies at most');
  }
});
test('an armored tank takes four hits',()=>{
  const w=world(),p=P(w,0);put(p,2.5,5.5,1);const e=enemyAt(w,8.5,5.5,1,'armor');
  for(let k=1;k<=3;k++){run(w,DT,tap(0));run(w,900);assert.equal(e.hp,4-k,'hit '+k);assert.equal(w.enemies.length,1);}
  run(w,DT,tap(0));const ev=run(w,900);assert.equal(w.enemies.length,0,'the fourth hit destroys it');assert.ok(ev.some(x=>x.type==='kill'&&x.etype==='armor'));
  assert.equal(p.stats.armor,1,'counted for the shooter');
});
test('every stage sends twenty enemies of the four kinds',()=>{
  for(let no=1;no<=6;no++){const q=Sim.createWorld({stage:no,seed:no}).queue;assert.equal(q.length,20);
    const n=k=>q.filter(x=>x===k).length;assert.deepEqual(C.KINDS.map(n),C.WAVES[no-1],'stage '+no);}
  assert.notDeepEqual(Sim.createWorld({stage:3,seed:1}).queue,Sim.createWorld({stage:3,seed:2}).queue,'the order follows the seed');
});
test('the 4th, 11th and 18th enemies flash and drop an item',()=>{
  const w=world({clear:false}),p=P(w,0);w.nextSpawnAt=0;p.shieldUntil=1e12;const flashes=[];
  for(let k=0;k<60*300&&w.sent<20;k++){const ev=Sim.step(w,DT,{});for(const e of ev)if(e.type==='enemy'&&e.flash)flashes.push(e.order);
    for(const e of w.enemies.slice())if(e.flash){w.item=null;Sim.killEnemy(w,e,p,'shot');assert.ok(w.item,'enemy '+e.order+' dropped an item');}
    else if(w.enemies.length>=3)Sim.killEnemy(w,e,p,'shot');}
  assert.deepEqual(flashes,[4,11,18]);
});
test('destroying all twenty enemies clears the stage',()=>{
  const w=world({clear:false}),p=P(w,0);w.nextSpawnAt=0;p.shieldUntil=1e12;
  for(let k=0;k<60*400&&!w.result;k++){Sim.step(w,DT,{});for(const e of w.enemies.slice())Sim.killEnemy(w,e,p,'shot');}
  assert.equal(w.result?.kind,'clear');assert.equal(w.killed,20);
});
test('undefended, the enemies break through and hit the base',()=>{
  for(const level of [0,1,2]){
    const g=Game.create({mode:'coop',startStage:1,cpuLevel:level,seed:11});Game.setRoster(g,[{slot:0,kind:'human',name:'我'}]);Game.startGame(g);
    Sim.player(g.world,0).shieldUntil=1e12; // the player sits still and cannot be hit
    for(let k=0;k<60*240&&g.phase!=='over';k++)Game.step(g,DT,STOP);
    assert.equal(g.result?.why,'base','level '+level+': the jar fell');
  }
});

// ---------------- §9 ----------------
function pickUp(w,p,kind){w.item={kind,x:p.x+1,y:p.y,until:w.t+20000};const ev=run(w,500,{[p.slot]:RIGHT});assert.ok(ev.some(e=>e.type==='pick'&&e.kind===kind),'picked '+kind);return ev;}
test('a star raises the tank one star',()=>{const w=world(),p=P(w,0);put(p,3.5,5.5,1);pickUp(w,p,'star');assert.equal(p.stars,1);for(let k=0;k<4;k++){put(p,3.5,5.5,1);pickUp(w,p,'star');}assert.equal(p.stars,3,'3 at most');});
test('while shielded a hit costs nothing',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);pickUp(w,p,'shield');assert.ok(p.shieldUntil-w.t>9000);
  const e=enemyAt(w,4.5,1.5,2);put(p,4.5,6.5,0);Sim.fire(w,e);run(w,1000);assert.equal(p.alive,true);assert.equal(p.lives,3);
  run(w,10000);const e2=enemyAt(w,4.5,1.5,2);Sim.fire(w,e2);run(w,1000);assert.equal(p.alive,false,'10 s later it is gone');
});
test('tape turns the base ring to steel for 15 s',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);pickUp(w,p,'tape');const ring=w.bases[0].ring;
  assert.ok(ring.every(i=>w.terrain[i]===T.steel));
  const e=enemyAt(w,9.5,8.5,2);Sim.fire(w,e);run(w,800);assert.ok(ring.every(i=>w.terrain[i]===T.steel),'a shot does not break it');assert.equal(w.result,null);
  run(w,14500);assert.ok(ring.every(i=>w.terrain[i]===T.brick),'bricks again, all eight');
});
test('a firecracker destroys every enemy on the field',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);for(const x of [2.5,6.5,12.5])enemyAt(w,x,1.5);
  const ev=pickUp(w,p,'boom');assert.equal(w.enemies.length,0);assert.equal(ev.filter(e=>e.type==='kill'&&e.why==='boom').length,3);
  assert.equal(p.stats.normal,0,'not counted as kills');
});
test('a clock stops the enemies for 10 s',()=>{
  const w=world(),p=P(w,0);put(p,3.5,5.5,1);const e=enemyAt(w,12.5,1.5,2);pickUp(w,p,'clock');
  const y0=e.y,ev=[];for(let k=0;k<60*9;k++)ev.push(...Sim.step(w,DT,{},{[e.id]:{...DOWN,fire:true}}));
  assert.equal(e.y,y0,'no driving');assert.ok(!ev.some(x=>x.type==='fire'),'no firing');
  run(w,1500,{},{[e.id]:DOWN});assert.ok(e.y>y0,'moves again after 10 s');
});
test('a fish gives one more life',()=>{const w=world(),p=P(w,0);put(p,3.5,5.5,1);pickUp(w,p,'fish');assert.equal(p.lives,4);});

// ---------------- §10 ----------------
test('after a clear the next stage keeps lives and stars',()=>{
  const g=Game.create({mode:'coop',startStage:2,seed:3});Game.setRoster(g,[{slot:0,kind:'human',name:'甲'},{slot:1,kind:'human',name:'乙',owner:'local'}]);Game.startGame(g);
  const w=g.world,a=Sim.player(w,0),b=Sim.player(w,1);
  for(let k=0;k<60*4;k++)Game.step(g,DT,STOP);
  a.shieldUntil=b.shieldUntil=0;a.stars=2;b.lives=1;
  const e=enemyAt(w,b.x,b.y-5,2);Sim.fire(w,e);for(let k=0;k<60;k++)Game.step(g,DT,STOP);assert.equal(b.lives,0,'b is out');
  w.enemies=w.enemies.filter(x=>x!==e);a.shieldUntil=1e12;w.nextSpawnAt=0;
  for(let k=0;k<60*400&&g.phase!=='over';k++){Game.step(g,DT,STOP);for(const x of w.enemies.slice())Sim.killEnemy(w,x,a,'shot');}
  assert.equal(g.result.kind,'clear');assert.equal(g.result.stage,2);
  Game.next(g);assert.equal(g.stage,3,'on to stage 3');
  const a2=Sim.player(g.world,0),b2=Sim.player(g.world,1);
  assert.deepEqual([a2.lives,a2.stars],[3,2],'lives and stars carried');assert.deepEqual([b2.lives,b2.stars],[3,0],'the player who was out comes back with 3 lives, 0 stars');
});
test('versus ends after 3 minutes by kills',()=>{
  const g=Game.create({mode:'versus',seed:5});Game.setRoster(g,Game.fillBots([{slot:0,name:'我'}],{mode:'versus'}));
  assert.equal(g.roster.length,4,'2v2 with computer players');Game.startGame(g);assert.equal(g.world.playMs,180000);
  const w=g.world;w.t=0;g.phase='play';
  const a=Sim.player(w,0),b=Sim.player(w,1);a.shieldUntil=b.shieldUntil=0;put(a,6.5,0.5,1);put(b,10.5,0.5,1);
  Sim.fire(w,a);Sim.step(w,DT);for(let k=0;k<40;k++)Sim.step(w,DT);assert.deepEqual(w.teamKills,[1,0]);
  w.bases.forEach(x=>{x.dead=false;});w.t=w.playMs-DT;Sim.step(w,DT*2);
  assert.deepEqual({winner:w.result.winner,why:w.result.why},{winner:'t0',why:'time'});
});
