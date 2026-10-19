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

/* Packed unsigned atlas: one RGBA32UI cubemap texel carries TWO nearby
   segments. Each channel stores exactly 32 bits:
      0..13 first segment's endpoint coordinate
     14..27 second segment's same endpoint coordinate
     28..31 one of four endpoint width bins.
   R/G own first segment's two widths; B/A own second segment's widths.
   14-bit face UV precision (<0.00014 normalized direction units) supports
   close zoom better than highp float multipacking. No extra sampler/texture.
   All four coordinates are encoded over [-1.125,1.125] for seam margins. */
const RIVER_DRAINAGE_UV_RANGE=1.125;
const RIVER_DRAINAGE_COORD_MAX=16383;
const RIVER_DRAINAGE_COORD_MASK=16383;
const RIVER_DRAINAGE_SECOND_SHIFT=14;
const RIVER_DRAINAGE_WIDTH_SHIFT=28;
function riverDrainageEncodeUV(uv){
  return Math.round((Math.max(-RIVER_DRAINAGE_UV_RANGE,
    Math.min(RIVER_DRAINAGE_UV_RANGE,uv))+RIVER_DRAINAGE_UV_RANGE)
    *RIVER_DRAINAGE_COORD_MAX/(2*RIVER_DRAINAGE_UV_RANGE));
}
function riverDrainageDecodeUV(bits){
  return bits*2*RIVER_DRAINAGE_UV_RANGE/RIVER_DRAINAGE_COORD_MAX-RIVER_DRAINAGE_UV_RANGE;
}
function riverDrainageUnpackSegment(data,off,slot){
  const q=new Float64Array(4);
  for(let c=0;c<4;c++){
    const value=data[off+c]>>>0;
    q[c]=riverDrainageDecodeUV(slot===0?
      (value&RIVER_DRAINAGE_COORD_MASK):
      ((value>>>RIVER_DRAINAGE_SECOND_SHIFT)&RIVER_DRAINAGE_COORD_MASK));
  }
  return {uv:q,widthA:data[off+(slot===0?0:2)]>>>RIVER_DRAINAGE_WIDTH_SHIFT,
          widthB:data[off+(slot===0?1:3)]>>>RIVER_DRAINAGE_WIDTH_SHIFT};
}
function riverDrainagePackSegment(data,offset,slot,uv,binA,binB){
  for(let c=0;c<4;c++){
    const n=data[offset+c]>>>0;
    const lo=n&RIVER_DRAINAGE_COORD_MASK;
    const hi=(n>>>RIVER_DRAINAGE_SECOND_SHIFT)&RIVER_DRAINAGE_COORD_MASK;
    const oldWidth=n>>>RIVER_DRAINAGE_WIDTH_SHIFT;
    const primary=slot===0?uv[c]:lo;
    const secondary=slot===1?uv[c]:hi;
    const nibble=slot===0?(c===0?binA:c===1?binB:oldWidth)
      :(c===2?binA:c===3?binB:oldWidth);
    data[offset+c]=(primary|(secondary<<RIVER_DRAINAGE_SECOND_SHIFT)|
      (nibble<<RIVER_DRAINAGE_WIDTH_SHIFT))>>>0;
  }
}
function riverDrainageShiftPrimaryToSecondary(data,offset){
  const widthA=data[offset]>>>RIVER_DRAINAGE_WIDTH_SHIFT;
  const widthB=data[offset+1]>>>RIVER_DRAINAGE_WIDTH_SHIFT;
  for(let c=0;c<4;c++){
    const n=data[offset+c]>>>0,coord=n&RIVER_DRAINAGE_COORD_MASK;
    const nibble=c===0?widthA:c===1?widthB:c===2?widthA:widthB;
    data[offset+c]=(coord|(coord<<RIVER_DRAINAGE_SECOND_SHIFT)|
      (nibble<<RIVER_DRAINAGE_WIDTH_SHIFT))>>>0;
  }
}

/* Build a coherent tangent at every junction before rasterizing any edge.
   The original D8 grid decides topology, but the displayed centerline uses
   a cubic Hermite path through shared vertices instead of independently
   bending each straight 50–100 km edge. Incoming tributaries share exactly
   the same downstream junction and tangent as their receiver. */
const RIVER_DRAINAGE_CURVE_STEPS=2;
function riverDrainageCurveGeometry(grid,network){
  const {down,channel,coastDistance}=network,n=down.length;
  const main=riverDrainagePrimaryUpstream(network);
  const src=grid.artDirs||grid.dirs,real=grid.dirs;
  const pos=new Float64Array(3*n),tangent=new Float64Array(3*n);
  for(let i=0;i<n;i++){
    const k=3*i,dirs=coastDistance?.[i]<=2?real:src;
    pos[k]=dirs[k];pos[k+1]=dirs[k+1];pos[k+2]=dirs[k+2];
  }
  for(let i=0;i<n;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0)continue;
    const k=3*i,dk=3*j,u=main[i],uk=3*u;
    // The same tangent is used for the end of every incoming edge and the
    // start of the outgoing edge. That removes sharp D8 bends at confluences.
    let x=pos[dk]-(u>=0?pos[uk]:pos[k]);
    let y=pos[dk+1]-(u>=0?pos[uk+1]:pos[k+1]);
    let z=pos[dk+2]-(u>=0?pos[uk+2]:pos[k+2]);
    const dot=x*pos[k]+y*pos[k+1]+z*pos[k+2];
    x-=dot*pos[k];y-=dot*pos[k+1];z-=dot*pos[k+2];
    const len=Math.hypot(x,y,z)||1;
    const edgeLength=Math.hypot(pos[dk]-pos[k],pos[dk+1]-pos[k+1],pos[dk+2]-pos[k+2]);
    const upLength=u>=0?
      Math.hypot(pos[uk]-pos[k],pos[uk+1]-pos[k+1],pos[uk+2]-pos[k+2]):edgeLength;
    const scale=0.8*Math.min(edgeLength,upLength);
    tangent[k]=x/len*scale;tangent[k+1]=y/len*scale;tangent[k+2]=z/len*scale;
  }
  return {pos,tangent,channel:network.channel,coastDistance:network.coastDistance,
    height:network.height,main};
}
function riverDrainageCurvePoint(geometry,i,j,t,out){
  const {pos,tangent,channel,coastDistance,height}=geometry;
  const k=3*i,l=3*j,u=1-t;
  const h0=2*t*t*t-3*t*t+1,h1=t*t*t-2*t*t+t;
  const h2=-2*t*t*t+3*t*t,h3=t*t*t-t*t;
  const steep=Math.abs((height?.[i]||0)-(height?.[j]||0));
  // Strong mountain slopes and estuaries should stay near the DEM edge.
  const curveStrength=coastDistance?.[i]<=2||coastDistance?.[j]<=2?
    0:Math.max(0.24,1-4.0*steep);
  const bx=pos[l]-pos[k],by=pos[l+1]-pos[k+1],bz=pos[l+2]-pos[k+2];
  const inX=tangent[k],inY=tangent[k+1],inZ=tangent[k+2];
  const outX=channel[j]?tangent[l]:bx*0.8;
  const outY=channel[j]?tangent[l+1]:by*0.8;
  const outZ=channel[j]?tangent[l+2]:bz*0.8;
  const linearX=u*pos[k]+t*pos[l],linearY=u*pos[k+1]+t*pos[l+1],linearZ=u*pos[k+2]+t*pos[l+2];
  const x=linearX+curveStrength*(h0*pos[k]+h1*inX+h2*pos[l]+h3*outX-linearX);
  const y=linearY+curveStrength*(h0*pos[k+1]+h1*inY+h2*pos[l+1]+h3*outY-linearY);
  const z=linearZ+curveStrength*(h0*pos[k+2]+h1*inZ+h2*pos[l+2]+h3*outZ-linearZ);
  const len=Math.hypot(x,y,z)||1;
  out[0]=x/len;out[1]=y/len;out[2]=z/len;
  return out;
}

/* The two nearest DIFFERENT drainage edges are cached per atlas texel.
   Minor tributaries can no longer be overwritten by a trunk occupying the
   same pixel. Only graph connectivity controls confluences and outlets. */
function riverDrainageRaster(grid,network,M){
  const {down,channel,flow,water}=network;
  const geometry=riverDrainageCurveGeometry(grid,network);
  const faces=Array.from({length:6},()=>new Uint32Array(M*M*4));
  const best=Array.from({length:6},()=>new Float32Array(M*M).fill(Infinity));
  const second=Array.from({length:6},()=>new Float32Array(M*M).fill(Infinity));
  const owner=Array.from({length:6},()=>new Int32Array(M*M).fill(-1));
  const seen=new Set(),padding=3,scale=M*0.5;
  const mainUpstream=geometry.main,steps=RIVER_DRAINAGE_CURVE_STEPS;
  let segments=0,secondSlots=0;
  const coords=[0,0,0,0],a=[0,0,0],b=[0,0,0];
  for(let i=0;i<down.length;i++){
    if(!channel[i])continue;
    const j=down[i];if(j<0)continue;segments++;
    const binA=riverDrainageWidthBin(flow[i]);
    const binB=!water?.[j]&&mainUpstream[j]===i?riverDrainageWidthBin(flow[j]):binA;
    for(let part=0;part<steps;part++){
      riverDrainageCurvePoint(geometry,i,j,part/steps,a);
      riverDrainageCurvePoint(geometry,i,j,(part+1)/steps,b);
      seen.clear();
      for(const p of [a,b])for(let axis=0;axis<3;axis++)
        if(Math.abs(p[axis])>=Math.max(Math.abs(p[0]),Math.abs(p[1]),Math.abs(p[2]))-6/M)
          seen.add(axis*2+(p[axis]<0?1:0));
      const width0=Math.round(binA+(binB-binA)*part/steps);
      const width1=Math.round(binA+(binB-binA)*(part+1)/steps);
      const segmentId=i*steps+part;
      for(const face of seen){
        const av=riverDrainageProject(face,...a),bv=riverDrainageProject(face,...b);
        const ax=(av[0]+1)*scale,ay=(1-av[1])*scale,bx=(bv[0]+1)*scale,by=(1-bv[1])*scale;
        coords[0]=riverDrainageEncodeUV(av[0]);coords[1]=riverDrainageEncodeUV(av[1]);
        coords[2]=riverDrainageEncodeUV(bv[0]);coords[3]=riverDrainageEncodeUV(bv[1]);
        const dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
        const x0=Math.max(0,Math.floor(Math.min(ax,bx)-padding)),x1=Math.min(M-1,Math.ceil(Math.max(ax,bx)+padding));
        const y0=Math.max(0,Math.floor(Math.min(ay,by)-padding)),y1=Math.min(M-1,Math.ceil(Math.max(ay,by)+padding));
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const t=Math.max(0,Math.min(1,((x+0.5-ax)*dx+(y+0.5-ay)*dy)/Math.max(1e-12,len2)));
          const dist=(x+0.5-ax-t*dx)**2+(y+0.5-ay-t*dy)**2,k=y*M+x;
          if(dist>9.5||owner[face][k]===segmentId)continue;
          const off=4*k,data=faces[face];
          if(dist<best[face][k]){
            if(owner[face][k]>=0&&best[face][k]<=2.25){
              if(!Number.isFinite(second[face][k]))secondSlots++;
              riverDrainageShiftPrimaryToSecondary(data,off);
              second[face][k]=best[face][k];
            }
            best[face][k]=dist;owner[face][k]=segmentId;
            riverDrainagePackSegment(data,off,0,coords,width0,width1);
          }else if(dist<=2.25&&dist<second[face][k]){
            if(!Number.isFinite(second[face][k]))secondSlots++;
            second[face][k]=dist;
            riverDrainagePackSegment(data,off,1,coords,width0,width1);
          }
        }
      }
    }
  }
  return {faces,segments,secondSlots};
}
