/* Run: node tests/river-surface-probe.js, then open /river-surface.tmp.html.
   Runs the production GPU terrain sampler and directed drainage graph. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const frag=['#version 300 es',read('shaders/header.glsl'),read('shaders/noise.glsl'),read('shaders/terrain.glsl'),read('shaders/weather-cloud-prelude.glsl')].join('\n');
const script=[read('js/math.js'),read('js/state.js'),`
const FRAG=${JSON.stringify(frag)};
const gl=document.createElement('canvas').getContext('webgl2'),webglVersion=2;
function weatherCoreCreate(){}function weatherCoreStep(){}
`,read('js/river-drainage.js'),read('js/river-gpu.js'),`
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
  const grid=riverDrainageGridCache,N=grid.N;
  const network=riverDrainageBuild(sampled.height,sampled.water,sampled.moisture,grid.neighbors,grid.area,{sourceArea:2*(N/160)**2});
  const incoming=new Int32Array(network.down.length);let segments=0,mouths=0,sources=0;
  for(let i=0;i<network.down.length;i++)if(network.channel[i]){
    const j=network.down[i];segments++;incoming[j]++;
    if(sampled.water[i])throw Error('River starts in water');
    if(j<0||(!sampled.water[j]&&!network.channel[j]))throw Error('River stops before reaching water');
    if(!sampled.water[j]&&sampled.height[j]>sampled.height[i])throw Error('Uphill flow');
    if(sampled.water[j])mouths++;
  }
  for(let i=0;i<incoming.length;i++)if(network.channel[i]&&!incoming[i]){
    sources++;if(network.coastDistance[i]<3)throw Error('Headwater on coast');
    const seen=new Set();let k=i;
    while(!sampled.water[k]){if(seen.has(k))throw Error('Loop');seen.add(k);k=network.down[k];}
  }
  if(!segments||!mouths||!sources)throw Error('Empty drainage network');
  const canvas=document.createElement('canvas');canvas.width=N*6;canvas.height=N;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(canvas.width,canvas.height);
  for(let f=0;f<6;f++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const i=f*N*N+y*N+x,p=(y*canvas.width+f*N+x)*4;
   const wet=sampled.water[i],h=sampled.height[i];
   img.data.set(wet?[85,134,174,255]:[130+h*220,159+h*160,103+h*220,255],p);
  }
  ctx.putImageData(img,0,0);ctx.strokeStyle='#153e63';ctx.lineWidth=0.65;
  for(let i=0;i<network.down.length;i++)if(network.channel[i]){
    const j=network.down[i],f=Math.floor(i/(N*N)),g=Math.floor(j/(N*N));if(f!==g)continue;
    ctx.beginPath();ctx.moveTo(f*N+i%N+0.5,Math.floor(i/N)%N+0.5);
    ctx.lineTo(g*N+j%N+0.5,Math.floor(j/N)%N+0.5);ctx.stroke();
  }
  document.body.appendChild(document.createTextNode('Seed '+state.seed));document.body.appendChild(canvas);
  results.push({seed:state.seed,segments,sources,mouths,sampling:core.riverLoopSampling});
  next++;out.textContent=(next===seeds.length?'PASS':'Running')+': GPU downhill drainage\\n'+JSON.stringify(results,null,2);
  if(next<seeds.length)setTimeout(run,100);
 }catch(e){out.textContent='FAIL: '+e.stack;}
}
run();
`].join('\n');
fs.writeFileSync(path.join(root,'river-surface.tmp.html'),'<!doctype html><meta charset="utf-8"><title>GPU river surface regression</title><style>canvas{display:block;max-width:100%;margin-bottom:16px}body{font:14px monospace}</style><div id="seedLabel"></div><input id="seed"><pre>Running GPU river test…</pre><script>'+script+'</script>');
console.log('Open http://127.0.0.1:8734/river-surface.tmp.html');
