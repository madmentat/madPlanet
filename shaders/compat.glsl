precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform float uFocal;
uniform mat3 uRotS;
uniform mat3 uRotC;
uniform vec3 uSunDir;
uniform vec3 uAxis;
uniform float uTemp;
uniform float uCloudLow;
uniform float uCloudMid;
uniform float uCloudHigh;
uniform float uLowOn;
uniform float uMidOn;
uniform float uHighOn;
uniform float uSea;
uniform float uCont;
uniform float uTect;
uniform float uAtmo;
uniform vec3 uStarCol;
uniform float uStarFlux;
uniform float uVoid;
uniform vec3 uSeedS;
uniform vec3 uSeedC;

float h31(vec3 p){
  p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z);
}
float n3(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=h31(i+vec3(0,0,0)), b=h31(i+vec3(1,0,0));
  float c=h31(i+vec3(0,1,0)), d=h31(i+vec3(1,1,0));
  float e=h31(i+vec3(0,0,1)), g=h31(i+vec3(1,0,1));
  float h=h31(i+vec3(0,1,1)), j=h31(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,j,f.x),f.y),f.z)*2.0-1.0;
}
float fb(vec3 p){
  float a=0.0,w=0.55; for(int i=0;i<4;i++){ a+=w*n3(p); p=p*2.03+vec3(1.7,2.9,4.1); w*=0.5; } return a;
}
float iSphere(vec3 ro,vec3 rd,float r){
  float b=dot(ro,rd), c=dot(ro,ro)-r*r, q=b*b-c; if(q<0.0)return -1.0; return -b-sqrt(q);
}
vec3 starField(vec3 rd){
  if(uVoid>0.5)return vec3(0.0);
  vec3 p=rd*120.0, id=floor(p), f=fract(p)-0.5;
  float k=h31(id+uSeedS*7.0), d=length(f);
  float s=smoothstep(0.055,0.0,d)*pow(k,22.0)*2.5;
  float sun=max(dot(rd,normalize(uSunDir)),0.0);
  return vec3(s)+uStarCol*pow(sun,3400.0)*(8.0+8.0*uStarFlux);
}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec3 rd=normalize(uCamMat*normalize(vec3(uv,uFocal)));
  vec3 ro=uCamPos;
  float tp=iSphere(ro,rd,1.0);
  vec3 col=starField(rd);
  if(tp>0.0){
    vec3 n=normalize(ro+rd*tp), q=uRotS*n;
    float macro=fb(q*1.55+uSeedS*0.7)+0.32*fb(q*3.6+uSeedS*1.3);
    float ridge=abs(fb(q*6.0+vec3(9.0)));
    float sea=mix(-0.14,0.24,uSea)+mix(-0.12,0.10,uCont);
    float h=macro*0.30+ridge*0.08*uTect-sea;
    float land=smoothstep(-0.012,0.018,h);
    float lat=abs(dot(n,normalize(uAxis)));
    float temp=mix(-0.25,1.20,uTemp)-lat*lat*1.0-max(h,0.0)*0.45;
    float moist=0.5+0.5*fb(q*2.3+vec3(17.0));
    vec3 ocean=mix(vec3(0.012,0.060,0.125),vec3(0.025,0.14,0.18),smoothstep(-0.08,0.02,h));
    vec3 sand=vec3(0.31,0.25,0.15), grass=vec3(0.10,0.19,0.075), forest=vec3(0.045,0.11,0.050);
    vec3 ground=mix(sand,mix(grass,forest,smoothstep(0.48,0.78,moist)),smoothstep(0.05,0.55,temp));
    float snow=1.0-smoothstep(-0.08,0.08,temp+0.08*fb(q*5.0));
    ground=mix(ground,vec3(0.78,0.82,0.86),snow);
    ground*=0.82+0.22*(0.5+0.5*fb(q*18.0));
    vec3 base=mix(ocean,ground,land);
    float ndl=dot(n,normalize(uSunDir));
    float day=max(ndl,0.0), ambient=0.055+0.055*uAtmo;
    col=base*(ambient+day*1.15*uStarCol);
    float rim=pow(max(0.0,1.0-dot(n,-rd)),3.0);
    col+=vec3(0.10,0.28,0.72)*rim*(0.12+0.25*uAtmo)*max(0.2,day);

    float dryHot=land*smoothstep(0.62,0.95,temp)*(1.0-smoothstep(0.30,0.56,moist));
    float lowClimate=mix(0.98,0.18,dryHot);
    if(uLowOn>0.5 && uCloudLow>0.015){
      vec3 cq=uRotC*n;
      float syn=0.70*fb(cq*1.75+uSeedC)+0.30*fb(cq*4.2+uSeedC*1.7+vec3(uTime*0.006,0,0));
      float detail=fb(cq*9.0+vec3(0,uTime*0.010,0));
      float amt=uCloudLow*lowClimate;
      float th=mix(0.70,0.02,amt);
      float cm=smoothstep(th,th+0.24,syn+0.12*detail);
      float lit=0.34+0.66*max(ndl,0.0);
      vec3 cc=mix(vec3(0.55,0.58,0.62),vec3(1.0,0.99,0.95),lit);
      col=mix(col,cc,cm*0.78);
    }
    if(uMidOn>0.5 && uCloudMid>0.02){
      vec3 mq=uRotC*n+vec3(17.0);
      float mf=0.68*fb(mq*1.15)+0.32*fb(mq*3.6+vec3(uTime*-0.004,0,0));
      float mm=smoothstep(mix(0.72,0.08,uCloudMid),mix(0.92,0.30,uCloudMid),mf);
      vec3 mc=vec3(0.78,0.80,0.84)*(0.42+0.58*max(ndl,0.0));
      col=mix(col,mc,mm*0.48);
    }
    if(uHighOn>0.5 && uCloudHigh>0.02){
      vec3 hq=uRotC*n+vec3(41.0);
      float hf=fb(hq*4.8+vec3(0,uTime*0.004,0));
      float hm=smoothstep(mix(0.82,0.28,uCloudHigh),mix(0.96,0.52,uCloudHigh),hf);
      col=mix(col,vec3(0.90,0.93,1.0),hm*0.22);
    }
  } else {
    float ta=iSphere(ro,rd,1.08+0.05*uAtmo);
    if(ta>0.0){
      vec3 n=normalize(ro+rd*ta);
      float rim=pow(max(0.0,1.0-abs(dot(n,-rd))),3.0);
      col+=vec3(0.08,0.24,0.70)*rim*0.10*uAtmo;
    }
  }
  col=clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14),0.0,1.0);
  col=pow(col,vec3(1.0/2.2));
  fragColor=vec4(col,1.0);
}
