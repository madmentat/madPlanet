/* Render-terrain drainage. Each land cell has one strictly lower receiver;
   equal-height plateaus use a stable index order. Water cells are terminal.
   Closed dry depressions are left without a surface outlet, never breached
   uphill to manufacture a river. The weather solver still owns water mass. */
function riverDrainageBuild(height,water,moisture,neighbors,area,options={}){
  const n=height.length,down=new Int32Array(n).fill(-1);
  const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>height[a]-height[b]||a-b);
  const reachesWater=new Uint8Array(n),flow=new Float64Array(n),channel=new Uint8Array(n);
  const coastDistance=new Int32Array(n).fill(-1),queue=new Int32Array(n);
  let head=0,tail=0;
  for(let i=0;i<n;i++)if(water[i]){reachesWater[i]=1;coastDistance[i]=0;queue[tail++]=i;}
  while(head<tail){
    const i=queue[head++];
    const edges=neighbors[i];
    for(let k=0;k<edges.length;k+=2){
      const j=edges[k];
      if(coastDistance[j]<0){coastDistance[j]=coastDistance[i]+1;queue[tail++]=j;}
    }
  }
  for(const i of order){
    if(water[i])continue;
    let best=-Infinity;
    const edges=neighbors[i];
    for(let k=0;k<edges.length;k+=2){
      const j=edges[k],distance=edges[k+1];
      if(!water[j]&&!(height[j]<height[i]||(height[j]===height[i]&&j<i)))continue;
      const drop=water[j]?Math.max(0.00001,height[i]-height[j]):height[i]-height[j];
      const slope=drop/Math.max(1e-9,distance);
      if(slope>best||(slope===best&&j<down[i])){best=slope;down[i]=j;}
    }
    if(down[i]>=0)reachesWater[i]=reachesWater[down[i]];
    // A wet catchment supplies more tributaries; a dry local patch cannot
    // erase a trunk which already carries water from its upstream basin.
    const m=Math.max(0,Math.min(1,(moisture[i]-0.25)/0.40));
    flow[i]=(area?.[i]??1)*m*m*(3-2*m);
  }
  const sourceArea=options.sourceArea??10,sourceInset=options.sourceInset??3;
  for(let k=n-1;k>=0;k--){
    const i=order[k],j=down[i];
    if(water[i]||!reachesWater[i]||j<0)continue;
    if(flow[i]>=sourceArea&&coastDistance[i]>=sourceInset&&height[i]>0.01)channel[i]=1;
    flow[j]+=flow[i];
    if(channel[i]&&!water[j])channel[j]=1;
  }
  return {down,flow,channel,reachesWater,coastDistance,order};
}

function riverDrainageGrid(N){
  const count=6*N*N,dirs=new Float64Array(count*3),area=new Float64Array(count);
  const neighbors=new Array(count),d=[0,0,0],uv={};
  for(let f=0;f<6;f++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=riverLoopIndex(f,x,y,N),u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1;
    riverLoopFaceDir(f,x+0.5,y+0.5,N,d);dirs.set(d,3*i);
    area[i]=1/Math.pow(1+u*u+v*v,1.5);
  }
  for(let f=0;f<6;f++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=riverLoopIndex(f,x,y,N),seen=new Set(),edges=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const j=riverLoopNeighborIndex(f,x,y,dx,dy,N,d,uv);
      if(j===i||seen.has(j))continue;seen.add(j);
      const distance=Math.hypot(dirs[3*i]-dirs[3*j],dirs[3*i+1]-dirs[3*j+1],dirs[3*i+2]-dirs[3*j+2]);
      edges.push(j,distance);
    }
    neighbors[i]=Float64Array.from(edges);
  }
  return {N,dirs,area,neighbors};
}

// Project an endpoint onto the selected cube face, including seam margins.
function riverDrainageProject(face,x,y,z){
  if(face===0)return [-z/x,y/x];
  if(face===1)return [-z/x,-y/x];
  if(face===2)return [x/y,-z/y];
  if(face===3)return [-x/y,-z/y];
  if(face===4)return [x/z,y/z];
  return [x/z,-y/z];
}

/* Each display texel stores a nearby segment, not a water-filled pixel.
   The fragment shader computes distance to that segment analytically, so a
   50-km grid cell can contain a 200-m river without becoming a blue blot.
   R packs a 1..15 width bin in multiples of 8 plus endpoint A's face U;
   G/B/A hold A.V/B.U/B.V. RGBA32F + NEAREST preserves endpoint precision. */
function riverDrainageRaster(grid,network,M){
  const {dirs}=grid,{down,channel,flow}=network;
  const faces=Array.from({length:6},()=>new Float32Array(M*M*4));
  const best=Array.from({length:6},()=>new Float32Array(M*M).fill(Infinity));
  const seen=new Set(),padding=3,scale=M*0.5;
  let segments=0;
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0)continue;segments++;
    const a=dirs.subarray(3*i,3*i+3),b=dirs.subarray(3*j,3*j+3);
    // A small seam overlap includes both faces (three at cube corners).
    seen.clear();
    for(const p of [a,b])for(let axis=0;axis<3;axis++)
      if(Math.abs(p[axis])>=Math.max(Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]))-6/M)
        seen.add(axis*2+(p[axis]<0?1:0));
    const bin=Math.max(1,Math.min(15,Math.round(1+3*Math.log2(1+flow[i]/10))));
    for(const face of seen){
      const av=riverDrainageProject(face,...a),bv=riverDrainageProject(face,...b);
      const ax=(av[0]+1)*scale,ay=(1-av[1])*scale,bx=(bv[0]+1)*scale,by=(1-bv[1])*scale;
      const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
      const x0=Math.max(0,Math.floor(Math.min(ax,bx)-padding)),x1=Math.min(M-1,Math.ceil(Math.max(ax,bx)+padding));
      const y0=Math.max(0,Math.floor(Math.min(ay,by)-padding)),y1=Math.min(M-1,Math.ceil(Math.max(ay,by)+padding));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const t=Math.max(0,Math.min(1,((x+0.5-ax)*dx+(y+0.5-ay)*dy)/Math.max(1e-12,len2)));
        const dist=(x+0.5-ax-t*dx)**2+(y+0.5-ay-t*dy)**2,k=y*M+x;
        if(dist>=best[face][k])continue;
        best[face][k]=dist;faces[face].set([av[0]+8*bin,av[1],bv[0],bv[1]],4*k);
      }
    }
  }
  return {faces,segments};
}
