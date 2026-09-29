'use strict';
// The maps (SPEC §1): six co-op stages and two versus arenas, 19 × 13 cells each.
// One character per cell (four bricks):
//   .  floor        b  bricks        s  steel        w  water        g  rug        i  ice
//   -  _  [  ]      half bricks: top / bottom / left / right half of the cell
//   ^  v  <  >      half steel, same halves
//   H  a snack jar (the base); its ring of eight bricks is added by the parser
const {W,H,BW,BH,T}=require('./config.cjs');

const COOP=[
 [ // 1 — the playroom
  '...................',
  '.b.b.b.b...b.b.b.b.',
  '.b.b.b.bsssb.b.b.b.',
  '.b.b.b.b...b.b.b.b.',
  '.....gg.....gg.....',
  'ss..bbbwww.bbb..ss.',
  'gg...b.iiiii.b...gg',
  '.....bb.....bb.....',
  '.b.b.b.b...b.b.b.b.',
  '.b.b.b.b.b.b.b.b.b.',
  '.b.b...........b.b.',
  '...................',
  '.........H.........'],
 [ // 2 — rugs in the corners
  '...................',
  '..bb..s.....s..bb..',
  '..bb..s.bbb.s..bb..',
  '......b.....b......',
  '.ggg..b..s..b..ggg.',
  '.ggg.....b.....ggg.',
  'bb..bb.bb.bb.bb..bb',
  '....w.........w....',
  '.b..w.b.bbb.b.w..b.',
  '.b....b.....b....b.',
  '.b.bbbb.....bbbb.b.',
  '...................',
  '.........H.........'],
 [ // 3 — the waxed hall
  '...................',
  '.s.s.s.s...s.s.s.s.',
  '...................',
  'bbbbb.iiiiiii.bbbbb',
  'b...b.iiiiiii.b...b',
  'b.g.b.ii.s.ii.b.g.b',
  'b...b.iiiiiii.b...b',
  'bb.bb.........bb.bb',
  '......bbb.bbb......',
  '.ww...b.....b...ww.',
  '.ww.............ww.',
  '....bb.......bb....',
  '.........H.........'],
 [ // 4 — the spilled river
  '...................',
  '.bbb.bbb...bbb.bbb.',
  '.b.....b...b.....b.',
  '.b.ggg.b.s.b.ggg.b.',
  '...ggg.........ggg.',
  'www.wwwww.wwwww.www',
  '...................',
  '.bb.ss.bb.bb.ss.bb.',
  '.bb....bb.bb....bb.',
  '.....g.......g.....',
  '.bbb.g.bb.bb.g.bbb.',
  '...................',
  '.........H.........'],
 [ // 5 — the maze
  '...................',
  '.bbbbbbb...bbbbbbb.',
  '.b.....s...s.....b.',
  '.b.bbb.s.b.s.bbb.b.',
  '.b.b...........b.b.',
  '...b.bbbb.bbbb.b...',
  'ss.g.b.......b.g.ss',
  '...g.b.bb.bb.b.g...',
  '.bbb...b...b...bbb.',
  '.....b.b.s.b.b.....',
  '.bb..b.......b..bb.',
  '....ii.......ii....',
  '.........H.........'],
 [ // 6 — the fortress
  '...................',
  '.s..bbb.....bbb..s.',
  '.s..b.........b..s.',
  '....b.sssssss.b....',
  'bb....b.....b....bb',
  '..gggg..bbb..gggg..',
  '..gggg.b...b.gggg..',
  'ww....bb.s.bb....ww',
  '...bb.........bb...',
  '.s.bb.bb...bb.bb.s.',
  '......b.....b......',
  '..b.............b..',
  '.........H.........'],
];
const VERSUS=[
 [ // A — the long hall
  '...................',
  '..b....s...s....b..',
  '..b.bb.s...s.bb.b..',
  '......b.....b......',
  '...b..b.www.b..b...',
  '......b.....b......',
  'H.....ggg.ggg.....H',
  '......b.....b......',
  '...b..b.www.b..b...',
  '......b.....b......',
  '..b.bb.s...s.bb.b..',
  '..b....s...s....b..',
  '...................'],
 [ // B — the ice rink
  '...................',
  '.s..bbb.....bbb..s.',
  '....b...iii...b....',
  '...bb...iii...bb...',
  '.....ss.....ss.....',
  '....b.........b....',
  'H...b..bb.bb..b...H',
  '....b.........b....',
  '.....ss.....ss.....',
  '...bb...iii...bb...',
  '....b...iii...b....',
  '.s..bbb.....bbb..s.',
  '...................'],
];
const MAP_NAMES={coop:['玩具房','角落毛毯','打蜡大厅','打翻的水','积木迷宫','饼干盒城堡'],versus:['长走廊','溜冰场']};

// Tank centres (cells) and the direction they face: 0 up, 1 right, 2 down, 3 left.
const ENEMY_SPAWNS=[[0.5,0.5],[9.5,0.5],[18.5,0.5]];
const COOP_SPAWNS=[[7.5,12.5,0],[11.5,12.5,0],[5.5,12.5,0],[13.5,12.5,0]];
const VERSUS_SPAWNS=[[2.5,4.5,1],[16.5,8.5,3],[16.5,4.5,3],[2.5,8.5,1]];

const bi=(bx,by)=>by*BW+bx;
const HALVES={'-':[[0,0],[1,0]],'_':[[0,1],[1,1]],'[':[[0,0],[0,1]],']':[[1,0],[1,1]]};
const STEEL_HALVES={'^':'-','v':'_','<':'[','>':']'};
function parse(rows){
  if(rows.length!==H||rows.some(r=>r.length!==W))throw Error('map must be '+W+'×'+H);
  const terrain=new Uint8Array(BW*BH),bases=[];
  const fill=(x,y,cells,v)=>{for(const [dx,dy] of cells)terrain[bi(x*2+dx,y*2+dy)]=v;};
  const ALL=[[0,0],[1,0],[0,1],[1,1]];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const c=rows[y][x];
    if(c==='.')continue;
    else if(c==='b')fill(x,y,ALL,T.brick);
    else if(c==='s')fill(x,y,ALL,T.steel);
    else if(c==='w')fill(x,y,ALL,T.water);
    else if(c==='g')fill(x,y,ALL,T.rug);
    else if(c==='i')fill(x,y,ALL,T.ice);
    else if(HALVES[c])fill(x,y,HALVES[c],T.brick);
    else if(STEEL_HALVES[c])fill(x,y,HALVES[STEEL_HALVES[c]],T.steel);
    else if(c==='H'){fill(x,y,ALL,T.base);bases.push({bx:x*2,by:y*2,x:x+0.5,y:y+0.5});}
    else throw Error('unknown map cell '+JSON.stringify(c));
  }
  // The ring of bricks around each base (inside the field).
  for(const b of bases){
    b.ring=[];
    for(let by=b.by-1;by<=b.by+2;by++)for(let bx=b.bx-1;bx<=b.bx+2;bx++){
      if(bx<0||by<0||bx>=BW||by>=BH)continue;if(bx>=b.bx&&bx<=b.bx+1&&by>=b.by&&by<=b.by+1)continue;
      terrain[bi(bx,by)]=T.brick;b.ring.push(bi(bx,by));
    }
  }
  return {terrain,bases};
}
// mode 'coop': stage 1–6; mode 'versus': arena 0–1.
function load(mode,no){
  const rows=mode==='versus'?VERSUS[no%VERSUS.length]:COOP[(no-1)%COOP.length];
  const m=parse(rows);
  if(mode==='versus'){m.bases.sort((a,b)=>a.x-b.x);m.bases.forEach((b,i)=>{b.team=i;});m.spawns=VERSUS_SPAWNS;}
  else{m.bases[0].team=0;m.spawns=COOP_SPAWNS;}
  m.enemySpawns=mode==='versus'?[]:ENEMY_SPAWNS;
  m.name=MAP_NAMES[mode][mode==='versus'?no%VERSUS.length:(no-1)%COOP.length];
  return m;
}
module.exports={COOP,VERSUS,MAP_NAMES,ENEMY_SPAWNS,COOP_SPAWNS,VERSUS_SPAWNS,parse,load,bi};
