'use strict';
// Route finding for computer tanks (SPEC §1, §8). Tanks line up on half cells, so the graph is
// the lattice of tank centres x = ix / 2, y = iy / 2 (ix 1 … 2W−1, iy 1 … 2H−1); a tank there
// covers bricks ix−1 … ix and iy−1 … iy. Bricks can be shot through (they cost extra); steel,
// water and bases cannot be crossed.
const {W,H,BW,T}=require('./config.cjs');
const LW=2*W+1,LH=2*H+1,N=LW*LH,BRICK_COST=3;
const DX=[0,1,0,-1],DY=[-1,0,1,0];
const node=(ix,iy)=>iy*LW+ix;
const valid=(ix,iy)=>ix>=1&&iy>=1&&ix<=2*W-1&&iy<=2*H-1;
function cost(terrain,ix,iy){
  if(!valid(ix,iy))return Infinity;
  let c=1;
  for(let by=iy-1;by<=iy;by++)for(let bx=ix-1;bx<=ix;bx++){
    const t=terrain[by*BW+bx];
    if(t===T.steel||t===T.water||t===T.base||t===T.wreck)return Infinity;
    if(t===T.brick)c=1+BRICK_COST;
  }
  return c;
}
// Binary heap of [dist, node].
function heap(){const a=[];return {push(d,n){a.push([d,n]);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<=a[i][0])break;[a[p],a[i]]=[a[i],a[p]];i=p;}},
  pop(){const top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){const l=2*i+1,r=l+1;let m=i;if(l<a.length&&a[l][0]<a[m][0])m=l;if(r<a.length&&a[r][0]<a[m][0])m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m;}}return top;},get size(){return a.length;}};}
// Distance from every lattice node to the nearest target node (entering a node costs its cost).
function field(terrain,targets){
  const dist=new Float32Array(N).fill(Infinity),q=heap();
  for(const n of targets){if(dist[n]===0)continue;dist[n]=0;q.push(0,n);}
  while(q.size){
    const [d,n]=q.pop();if(d>dist[n])continue;
    const ix=n%LW,iy=(n-ix)/LW,c=cost(terrain,ix,iy);if(c===Infinity&&d>0)continue;
    for(let k=0;k<4;k++){
      const jx=ix+DX[k],jy=iy+DY[k];if(!valid(jx,jy))continue;
      // Moving from j into n costs n's cost (the node you drive into).
      const j=node(jx,jy),cj=cost(terrain,jx,jy);if(cj===Infinity)continue;
      const nd=d+(c===Infinity?1:c);if(nd<dist[j]){dist[j]=nd;q.push(nd,j);}
    }
  }
  return dist;
}
// Lattice nodes next to a base (one brick away from its 2×2 bricks, crossable).
function baseTargets(terrain,base){
  const out=[];
  for(let iy=1;iy<=2*H-1;iy++)for(let ix=1;ix<=2*W-1;ix++){
    if(cost(terrain,ix,iy)===Infinity)continue;
    const bx0=ix-1,by0=iy-1; // covered bricks bx0…bx0+1
    const gapX=Math.max(base.bx-(bx0+1),bx0-(base.bx+1),0),gapY=Math.max(base.by-(by0+1),by0-(base.by+1),0);
    if(gapX+gapY<=1&&!(gapX===0&&gapY===0))out.push(node(ix,iy));
  }
  return out;
}
const nearestNode=(x,y)=>node(Math.max(1,Math.min(2*W-1,Math.round(x*2))),Math.max(1,Math.min(2*H-1,Math.round(y*2))));
// Best direction (0–3) to leave (x, y) along the field; null at a target or when stuck.
function nextDir(f,x,y){
  const n=nearestNode(x,y),ix=n%LW,iy=(n-ix)/LW;let best=null,bd=f[n];
  for(let k=0;k<4;k++){const jx=ix+DX[k],jy=iy+DY[k];if(!valid(jx,jy))continue;const d=f[node(jx,jy)];if(d<bd){bd=d;best=k;}}
  return best;
}
module.exports={LW,LH,N,node,valid,cost,field,baseTargets,nearestNode,nextDir,DX,DY,BRICK_COST};
