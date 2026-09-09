/* Thin channels follow drainage segments. The texture is an acceleration
   structure, not a painted river mask; its texel size never sets river width. */
vec3 riverFaceDirection(int face,vec2 p){
  if(face==0)return normalize(vec3(1.0,p.y,-p.x));
  if(face==1)return normalize(vec3(-1.0,p.y,p.x));
  if(face==2)return normalize(vec3(p.x,1.0,-p.y));
  if(face==3)return normalize(vec3(p.x,-1.0,p.y));
  if(face==4)return normalize(vec3(p.x,p.y,1.0));
  return normalize(vec3(-p.x,p.y,-1.0));
}
vec2 riverChannelSample(vec3 d,float footprint){
  if(uRiverLoopOn<0.5)return vec2(0.0);
  vec3 ad=abs(d);vec2 uv;int face;
  if(ad.x>=ad.y&&ad.x>=ad.z){
    face=d.x>=0.0?0:1;uv=vec2(d.x>=0.0?-d.z:d.z,d.y)/ad.x;
  }else if(ad.y>=ad.z){
    face=d.y>=0.0?2:3;uv=vec2(d.x,d.y>=0.0?-d.z:d.z)/ad.y;
  }else{
    face=d.z>=0.0?4:5;uv=vec2(d.z>=0.0?d.x:-d.x,d.y)/ad.z;
  }
  float size=float(textureSize(uRiverLoopTex,0).x);
  vec2 base=floor((vec2(uv.x,-uv.y)*0.5+0.5)*size);
  vec2 result=vec2(0.0);
  // At a confluence the trunk can own all four nearest texels. Include the
  // upstream texel too, so the last part of a tributary reaches the junction.
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec2 cell=base+vec2(float(x),float(y));
    vec2 p=(cell+0.5)/size*2.0-1.0;p.y=-p.y;
    vec3 query=riverFaceDirection(face,p);
    vec4 edge=texture(uRiverLoopTex,query);
    int edgeFace=face;
    if(any(greaterThan(abs(p),vec2(1.0)))){
      vec3 aq=abs(query);
      if(aq.x>=aq.y&&aq.x>=aq.z)edgeFace=query.x>=0.0?0:1;
      else if(aq.y>=aq.z)edgeFace=query.y>=0.0?2:3;
      else edgeFace=query.z>=0.0?4:5;
    }
    float widthBin=floor(edge.r/8.0+0.5);
    if(widthBin<0.5)continue;
    vec3 a=riverFaceDirection(edgeFace,vec2(edge.r-widthBin*8.0,edge.g));
    vec3 b=riverFaceDirection(edgeFace,edge.ba),ab=b-a;
    float t=clamp(dot(d-a,ab)/max(dot(ab,ab),1e-12),0.0,1.0);
    float distance=length(d-normalize(a+ab*t));
    float halfWidth=mix(0.000008,0.00012,pow(widthBin/15.0,1.6));
    float aa=max(0.000004,footprint*0.60);
    float ink=(1.0-smoothstep(max(0.0,halfWidth-aa),halfWidth+aa,distance));
    ink*=clamp(halfWidth/aa,0.32,1.0);
    float plain=1.0-smoothstep(halfWidth*2.0,halfWidth*8.0+aa,distance);
    result=max(result,vec2(ink,plain));
  }
  return result;
}
