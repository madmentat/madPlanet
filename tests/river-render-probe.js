/* node tests/river-render-probe.js, then open /river-render.tmp.html.
   Exercises the production GPU terrain sampler, routing, endpoint texture,
   and actual riverChannelSample GLSL at points along every routed segment. */
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const prefix=['#version 300 es',read('shaders/header.glsl'),read('shaders/noise.glsl'),read('shaders/terrain.glsl')].join('\n');
const frag=prefix+'\n'+read('shaders/river-channels.glsl')+`
uniform sampler2D testPoints;
uniform int testMode;
void main(){
 vec3 d;
 if(testMode==1)d=texelFetch(testPoints,ivec2(gl_FragCoord.xy),0).xyz;
 else{
  vec2 uv=gl_FragCoord.xy/vec2(1200.0,600.0);
  float lat=(uv.y-0.5)*3.14159265,lon=uv.x*6.2831853;
  d=vec3(cos(lon)*cos(lat),sin(lat),sin(lon)*cos(lat));
 }
 vec2 river=riverChannelSample(normalize(d),0.00001);
 if(testMode==1){fragColor=vec4(river,0.0,1.0);return;}
 float rock,mount,lee;float h=terrain(d,rock,mount,lee);
 vec3 color=h<0.0?vec3(0.18,0.34,0.50):mix(vec3(0.39,0.52,0.32),vec3(0.80,0.78,0.69),smoothstep(0.0,0.45,h));
 if(h>0.0)color=mix(color,vec3(0.04,0.22,0.37),riverChannelSample(d,0.006).x*2.0);
 fragColor=vec4(color,1.0);
}`;
const script=[read('js/math.js'),read('js/state.js'),`
const FRAG=${JSON.stringify(prefix+'\n#define lowCover')};
const display=document.createElement('canvas');display.width=1200;display.height=600;
const gl=display.getContext('webgl2',{preserveDrawingBuffer:true}),webglVersion=2;
function weatherCoreCreate(){}function weatherCoreStep(){}
`,read('js/river-drainage.js'),read('js/river-gpu.js'),`
const out=document.querySelector('pre');let program,complete=false,next=0;const seeds=[8127344,55807208,5569959],results=[];
const original=riverLoopSampleSurface;let sampled;
riverLoopSampleSurface=function(N){const s=original(N);if(s&&!s.pending)sampled=s;return s;};
function run(){try{
 state.seed=seeds[next];state.sea=0.40;deriveWorld();
 const core={N:32,seed:state.seed};
 if(!riverLoopBuildMask(core)){setTimeout(run,200);return;}
 if(!program){
  program=gl.createProgram();
  for(const [type,source] of [[gl.VERTEX_SHADER,'#version 300 es\\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'],[gl.FRAGMENT_SHADER,${JSON.stringify(frag)}]]){
   const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);gl.attachShader(program,s);
  }
  gl.linkProgram(program);
 }
 const ext=gl.getExtension('KHR_parallel_shader_compile');
 if(ext&&!gl.getProgramParameter(program,ext.COMPLETION_STATUS_KHR)){setTimeout(run,200);return;}
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);const loc=n=>gl.getUniformLocation(program,n);
 gl.uniform1i(loc('uRiverLoopTex'),8);gl.uniform1f(loc('uRiverLoopOn'),1);
 gl.activeTexture(gl.TEXTURE8);gl.bindTexture(gl.TEXTURE_CUBE_MAP,riverLoopTex);
 gl.uniformMatrix3fv(loc('uRotS'),false,[1,0,0,0,1,0,0,0,1]);gl.uniform3fv(loc('uSeedS'),world.seedS);
 for(const [u,k] of [['uCont','cont'],['uSea','sea'],['uTect','tect'],['uIsle','isle'],['uLake','lake']])gl.uniform1f(loc(u),state[k]);
 gl.uniform1f(loc('uDraft'),1);gl.uniform1f(loc('uCamDist'),4);gl.uniform1i(loc('uPlateN'),world.plateN);
 gl.uniform4fv(loc('uPlateP'),world.plateP);gl.uniform4fv(loc('uPlateW'),world.plateW);
 const grid=riverDrainageGridCache;
 const net=riverDrainageBuild(sampled.height,sampled.water,sampled.moisture,grid.neighbors,grid.area,{sourceArea:2});
 const points=[];
 for(let i=0;i<net.down.length;i++)if(net.channel[i]){
  const j=net.down[i];for(const t of [0.1,0.5,0.9]){
   const a=grid.dirs.subarray(i*3,i*3+3),b=grid.dirs.subarray(j*3,j*3+3);
   points.push(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,1);
  }
 }
 const count=points.length/4,W=256,H=Math.ceil(count/W),data=new Float32Array(W*H*4);data.set(points);
 const tex=gl.createTexture();gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,tex);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,W,H,0,gl.RGBA,gl.FLOAT,data);
 gl.uniform1i(loc('testPoints'),7);gl.uniform1i(loc('testMode'),1);gl.viewport(0,0,W,H);gl.drawArrays(gl.TRIANGLES,0,3);
 const pixels=new Uint8Array(W*H*4);gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
 let gaps=0;const failed=[];
 for(let i=0;i<count;i++)if(pixels[i*4]<8){gaps++;if(failed.length<12)failed.push({index:i,xyz:points.slice(i*4,i*4+3),value:pixels[i*4]});}
 if(gl.getError()!==gl.NO_ERROR)throw Error('WebGL error');
 results.push({seed:state.seed,samples:count,gaps,failed});
 gl.uniform1i(loc('testMode'),0);gl.viewport(0,0,1200,600);gl.drawArrays(gl.TRIANGLES,0,3);
 const copy=document.createElement('canvas');copy.width=1200;copy.height=600;copy.getContext('2d').drawImage(display,0,0);
 document.body.appendChild(document.createTextNode('Seed '+state.seed));document.body.appendChild(copy);gl.deleteTexture(tex);
 next++;out.textContent=(next===seeds.length?(results.some(r=>r.gaps)?'FAIL':'PASS'):'Running')+': actual channel shader continuity\\n'+JSON.stringify(results,null,2);
 if(next<seeds.length)setTimeout(run,100);
}catch(e){out.textContent='FAIL: '+e.stack;}}
run();
`].join('\n');
fs.writeFileSync(path.join(root,'river-render.tmp.html'),'<!doctype html><meta charset="utf-8"><title>River renderer regression</title><style>body{font:14px monospace}canvas{display:block;max-width:100%}</style><div id="seedLabel"></div><input id="seed"><pre>Running…</pre><script>'+script+'</script>');
console.log('Open http://127.0.0.1:8734/river-render.tmp.html');
