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
      // A lake is an outlet, not permission to climb into its surface.
      if(water[j]){if(height[j]>height[i])continue;}
      else if(!(height[j]<height[i]||(height[j]===height[i]&&j<i)))continue;
      const drop=water[j]?Math.max(0,height[i]-height[j]):height[i]-height[j];
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
  return {down,flow,channel,reachesWater,coastDistance,order,height};
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
/* Main-stem tangent: retain the largest donor for smooth junctions. */
function riverDrainagePrimaryUpstream(network){
  const {down,channel,flow}=network;
  const up=new Int32Array(down.length).fill(-1);
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0||!channel[j])continue;
    if(up[j]<0||flow[i]>flow[up[j]])up[j]=i;
  }
  return up;
}

/* Spherical Catmull-Rom with bounded, deterministic lowland curvature.
   Endpoints remain fixed on the drainage graph; bends cannot connect shores
   or cross basin boundaries by inventing new edges. */
function riverDrainageCurvePoint(grid,network,i,j,upstream,t,out){
  const {dirs}=grid,down=network.down;
  const prev=upstream[i]>=0?upstream[i]:i,next=down[j]>=0?down[j]:j;
  const a=3*prev,b=3*i,c=3*j,d=3*next;
  const h=network.height,drop=h?Math.max(0,h[i]-h[j]):0;
  const bendSupport=1/(1+16*drop);
  const mouth=h&&h[j]<=0?0.28:1;
  const tension=0.78*bendSupport*mouth,t2=t*t,t3=t2*t;
  for(let q=0;q<3;q++){
    const p0=dirs[a+q],p1=dirs[b+q],p2=dirs[c+q],p3=dirs[d+q];
    const straight=p1+(p2-p1)*t;
    const spline=0.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+
      (-p0+3*p1-3*p2+p3)*t3);
    out[q]=straight+(spline-straight)*tension;
  }
  const nx=dirs[b+1]*dirs[c+2]-dirs[b+2]*dirs[c+1];
  const ny=dirs[b+2]*dirs[c]-dirs[b]*dirs[c+2];
  const nz=dirs[b]*dirs[c+1]-dirs[b+1]*dirs[c];
  const nlen=Math.hypot(nx,ny,nz);
  if(nlen>1e-12&&t>0&&t<1){
    let hash=Math.imul(i+1,0x45d9f3b)^Math.imul(j+1,0x119de1f3);
    hash^=hash>>>16;hash=Math.imul(hash,0x7feb352d);hash^=hash>>>15;
    const phase=(hash>>>0)/4294967296*6.283185307179586;
    const arc=Math.hypot(dirs[b]-dirs[c],dirs[b+1]-dirs[c+1],dirs[b+2]-dirs[c+2]);
    const envelope=Math.sin(Math.PI*t)**2;
    const meander=0.12*arc*bendSupport*mouth*envelope*Math.sin(2*Math.PI*t+phase);
    out[0]+=nx/nlen*meander;out[1]+=ny/nlen*meander;out[2]+=nz/nlen*meander;
  }
  const len=Math.hypot(out[0],out[1],out[2])||1;
  out[0]/=len;out[1]/=len;out[2]/=len;
  return out;
}

/* Each texel stores the nearest SHORT analytic segment of a smoothed river.
   Smoothing is geometry only: topology, discharge and sinks remain physical. */
function riverDrainageRaster(grid,network,M){
  const {down,channel,flow}=network;
  const faces=Array.from({length:6},()=>new Float32Array(M*M*4));
  const best=Array.from({length:6},()=>new Float32Array(M*M).fill(Infinity));
  const upstream=riverDrainagePrimaryUpstream(network);
  const seen=new Set(),padding=3,scale=M*0.5;
  const subdivisions=2,curve=new Float64Array((subdivisions+1)*3);
  let segments=0;
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0)continue;segments++;
    const bin=Math.max(1,Math.min(15,Math.round(1+3*Math.log2(1+flow[i]/10))));
    for(let s=0;s<=subdivisions;s++)
      riverDrainageCurvePoint(grid,network,i,j,upstream,s/subdivisions,curve.subarray(3*s,3*s+3));
    for(let s=0;s<subdivisions;s++){
      const a=curve.subarray(3*s,3*s+3),b=curve.subarray(3*(s+1),3*(s+1)+3);
      seen.clear();
      for(const p of [a,b])for(let axis=0;axis<3;axis++)
        if(Math.abs(p[axis])>=Math.max(Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]))-6/M)
          seen.add(axis*2+(p[axis]<0?1:0));
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
  }
  return {faces,segments};
}
