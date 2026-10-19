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
  // A single downstream pointer gives every cell one stable basin outlet.
  // Dry local minima stay endorheic; only cells with reachesWater may paint
  // permanent surface channels. All cube-face seams use the same graph.
  const basin=new Int32Array(n).fill(-1);
  for(let i=0;i<n;i++)if(water[i])basin[i]=i;
  for(const i of order)if(!water[i])
    basin[i]=down[i]>=0?basin[down[i]]:i;
  return {down,flow,channel,reachesWater,coastDistance,order,height,water,basin};
}

function riverDrainageGrid(N){
  const count=6*N*N,dirs=new Float64Array(count*3),artDirs=new Float32Array(count*3),area=new Float64Array(count);
  const neighbors=new Array(count),d=[0,0,0],uv={};
  for(let f=0;f<6;f++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=riverLoopIndex(f,x,y,N),u=2*(x+0.5)/N-1,v=2*(y+0.5)/N-1;
    riverLoopFaceDir(f,x+0.5,y+0.5,N,d);dirs.set(d,3*i);
    // Tiny repeatable within-cell offsets break the map's 8 compass tracks.
    // Every tributary uses exactly the same cached vertex at a junction.
    let h=Math.imul(i+1,0x9e3779b1)^0x6c8e9cf5;
    h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;
    const dx=((h>>>0)/4294967296-0.5)*0.36;
    h=Math.imul(h^0x85ebca6b,0x846ca68b);h^=h>>>16;
    const dy=((h>>>0)/4294967296-0.5)*0.36;
    riverLoopFaceDir(f,x+0.5+dx,y+0.5+dy,N,d);artDirs.set(d,3*i);
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
  return {N,dirs,artDirs,area,neighbors};
}

/* A visual width scale for unitless accumulated high-res runoff Q.
   The coarse Weather Core already stores physical widths in metres; here
   we keep Q^b as a display proxy because the grids are not equivalent.
   1..15 bins fit two endpoint widths alongside the four cube UV values. */
function riverDrainageWidthBin(Q){
  return Math.max(1,Math.min(15,Math.round(1+1.30*Math.pow(Math.max(0,Q),0.38))));
}

/* Pick one main donor at every confluence. Its visible edge widens
   towards the combined downstream flow; smaller side streams remain narrow
   right up to the junction instead of swelling into identical funnels. */
function riverDrainagePrimaryUpstream(network){
  const {down,channel,flow}=network,main=new Int32Array(down.length).fill(-1);
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];
    if(j<0||!channel[j])continue;
    const k=main[j];
    if(k<0||flow[i]>flow[k]||(flow[i]===flow[k]&&i<k))main[j]=i;
  }
  return main;
}

/* Cheap, build-time hydrography audit. Never called from the fragment shader.
   Each channel has exactly one downstream path; a single outlet per physical
   catchment excludes rivers connecting two opposite ocean shores. */
function riverDrainageDiagnostics(network){
  const {down,channel,water,height,basin,flow}=network,n=down.length;
  const incoming=new Uint16Array(n),outlets=new Set();
  let segments=0,mouths=0,uphill=0,dangling=0,maxFlow=0;
  for(let i=0;i<n;i++){
    if(!channel[i])continue;segments++;
    const j=down[i];maxFlow=Math.max(maxFlow,flow[i]);
    if(j<0||j>=n||(!water[j]&&!channel[j])){dangling++;continue;}
    if(height[j]>height[i]+1e-7)uphill++;
    if(water[j])mouths++;else incoming[j]++;
    outlets.add(basin[i]);
  }
  let sources=0;
  for(let i=0;i<n;i++)if(channel[i]&&!incoming[i])sources++;
  return {segments,sources,mouths,basins:outlets.size,uphill,dangling,maxFlow};
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

/* The surface shader supplies smooth S-bends analytically. Store exactly
   ONE short edge for each D8 receiver, as before the expensive spline pass:
   no subdivided arcs, no per-sample terrain queries, no time-step physics.
   Cache the subtly offset art vertices on the cube-sphere grid once.
   The real drainage graph still decides basin ownership and the outlet. */
function riverDrainageRaster(grid,network,M){
  const {down,channel,flow,water}=network;
  const dirs=grid.artDirs||grid.dirs,realDirs=grid.dirs;
  const faces=Array.from({length:6},()=>new Float32Array(M*M*4));
  const best=Array.from({length:6},()=>new Float32Array(M*M).fill(Infinity));
  const seen=new Set(),padding=3,scale=M*0.5;
  const mainUpstream=riverDrainagePrimaryUpstream(network);
  let segments=0;
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0)continue;segments++;
    // Anchor the final two coastal cells to the actual terrain grid. Tiny
    // artistic offsets are only permitted inland, not across a narrow isthmus
    // or a shoreline the channel must not alter.
    const coast=network.coastDistance;
    const aDir=coast?.[i]<=2?realDirs:dirs;
    const bDir=water?.[j]||coast?.[j]<=2?realDirs:dirs;
    const a=aDir.subarray(3*i,3*i+3),b=bDir.subarray(3*j,3*j+3);
    seen.clear();
    for(const p of [a,b])for(let axis=0;axis<3;axis++)
      if(Math.abs(p[axis])>=Math.max(Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]))-6/M)
        seen.add(axis*2+(p[axis]<0?1:0));
    const binA=riverDrainageWidthBin(flow[i]);
    // At the receiving node, width reflects its new accumulated discharge;
    // both adjacent main-stem edges use that same value, so confluences no
    // longer create one-width-step discontinuities at the graph vertices.
    const binB=!water?.[j]&&mainUpstream[j]===i?riverDrainageWidthBin(flow[j]):binA;
    const widthCode=binA+16*binB;
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
        best[face][k]=dist;faces[face].set([av[0]+8*widthCode,av[1],bv[0],bv[1]],4*k);
      }
    }
  }
  return {faces,segments};
}
