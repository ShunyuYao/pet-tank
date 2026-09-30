// The 3D view (SPEC §12): a toy-room floor seen from a fixed angle, toy bricks, cookie tins,
// spilled water, rugs, waxed tiles, the snack jar, toy tanks with the pets riding in the turret
// hatch, enemies, bullets, items and bursts. Reads the simulation, never writes it.
// Grid point (x, y) in cells sits at world (x − W/2, 0, y − H/2).
import * as THREE from '../vendor/lib/three.module.js';
import Config from '../game/config.cjs';
import Sim from '../game/sim.cjs';
import {buildAvatar} from './avatars.js';

const {W,H,BW,BH,T,ITEM}=Config;
const wx=x=>x-W/2,wz=y=>y-H/2;
// The pet stands inside the turret: feet below the floor line, the hatch at its waist.
const PET_HEIGHT=1.35,HATCH_Y=0.46,SEAT_Y=HATCH_Y-PET_HEIGHT*0.42;
// A 2D standee leans back (avatars.js tilts it 0.32 rad so it reads from above): move it towards
// the camera so the line where the hatch cuts it sits at the turret's centre, not its back edge.
const STANDEE_FORWARD=Math.tan(0.32)*(HATCH_Y-SEAT_Y);
// Game direction (0 up, 1 right, 2 down, 3 left) → rotation.y for a +Z-facing model; → avatar yaw.
const ROT=[Math.PI,Math.PI/2,0,-Math.PI/2],YAW=[-Math.PI/2,0,Math.PI/2,Math.PI];

function canvasTexture(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}
const std=opts=>new THREE.MeshStandardMaterial({roughness:.7,...opts});
const ENEMY_LOOK={normal:{color:'#8b93a1',scale:1},fast:{color:'#aab4c0',scale:0.92},rapid:{color:'#7d8794',scale:1},armor:{color:'#5d6776',scale:1.1}};
const ARMOR_HP=['#b8423a','#d77a2c','#8a64c8','#5d6776'];

export function createWorld(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled=true;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#3a2f26');
  const camera=new THREE.PerspectiveCamera(30,1,0.5,200);
  scene.add(new THREE.HemisphereLight('#fff6ea','#7a6250',1.45));
  const sun=new THREE.DirectionalLight('#ffffff',1.6);sun.position.set(-7,16,9);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-12,right:12,top:9,bottom:-9,near:1,far:40});scene.add(sun);
  // Only the part of a pet above the hatch shows (SPEC §12).
  const hatchClip=new THREE.Plane(new THREE.Vector3(0,1,0),-HATCH_Y+0.02);

  // Floor: wooden planks; a darker rug around the field.
  const floorTex=canvasTexture(W*64,H*64,g=>{
    for(let y=0;y<H*2;y++){g.fillStyle=y%2?'#cfa577':'#c59b6c';g.fillRect(0,y*32,W*64,32);g.fillStyle='rgba(90,60,30,.25)';g.fillRect(0,y*32,W*64,2);
      for(let k=0;k<5;k++){const x=((y*97+k*211)%(W*64));g.fillRect(x,y*32,2,32);}}
  });
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,H),std({map:floorTex,roughness:.85}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(W+30,H+30),std({color:'#4d3b2d'}));ground.rotation.x=-Math.PI/2;ground.position.y=-0.02;scene.add(ground);
  const border=new THREE.Mesh(new THREE.BoxGeometry(W+0.3,0.12,H+0.3),std({color:'#6b4f38'}));border.position.y=-0.075;scene.add(border);

  // Terrain: one instanced mesh per kind, rebuilt when the terrain changes.
  const kinds={
    brick:{geo:new THREE.BoxGeometry(0.48,0.42,0.48),mat:std({color:'#ffffff',roughness:.55}),y:0.21},
    stud:{geo:new THREE.CylinderGeometry(0.09,0.09,0.06,12),mat:std({color:'#ffffff',roughness:.5}),y:0.45},
    steel:{geo:new THREE.BoxGeometry(0.49,0.5,0.49),mat:std({color:'#aeb8c4',roughness:.3,metalness:.65}),y:0.25},
    water:{geo:new THREE.BoxGeometry(0.5,0.05,0.5),mat:new THREE.MeshStandardMaterial({color:'#4fb4e6',roughness:.08,metalness:.1,transparent:true,opacity:.78}),y:0.03},
    rug:{geo:new THREE.BoxGeometry(0.5,0.1,0.5),mat:std({color:'#5f9143',roughness:1}),y:0.05},
    ice:{geo:new THREE.BoxGeometry(0.5,0.02,0.5),mat:std({color:'#e3f3fa',roughness:.05,metalness:.2}),y:0.012},
  };
  const inst={};
  for(const [k,v] of Object.entries(kinds)){const m=new THREE.InstancedMesh(v.geo,v.mat,BW*BH);m.count=0;m.castShadow=k==='brick'||k==='steel'||k==='stud';m.receiveShadow=true;m.frustumCulled=false;scene.add(m);inst[k]=m;}
  const BRICK_COLORS=['#e0523f','#f08a2e','#f2c230','#4a90d9','#43b26b'].map(c=>new THREE.Color(c)),RUG_A=new THREE.Color('#5f9143'),RUG_B=new THREE.Color('#6fa24f');
  const mtx=new THREE.Matrix4(),pos=new THREE.Vector3(),quat=new THREE.Quaternion(),scl=new THREE.Vector3(1,1,1);
  let builtKey='',lastWorld=null;
  function drawTerrain(w){
    const key=w.version+':'+w.stage+':'+w.seed;if(w===lastWorld&&key===builtKey)return;lastWorld=w;builtKey=key;
    const n={brick:0,stud:0,steel:0,water:0,rug:0,ice:0};
    for(let by=0;by<BH;by++)for(let bx=0;bx<BW;bx++){
      const t=w.terrain[by*BW+bx];const k=t===T.brick?'brick':t===T.steel?'steel':t===T.water?'water':t===T.rug?'rug':t===T.ice?'ice':null;if(!k)continue;
      const x=wx(bx/2+0.25),z=wz(by/2+0.25);
      pos.set(x,kinds[k].y,z);quat.identity();mtx.compose(pos,quat,scl);inst[k].setMatrixAt(n[k],mtx);
      if(k==='brick'){const c=BRICK_COLORS[((bx>>1)*3+(by>>1)*5)%BRICK_COLORS.length];inst.brick.setColorAt(n.brick,c);pos.y=kinds.stud.y;mtx.compose(pos,quat,scl);inst.stud.setMatrixAt(n.stud,mtx);inst.stud.setColorAt(n.stud,c);n.stud++;}
      if(k==='rug')inst.rug.setColorAt(n.rug,(bx+by)%2?RUG_A:RUG_B);
      n[k]++;
    }
    for(const [k,m] of Object.entries(inst)){m.count=n[k];m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
  }

  // Snack jars.
  const jars=[];
  function jarGroup(){
    const g=new THREE.Group();
    const glass=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.62,28,1,true),new THREE.MeshStandardMaterial({color:'#dff3ff',transparent:true,opacity:.35,roughness:.05,side:THREE.DoubleSide}));glass.position.y=0.33;g.add(glass);
    const bottom=new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.04,28),std({color:'#e8d9b8'}));bottom.position.y=0.03;g.add(bottom);
    const lid=new THREE.Mesh(new THREE.CylinderGeometry(0.37,0.37,0.12,28),std({color:'#ffcf4a',roughness:.4}));lid.position.y=0.7;lid.castShadow=true;g.add(lid);
    const band=new THREE.Mesh(new THREE.CylinderGeometry(0.345,0.345,0.16,28,1,true),std({color:'#f47a12',side:THREE.DoubleSide}));band.position.y=0.36;g.add(band);
    const cookies=new THREE.Group();g.add(cookies);
    for(let i=0;i<7;i++){const c=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.04,14),std({color:i%2?'#a86a36':'#c98b4c'}));c.position.set(Math.cos(i*2.3)*0.16,0.08+i*0.07,Math.sin(i*2.3)*0.16);c.rotation.set(0.3*i,0,0.2*i);cookies.add(c);}
    g.userData={cookies,lid};scene.add(g);return g;
  }
  function drawJars(w){
    while(jars.length<w.bases.length)jars.push(jarGroup());
    jars.forEach((g,i)=>{const b=w.bases[i];g.visible=!!b;if(!b)return;g.position.set(wx(b.x),0,wz(b.y));
      g.rotation.z=b.dead?Math.PI/2*0.95:0;g.position.y=b.dead?0.34:0;g.userData.lid.position.set(b.dead?0.5:0,b.dead?0.2:0.7,0);
      g.userData.cookies.children.forEach((c,k)=>{c.position.x=b.dead?0.2+k*0.12:Math.cos(k*2.3)*0.16;});});
  }

  // Tanks: one toy model per player slot and per enemy id.
  function tankModel(color,kind='player'){
    const look=ENEMY_LOOK[kind]||{scale:1},g=new THREE.Group(),body=new THREE.Group();g.add(body);
    const paint=std({color,roughness:.45}),dark=std({color:'#2f3340',roughness:.8}),metal=std({color:'#3b3f4c',roughness:.4,metalness:.4});
    const add=(geo,mat,p,parent=body)=>{const m=new THREE.Mesh(geo,mat);m.position.set(...p);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
    for(const s of [-1,1]){add(new THREE.BoxGeometry(0.2,0.2,0.9),dark,[s*0.34,0.1,0]);
      for(let k=0;k<4;k++)add(new THREE.CylinderGeometry(0.07,0.07,0.21,10),metal,[s*0.34,0.1,-0.33+k*0.22]).rotation.z=Math.PI/2;}
    add(new THREE.BoxGeometry(0.5,0.2,0.78),paint,[0,0.24,0]);
    const turret=add(new THREE.CylinderGeometry(0.24,0.27,0.16,20),paint,[0,0.4,-0.04]);
    const barrels=kind==='rapid'?[-0.07,0.07]:[0];
    for(const bx of barrels)add(new THREE.CylinderGeometry(0.045,0.05,0.46,10),metal,[bx,0.41,0.3]).rotation.x=Math.PI/2;
    if(kind==='player'){const rim=add(new THREE.TorusGeometry(0.16,0.03,8,20),metal,[0,0.48,-0.04]);rim.rotation.x=Math.PI/2;}
    else add(new THREE.SphereGeometry(0.1,12,8),metal,[0,0.5,-0.04]);
    body.scale.setScalar(look.scale||1);
    const shield=new THREE.Mesh(new THREE.SphereGeometry(0.68,24,16),new THREE.MeshStandardMaterial({color:'#fff8d6',transparent:true,opacity:.22,emissive:'#fff1a8',emissiveIntensity:.35,depthWrite:false}));shield.position.y=0.35;shield.visible=false;g.add(shield);
    const ice=new THREE.Mesh(new THREE.BoxGeometry(1,0.7,1),new THREE.MeshStandardMaterial({color:'#bfe8ff',transparent:true,opacity:.35,roughness:.05,depthWrite:false}));ice.position.y=0.35;ice.visible=false;g.add(ice);
    // Tanks are drawn back to front without writing depth, so the pet riding in the hatch (drawn
    // after its tank) shows over the turret instead of sinking behind it. Walls still hide both.
    const mats=[];g.traverse(o=>{if(!o.isMesh)return;o.renderOrder=o===shield||o===ice?3:1;for(const m of [].concat(o.material))if(!mats.includes(m)){m.transparent=true;m.depthWrite=false;mats.push(m);}});
    scene.add(g);return {group:g,paint,shield,ice,mats,turret};
  }
  const setAlpha=(mats,a,base=new Map())=>{for(const m of mats){if(!base.has(m))base.set(m,m.opacity);m.opacity=base.get(m)*a;}};

  const players=new Map(),building=new Map();
  function nameTag(text,color){
    const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');
    g.font='600 28px "PingFang SC","Microsoft YaHei",sans-serif';const w=Math.min(240,g.measureText(text).width+28);
    g.fillStyle='#'+color.getHexString();g.globalAlpha=.92;g.beginPath();g.roundRect((256-w)/2,10,w,44,22);g.fill();g.globalAlpha=1;
    g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';g.fillText(text,128,33);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));s.scale.set(1.4,0.35,1);s.renderOrder=10;return s;
  }
  async function setPlayer(slot,{signature,asset,fallback,name,color}){
    const cur=players.get(slot);
    if(cur&&cur.signature===signature&&cur.name===name&&cur.color===color)return;
    const token={};building.set(slot,token);
    const avatar=await buildAvatar(asset,fallback,{height:asset?.kind==='sprite'?PET_HEIGHT*1.2:PET_HEIGHT});
    if(building.get(slot)!==token){avatar.dispose?.();return;}
    const old=players.get(slot);if(old){scene.remove(old.tank.group,old.seat);old.avatar.dispose?.();}
    const c=new THREE.Color(color),tank=tankModel(c,'player');
    const seat=new THREE.Group();seat.add(avatar.object);
    avatar.object.traverse(o=>{if(!o.isMesh)return;o.castShadow=true;o.renderOrder=2;for(const m of [].concat(o.material)){m.clippingPlanes=[hatchClip];m.clipShadows=true;}});
    // The name lies on the floor in front of the tank, so it never covers the pet.
    const tag=nameTag(name,c);tag.position.set(0,0.05-SEAT_Y,0.78);seat.add(tag);
    scene.add(seat);
    const baseAlpha=new Map();
    players.set(slot,{avatar,tank,seat,tag,signature,name,color,kind:avatar.kind,fade:1,baseAlpha,view:'full',yaw:0});
  }
  function removePlayer(slot){const p=players.get(slot);if(p){scene.remove(p.tank.group,p.seat);p.avatar.dispose?.();players.delete(slot);}}
  let clock=0;
  function drawPlayers(w,dt,viewerSide){
    for(const a of w.players){
      const p=players.get(a.slot);if(!p)continue;
      const view=a.alive?Sim.visibility(w,a,viewerSide):'hidden';p.view=view;
      const target=!a.alive||view==='hidden'?0:view==='ghost'?0.42:1;p.fade+=(target-p.fade)*Math.min(1,dt*10);
      const shown=p.fade>0.03;p.tank.group.visible=shown;p.seat.visible=shown;
      p.tank.group.position.set(wx(a.x),0,wz(a.y));p.tank.group.rotation.y=ROT[a.dir];
      p.seat.position.set(wx(a.x),SEAT_Y,wz(a.y)+(p.kind==='sprite'?STANDEE_FORWARD:0));
      setAlpha(p.tank.mats,p.fade,p.baseAlpha);
      p.tank.shield.visible=a.alive&&w.t<a.shieldUntil;p.tank.shield.material.opacity=0.18+Math.sin(clock*8)*0.06;
      p.tank.ice.visible=a.alive&&w.t<a.frozenUntil;
      p.yaw=YAW[a.dir];
      p.avatar.update(dt,{yaw:p.yaw,run:0,runPhase:0,cheer:w.result&&w.result.kind==='clear'?1:0,visible:shown,alpha:p.fade,flash:0});
      p.tag.visible=shown&&view!=='hidden';
    }
  }
  const enemyMeshes=new Map();
  function drawEnemies(w,viewerSide){
    const seen=new Set();
    for(const e of w.enemies){seen.add(e.id);let m=enemyMeshes.get(e.id);
      if(!m){m=tankModel(new THREE.Color(ENEMY_LOOK[e.type].color),e.type);m.baseAlpha=new Map();enemyMeshes.set(e.id,m);}
      const view=Sim.visibility(w,e,viewerSide);m.group.visible=view!=='hidden';
      m.group.position.set(wx(e.x),0,wz(e.y));m.group.rotation.y=ROT[e.dir];
      if(e.type==='armor')m.paint.color.set(ARMOR_HP[Math.max(0,Math.min(3,e.hp-1))]);
      const frozen=w.t<w.clockUntil;
      m.paint.emissive.set(e.flash&&Math.sin(clock*10)>0?'#ff3b3b':frozen?'#3a7bd5':'#000000');m.paint.emissiveIntensity=e.flash?0.7:frozen?0.35:0;
    }
    for(const [id,m] of enemyMeshes)if(!seen.has(id)){scene.remove(m.group);enemyMeshes.delete(id);}
  }

  // Bullets.
  const bulletPool=[],bulletGeo=new THREE.CapsuleGeometry(0.07,0.14,4,8);
  function drawBullets(w){
    let n=0;
    for(const b of w.bullets){if(b.done)continue;let m=bulletPool[n];
      if(!m){m=new THREE.Mesh(bulletGeo,new THREE.MeshStandardMaterial({color:'#fff7d6',emissive:'#ffd35a',emissiveIntensity:.8,roughness:.3}));m.castShadow=true;scene.add(m);bulletPool.push(m);}
      m.visible=true;m.position.set(wx(b.x),0.41,wz(b.y));m.rotation.set(b.dir%2===0?Math.PI/2:0,0,b.dir%2===1?Math.PI/2:0);
      m.material.color.set(b.side==='e'?'#ffd0c8':'#fff7d6');n++;}
    for(let i=n;i<bulletPool.length;i++)bulletPool[i].visible=false;
    return n;
  }

  // Bursts: a pooled flash per spark (brick crumbs, steel sparks, tank explosions).
  const bursts=[],seenSparks=new WeakSet(),burstGeo=new THREE.IcosahedronGeometry(0.5,1);
  function drawBursts(w,dt){
    for(const s of w.sparks){if(seenSparks.has(s))continue;seenSparks.add(s);
      let m=bursts.find(b=>!b.visible);if(!m){m=new THREE.Mesh(burstGeo,new THREE.MeshBasicMaterial({color:'#ffb13b',transparent:true,depthWrite:false}));scene.add(m);bursts.push(m);}
      const big=s.what==='tank'||s.what==='boom'||s.what==='base';
      m.userData={life:0,max:big?0.55:0.22,size:big?1.3:0.35};m.material.color.set(s.what==='steel'?'#ffffff':s.what==='brick'?'#ff8a4a':'#ffb13b');
      m.position.set(wx(s.x),0.4,wz(s.y));m.visible=true;}
    for(const m of bursts){if(!m.visible)continue;m.userData.life+=dt;const k=m.userData.life/m.userData.max;if(k>=1){m.visible=false;continue;}
      m.scale.setScalar(m.userData.size*(0.4+k));m.material.opacity=0.9*(1-k);}
  }

  // Spawn warning (a spinning star) and the item.
  const warn=new THREE.Group();{const s=new THREE.Shape();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?0.16:0.42;s[i?'lineTo':'moveTo'](Math.cos(a)*r,Math.sin(a)*r);}
    const star=new THREE.Mesh(new THREE.ShapeGeometry(s),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}));star.rotation.x=-Math.PI/2;warn.add(star);warn.position.y=0.3;warn.visible=false;scene.add(warn);}
  const itemMeshes={};
  function itemGroup(kind){
    const g=new THREE.Group();const icon=new THREE.Group();icon.position.y=0.5;g.add(icon);g.userData.icon=icon;
    const glow=new THREE.Mesh(new THREE.CircleGeometry(0.42,24),new THREE.MeshBasicMaterial({color:'#fff4a8',transparent:true,opacity:.6,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.y=0.02;g.add(glow);
    const add=(geo,color,p=[0,0,0],r=[0,0,0])=>{const m=new THREE.Mesh(geo,std({color,roughness:.35,emissive:color,emissiveIntensity:.2}));m.position.set(...p);m.rotation.set(...r);m.castShadow=true;icon.add(m);};
    if(kind==='star'){const s=new THREE.Shape();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?0.12:0.28;s[i?'lineTo':'moveTo'](Math.cos(a)*r,Math.sin(a)*r);}add(new THREE.ExtrudeGeometry(s,{depth:0.08,bevelEnabled:false}),'#ffd23f');}
    if(kind==='shield')add(new THREE.BoxGeometry(0.4,0.46,0.08),'#c79a5b');
    if(kind==='tape'){add(new THREE.TorusGeometry(0.2,0.08,10,20),'#d9d2c0');}
    if(kind==='boom'){add(new THREE.CylinderGeometry(0.09,0.09,0.4,12),'#e0412f',[0,0,0],[0,0,0.4]);add(new THREE.CylinderGeometry(0.015,0.015,0.16,6),'#333333',[0.1,0.22,0],[0,0,0.4]);}
    if(kind==='clock'){add(new THREE.CylinderGeometry(0.22,0.22,0.1,20),'#e24a4a',[0,0,0],[Math.PI/2,0,0]);add(new THREE.CylinderGeometry(0.17,0.17,0.11,20),'#ffffff',[0,0,0.01],[Math.PI/2,0,0]);}
    if(kind==='fish'){add(new THREE.SphereGeometry(0.16,14,10),'#ffb36b',[0,0,0]);add(new THREE.ConeGeometry(0.12,0.2,4),'#ffb36b',[0.24,0,0],[0,0,Math.PI/2]);}
    scene.add(g);return g;
  }
  function drawItem(w){
    for(const [k,g] of Object.entries(itemMeshes))g.visible=!!w.item&&w.item.kind===k;
    if(w.item){const g=itemMeshes[w.item.kind]||(itemMeshes[w.item.kind]=itemGroup(w.item.kind));g.position.set(wx(w.item.x),0,wz(w.item.y));
      g.userData.icon.rotation.y=clock*1.8;g.userData.icon.position.y=0.5+Math.sin(clock*3)*0.06;
      g.visible=!(w.item.until-w.t<4000&&Math.sin(clock*14)<0);}
    warn.visible=!!w.warn;if(w.warn){warn.position.set(wx(w.warn.x),0.3,wz(w.warn.y));warn.rotation.y=clock*6;warn.scale.setScalar(0.7+0.3*Math.abs(Math.sin(clock*8)));}
  }

  function resize(){const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();fit();}
  // Frame the whole field as large as it goes between the top bar and the bottom player bar,
  // found by projecting its corners (so it holds for any window size).
  const PITCH=60*Math.PI/180,_v=new THREE.Vector3();
  function fits(dist,lookZ,box){
    camera.position.set(0,dist*Math.sin(PITCH),lookZ+dist*Math.cos(PITCH));camera.lookAt(0,0,lookZ);camera.updateMatrixWorld();
    let minX=1,maxX=-1,minY=1,maxY=-1;
    for(const [x,z,y] of [[-W/2,-H/2,SEAT_Y+PET_HEIGHT],[W/2,-H/2,SEAT_Y+PET_HEIGHT],[-W/2,H/2,0],[W/2,H/2,0],[-W/2,H/2,0.5],[W/2,H/2,0.5]]){
      _v.set(x,y,z).project(camera);minX=Math.min(minX,_v.x);maxX=Math.max(maxX,_v.x);minY=Math.min(minY,_v.y);maxY=Math.max(maxY,_v.y);}
    return {ok:minX>=box.l&&maxX<=box.r&&minY>=box.b&&maxY<=box.t,minY,maxY};
  }
  function fit(){
    const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;
    const box={l:-1+16/w*2,r:1-16/w*2,b:-1+54/h*2,t:1-64/h*2};
    const want=(box.b+box.t)/2;let lookZ=0.3,hi=80;
    for(let pass=0;pass<4;pass++){
      let lo=4;hi=80;for(let k=0;k<30;k++){const m=(lo+hi)/2;if(fits(m,lookZ,box).ok)hi=m;else lo=m;}
      const mid=z=>{const f=fits(hi,z,box);return (f.minY+f.maxY)/2;};
      let a=-H/2,c=H/2;const up=mid(c)>mid(a);
      for(let k=0;k<30;k++){const m=(a+c)/2;if((mid(m)>want)===up)c=m;else a=m;}
      lookZ=(a+c)/2;
    }
    let lo=4;hi=80;for(let k=0;k<30;k++){const m=(lo+hi)/2;if(fits(m,lookZ,box).ok)hi=m;else lo=m;}
    fits(hi,lookZ,box);
  }
  addEventListener('resize',resize);resize();

  let lastBullets=0;
  function render(dt,{world:w,viewerSide='p'}){
    clock+=dt;
    if(w){drawTerrain(w);drawJars(w);drawPlayers(w,dt,viewerSide);drawEnemies(w,viewerSide);lastBullets=drawBullets(w);drawBursts(w,dt);drawItem(w);}
    inst.water.material.opacity=0.72+Math.sin(clock*2)*0.06;
    renderer.render(scene,camera);
  }
  // Cell point → client px (for tests driven by real input).
  const tmp=new THREE.Vector3();
  function project(x,y,h=0.4){tmp.set(wx(x),h,wz(y)).project(camera);const r=canvas.getBoundingClientRect();return {x:r.left+(tmp.x+1)/2*r.width,y:r.top+(1-tmp.y)/2*r.height};}
  function info(){return {players:[...players.entries()].map(([slot,p])=>({slot,kind:p.kind,visible:p.tank.group.visible,view:p.view,alpha:+p.fade.toFixed(2),yaw:+p.yaw.toFixed(3),seated:p.avatar.object.parent===p.seat,clipped:(()=>{let ok=true;p.avatar.object.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material))if(!m.clippingPlanes?.includes(hatchClip))ok=false;});return ok;})()})),
    enemies:enemyMeshes.size,bullets:lastBullets,bricks:inst.brick.count,steel:inst.steel.count,jars:jars.map(j=>j.rotation.z!==0?'down':'up'),item:Object.values(itemMeshes).some(g=>g.visible),calls:renderer.info.render.calls};}
  return {render,setPlayer,removePlayer,project,info,renderer,camera};
}
