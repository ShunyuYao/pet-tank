// Entry: menus, keyboard input, the fixed-step loop, HUD, and wiring of the rules (game/) to the
// view (scene.js) and — for LAN play — the room (game/net.js on pet-kit).
import {createWorld} from './scene.js';
import {createAudio} from './audio.js';
import * as C from '../vendor/pet-kit/looks.js';
import Config from '../game/config.cjs';
import Game from '../game/game.cjs';
import AI from '../game/ai.cjs';
import Sim from '../game/sim.cjs';
import Maps from '../game/maps.cjs';
import Net from '../game/net.js';

C.configureLooks({dbName:'pet-tank'});
const $=id=>document.getElementById(id);
const world=createWorld($('stage'));
const KIND_LABEL={doll3d:'3D 布偶',sprite:'2D 立绘',toy:'内置形象'};
const MODE_LABEL={coop:'合作守家',versus:'组队对战'};
const CPU_LOOKS=[{species:'cat',color:'#8e7cff'},{species:'bunny',color:'#34c38f'},{species:'mouse',color:'#ffb020'},{species:'cat',color:'#ff7aa8'}];
const DEFAULT_PREFS={mode:'coop',stage:1,arena:0,cpuLevel:1,sfx:true};
const prefs=loadPrefs();
function loadPrefs(){try{return {...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('pet-tank-prefs')||'{}')};}catch{return {...DEFAULT_PREFS};}}
function savePrefs(){try{localStorage.setItem('pet-tank-prefs',JSON.stringify(prefs));}catch{}}
const audio=createAudio({sfx:prefs.sfx});
addEventListener('pointerdown',()=>audio.unlock(),{capture:true});addEventListener('keydown',()=>audio.unlock(),{capture:true});

let sdk=window.pet||null,driver=null,petDriver=null,realtimeNote='';
let session=null; // {kind:'solo'|'lan', game, step, ...}
let mode='title';
const peerAssets=new Map(); // signature → asset (LAN)

// ---------- UI helpers ----------
let errorTimer=null,announceTimer=null;
function show(panel){for(const id of ['title-panel','lobby-panel','over-panel'])$(id).hidden=id!==panel;$('menu').hidden=!panel;}
function error(text){$('error').textContent=text||'';$('error').hidden=!text;clearTimeout(errorTimer);if(text)errorTimer=setTimeout(()=>{$('error').hidden=true;},7000);}
function announce(text,{small=false,ms=900}={}){const a=$('announce');a.textContent=text;a.classList.toggle('small',small);a.hidden=false;a.classList.remove('pop');void a.offsetWidth;a.classList.add('pop');clearTimeout(announceTimer);announceTimer=setTimeout(()=>{a.hidden=true;},ms);}
function describe(e){const m=e?.message||String(e);const map={no_invitation:'这份 HTML 还没有联机邀请。',protocol_mismatch:'双方的游戏版本不一致，请用同一份 HTML。',session_closed:'本次联机已结束。',room_full:'房间已经满 4 人了。',zip_invalid:'这个 ZIP 读不出来，请确认是完整的角色包。',pack_no_character:'包里没有 character.json，不像是桌宠角色包。',pack_no_frames:'角色包里没有找到 idle 动作图。',pack_realtime_invalid:'角色包里的 3D 布偶数据不完整。',image_decode_failed:'图片解码失败，换一张 PNG / WebP / JPG 试试。',file_too_large:'文件太大了（超过 12 MB）。',asset_too_large:'形象素材超过 1 MB，其他人会看到内置形象。',CHARACTER_IMAGE_UNAVAILABLE:'暂时读不到当前桌宠形象。',host_only:'只有房主可以修改。'};
  return map[m]||(/permission|denied|revoked/i.test(m)?'能力未授权：请重新打开 HTML 并允许读取形象 / 联机。':'出了点问题：'+m);}
function portraitInto(el,src,fallback='🐭'){el.replaceChildren();if(src){const img=new Image();img.src=src;img.alt='';el.append(img);}else el.textContent=fallback;}
const portraitOf=a=>a?.kind==='sprite'?a.frames[0]:a?.kind==='doll3d'?a.head:null;
const toyEmoji=a=>a?.species==='cat'?'🐱':a?.species==='bunny'?'🐰':'🐭';
function chipGroup(el,values,label,current,onPick,{disabled=false}={}){
  el.replaceChildren();
  for(const v of values){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.value=String(v);b.textContent=label(v);b.setAttribute('aria-pressed',String(v===current));b.disabled=disabled;b.addEventListener('click',()=>onPick(v));el.append(b);}
}
const colorOf=slot=>{const g=session?.game;if(g?.mode==='versus')return Config.TEAMS[Config.teamOfSlot(slot)].color;return Config.SLOT_COLORS[slot];};
const STAGES=[1,2,3,4,5,6];
function renderFighterCard(){
  portraitInto($('fighter-portrait'),driver?.portrait,toyEmoji(driver?.asset));
  $('fighter-name').textContent=driver?.profile.name||'…';
  $('fighter-kind').textContent=driver?KIND_LABEL[driver.profile.kind]:'';$('fighter-kind').dataset.kind=driver?.profile.kind||'';
  $('use-pet').hidden=!sdk?.character;$('use-pet').disabled=!petDriver;
  const usingPet=driver&&petDriver&&(driver.source==='pet'||driver.characterKey===petDriver.characterKey);
  $('pet-auto').hidden=!usingPet;$('pet-auto').textContent='已自动带入你的桌宠形象。'+(driver?.profile.kind==='sprite'&&realtimeNote?' '+realtimeNote:'');
}
function renderOptions(){
  for(const b of document.querySelectorAll('.mode-card'))b.setAttribute('aria-checked',String(b.dataset.mode===prefs.mode));
  $('stage-opt').hidden=prefs.mode!=='coop';$('arena-opt').hidden=prefs.mode!=='versus';
  chipGroup($('stage-list'),STAGES,v=>String(v),prefs.stage,v=>{prefs.stage=v;savePrefs();renderOptions();});
  chipGroup($('arena-list'),[0,1],v=>Maps.MAP_NAMES.versus[v],prefs.arena,v=>{prefs.arena=v;savePrefs();renderOptions();});
  chipGroup($('cpu-list'),[0,1,2],v=>AI.LEVELS[v].name,prefs.cpuLevel,v=>{prefs.cpuLevel=v;savePrefs();renderOptions();});
  $('solo').textContent=prefs.mode==='coop'?'单人开始 · 第 '+prefs.stage+' 关':'单人开始 · 和电脑 2v2';
}
for(const b of document.querySelectorAll('.mode-card'))b.addEventListener('click',()=>{prefs.mode=b.dataset.mode;savePrefs();renderOptions();});
$('sfx').addEventListener('click',()=>{prefs.sfx=!prefs.sfx;audio.setOn(prefs.sfx);savePrefs();$('sfx').textContent='音效 '+(prefs.sfx?'开':'关');$('sfx').setAttribute('aria-pressed',String(prefs.sfx));});
$('keys-btn').addEventListener('click',()=>toggleKeys());
function toggleKeys(force){const open=force??$('keys-panel').hidden;$('keys-panel').hidden=!open;$('keys-btn').setAttribute('aria-expanded',String(open));}

// ---------- characters ----------
async function setDriver(next){driver=next;renderFighterCard();session?.lan?.setProfile?.(profileOf(driver),driver.asset);syncPlayers();}
function profileOf(d){return {name:d.profile.name,signature:d.profile.signature,kind:d.profile.kind};}
async function importFiles(files){
  const list=[...files];if(!list.length)return;
  $('import-status').textContent='正在读取 '+(list[0].webkitRelativePath?.split('/')[0]||list[0].name)+' …';$('import-status').dataset.state='busy';
  try{
    let d;
    if(list.length>1||list[0].webkitRelativePath)d=await C.packDriver(list);
    else if(/\.zip$/i.test(list[0].name)||list[0].type==='application/zip')d=await C.packDriver(list[0]);
    else if(/^image\//.test(list[0].type)||/\.(png|webp|jpe?g|gif)$/i.test(list[0].name))d=await C.imageDriver(list[0]);
    else throw Error('请导入角色包 ZIP / 文件夹，或 PNG / WebP / JPG 图片。');
    if(d.characterKey)void C.saveDriver('pack:'+d.characterKey,d);
    await setDriver(d);void C.saveDriver('last',d);
    $('import-status').textContent='已导入「'+d.profile.name+'」 · '+KIND_LABEL[d.profile.kind];$('import-status').dataset.state='ok';
  }catch(e){console.error(e);$('import-status').textContent=describe(e);$('import-status').dataset.state='error';}
}
$('import-file').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
$('import-folder').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
addEventListener('dragover',e=>{e.preventDefault();if(mode!=='play')document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');if(mode==='play')return;void importFiles(e.dataTransfer.files);});
for(const t of C.TOYS){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.toy=t.id;b.textContent=t.name;b.addEventListener('click',async()=>{await setDriver(await C.toyDriver(t.id));$('import-status').textContent='';});$('toy-row').append(b);}
$('use-pet').addEventListener('click',async()=>{if(petDriver)await setDriver(await preferRealtime(petDriver));});
async function preferRealtime(d){
  if(d?.source==='pet'&&sdk?.character?.getRealtime){
    try{const raw=await sdk.character.getRealtime(),rt=await C.realtimeDriver(raw,d);if(rt){realtimeNote='';return rt;}
      realtimeNote=raw?'这个形象的 3D 数据格式本游戏不认识，先以 2D 出战。':'这个形象没有 3D 布偶数据，以 2D 出战。';}
    catch(e){console.warn('realtime unavailable',e);realtimeNote='读取 3D 布偶数据失败，先以 2D 出战。';}
  }
  if(d?.characterKey){const cached=await C.loadDriver('pack:'+d.characterKey);if(cached?.asset.kind==='doll3d')return cached;}
  return d;
}
function grantState(text){$('grant-box').hidden=!text;$('grant-text').textContent=text||'';}
async function readPet(){
  grantState('正在请求读取你的桌宠形象：请在桌宠弹出的授权窗口里点「允许」。');
  let grant;try{grant=await sdk.capabilities.request({});}catch(e){grantState('授权请求没有完成（'+describe(e)+'），可以再试一次。');return false;}
  if(grant?.status!=='granted'||!grant.permissions?.includes('character:read')){grantState('还没有允许读取桌宠形象，现在先用内置形象。点下面的按钮可以重新授权。');return false;}
  try{petDriver=await C.currentPetDriver(sdk.character);}catch(e){grantState('已授权，但暂时读不到当前桌宠形象：'+describe(e));return false;}
  grantState('');await setDriver(await preferRealtime(petDriver));return true;
}
$('grant-retry').addEventListener('click',async()=>{if(await readPet())await joinInvitation();});

// ---------- players in the view ----------
// me = my driver; other humans = their transferred look (a toy until it arrives); computers = toys.
function lookOf(r,g){
  if(r.slot===g.mySlot&&driver)return {signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback};
  if(r.kind==='bot'){const look=CPU_LOOKS[r.slot%CPU_LOOKS.length];return {signature:'cpu:'+r.slot+look.species,asset:{kind:'toy',...look}};}
  const asset=peerAssets.get(r.signature);
  return {signature:asset?r.signature:'pending:'+r.signature,asset:asset||{kind:'toy',species:'mouse',color:colorOf(r.slot)}};
}
let rosterKey='';
function syncPlayers(force){
  const g=session?.game;
  if(!g||!g.world){for(const s of [1,2,3])world.removePlayer(s);if(driver)void world.setPlayer(0,{signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback,name:driver.profile.name,color:Config.SLOT_COLORS[0]});rosterKey='';return;}
  const key=JSON.stringify([g.mode,g.mySlot,g.roster.map(r=>[r.slot,r.kind,r.name,r.signature]),[...peerAssets.keys()],driver?.profile.signature]);
  if(key===rosterKey&&!force)return;rosterKey=key;
  const slots=new Set();
  for(const r of g.roster){slots.add(r.slot);void world.setPlayer(r.slot,{...lookOf(r,g),name:r.name,color:colorOf(r.slot)});}
  for(const p of world.info().players)if(!slots.has(p.slot))world.removePlayer(p.slot);
}

// ---------- input ----------
// Driving: the most recently pressed direction wins (SPEC §2). Fire: a press fires, holding
// keeps firing about four times a second (the stars still cap bullets in the air).
const MOVE={KeyW:[0,-1],ArrowUp:[0,-1],KeyS:[0,1],ArrowDown:[0,1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0]};
let held=[],fireQueued=false,fireHeld=false,lastFireAt=0;
addEventListener('keydown',e=>{
  if(e.code==='KeyP'){toggleKeys();return;}
  if(mode!=='play')return;
  if(MOVE[e.code]||e.code==='Space'||e.code==='KeyJ')e.preventDefault();
  if(e.repeat)return;
  if(MOVE[e.code]){held=held.filter(k=>k!==e.code);held.push(e.code);}
  if(e.code==='KeyJ'||e.code==='Space'){fireQueued=true;fireHeld=true;}
});
addEventListener('keyup',e=>{held=held.filter(k=>k!==e.code);if(e.code==='KeyJ'||e.code==='Space')fireHeld=false;});
addEventListener('blur',()=>{held=[];fireHeld=false;});
function readInput(){
  const k=held[held.length-1],[dx,dy]=k?MOVE[k]:[0,0],now=performance.now();
  const fire=fireQueued||(fireHeld&&now-lastFireAt>=Config.PLAYER.refireMs);
  if(fire)lastFireAt=now;fireQueued=false;
  return {dx,dy,fire};
}

// ---------- solo ----------
function startSolo(){
  const g=Game.create({role:'solo',mySlot:0,mode:prefs.mode,startStage:prefs.stage,arena:prefs.arena,cpuLevel:prefs.cpuLevel});
  const me={slot:0,name:driver?.profile.name||'我',owner:'local',signature:driver?.profile.signature};
  Game.setRoster(g,Game.fillBots([me],{mode:prefs.mode}));
  session={kind:'solo',game:g,step:(dt,input)=>{const ev=Game.step(g,dt,input);g.out.length=0;return ev;},next(){Game.next(g);g.out.length=0;},leave(){}};
  Game.startGame(g);g.out.length=0;syncPlayers(true);setConn('solo','单人');
}
$('solo').addEventListener('click',()=>{audio.unlock();startSolo();});
$('next').addEventListener('click',()=>{if(!session)return;if(session.kind==='solo')session.next();else session.lan.next();});
$('to-title').addEventListener('click',()=>{if(session?.kind==='lan'&&session.lan.isHost()){session.lan.toLobby();return;}leave();});
$('leave').addEventListener('click',()=>leave());
async function leave(){const s=session;session=null;try{await s?.leave?.();}catch{}held=[];fireHeld=false;renderMode(true);syncPlayers(true);}
function setConn(state,text){$('conn').hidden=!state;$('conn').dataset.state=state||'';$('conn').textContent=text||'';}

// ---------- LAN ----------
const CONN_TEXT={connected:'已联机',waiting:'等待连接',reconnecting:'正在重连',closed:'联机已结束'};
let feedQueue=[];
async function joinInvitation(){
  if(session||!sdk?.sessions?.getContext)return;
  let context=null;try{context=await sdk.sessions.getContext();}catch(e){if(!/permission|denied|revoked/i.test(e.message))error(describe(e));return;}
  if(!context)return;
  const lan=Net.create(sdk.sessions,{
    onLobby:()=>{if(mode==='lobby')renderLobby();},
    onAsset:(signature,asset)=>{if(!C.checkAsset(asset)){error('有位玩家的形象数据无效，已改用内置形象。');return;}peerAssets.set(signature,asset);syncPlayers(true);},
    onConnection:s=>setConn(s,CONN_TEXT[s]||s),
    onClosed:r=>{if(r==='room_full')error(describe(Error('room_full')));},
    onFeed:e=>feedQueue.push(e),
    onError:e=>{if(!/\b(backpressure|peer_offline|not_connected|quota_exceeded)\b/.test(e.message))error(describe(e));},
  });
  try{await lan.start(profileOf(driver),driver.asset);}catch(e){error(describe(e));return;}
  session={kind:'lan',lan,get game(){return lan.game;},step:(dt,input)=>{lan.step(dt,input);const ev=feedQueue;feedQueue=[];return ev;},leave:()=>lan.leave()};
  syncPlayers(true);
}

// ---------- mode / menus ----------
function phaseOf(){const g=session?.game;if(!session)return null;return session.kind==='lan'?session.lan.phase():g.phase;}
function computeMode(){
  const ph=phaseOf();if(!ph)return 'title';
  if(ph==='closed')return 'closed';if(ph==='lobby')return 'lobby';if(ph==='over')return 'over';return 'play';
}
let renderedMode='';
function renderMode(force){
  mode=computeMode();if(!force&&mode===renderedMode)return;const prev=renderedMode;renderedMode=mode;
  document.body.classList.toggle('playing',mode==='play');
  $('hud').hidden=!['play','over'].includes(mode);$('leave').hidden=!session;
  if(mode==='title'||mode==='closed'){show('title-panel');renderOptions();}
  else if(mode==='lobby'){show('lobby-panel');renderLobby();}
  else if(mode==='over'){show('over-panel');renderOver();}
  else{show(null);if(prev!=='play'){countdownShown=-1;held=[];fireHeld=false;}}
  if(mode!=='play'){held=[];fireHeld=false;$('hint').hidden=true;}
}
function renderLobby(){
  const lan=session?.lan;if(!lan)return;const L=lan.lobby(),host=L.host,st=L.settings;
  const cells=[0,1,2,3].map(slot=>{
    const p=L.players.find(x=>x.slot===slot),d=document.createElement('div');
    d.className='seat'+(p?.you?' you':'')+(p?'':' empty');if(st.mode==='versus')d.dataset.team=String(Config.teamOfSlot(slot));
    if(!p){d.textContent=st.mode==='versus'?'空位 · 开局时由电脑补上':'空位 · 可以再邀请朋友';return d;}
    const mini=document.createElement('div');mini.className='mini';const a=p.you?driver?.asset:peerAssets.get(p.signature);portraitInto(mini,portraitOf(a)||(p.you?driver?.portrait:null),toyEmoji(a));
    const who=document.createElement('div');who.className='who';const n=document.createElement('strong');n.textContent=p.name+(p.slot===0?'（房主）':'')+(p.you?' · 我':'');
    const k=document.createElement('span');k.className='kind-tag small';k.dataset.kind=p.kind;k.textContent=KIND_LABEL[p.kind]||'';who.append(n,k);
    const r=document.createElement('span');r.className='rd'+(p.waiting?' wait':p.ready?' ok':'');r.textContent=p.waiting?'下一场上场':p.ready?'已准备':p.online===false?'掉线':'未准备';
    d.append(mini,who,r);return d;});
  $('seats').replaceChildren(...cells);
  const set=s=>{try{lan.setSettings(s);}catch(e){error(describe(e));}renderLobby();};
  chipGroup($('lobby-mode'),Config.MODES,v=>MODE_LABEL[v],st.mode,v=>set({mode:v}),{disabled:!host});
  $('lobby-stage-opt').hidden=st.mode!=='coop';$('lobby-arena-opt').hidden=st.mode!=='versus';
  chipGroup($('lobby-stage'),STAGES,v=>String(v),st.stage,v=>set({stage:v}),{disabled:!host});
  chipGroup($('lobby-arena'),[0,1],v=>Maps.MAP_NAMES.versus[v],st.arena,v=>set({arena:v}),{disabled:!host});
  chipGroup($('lobby-cpu'),[0,1,2],v=>AI.LEVELS[v].name,st.cpu,v=>set({cpu:v}),{disabled:!host});
  $('host-hint').textContent=host?'':'（房主决定）';
  $('lobby-title').textContent='联机大厅 · '+MODE_LABEL[st.mode];
  $('ready').textContent=lan.ready()?'取消准备':'我准备好了';
  const me=L.players.find(p=>p.you);
  $('lobby-note').textContent=me?.waiting?'这一局已经开始，等打完回到大厅再上场。':L.players.length<2?'等朋友加入：在桌宠控制栏点「＋ 邀请」，最多 4 人。':st.mode==='versus'?'所有人都准备好就开始；不到 4 人时，空位由电脑坦克补上。':'所有人都准备好就开始；合作模式只有来了的人上场。';
}
$('ready').addEventListener('click',()=>{const lan=session?.lan;if(!lan)return;lan.setReady(!lan.ready());renderLobby();});
const myTeam=g=>Config.teamOfSlot(g.mySlot);
const teamName=side=>side?Config.TEAMS[+side.slice(1)].name:'';
const COOP_COLS=[['normal','普通车'],['fast','快车'],['rapid','速射车'],['armor','铁甲车']];
function statsTable(el,g,rows,versus){
  el.replaceChildren();const head=document.createElement('tr');
  for(const h of versus?['选手','队伍','击毁','被击毁']:['选手',...COOP_COLS.map(c=>c[1]),'合计','道具']){const th=document.createElement('th');th.textContent=h;head.append(th);}el.append(head);
  for(const r of rows){const tr=document.createElement('tr');if(r.slot===g.mySlot)tr.className='you';
    const td0=document.createElement('td');const dot=document.createElement('span');dot.className='dot';dot.style.background=colorOf(r.slot);td0.append(dot,r.name);tr.append(td0);
    const cells=versus?[Config.TEAMS[Config.teamOfSlot(r.slot)].name,r.kills,r.deaths]:[...COOP_COLS.map(c=>r[c[0]]||0),COOP_COLS.reduce((a,c)=>a+(r[c[0]]||0),0),r.items||0];
    for(const v of cells){const td=document.createElement('td');td.textContent=String(v);tr.append(td);}el.append(tr);}
}
function renderOver(){
  const g=session.game,r=(session.kind==='lan'?session.lan.result():g.result);if(!r)return;
  const guest=session.kind==='lan'&&!session.lan.isHost(),versus=r.kind==='versus';
  let eyebrow,title,next,sound;
  if(versus){eyebrow='VERSUS';title=r.winner?(r.winner==='t'+myTeam(g)?'我们赢了！':teamName(r.winner)+'赢了'):'平局';next='再来一场';sound=r.winner==='t'+myTeam(g)?'win':'lose';}
  else if(r.kind==='clear'){eyebrow=r.allClear?'ALL CLEAR':'STAGE '+r.stage+' CLEAR';title=r.allClear?'6 关全部守住了！':'第 '+r.stage+' 关守住了';next=r.allClear?'从第 1 关再来':'下一关';sound='win';}
  else{eyebrow='GAME OVER';title=r.why==='base'?'零食罐被打翻了':'大家的命都用完了';next='重试这一关';sound='lose';}
  $('over-eyebrow').textContent=eyebrow;$('over-title').textContent=title;
  $('over-pips').hidden=!versus;
  if(versus){const [a,b]=r.teamKills||[0,0];$('over-pips').replaceChildren();for(const [t,n] of [[0,a],[1,b]]){const s=document.createElement('span');s.style.color=Config.TEAMS[t].color;s.textContent=Config.TEAMS[t].name;const sc=document.createElement('span');sc.className='score';sc.textContent=String(n);if(t===0)$('over-pips').append(s,sc);else $('over-pips').append(sc,s);}}
  statsTable($('over-stats'),g,r.allClear?r.totals:r.stats,versus);
  $('next').hidden=guest;$('next').textContent=next;
  $('to-title').textContent=session.kind==='lan'&&!guest?'回大厅':'回到开始';
  $('over-note').textContent=guest?'等房主选择下一步。':r.allClear?'表里是 6 关的合计。':versus?'击毁数算上对面的每一次重生。':r.kind==='clear'?'命数和星级带到下一关；出局的人以 3 条命、0 星重新上场。':'重试时所有人都回到 3 条命、0 星。';
  audio.play(sound);
}

// ---------- HUD ----------
let countdownShown=-1,lastSec=-1,lastBar='';
function hud(g){
  const w=g.world;if(!w)return;
  const versus=g.mode==='versus';
  $('enemies').hidden=versus;$('left').hidden=versus;$('versus-score').hidden=!versus;$('timer').hidden=!versus;
  if(versus){
    const [a,b]=w.teamKills;$('versus-score').innerHTML='';for(const [t,n] of [[0,a],[1,b]]){const s=document.createElement('span');s.style.color=Config.TEAMS[t].color;s.style.margin='0 4px';s.textContent=t===0?Config.TEAMS[0].name+' '+n:n+' '+Config.TEAMS[1].name;$('versus-score').append(s,t===0?' : ':'');}
    const left=Math.max(0,w.playMs-Math.max(0,w.t)),sec=Math.ceil(left/1000);$('timer').textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');$('timer').dataset.low=String(left<=15000);
    $('stage-no').textContent=w.mapName;
    if(w.t>=0&&left<=10000&&sec!==lastSec){lastSec=sec;audio.play('tick');}
  }else{
    $('stage-no').textContent='第 '+w.stage+' 关';
    const box=$('enemies');if(box.childElementCount!==w.queue.length){box.replaceChildren(...w.queue.map(()=>document.createElement('i')));}
    [...box.children].forEach((i,k)=>i.classList.toggle('gone',k<w.killed));
    $('left').textContent='还剩 '+(w.queue.length-w.killed)+' 辆';
  }
  const jar=$('jar'),mine=w.bases.find(b=>b.team===(versus?myTeam(g):0));
  if(mine?.dead){jar.dataset.state='down';jar.textContent='零食罐翻了';}
  else if(w.t<w.tapeUntil){jar.dataset.state='tape';jar.textContent='胶带加固 '+Math.ceil((w.tapeUntil-w.t)/1000)+' 秒';}
  else if(w.t<w.clockUntil){jar.dataset.state='clock';jar.textContent='闹钟：敌车停 '+Math.ceil((w.clockUntil-w.t)/1000)+' 秒';}
  else{jar.dataset.state='safe';jar.textContent=versus?'自家零食罐安全':'零食罐安全';}
  // Player bar (rebuilt only when something on it changes).
  const key=JSON.stringify(w.players.map(p=>[p.slot,p.alive,p.lives,p.stars,p.stats.kills,w.t<p.shieldUntil,w.t<p.frozenUntil,p.respawnAt?Math.ceil((p.respawnAt-w.t)/1000):0]))+rosterKey;
  if(key!==lastBar){lastBar=key;$('bar').replaceChildren(...w.players.map(p=>{const r=g.roster.find(x=>x.slot===p.slot);const d=document.createElement('div');d.className='pp'+(p.slot===g.mySlot?' you':'')+(!p.alive&&!p.respawnAt?' out':'');d.dataset.slot=String(p.slot);
    const dot=document.createElement('span');dot.className='dot';dot.style.background=colorOf(p.slot);const b=document.createElement('b');b.textContent=r?.name||'';
    const lv=document.createElement('span');lv.className='lv';lv.textContent=versus?'击毁 '+p.stats.kills:'命 '+p.lives;
    const st=document.createElement('span');st.className='star';st.textContent='★'.repeat(p.stars)+'☆'.repeat(3-p.stars);
    d.append(dot,b,lv,st);
    const tag=(k,text)=>{const s=document.createElement('span');s.className='st';s.dataset.k=k;s.textContent=text;d.append(s);};
    if(!p.alive)tag('dead',p.respawnAt?'重生 '+Math.max(0,Math.ceil((p.respawnAt-w.t)/1000))+' 秒':'出局');
    else if(w.t<p.frozenUntil)tag('freeze','定身');else if(w.t<p.shieldUntil&&w.t>=0)tag('shield','护盾');
    return d;}));}
  if(w.t<0){const n=Math.ceil(-w.t/1000);if(n!==countdownShown&&n>0&&n<=3){if(countdownShown<0)announce(versus?'组队对战':'第 '+w.stage+' 关',{small:true,ms:700});else announce(String(n));countdownShown=n;audio.play('beep');}}
  else if(countdownShown>0){countdownShown=0;announce('开始！',{ms:700});audio.play('go');}
  const me=Sim.player(w,g.mySlot),hint=$('hint');
  if(me&&!me.alive&&!w.result){hint.hidden=false;hint.textContent=me.respawnAt?Math.max(0,Math.ceil((me.respawnAt-w.t)/1000))+' 秒后在出生点重生':'你的命用完了，看队友守家';}
  else if(me&&me.alive&&w.t<me.frozenUntil){hint.hidden=false;hint.textContent='被队友打中了，定身 2 秒';}
  else if(!me&&w.t>=0){hint.hidden=false;hint.textContent='观战中：下一局上场';}
  else hint.hidden=true;
}
// Shots this screen has flown this stage, by shooter (read by the tests' state hook).
let firesSeen={};
function onEvents(g,events){
  const w=g.world;
  for(const e of events){
    if(e.type==='fire'&&e.by?.p!==undefined)firesSeen[e.by.p]=(firesSeen[e.by.p]||0)+1;
    if(e.type==='stage')firesSeen={};
    if(e.type==='fire'&&e.by?.p===g.mySlot)audio.play('fire');
    else if(e.type==='hit')audio.play(e.what==='steel'?'steel':e.what==='brick'?'brick':e.what==='bullet'?'clink':'thud');
    else if(e.type==='kill'||e.type==='die')audio.play('boom');
    else if(e.type==='pick')audio.play('pick');
    else if(e.type==='freeze'&&e.slot===g.mySlot)audio.play('freeze');
    else if(e.type==='base')audio.play('jar');
    else if(e.type==='stage')syncPlayers(true);
  }
  void w;
}

// ---------- loops ----------
// Simulation: fixed 60 Hz on wall time (setInterval keeps running when the window is covered).
const STEP=1000/60;let acc=0,lastT=performance.now();
setInterval(()=>{
  try{
    const t=performance.now();acc=Math.min(acc+(t-lastT),500);lastT=t;
    const s=session;if(!s){acc=0;return;}
    while(acc>=STEP){acc-=STEP;const input=mode==='play'?readInput():{dx:0,dy:0};const ev=s.step(STEP,input);if(s.game)onEvents(s.game,ev||[]);}
  }catch(e){console.error(e);error(describe(e));}
},1000/120);
let lastFrame=performance.now(),lastLobby=0,idle=null;
function idleWorld(){if(!idle){idle=Sim.createWorld({seed:20260930,roster:[{slot:0}]});idle.t=1;}return idle;}
function frame(now){
  const dt=Math.min(0.1,(now-lastFrame)/1000);lastFrame=now;
  try{
    renderMode();if(mode==='lobby'&&now-lastLobby>400){lastLobby=now;renderLobby();}
    if(mode==='closed'&&session){const s=session;session=null;error(s.lan.closeReason()==='left'?'':'联机已结束：房主离开或连接断开。');renderMode(true);syncPlayers(true);}
    const g=session?.game;
    if(g?.world){syncPlayers();world.render(dt,{world:g.world,viewerSide:g.mode==='versus'?'t'+myTeam(g):'p'});if(mode==='play'||mode==='over')hud(g);if(mode!=='play')$('hint').hidden=true;}
    else world.render(dt,{world:idleWorld()});
  }catch(e){console.error(e);}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- test / diagnostics hook (read-only view of the state) ----------
window.__tank={
  state:()=>{const g=session?.game,w=g?.world,me=w&&Sim.player(w,g.mySlot);return {mode,driver:driver?{kind:driver.profile.kind,name:driver.profile.name}:null,session:session?.kind||null,
    phase:phaseOf(),stage:g?.stage||0,gameMode:g?.mode||null,t:w?Math.round(w.t):null,mySlot:g?.mySlot??null,
    me:me?{x:me.x,y:me.y,dir:me.dir,alive:me.alive,lives:me.lives,stars:me.stars,frozen:w.t<me.frozenUntil,shield:w.t<me.shieldUntil}:null,
    players:w?w.players.map(p=>({slot:p.slot,x:p.x,y:p.y,alive:p.alive,lives:p.lives,kind:p.kind})):[],
    enemies:w?w.enemies.length:0,killed:w?.killed||0,
    bullets:w?w.bullets.filter(b=>!b.done).map(b=>({id:b.id,by:b.owner,x:b.x,y:b.y})):[],fires:{...firesSeen},
    hash:w?Sim.hash(w.terrain):null,result:g?(session.kind==='lan'?session.lan.result():g.result):null,
    lobby:session?.lan?session.lan.lobby().players.map(p=>({slot:p.slot,name:p.name,kind:p.kind,ready:p.ready,you:p.you})):null,
    audio:audio.state(),net:session?.lan?.stats?.()||null};},
  world:()=>world.info(),
  screen:(x,y,h)=>world.project(x,y,h),
};

// ---------- boot ----------
(async()=>{
  renderOptions();
  driver=await C.loadDriver('last')||await C.toyDriver('mouse');renderFighterCard();syncPlayers(true);
  $('env-note').textContent=sdk?'在桌宠里打开：会自动带入你的桌宠。和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML。':'普通浏览器打开：可以单人玩；导入角色包或图片可以换形象。';
  if(sdk?.character&&await readPet())await joinInvitation();
  else if(sdk?.sessions)await joinInvitation();
})().catch(e=>{console.error(e);error(describe(e));});
