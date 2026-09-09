/* Run: node tests/river-surface-probe.js, then open /river-surface.tmp.html.
   Runs the production GPU sampler, contour graph and final mask together. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const frag=['#version 300 es',read('shaders/header.glsl'),read('shaders/noise.glsl'),read('shaders/terrain.glsl'),read('shaders/weather-cloud-prelude.glsl')].join('\n');
const script=[read('js/math.js'),read('js/state.js'),`
const FRAG=${JSON.stringify(frag)};
const gl=document.createElement('canvas').getContext('webgl2'),webglVersion=2;
function weatherCoreCreate(){}function weatherCoreStep(){}
`,read('js/river-gpu.js'),`
const out=document.querySelector('pre'),results=[];
const sampleOriginal=riverLoopSampleSurface;let sampled;
riverLoopSampleSurface=function(N){const s=sampleOriginal(N);if(s&&!s.pending)sampled=s;return s;};
const seeds=[8127344,55807208,5569959];let next=0;
function run(){
 try{
  state.seed=seeds[next];state.sea=0.40;deriveWorld();
  const core={N:32,count:6144,seed:state.seed,h2oSurfaceSignature:'probe'};
  if(!riverLoopBuildMask(core)){setTimeout(run,250);return;}
  if(core.riverLoopSampling!=='gpu-terrain')throw Error('GPU sampling unavailable');
  const graph=riverLoopContourGraph(sampled.corners,sampled.water,riverLoopN);
  const kept=riverLoopRootedForest(graph.neighbors,graph.water),seen=new Set();
  let components=0,segments=0;
  for(let i=0;i<kept.length;i++)if(kept[i]&&!seen.has(i)){
   components++;const queue=[i];seen.add(i);let edges=0,contacts=0;
   for(const j of queue)for(const k of graph.neighbors[j]){
    if(graph.water[k])contacts++;
    else if(kept[k]){edges++;if(!seen.has(k)){seen.add(k);queue.push(k);}}
   }
   if(contacts!==1||edges/2!==queue.length-1)throw Error('Cycle or multiple shore contacts');
   segments+=queue.length;
  }
  const N=riverLoopN;
  for(let i=0;i<kept.length;i++)if(!kept[i]&&!graph.water[i]){
   const p=graph.pixels[i],f=Math.floor(p/(N*N)),k=p%(N*N);
   if(riverLoopFaces[f][k*4]!==0)throw Error('Rejected contour restored by final raster mask');
  }
  if(!segments||!core.riverLoopRemovedSegments)throw Error('Vacuous result: need retained and removed rivers');
  const canvas=document.createElement('canvas');canvas.width=N*6;canvas.height=N*2;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(canvas.width,canvas.height);
  for(let f=0;f<6;f++)for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(let row=0;row<2;row++){
   const wet=sampled.water[f*N*N+y*N+x],p=((row*N+y)*canvas.width+f*N+x)*4;
   img.data.set(wet?[110,156,192,255]:[209,205,178,255],p);
  }
  for(let i=0;i<graph.pixels.length;i++){
   const p=graph.pixels[i],f=Math.floor(p/(N*N)),k=p%(N*N),x=k%N,y=Math.floor(k/N);
   for(let row=0;row<2;row++)if(!row||riverLoopFaces[f][k*4]>0)
    img.data.set([15,55,103,255],((row*N+y)*canvas.width+f*N+x)*4);
  }
  ctx.putImageData(img,0,0);document.body.appendChild(document.createTextNode('Seed '+state.seed+': before / after'));document.body.appendChild(canvas);
  results.push({seed:state.seed,components,segments,removed:core.riverLoopRemovedSegments,sampling:core.riverLoopSampling});
  next++;out.textContent=(next===seeds.length?'PASS':'Running')+': GPU river topology and raster cuts\\n'+JSON.stringify(results,null,2);
  if(next<seeds.length)setTimeout(run,100);
 }catch(e){out.textContent='FAIL: '+e.stack;}
}
run();
`].join('\n');
fs.writeFileSync(path.join(root,'river-surface.tmp.html'),'<!doctype html><meta charset="utf-8"><title>GPU river surface regression</title><style>canvas{display:block;max-width:100%;margin-bottom:16px}body{font:14px monospace}</style><div id="seedLabel"></div><input id="seed"><pre>Running GPU river test…</pre><script>'+script+'</script>');
console.log('Open http://127.0.0.1:8734/river-surface.tmp.html');
