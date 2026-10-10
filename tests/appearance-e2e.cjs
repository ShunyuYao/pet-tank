'use strict';
// Reproduce the missing torso through the shipped HTML, real pack import and CDP keys.
// The spawn shield must be active: testing only after it expires misses the defect.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {launch,ROOT}=require('./launch.cjs');
const out=path.join(ROOT,'artifacts/appearance-e2e');fs.mkdirSync(out,{recursive:true});
async function pixelAt(p,x,y){
  const {data}=await p.send('Page.captureScreenshot',{format:'png',clip:{x:Math.round(x),y:Math.round(y),width:1,height:1,scale:1}});
  const png=Buffer.from(data,'base64');let i=8,idat=[];while(i<png.length){const n=png.readUInt32BE(i),t=png.toString('ascii',i+4,i+8);if(t==='IDAT')idat.push(png.subarray(i+8,i+8+n));i+=12+n;}
  const raw=require('node:zlib').inflateSync(Buffer.concat(idat));return [raw[1],raw[2],raw[3]];
}
(async()=>{
 for(const person of ['male','female']){
  const h=await launch();const {p,wait,sleep,errors}=h;
  try{
   await wait('window.__tank?.state().driver','boot');
   const pack=path.join(process.env.TANK_PACKS_DIR||path.resolve(ROOT,'../rat-doll-lab/dist'),'rat-doll-'+person+'.zip');
   await p.setFiles('#import-file',[pack]);await wait('window.__tank.world().players.some(x=>x.kind==="doll3d")','3D import',60000);
   await p.activate('#solo');await wait('window.__tank.state().phase==="play"','play');
   await p.key('KeyS');await sleep(100);await p.key('KeyS','keyUp');
   const sample=async label=>{
    const state=await p.evaluate('window.__tank.state()');assert.equal(state.me.dir,2);
    const effects=(await p.evaluate('window.__tank.world()')).players.find(x=>x.slot===0).effects;
    const points=[];
    // Three points down the garment centre: real rendered pixels, not mesh flags.
    for(const height of [.99,1.04,1.09]){
     const q=await p.evaluate(`window.__tank.screen(${state.me.x},${state.me.y+.1},${height})`);
     points.push(await pixelAt(p,q.x,q.y));
    }
    await p.screenshot(path.join(out,person+'-'+label+'.png'));
    return {shield:state.me.shield,points,effects};
   };
   const protectedView=await sample('shield');assert(protectedView.shield,'must observe active spawn shield');
   await wait('!window.__tank.state().me.shield','shield expires');
   const normalView=await sample('normal');
   const cloth=([r,g,b])=>Math.max(r,g,b)-Math.min(r,g,b)<55;
   fs.writeFileSync(path.join(out,person+'.json'),JSON.stringify({protectedView,normalView},null,2));
   assert(normalView.points.every(cloth),person+': torso visible without shield '+JSON.stringify(normalView));
   assert(protectedView.points.every(cloth),person+': shield must not erase torso and reveal orange tank '+JSON.stringify(protectedView));
   for(const view of [protectedView,normalView]){assert.equal(view.effects.shield.depthWrite,false,'shield remains translucent');assert.equal(view.effects.ice.depthWrite,false,'ice remains translucent');assert.equal(view.effects.bodyDepthWrite,true,'solid tank still occludes');}
   for(const key of ['KeyD','KeyA','KeyW']){await p.key(key);await sleep(100);await p.key(key,'keyUp');await p.screenshot(path.join(out,person+'-'+key+'.png'));}
   assert.deepEqual(errors,[]);console.log('PASS',person,'torso visible during and after shield; four directions; no page errors');
  }finally{await h.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
