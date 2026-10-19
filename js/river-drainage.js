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

/* The ONLY visible river representation: a prepainted grayscale cubemap.
   Direction/tributaries come from the above monotone D8 drainage graph.
   Paths are cubic curves with shared vertices. No RGBA32UI bit packing,
   no distance-search fragment shader, no screen-dependent linewidths. */

function riverDrainageCurveGeometry(grid,network){
  const n=network.down.length,main=riverDrainagePrimaryUpstream(network);
  const src=grid.artDirs||grid.dirs,real=grid.dirs,coast=network.coastDistance;
  const pos=new Float64Array(n*3),tangent=new Float64Array(n*3);
  for(let i=0;i<n;i++){
    const k=i*3,p=coast[i]<=2?real:src;
    pos[k]=p[k];pos[k+1]=p[k+1];pos[k+2]=p[k+2];
  }
  for(let i=0;i<n;i++)if(network.channel[i]){
    const j=network.down[i];if(j<0)continue;
    const k=3*i,d=3*j,u=main[i],z=3*u;
    let x=pos[d]-(u>=0?pos[z]:pos[k]);
    let y=pos[d+1]-(u>=0?pos[z+1]:pos[k+1]);
    let w=pos[d+2]-(u>=0?pos[z+2]:pos[k+2]);
    const proj=x*pos[k]+y*pos[k+1]+w*pos[k+2];
    x-=proj*pos[k];y-=proj*pos[k+1];w-=proj*pos[k+2];
    const len=Math.hypot(x,y,w)||1;
    const edge=Math.hypot(pos[d]-pos[k],pos[d+1]-pos[k+1],pos[d+2]-pos[k+2]);
    const prev=u>=0?Math.hypot(pos[z]-pos[k],pos[z+1]-pos[k+1],pos[z+2]-pos[k+2]):edge;
    const strength=0.75*Math.min(edge,prev)/len;
    tangent[k]=x*strength;tangent[k+1]=y*strength;tangent[k+2]=w*strength;
  }
  return {pos,tangent,channel:network.channel,coastDistance:coast,height:network.height,main};
}
function riverDrainageCurvePoint(g,i,j,t,out){
  const {pos,tangent,channel,coastDistance,height}=g,k=i*3,l=j*3;
  const tt=t*t,ttt=tt*t,s=1-t;
  const h0=2*ttt-3*tt+1,h1=ttt-2*tt+t;
  const h2=-2*ttt+3*tt,h3=ttt-tt;
  const strength=coastDistance[i]<=2||coastDistance[j]<=2?
    0:Math.max(0.3,1-4*Math.abs(height[i]-height[j]));
  const d0=pos[l]-pos[k],d1=pos[l+1]-pos[k+1],d2=pos[l+2]-pos[k+2];
  const m0=tangent[k],m1=tangent[k+1],m2=tangent[k+2];
  const n0=channel[j]?tangent[l]:d0*0.75;
  const n1=channel[j]?tangent[l+1]:d1*0.75;
  const n2=channel[j]?tangent[l+2]:d2*0.75;
  const x=s*pos[k]+t*pos[l],y=s*pos[k+1]+t*pos[l+1],z=s*pos[k+2]+t*pos[l+2];
  out[0]=x+strength*(h0*pos[k]+h1*m0+h2*pos[l]+h3*n0-x);
  out[1]=y+strength*(h0*pos[k+1]+h1*m1+h2*pos[l+1]+h3*n1-y);
  out[2]=z+strength*(h0*pos[k+2]+h1*m2+h2*pos[l+2]+h3*n2-z);
  const len=Math.hypot(...out)||1;
  out[0]/=len;out[1]/=len;out[2]/=len;
  return out;
}

function riverDrainageDrawDab(faces,M,dir,radius){
  // Sample all 6 faces only when the point falls inside their visible
  // projection. Draw into adjacent faces near a seam to avoid gaps there.
  const ax=Math.abs(dir[0]),ay=Math.abs(dir[1]),az=Math.abs(dir[2]);
  const dominant=Math.max(ax,ay,az),margin=(radius+1.2)/M*2.1;
  for(let f=0;f<6;f++){
    const major=f<2?dir[0]:f<4?dir[1]:dir[2];
    if((f%2===0?major:-major)<dominant*(1-margin))continue;
    const uv=riverDrainageProject(f,...dir);
    const x=(uv[0]+1)*M/2-0.5,y=(1-uv[1])*M/2-0.5;
    if(x<-(radius+2)||y<-(radius+2)||x>M+radius+1||y>M+radius+1)continue;
    const buf=faces[f],r=Math.ceil(radius+0.85);
    const x0=Math.max(0,Math.floor(x-r)),x1=Math.min(M-1,Math.ceil(x+r));
    const y0=Math.max(0,Math.floor(y-r)),y1=Math.min(M-1,Math.ceil(y+r));
    for(let py=y0;py<=y1;py++)for(let px=x0;px<=x1;px++){
      const d=Math.hypot(px-x,py-y);
      const cover=Math.min(1,Math.max(0,radius+0.65-d));
      if(cover<=0)continue;
      const k=(py*M+px)*4,alpha=Math.round(255*cover);
      if(buf[k]<alpha)buf[k]=alpha;
    }
  }
}

/* Draw all routed channels ONCE when terrain/seed changes, including small
   feeders. Width depends only on accumulated discharge, not on zoom.
   A real land/water decision is made in riverDrainageBuild; the shader also
   clips river pixels to terrain height>0. Rivers have one downhill receiver
   and one outlet per connected tree: no ocean-to-ocean canals. */
function riverDrainageRaster(grid,network,M){
  const faces=Array.from({length:6},()=>{
    const buf=new Uint8Array(M*M*4);
    for(let i=3;i<buf.length;i+=4)buf[i]=255; // RGBA8, R=river, A=opaque
    return buf;
  });
  const g=riverDrainageCurveGeometry(grid,network),p=[0,0,0],q=[0,0,0];
  const {down,channel,flow,water}=network;
  let segments=0,painted=0;
  for(let i=0;i<down.length;i++)if(channel[i]){
    const j=down[i];if(j<0)continue;
    segments++;
    const wa=g.main[i]<0?0.12:riverDrainageWidthBin(flow[i])/15;
    const wb=water[j]?wa:g.main[j]===i?riverDrainageWidthBin(flow[j])/15:wa;
    riverDrainageCurvePoint(g,i,j,0,p);riverDrainageCurvePoint(g,i,j,1,q);
    const length=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);
    const steps=Math.max(6,Math.min(60,Math.ceil(M*length*1.8)));
    for(let k=0;k<=steps;k++){
      const t=k/steps;
      riverDrainageCurvePoint(g,i,j,t,p);
      const w=wa+(wb-wa)*(t*t*(3-2*t));
      // Half width in cube-map UV: this is a fixed geographic width.
      // Trunks show up from orbit, narrow tributaries at regional zoom.
      const radius=M*(0.00070+0.0060*Math.pow(w,2.2));
      riverDrainageDrawDab(faces,M,p,radius);
      painted++;
    }
  }
  return {faces,segments,painted,resolution:M};
}
