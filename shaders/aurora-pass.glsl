precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform float uFocal;
uniform vec3 uSunDir;
uniform vec3 uMagAxis;
uniform float uMagField;
uniform float uAurora;
uniform float uAtmo;
uniform float uStarFlux;

float h31(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float n3(vec3 p){
  vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),
                 mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),
                 mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z)*2.0-1.0;
}
float fb(vec3 p){float a=0.0,w=0.55;for(int i=0;i<3;i++){a+=w*n3(p);p=p*2.03+vec3(1.7,2.9,4.1);w*=0.5;}return a;}

vec2 sphRange(vec3 ro,vec3 rd,float r){
  float b=dot(ro,rd),c=dot(ro,ro)-r*r,q=b*b-c;
  if(q<0.0)return vec2(-1.0);
  float s=sqrt(q); return vec2(-b-s,-b+s);
}
float sphNear(vec3 ro,vec3 rd,float r){
  vec2 q=sphRange(ro,rd,r); if(q.x<0.0&&q.y<0.0)return -1.0;
  return q.x>0.0?q.x:q.y;
}

/* 0.5.68: Kp widens the REGION in which auroral curtains may occur, not one
   thick luminous band. 0.5.63..0.5.67 tried to guarantee visibility with a
   non-zero sector floor and an 8.8 degree half-width. From a polar camera that
   mathematically guaranteed the familiar green "eye". Keep a broad physical
   oval envelope, but populate it with thin independently broken ribbons. */
vec3 auroraEmission(vec3 p,vec3 rd,float activity,float innerR,float outerR){
  float r=length(p); if(r<innerR||r>outerR)return vec3(0.0);
  vec3 n=p/r, ma=normalize(uMagAxis);
  float pole=dot(n,ma);
  float lat=abs(asin(clamp(pole,-1.0,1.0)));
  vec3 ref=abs(ma.y)<0.92?vec3(0,1,0):vec3(1,0,0);
  vec3 mt=normalize(cross(ma,ref)), mb=cross(ma,mt);
  vec3 mq=vec3(dot(n,mt),dot(n,mb),pole);

  float activityV=pow(clamp(activity,0.0,1.0),0.80);
  float timeA=uTime*(0.018+0.060*activityV);
  float daySide=clamp(dot(n,uSunDir)*0.5+0.5,0.0,1.0);
  float baseCenter=radians(mix(75.0,59.5,activityV));
  float wander=fb(mq*3.0+vec3(timeA,-timeA*0.72,11.0));
  float center=baseCenter+radians(1.45)*wander+radians(0.75)*(daySide*2.0-1.0);

  /* zoneHW controls where precipitation is plausible; ribbonHW controls the
     optical curtain thickness. Even Kp 9 therefore yields several thin arcs
     spread over a wider latitude range instead of one fat annulus. */
  float zoneHW=radians(mix(1.8,7.0,activityV));
  float ribbonHW=radians(mix(0.38,0.88,activityV));
  float zoneD=(lat-center)/max(zoneHW,1e-4);
  float zone=exp(-1.35*zoneD*zoneD);
  if(zone<0.008)return vec3(0.0);

  float shapeA=fb(mq*4.2+vec3(timeA*0.65,7.0,-timeA*0.31));
  float shapeB=fb(mq*5.1+vec3(19.0,-timeA*0.44,3.0));
  float c0=center+zoneHW*(0.10+0.20*shapeA);
  float c1=center-zoneHW*(0.34+0.15*shapeB);
  float c2=center+zoneHW*(0.42+0.10*shapeB);

  /* No minimum sector floor. Real aurora can have large dark magnetic-local-
     time sectors. Two unrelated broad masks make total disappearance unlikely
     while still allowing the black gaps that prevent a techno-ring. */
  float broad0=0.5+0.5*fb(mq*2.30+vec3(timeA*0.43,17.0,-timeA*0.28));
  float broad1=0.5+0.5*fb(mq*2.85+vec3(31.0,-timeA*0.36,9.0));
  float cut0=mix(0.64,0.39,activityV);
  float cut1=mix(0.70,0.44,activityV);
  float sector0=smoothstep(cut0,cut0+0.17,broad0);
  float sector1=smoothstep(cut1,cut1+0.18,broad1);

  float d0=(lat-c0)/max(ribbonHW,1e-4);
  float d1=(lat-c1)/max(ribbonHW*0.82,1e-4);
  float d2=(lat-c2)/max(ribbonHW*0.70,1e-4);
  float arc0=exp(-2.9*d0*d0)*sector0;
  float arc1=0.78*exp(-3.3*d1*d1)*sector1*smoothstep(0.22,0.58,activityV);
  float arc2=0.46*exp(-3.8*d2*d2)*sector0*sector1*smoothstep(0.58,0.88,activityV);

  /* Split the strongest sheet into a nearby filament. This remains tied to
     the same physical sector instead of creating a periodic concentric ring. */
  float splitD=(lat-(c0-ribbonHW*1.55))/max(ribbonHW*0.52,1e-4);
  float split=0.34*exp(-4.6*splitD*splitD)*sector0*smoothstep(0.34,0.70,activityV);
  float arc=clamp((arc0+arc1+arc2+split)*zone,0.0,1.45);
  if(arc<0.0007)return vec3(0.0);

  /* Fine structure runs along the sheets. Unlike the old low-frequency broad
     opacity blobs, these frequencies make narrow curtain folds and holes. */
  float foldA=0.5+0.5*fb(mq*13.0+vec3(-timeA*0.92,5.0,timeA*0.58));
  float foldB=0.5+0.5*n3(mq*31.0+vec3(13.0,timeA*1.75,-7.0));
  float folds=0.24+0.76*smoothstep(0.43,0.70,foldA*0.72+foldB*0.28);
  float ragged=0.66+0.34*(0.5+0.5*n3(mq*9.5+vec3(43.0,-timeA,3.0)));

  /* Looking tangentially through a real sheet gives a much longer optical
     path. Accentuate that geometry modestly: face-on polar views show broken
     arcs, while the limb develops the bright upright curtains seen from orbit. */
  float tangent=pow(clamp(1.0-abs(dot(n,-rd)),0.0,1.0),0.70);
  float viewGain=mix(0.70,1.55,tangent);

  float night=1.0-smoothstep(-0.14,0.17,dot(n,uSunDir));
  float magSupport=0.36+0.64*sqrt(clamp(uMagField,0.0,1.0));
  float power=(0.020+0.46*pow(activityV,1.42))*magSupport;
  power*=mix(0.028,1.0,night)*smoothstep(0.02,0.17,uAtmo);

  float alt=clamp((r-innerR)/max(outerR-innerR,1e-4),0.0,1.0);
  float greenH=exp(-pow((alt-0.32)/0.22,2.0));
  float redH=exp(-pow((alt-0.80)/0.18,2.0));
  float violetH=exp(-pow((alt-0.16)/0.15,2.0));
  vec3 green=vec3(0.11,0.84,0.27);
  vec3 red=vec3(0.80,0.14,0.085);
  vec3 violet=vec3(0.24,0.17,0.62);
  vec3 color=green*greenH+red*redH*(0.12+0.42*activityV)+violet*violetH*(0.035+0.095*activityV);
  color*=clamp(0.88+0.12*uStarFlux,0.78,1.18);
  return color*(arc*folds*ragged*power*viewGain);
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec3 rd=normalize(uCamMat*normalize(vec3(uv,uFocal)));
  vec3 ro=uCamPos;
  if(uAurora<0.005||uMagField<0.01||uAtmo<0.02){fragColor=vec4(0);return;}

  float activity=clamp(uAurora,0.0,1.0);
  /* Roughly 90..430 km for an Earth-size visual scale. */
  float innerR=1.0135+0.0030*uAtmo;
  float outerR=1.0580+0.0090*uAtmo;
  vec2 outer=sphRange(ro,rd,outerR);
  if(outer.y<=0.0){fragColor=vec4(0);return;}
  float ta=max(outer.x,0.0), tb=outer.y;
  float planet=sphNear(ro,rd,1.0);
  if(planet>0.0)tb=min(tb,planet);
  if(tb<=ta){fragColor=vec4(0);return;}

  vec3 sum=vec3(0.0);
  const int N=8;
  float stepLen=(tb-ta)/float(N);
  for(int i=0;i<N;i++){
    float t=ta+(float(i)+0.5)*stepLen;
    sum+=auroraEmission(ro+rd*t,rd,activity,innerR,outerR);
  }
  sum*=clamp(stepLen/0.0095,0.38,1.85);

  /* The pass is additively composited over an already display-space planet.
     Keep it plainly visible, but undo the 0.5.65 overcompensation that made
     moderate Kp look like a fluorescent torus across the whole disc. */
  vec3 display=sum/(vec3(1.0)+0.78*sum);
  display=pow(clamp(display,vec3(0.0),vec3(1.0)),vec3(1.0/2.2))*0.92;
  fragColor=vec4(clamp(display,vec3(0.0),vec3(0.95)),1.0);
}
