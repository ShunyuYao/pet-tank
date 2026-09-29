'use strict';
// Plain-browser acceptance (SPEC §2, §3, §6, §10, §12): the unmodified built HTML in a hidden
// Chromium window, driven only by real CDP input — keyboard for menus, driving and firing, the
// real file chooser for 2D / 3D imports. Checks read what the game shows or the read-only state
// hook (window.__tank).
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {launch,ROOT}=require('./launch.cjs');
const DOLL=process.env.TANK_DOLL_ZIP||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-female.zip');
const IMAGE=process.env.TANK_IMAGE||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-male/frames/idle/frame_00.png');
const out=path.join(ROOT,'artifacts/browser-e2e');fs.mkdirSync(out,{recursive:true});
const check=(ok,label,detail)=>{assert.ok(ok,label+(detail!==undefined?' '+JSON.stringify(detail):''));console.log('PASS',label);};
(async()=>{
  assert(fs.existsSync(DOLL)&&fs.existsSync(IMAGE),'local character fixtures missing');
  const {p,wait,errors,close,sleep}=await launch();
  const st=()=>p.evaluate('window.__tank.state()'),me=async()=>(await st()).me,shot=n=>p.screenshot(path.join(out,n+'.png'));
  const mine=async()=>(await st()).bullets.filter(b=>b.by.p===0).length;
  const seat=async kind=>{const x=(await p.evaluate('window.__tank.world()')).players.find(q=>q.slot===0);return x?.kind===kind&&x.seated&&x.clipped;};
  try{
    await wait('window.__tank?.state().driver','boot');
    check(await p.evaluate('typeof window.pet==="undefined"'),'plain browser: no pet SDK');
    check((await st()).driver.kind==='toy','default look is a built-in toy');
    // 2D and 3D pets ride in the turret, cut off at the hatch.
    await p.setFiles('#import-file',[IMAGE]);await wait('window.__tank.state().driver.kind==="sprite"','2D import');
    await wait(`(()=>{const x=window.__tank.world().players.find(q=>q.slot===0);return x?.kind==="sprite"&&x.seated&&x.clipped;})()`,'2D standee in the hatch');check(true,'a picture rides in the turret as a 2D standee');
    await p.setFiles('#import-file',[DOLL]);await wait('window.__tank.state().driver.kind==="doll3d"','3D import',60000);
    await wait(`(()=>{const x=window.__tank.world().players.find(q=>q.slot===0);return x?.kind==="doll3d"&&x.seated&&x.clipped;})()`,'3D doll in the hatch',30000);check(await seat('doll3d'),'a doll pack rides in the turret as a 3D doll');
    await shot('01-title');
    // Options by keyboard: co-op, stage 1, easy computer.
    await p.activate('.mode-card[data-mode="coop"]');await p.activate('#stage-list [data-value="1"]');await p.activate('#cpu-list [data-value="0"]');
    check(/第 1 关/.test(await p.evaluate('document.querySelector("#solo").textContent')),'the start button names the stage');
    await p.activate('#solo');
    await wait('window.__tank.state().phase==="count"','countdown');
    const y0=(await me()).y;await p.key('KeyW');await sleep(500);await p.key('KeyW','keyUp');
    check((await me()).y===y0,'the countdown freezes the tank');
    await wait('window.__tank.state().phase==="play"','play',6000);
    // Drive up out of the spawn, then hold W and also press D: the most recent key wins.
    await p.key('KeyW');await sleep(500);const a=await me();check(a.y<y0-1,'W drives up',{y0,y:a.y});
    await wait('window.__tank.world().players[0].yaw<-1.5','the pet faces up',2000);check(true,'the pet in the turret faces the way the tank drives');
    await p.key('KeyD');await sleep(400);await p.key('KeyD','keyUp');await p.key('KeyW','keyUp');
    const b=await me();check(b.x>a.x+0.6&&b.dir===1,'the most recent direction wins',{from:a,to:b});
    check((await p.evaluate('window.__tank.world().players[0].yaw'))===0,'the pet turned right with the tank');
    check(Math.abs(b.y*2-Math.round(b.y*2))<1e-6,'turning lined the tank up on a half cell',b.y);
    // Tapping fire with 0 stars keeps one bullet in the air.
    let most=0;for(let k=0;k<6;k++){await p.press('Space');await sleep(40);most=Math.max(most,await mine());}
    check(most===1,'tapping fire with 0 stars keeps one bullet in the air',most);
    await shot('02-play');
    // Drive to just above the jar, face down and shoot through its ring: the jar falls → lost.
    const hold=async(code,done,ms=4000)=>{await p.key(code);const t=Date.now();while(Date.now()-t<ms&&!(await done(await me())))await sleep(30);await p.key(code,'keyUp');};
    await hold('KeyD',m=>m.x>=9.3);await hold('KeyS',m=>m.dir===2&&m.y>=10.9,2500);
    check(Math.abs((await me()).x-9.5)<0.01,'lined up over the jar',await me());
    for(let k=0;k<6&&(await st()).phase==='play';k++){await p.press('Space');await sleep(700);}
    await wait('window.__tank.state().phase==="over"','the stage is lost',8000);
    const r=(await st()).result;check(r.kind==='fail'&&r.why==='base','a bullet on our own jar loses the stage',r&&{kind:r.kind,why:r.why});
    check((await p.evaluate('window.__tank.world().jars[0]'))==='down','the jar is drawn knocked over');
    await wait('!document.querySelector("#over-panel").hidden&&/零食罐/.test(document.querySelector("#over-title").textContent)','over panel',2000);
    check(await p.evaluate('document.querySelector("#next").textContent==="重试这一关"'),'a lost stage offers a retry');
    check(await p.evaluate('document.querySelectorAll("#over-stats tr").length===2&&/普通车/.test(document.querySelector("#over-stats").textContent)'),'the table lists kills by enemy kind');
    await shot('03-over');
    await p.activate('#next');await wait('window.__tank.state().phase==="count"&&window.__tank.state().stage===1','retry',4000);
    // The view catches up on the next frame.
    await wait('window.__tank.state().me?.lives===3&&window.__tank.world().jars[0]==="up"','retry state',2000);check(true,'retrying starts the stage again with 3 lives and the jar up');
    await p.activate('#leave');await wait('window.__tank.state().mode==="title"','back to title');check(true,'leave returns to the title');
    // Versus solo: 2v2 against computers, a clock on top.
    await p.activate('.mode-card[data-mode="versus"]');await p.activate('#arena-list [data-value="1"]');
    check(/2v2/.test(await p.evaluate('document.querySelector("#solo").textContent')),'versus start button');
    await p.activate('#solo');await wait('window.__tank.state().phase==="play"','versus play',8000);
    const v=await st();check(v.gameMode==='versus'&&v.players.length===4&&v.players.filter(x=>x.kind==='bot').length===3,'versus fills three computer tanks',v.players);
    check(await p.evaluate('!document.querySelector("#timer").hidden&&/^[23]:\\d\\d$/.test(document.querySelector("#timer").textContent)'),'versus shows the clock');
    await sleep(3000);await shot('04-versus');
    await p.activate('#leave');await wait('window.__tank.state().mode==="title"','back to title');
    assert.deepEqual(errors,[],'no page errors');check(true,'no page errors or exceptions');
  }finally{close();}
})().catch(e=>{console.error(e);process.exit(1);});
