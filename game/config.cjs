'use strict';
// Numbers from docs/SPEC.zh-CN.md. Times are integer milliseconds; positions are in cells:
// cell (i, j) covers x ∈ [i, i+1], y ∈ [j, j+1]; a brick is half a cell.
module.exports={
  W:19,H:13,BW:38,BH:26,
  // Terrain per brick.
  T:{floor:0,brick:1,steel:2,water:3,rug:4,ice:5,base:6,wreck:7},
  TANK:{half:0.48},
  PLAYER:{speed:3,lives:3,respawnMs:3000,spawnShieldMs:2000,freezeMs:2000,maxStars:3,iceSlide:0.6,refireMs:260},
  BULLET:{half:0.12,speed:{normal:8,fast:13},nose:0.42},
  // Stars → bullets in the air, speed, pierces steel.
  STARS:[{max:1,speed:'normal',pierce:false},{max:1,speed:'fast',pierce:false},{max:2,speed:'fast',pierce:false},{max:2,speed:'fast',pierce:true}],
  ENEMY_TYPES:{
    normal:{speed:2.5,bullet:'normal',hp:1,name:'普通车'},
    fast:{speed:4.5,bullet:'normal',hp:1,name:'快车'},
    rapid:{speed:2.5,bullet:'fast',hp:1,name:'速射车'},
    armor:{speed:2,bullet:'normal',hp:4,name:'铁甲车'},
  },
  KINDS:['normal','fast','rapid','armor'],
  // Twenty per stage: [normal, fast, rapid, armor].
  WAVES:[[18,2,0,0],[14,4,2,0],[10,4,4,2],[6,6,4,4],[4,6,4,6],[2,6,6,6]],
  STAGE:{enemies:20,field:4,fieldMax:7,warnMs:1000,flash:[4,11,18],itemMs:20000,countdownMs:3000},
  ITEMS:['star','shield','tape','boom','clock','fish'],
  ITEM:{shieldMs:10000,tapeMs:15000,clockMs:10000,half:0.45},
  VERSUS:{playMs:180000},
  MODES:['coop','versus'],
  STAGES:6,
  TEAMS:[{name:'橘队',color:'#f47a12'},{name:'蓝队',color:'#2a5bd7'}],
  SLOT_COLORS:['#f47a12','#2a5bd7','#1fb86a','#e2489a'],
  // Versus: slots 0 and 3 are orange (left), 1 and 2 blue (right) — the first guest faces the host.
  teamOfSlot:slot=>slot===0||slot===3?0:1,
};
