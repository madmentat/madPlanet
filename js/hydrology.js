/* ============ гидрология: D8 + накопление + речной граф ============
   Чистый CPU-модуль. Не зависит от WebGL и принимает обычные 2D-матрицы.

   Основной API:
     generateRiverNetwork({ Heightmap, OceanMask, RainfallMap?, Threshold? })

   Координаты во всех путях: [x, y], где x — столбец, y — строка.
*/
(function(root, factory){
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) Object.keys(api).forEach(k => { root[k] = api[k]; });
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  /* Жёсткий порядок обхода при равных уклонах: по часовой стрелке от NE. */
  const D8 = Object.freeze([
    Object.freeze({dx: 1, dy:-1, dist:Math.SQRT2, name:'NE'}),
    Object.freeze({dx: 1, dy: 0, dist:1,          name:'E'}),
    Object.freeze({dx: 1, dy: 1, dist:Math.SQRT2, name:'SE'}),
    Object.freeze({dx: 0, dy: 1, dist:1,          name:'S'}),
    Object.freeze({dx:-1, dy: 1, dist:Math.SQRT2, name:'SW'}),
    Object.freeze({dx:-1, dy: 0, dist:1,          name:'W'}),
    Object.freeze({dx:-1, dy:-1, dist:Math.SQRT2, name:'NW'}),
    Object.freeze({dx: 0, dy:-1, dist:1,          name:'N'}),
  ]);

  class MinHeap {
    constructor(){ this.a = []; }
    get size(){ return this.a.length; }
    push(item){
      const a = this.a;
      let i = a.length;
      a.push(item);
      while(i > 0){
        const p = (i-1) >> 1;
        if(a[p].h < item.h || (a[p].h === item.h && a[p].idx <= item.idx)) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    pop(){
      const a = this.a;
      if(a.length === 0) return null;
      const root = a[0];
      const last = a.pop();
      if(a.length){
        let i = 0;
        while(true){
          const l = i*2+1, r = l+1;
          if(l >= a.length) break;
          let c = l;
          if(r < a.length && (a[r].h < a[l].h || (a[r].h === a[l].h && a[r].idx < a[l].idx))) c = r;
          if(a[c].h > last.h || (a[c].h === last.h && a[c].idx >= last.idx)) break;
          a[i] = a[c]; i = c;
        }
        a[i] = last;
      }
      return root;
    }
  }

  function assertMatrix(m, name, rows, cols){
    if(!m || typeof m.length !== 'number' || m.length === 0)
      throw new Error(name + ': требуется непустая двумерная матрица');
    const r = rows == null ? m.length : rows;
    if(m.length !== r) throw new Error(name + ': число строк не совпадает с Heightmap');
    const c = cols == null ? (m[0] && m[0].length) : cols;
    if(!Number.isInteger(c) || c <= 0) throw new Error(name + ': пустая первая строка');
    for(let y=0;y<r;y++){
      if(!m[y] || m[y].length !== c) throw new Error(name + ': матрица должна быть прямоугольной');
    }
    return {rows:r, cols:c};
  }

  function flattenNumeric(m, rows, cols, name){
    const out = new Float64Array(rows*cols);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
      const v = Number(m[y][x]);
      if(!Number.isFinite(v)) throw new Error(name + ': нечисловое значение в ['+y+']['+x+']');
      out[y*cols+x] = v;
    }
    return out;
  }

  function flattenMask(m, rows, cols, name){
    const out = new Uint8Array(rows*cols);
    for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
      const v = Number(m[y][x]);
      if(v !== 0 && v !== 1) throw new Error(name + ': ожидаются только 0/1, ошибка в ['+y+']['+x+']');
      out[y*cols+x] = v;
    }
    return out;
  }

  function toMatrix(flat, rows, cols, integer=false){
    const out = new Array(rows);
    for(let y=0;y<rows;y++){
      const row = new Array(cols);
      const off = y*cols;
      for(let x=0;x<cols;x++) row[x] = integer ? Number(flat[off+x]) : flat[off+x];
      out[y] = row;
    }
    return out;
  }

  function xy(idx, cols){ return [idx % cols, Math.floor(idx/cols)]; }
  function idxOf(x,y,cols){ return y*cols+x; }

  function forEachNeighbor(idx, rows, cols, fn){
    const x = idx % cols, y = Math.floor(idx/cols);
    for(let d=0;d<8;d++){
      const nx=x+D8[d].dx, ny=y+D8[d].dy;
      if(nx<0 || nx>=cols || ny<0 || ny>=rows) continue;
      fn(idxOf(nx,ny,cols), d, nx, ny);
    }
  }

  /* ------------------------------------------------------------------
     ШАГ 1. Priority-Flood.

     Океанские ячейки являются гарантированными выходами. Сухопутная ячейка,
     которая лежит не выше уже обработанного порога, слегка поднимается над
     ним на epsilon. Эта микроскопическая надбавка нужна не для рельефа как
     такового, а чтобы D8 получил однозначный нисходящий путь через плоское
     дно заполненной депрессии.

     Если океана вообще нет, создаётся один глобальный сухопутный минимум —
     допустимый терминал бессточного бассейна.
  ------------------------------------------------------------------ */
  function priorityFlood(height, ocean, rows, cols, epsilon){
    const n = rows*cols;
    const filled = new Float64Array(height);
    const visited = new Uint8Array(n);
    const parent = new Int32Array(n); parent.fill(-1);
    const raised = new Uint8Array(n);
    const heap = new MinHeap();
    let oceanSeeds = 0;

    for(let i=0;i<n;i++) if(ocean[i]){
      visited[i] = 1;
      heap.push({h:filled[i], idx:i});
      oceanSeeds++;
    }

    let globalSink = -1;
    if(oceanSeeds === 0){
      let best = Infinity;
      for(let i=0;i<n;i++) if(!ocean[i] && height[i] < best){ best=height[i]; globalSink=i; }
      if(globalSink >= 0){
        visited[globalSink]=1;
        heap.push({h:filled[globalSink], idx:globalSink});
      }
    }

    while(heap.size){
      const cur = heap.pop();
      const ci = cur.idx;
      forEachNeighbor(ci, rows, cols, ni => {
        if(visited[ni]) return;
        visited[ni] = 1;
        if(ocean[ni]){
          heap.push({h:filled[ni], idx:ni});
          return;
        }
        parent[ni] = ci;
        const minDrainHeight = filled[ci] + epsilon;
        if(filled[ni] <= filled[ci]){
          filled[ni] = minDrainHeight;
          raised[ni] = 1;
        }
        heap.push({h:filled[ni], idx:ni});
      });
    }

    /* На корректном OceanMask сюда обычно не попадаем. Если всё же остался
       недостижимый кусок суши, заводим для него собственный глобальный минимум. */
    for(let seed=0;seed<n;seed++){
      if(visited[seed] || ocean[seed]) continue;
      let compMin = seed, compH = filled[seed];
      const q=[seed], comp=[]; visited[seed]=2;
      for(let qi=0;qi<q.length;qi++){
        const i=q[qi]; comp.push(i);
        if(filled[i] < compH){ compH=filled[i]; compMin=i; }
        forEachNeighbor(i, rows, cols, ni => {
          if(!ocean[ni] && visited[ni]===0){ visited[ni]=2; q.push(ni); }
        });
      }
      comp.forEach(i => { visited[i]=0; });
      visited[compMin]=1;
      if(globalSink < 0) globalSink=compMin;
      heap.push({h:filled[compMin],idx:compMin});
      while(heap.size){
        const cur=heap.pop(), ci=cur.idx;
        forEachNeighbor(ci, rows, cols, ni => {
          if(ocean[ni] || visited[ni]) return;
          visited[ni]=1; parent[ni]=ci;
          if(filled[ni] <= filled[ci]){ filled[ni]=filled[ci]+epsilon; raised[ni]=1; }
          heap.push({h:filled[ni],idx:ni});
        });
      }
    }

    return {filled, parent, raised, globalSink};
  }

  /* ------------------------------------------------------------------
     ШАГ 2. D8. При равном уклоне остаётся первое направление из D8,
     поэтому порядок NE,E,SE,S,SW,W,NW,N является строгим tie-break.
  ------------------------------------------------------------------ */
  function computeFlowDir(filled, ocean, rows, cols, slopeTolerance){
    const n=rows*cols;
    const flowDir=new Int8Array(n); flowDir.fill(-1);
    const flowTo=new Int32Array(n); flowTo.fill(-1);
    const localMin=new Uint8Array(n);

    for(let i=0;i<n;i++){
      if(ocean[i]) continue;
      const h=filled[i];
      let bestSlope=0, bestDir=-1, bestTo=-1;
      const x=i%cols, y=Math.floor(i/cols);
      for(let d=0;d<8;d++){
        const nx=x+D8[d].dx, ny=y+D8[d].dy;
        if(nx<0||nx>=cols||ny<0||ny>=rows) continue;
        const ni=idxOf(nx,ny,cols);
        const drop=h-filled[ni];
        if(drop <= 0) continue;
        const slope=drop/D8[d].dist;
        if(slope > bestSlope + slopeTolerance){
          bestSlope=slope; bestDir=d; bestTo=ni;
        }
        /* При |slope-bestSlope| <= tolerance ничего не меняем: более раннее
           направление по часовой стрелке уже победило. */
      }
      if(bestDir>=0){ flowDir[i]=bestDir; flowTo[i]=bestTo; }
      else localMin[i]=1;
    }
    return {flowDir, flowTo, localMin};
  }

  function breakFlowCycles(flowDir, flowTo, localMin, filled, ocean, rows, cols){
    const n=rows*cols;
    const state=new Uint8Array(n); // 0 new, 1 stack, 2 done
    const pos=new Int32Array(n); pos.fill(-1);
    const stack=[];

    for(let start=0;start<n;start++){
      if(ocean[start] || state[start]===2) continue;
      let cur=start;
      stack.length=0;
      while(cur>=0 && !ocean[cur] && state[cur]===0){
        state[cur]=1; pos[cur]=stack.length; stack.push(cur); cur=flowTo[cur];
      }
      if(cur>=0 && !ocean[cur] && state[cur]===1){
        const begin=pos[cur];
        let cut=stack[begin];
        for(let k=begin+1;k<stack.length;k++){
          const i=stack[k];
          if(filled[i] < filled[cut] || (filled[i]===filled[cut] && i<cut)) cut=i;
        }
        flowDir[cut]=-1; flowTo[cut]=-1; localMin[cut]=1;
      }
      for(const i of stack){ state[i]=2; pos[i]=-1; }
    }
  }

  /* ------------------------------------------------------------------
     ШАГ 3. Накопление потока через топологическую сортировку Kahn.
  ------------------------------------------------------------------ */
  function flowAccumulation(flowTo, ocean, rainfall, rows, cols){
    const n=rows*cols;
    const indeg=new Int32Array(n);
    const accum=new Float64Array(n);
    let landCount=0;

    for(let i=0;i<n;i++) if(!ocean[i]){
      landCount++;
      accum[i]=rainfall[i];
      const to=flowTo[i];
      if(to>=0 && !ocean[to]) indeg[to]++;
    }

    const q=new Int32Array(landCount || 1);
    let qh=0, qt=0;
    for(let i=0;i<n;i++) if(!ocean[i] && indeg[i]===0) q[qt++]=i;
    const topo=new Int32Array(landCount || 1);
    let tc=0;
    while(qh<qt){
      const i=q[qh++]; topo[tc++]=i;
      const to=flowTo[i];
      if(to>=0 && !ocean[to]){
        accum[to]+=accum[i];
        indeg[to]--;
        if(indeg[to]===0) q[qt++]=to;
      }
    }
    return {accum, topo:topo.subarray(0,tc), processed:tc, landCount};
  }

  function computeDrainageClass(flowTo, ocean, rows, cols){
    const n=rows*cols;
    const cls=new Int8Array(n); // 1 ocean, 0 sink/endorheic, -1 unknown
    cls.fill(-1);
    for(let i=0;i<n;i++) if(ocean[i]) cls[i]=1;
    const seen=new Int32Array(n); seen.fill(-1);
    let token=0;
    for(let start=0;start<n;start++){
      if(ocean[start] || cls[start]>=0) continue;
      token++;
      const path=[];
      let cur=start, endClass=0;
      while(cur>=0 && !ocean[cur] && cls[cur]<0 && seen[cur]!==token){
        seen[cur]=token; path.push(cur); cur=flowTo[cur];
      }
      if(cur>=0){
        if(ocean[cur]) endClass=1;
        else if(cls[cur]>=0) endClass=cls[cur];
        else endClass=0;
      }
      for(const i of path) cls[i]=endClass;
    }
    return cls;
  }

  function computeStrahler(channel, flowTo, topo, ocean, rows, cols){
    const n=rows*cols;
    const maxOrder=new Uint16Array(n);
    const maxCount=new Uint16Array(n);
    const order=new Uint16Array(n);
    const incomingChannelCount=new Uint16Array(n);

    for(let i=0;i<n;i++) if(channel[i]){
      const to=flowTo[i];
      if(to>=0 && !ocean[to] && channel[to]) incomingChannelCount[to]++;
    }

    for(let k=0;k<topo.length;k++){
      const i=topo[k];
      if(!channel[i]) continue;
      let o;
      if(incomingChannelCount[i]===0) o=1;
      else o=maxOrder[i] + (maxCount[i]>=2 ? 1 : 0);
      if(o<1) o=1;
      order[i]=o;
      const to=flowTo[i];
      if(to>=0 && channel[to]){
        if(o>maxOrder[to]){ maxOrder[to]=o; maxCount[to]=1; }
        else if(o===maxOrder[to]) maxCount[to]++;
      }
    }
    return {order,incomingChannelCount};
  }

  function meanTailRain(path, rainfall, cols, count){
    const n=Math.min(count,path.length);
    if(n===0) return 1;
    let s=0;
    for(let k=path.length-n;k<path.length;k++){
      const p=path[k]; s += rainfall[idxOf(p[0],p[1],cols)];
    }
    return s/n;
  }

  function widthFromAccum(a, threshold){
    const q=Math.max(1, a/Math.max(threshold,1e-9));
    return Math.min(14, 0.85 + 0.95*Math.sqrt(q));
  }

  function markDisk(mask, cx, cy, r, rows, cols, value=1){
    const rr=Math.max(0,Math.ceil(r));
    for(let dy=-rr;dy<=rr;dy++) for(let dx=-rr;dx<=rr;dx++){
      if(dx*dx+dy*dy > r*r+0.25) continue;
      const x=cx+dx,y=cy+dy;
      if(x>=0&&x<cols&&y>=0&&y<rows) mask[idxOf(x,y,cols)]=value;
    }
  }

  function maxDisk(widthMap, cx, cy, r, rows, cols, value){
    const rr=Math.max(0,Math.ceil(r));
    for(let dy=-rr;dy<=rr;dy++) for(let dx=-rr;dx<=rr;dx++){
      const d=Math.hypot(dx,dy);
      if(d>r+0.25) continue;
      const x=cx+dx,y=cy+dy;
      if(x<0||x>=cols||y<0||y>=rows) continue;
      const fall=Math.max(0.25,1-d/Math.max(r,1));
      const i=idxOf(x,y,cols);
      widthMap[i]=Math.max(widthMap[i], value*fall);
    }
  }

  /* Упрощённое заполнение локального озера до ближайшего краевого порога. */
  function createEndorheicLake(sinkIdx, originalHeight, filled, flowTo, drainsToOcean,
                                lakeMask, rows, cols){
    const sinkH=originalHeight[sinkIdx];
    let spill=Infinity, outlet=-1;
    forEachNeighbor(sinkIdx, rows, cols, ni => {
      const h=originalHeight[ni];
      if(h>=sinkH && (drainsToOcean[ni]===1 || flowTo[ni]!==sinkIdx)){
        if(h<spill){ spill=h; outlet=ni; }
      }
    });
    if(!Number.isFinite(spill)){
      forEachNeighbor(sinkIdx, rows, cols, ni => {
        if(originalHeight[ni]<spill){ spill=originalHeight[ni]; outlet=ni; }
      });
    }
    if(!Number.isFinite(spill)) spill=filled[sinkIdx];

    /* Flood только в чаше <= spill. Это не меняет Heightmap, а строит LakeMask. */
    const seen=new Uint8Array(rows*cols);
    const q=[sinkIdx]; seen[sinkIdx]=1;
    for(let qi=0;qi<q.length;qi++){
      const i=q[qi];
      if(originalHeight[i] > spill + 1e-12) continue;
      lakeMask[i]=1;
      forEachNeighbor(i, rows, cols, ni => {
        if(!seen[ni] && originalHeight[ni] <= spill + 1e-12){ seen[ni]=1; q.push(ni); }
      });
    }
    return {sink:xy(sinkIdx,cols), level:spill, spillHeight:spill,
            outlet:outlet>=0?xy(outlet,cols):null, cells:q.length};
  }

  /* Низкочастотный детерминированный value-noise для меандров. */
  function hash2i(x,y,seed){
    let h=(Math.imul(x|0,0x1f123bb5) ^ Math.imul(y|0,0x5f356495) ^ (seed|0))|0;
    h=Math.imul(h^(h>>>16),0x45d9f3b); h=Math.imul(h^(h>>>16),0x45d9f3b); h^=h>>>16;
    return (h>>>0)/4294967295;
  }
  function smooth01(t){ return t*t*(3-2*t); }
  function valueNoise2(x,y,seed){
    const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
    const u=smooth01(fx),v=smooth01(fy);
    const a=hash2i(x0,y0,seed),b=hash2i(x0+1,y0,seed),c=hash2i(x0,y0+1,seed),d=hash2i(x0+1,y0+1,seed);
    return ((a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v)*2-1;
  }

  function meanderedCell(path, k, corrected, rows, cols, seed){
    const p=path[k];
    if(path.length<3) return p;
    const a=path[Math.max(0,k-1)], b=path[Math.min(path.length-1,k+1)];
    let tx=b[0]-a[0], ty=b[1]-a[1];
    const tl=Math.hypot(tx,ty)||1; tx/=tl; ty/=tl;
    const px=-ty, py=tx;
    const n=valueNoise2(k*0.13, (p[0]+p[1])*0.035, seed);
    const amp=0.85;
    const ox=Math.round(px*n*amp), oy=Math.round(py*n*amp);
    const x=p[0]+ox,y=p[1]+oy;
    if(x<0||x>=cols||y<0||y>=rows) return p;
    const i=idxOf(p[0],p[1],cols), j=idxOf(x,y,cols);
    /* Меандр не имеет права прорезать соседний хребет. Допускается только
       практически та же высота или более низкая ячейка. */
    if(corrected[j] <= corrected[i] + 1e-6) return [x,y];
    return p;
  }

  function erodeHeightmap(originalHeight, corrected, RiverGraph, rows, cols, seed){
    const n=rows*cols;
    const depth=new Float64Array(n);

    for(let r=0;r<RiverGraph.length;r++){
      const path=RiverGraph[r];
      const denom=Math.max(1,path.length-1);
      for(let k=0;k<path.length;k++){
        const t=k/denom;
        const d=t<0.30?0.5:(t<0.70?0.3:0.15);
        const base=path[k];
        const bi=idxOf(base[0],base[1],cols);
        /* Жёсткое требование: каждая ячейка RiverGraph получает полный врез. */
        depth[bi]=Math.max(depth[bi],d);
        /* Низкочастотный меандр расширяет эрозионный коридор в безопасную
           соседнюю ячейку, но не ломает гидрологический D8-граф. */
        const p=meanderedCell(path,k,corrected,rows,cols,(seed|0)+r*977);
        const i=idxOf(p[0],p[1],cols);
        if(i!==bi) depth[i]=Math.max(depth[i],d*0.55);
      }
    }

    const valley=new Float64Array(depth);
    for(let i=0;i<n;i++) if(depth[i]>0){
      const x=i%cols,y=Math.floor(i/cols),d=depth[i];
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
        if(dx===0&&dy===0) continue;
        const dist=Math.hypot(dx,dy);
        if(dist>2.01) continue;
        const xx=x+dx,yy=y+dy;
        if(xx<0||xx>=cols||yy<0||yy>=rows) continue;
        const fall=dist<=1.01?0.5:0.25;
        const j=idxOf(xx,yy,cols);
        valley[j]=Math.max(valley[j],d*fall);
      }
    }

    const updated=new Float64Array(originalHeight);
    for(let i=0;i<n;i++) updated[i]-=valley[i];
    return {updated, erosionDepth:valley};
  }

  /* ------------------------------------------------------------------
     Главная функция — все шесть шагов из задания.
  ------------------------------------------------------------------ */
  function generateRiverNetwork(input){
    if(!input || typeof input!=='object') throw new Error('generateRiverNetwork: требуется объект параметров');
    const Heightmap=input.Heightmap, OceanMask=input.OceanMask, RainfallMap=input.RainfallMap;
    const dims=assertMatrix(Heightmap,'Heightmap');
    const rows=dims.rows, cols=dims.cols, n=rows*cols;
    assertMatrix(OceanMask,'OceanMask',rows,cols);
    if(RainfallMap!=null) assertMatrix(RainfallMap,'RainfallMap',rows,cols);

    const height=flattenNumeric(Heightmap,rows,cols,'Heightmap');
    const ocean=flattenMask(OceanMask,rows,cols,'OceanMask');
    const rainfall=new Float64Array(n);
    if(RainfallMap==null){
      for(let i=0;i<n;i++) rainfall[i]=ocean[i]?0:1;
    } else {
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++){
        const i=idxOf(x,y,cols),v=Number(RainfallMap[y][x]);
        if(!Number.isFinite(v)) throw new Error('RainfallMap: нечисловое значение в ['+y+']['+x+']');
        rainfall[i]=ocean[i]?0:Math.max(0,Math.min(1,v));
      }
    }

    const Threshold=Number.isFinite(input.Threshold)?Math.max(0,input.Threshold):100;
    let hMin=Infinity,hMax=-Infinity;
    for(let i=0;i<n;i++) if(!ocean[i]){ hMin=Math.min(hMin,height[i]);hMax=Math.max(hMax,height[i]); }
    const range=Number.isFinite(hMax-hMin)?Math.max(1,hMax-hMin):1;
    const epsilon=Number.isFinite(input.Epsilon)?Math.max(1e-12,input.Epsilon):range*1e-9;
    const slopeTolerance=Math.max(1e-14,epsilon*1e-3);

    // Шаг 1
    const flood=priorityFlood(height,ocean,rows,cols,epsilon);

    // Шаг 2
    const flow=computeFlowDir(flood.filled,ocean,rows,cols,slopeTolerance);
    breakFlowCycles(flow.flowDir,flow.flowTo,flow.localMin,flood.filled,ocean,rows,cols);

    // Шаг 3. После страховочного разрыва циклов граф гарантированно ацикличен.
    let acc=flowAccumulation(flow.flowTo,ocean,rainfall,rows,cols);
    if(acc.processed!==acc.landCount){
      /* Крайне защитный путь: если пользователь подал патологические данные,
         остаток становится замкнутой низиной, затем accumulation пересчитывается. */
      const done=new Uint8Array(n); for(const i of acc.topo) done[i]=1;
      for(let i=0;i<n;i++) if(!ocean[i]&&!done[i]){ flow.flowDir[i]=-1;flow.flowTo[i]=-1;flow.localMin[i]=1; }
      acc=flowAccumulation(flow.flowTo,ocean,rainfall,rows,cols);
    }
    const drainsToOcean=computeDrainageClass(flow.flowTo,ocean,rows,cols);

    // Шаг 4: русла и порядок Штралера.
    const channel=new Uint8Array(n);
    for(let i=0;i<n;i++) if(!ocean[i] && acc.accum[i]>Threshold) channel[i]=1;
    const strahler=computeStrahler(channel,flow.flowTo,acc.topo,ocean,rows,cols);

    const sources=[];
    for(let i=0;i<n;i++) if(channel[i] && strahler.incomingChannelCount[i]===0) sources.push(i);

    const RiverGraph=[];
    const StreamOrder=[];
    const RiverTerminals=[];
    const lakeMask=new Uint8Array(n);
    const saltFlatMask=new Uint8Array(n);
    const widthMap=new Float64Array(n);
    const Lakes=[];

    for(let ri=0;ri<sources.length;ri++){
      const source=sources[ri];
      const path=[];
      const visited=new Set();
      let cur=source, terminal={type:'B',coord:xy(cur,cols),reason:'closed_sink'};

      while(cur>=0 && !ocean[cur]){
        if(visited.has(cur)){
          terminal={type:'B',coord:xy(cur,cols),reason:'cycle'};
          flow.localMin[cur]=1;
          break;
        }
        visited.add(cur);
        path.push(xy(cur,cols));

        // Терминал C: средняя засушливость по последним пяти точкам.
        const dry=meanTailRain(path,rainfall,cols,5)<0.1 && height[cur]>0;
        if(dry){ terminal={type:'C',coord:xy(cur,cols),reason:'arid_evaporation'}; break; }

        const next=flow.flowTo[cur];
        if(next<0){
          terminal={type:'B',coord:xy(cur,cols),reason:'local_minimum'};
          flow.localMin[cur]=1;
          break;
        }
        if(ocean[next]){
          terminal={type:'A',coord:xy(cur,cols),oceanCell:xy(next,cols),reason:'ocean'};
          break;
        }
        if(flow.localMin[next] && drainsToOcean[next]!==1){
          path.push(xy(next,cols));
          terminal={type:'B',coord:xy(next,cols),reason:'endorheic_minimum'};
          cur=next;
          break;
        }
        cur=next;
      }

      if(path.length===0) continue;
      RiverGraph.push(path);
      const last=path[path.length-1], lastIdx=idxOf(last[0],last[1],cols);
      StreamOrder.push(Math.max(1,strahler.order[lastIdx]||1));
      RiverTerminals.push(terminal);

      /* Базовая ширина по накопленному потоку. */
      for(const p of path){
        const i=idxOf(p[0],p[1],cols);
        widthMap[i]=Math.max(widthMap[i],widthFromAccum(acc.accum[i],Threshold));
      }

      if(terminal.type==='A'){
        // Последние 10% линейно расширяются к устью.
        const count=Math.max(1,Math.ceil(path.length*0.10));
        for(let k=path.length-count;k<path.length;k++){
          const p=path[k],i=idxOf(p[0],p[1],cols),t=(k-(path.length-count))/Math.max(1,count-1);
          const base=widthFromAccum(acc.accum[i],Threshold);
          widthMap[i]=Math.max(widthMap[i],base*(1+0.65*t));
        }
      } else if(terminal.type==='B'){
        const sink=lastIdx;
        const lake=createEndorheicLake(sink,height,flood.filled,flow.flowTo,drainsToOcean,lakeMask,rows,cols);
        Lakes.push(lake);
        // Последние 5–10 точек раскрываются веером без резкого обрыва.
        const count=Math.min(path.length,Math.max(5,Math.min(10,Math.ceil(path.length*0.12))));
        for(let k=path.length-count;k<path.length;k++){
          const p=path[k],i=idxOf(p[0],p[1],cols),t=(k-(path.length-count))/Math.max(1,count-1);
          const w=widthFromAccum(acc.accum[i],Threshold)*(1+1.6*t);
          widthMap[i]=Math.max(widthMap[i],w);
          maxDisk(widthMap,p[0],p[1],Math.max(1,w*0.35*t),rows,cols,w);
        }
        /* Статический уровень озера равен краевому порогу. Поэтому выход
           разрешён только если внешний код поднимет фактический уровень выше
           lake.spillHeight; сам эндорейный терминал его не форсирует. */
      } else if(terminal.type==='C'){
        const count=Math.min(path.length,Math.max(5,Math.ceil(path.length*0.12)));
        for(let k=path.length-count;k<path.length;k++){
          const p=path[k],i=idxOf(p[0],p[1],cols),t=(k-(path.length-count))/Math.max(1,count-1);
          const base=widthFromAccum(acc.accum[i],Threshold);
          /* Здесь нужно именно уменьшение, поэтому нельзя использовать max:
             базовая ширина была записана выше для всего пути. */
          widthMap[i]=base*(1-t);
          markDisk(saltFlatMask,p[0],p[1],1+2*t,rows,cols,1);
        }
        widthMap[lastIdx]=0;
      }
    }

    // Шаг 6: эрозия исходной Heightmap + плавная долина + безопасный меандр.
    const erosion=erodeHeightmap(height,flood.filled,RiverGraph,rows,cols,
      Number.isFinite(input.Seed)?input.Seed:0x51f15e);

    return {
      // Требуемые выходы
      RiverGraph,
      StreamOrder,
      RiverWidthMap:toMatrix(widthMap,rows,cols),
      UpdatedHeightmap:toMatrix(erosion.updated,rows,cols),
      LakeMask:toMatrix(lakeMask,rows,cols,true),

      // Полезная диагностическая часть — не мешает требуемому контракту.
      FlowDir:toMatrix(flow.flowDir,rows,cols,true),
      Accum:toMatrix(acc.accum,rows,cols),
      CorrectedHeightmap:toMatrix(flood.filled,rows,cols),
      LocalMinMask:toMatrix(flow.localMin,rows,cols,true),
      SaltFlatMask:toMatrix(saltFlatMask,rows,cols,true),
      StreamOrderMap:toMatrix(strahler.order,rows,cols,true),
      RiverTerminals,
      Lakes,
      Threshold,
      D8Order:D8.map(d=>d.name),
    };
  }

  return { generateRiverNetwork, D8 };
});
