/*
{
  "DESCRIPTION": "Three-Body MothIII orbit with selectable visual effect",
  "CREDIT": "Ghost Arcade",
  "ISFVSN": "2",
  "CATEGORIES": [
    "GENERATOR"
  ],
  "INPUTS": [
    {
      "NAME": "effectStyle",
      "TYPE": "long",
      "VALUES": [0,1,2,3,4,5,6,7,8,9,10,11],
      "LABELS": ["Orbits","Ribbons","Particles","Fire","Neon","Plasma","Stardust","Wireframe","Kaleidoscope","Glitch","Nebula","Bloom"],
      "DEFAULT": 0
    },
    {"NAME": "quality", "TYPE": "long", "VALUES": [0,1,2], "LABELS": ["Low","Medium","High"], "DEFAULT": 1},
    {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 3, "DEFAULT": 1},
    {"NAME": "zoom", "TYPE": "float", "MIN": 0.3, "MAX": 3, "DEFAULT": 1},
    {"NAME": "trailLength", "TYPE": "float", "MIN": 0.2, "MAX": 1, "DEFAULT": 0.7},
    {"NAME": "colorShift", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0},
    {"NAME": "svPump", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0},
    {"NAME": "svChaos", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0},
    {"NAME": "svGlow", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 0},
    {"NAME": "svColor", "TYPE": "float", "MIN": 0, "MAX": 1, "DEFAULT": 0},
    {"NAME": "svSpeed", "TYPE": "float", "MIN": 0, "MAX": 2, "DEFAULT": 1}
  ]
}
*/

#define VX 0.383444
#define VY 0.377364
#define PER 7.0039
#define S2 0.000225

vec3 grav(vec3 a, vec3 b){vec3 d=b-a;float r2=dot(d,d)+S2;return d/(r2*sqrt(r2));}

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}

float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<3;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}

vec3 palette(float t,float shift){
  t+=shift;
  vec3 a=vec3(0.5),b=vec3(0.5),c=vec3(1.0),d=vec3(t,t+0.33,t+0.67);
  return a+b*cos(6.28318*(c*t+d));
}

void main(){
  vec2 uv=(gl_FragCoord.xy-RENDERSIZE*.5)/(min(RENDERSIZE.x,RENDERSIZE.y)*.45)*zoom;
  int steps=quality==0?80:quality==1?150:200;
  float dt=PER/float(steps);
  float finalSpeed=speed*svSpeed;
  float t=mod(TIME*finalSpeed,PER);
  int maxI=int(t/dt);
  float frac=t/dt-float(maxI);
  int trail=int(float(steps)*trailLength);

  vec3 p1=vec3(-1,0,0),p2=vec3(1,0,0),p3=vec3(0,0,0);
  vec3 v1=vec3(VX,VY,0),v2=vec3(VX,VY,0),v3=vec3(-2.0*VX,-2.0*VY,0);

  float md1=99.0,md2=99.0,md3=99.0;
  vec3 lp1,lp2,lp3;
  float glow1=0.0,glow2=0.0,glow3=0.0;

  for(int i=0;i<steps;i++){
    if(i>maxI)break;
    vec3 g12=grav(p1,p2),g13=grav(p1,p3),g23=grav(p2,p3);
    vec3 a1=g12+g13,a2=-g12+g23,a3=-g13-g23;
    v1+=a1*dt;v2+=a2*dt;v3+=a3*dt;
    p1+=v1*dt;p2+=v2*dt;p3+=v3*dt;

    int age=maxI-i;
    if(age<trail){
      float w=1.0-float(age)/float(trail);
      vec3 q1=vec3(p1.xy,0),q2=vec3(p2.xy,0),q3=vec3(p3.xy,0);
      float d1=length(uv-q1.xy),d2=length(uv-q2.xy),d3=length(uv-q3.xy);
      if(d1<md1)md1=d1;if(d2<md2)md2=d2;if(d3<md3)md3=d3;
      glow1+=w*0.003/(d1*d1+0.001);
      glow2+=w*0.003/(d2*d2+0.001);
      glow3+=w*0.003/(d3*d3+0.001);
      lp1=q1;lp2=q2;lp3=q3;
    }
  }

  float totalShift=colorShift+svColor;
  vec3 c1=palette(0.0,totalShift),c2=palette(0.33,totalShift),c3=palette(0.67,totalShift);
  vec3 col=vec3(0);

  if(effectStyle==0){
    col+=c1*(0.008/(md1+0.005))+c2*(0.008/(md2+0.005))+c3*(0.008/(md3+0.005));
  }else if(effectStyle==1){
    float r1=smoothstep(0.06,0.0,md1),r2=smoothstep(0.06,0.0,md2),r3=smoothstep(0.06,0.0,md3);
    col+=c1*r1+c2*r2+c3*r3;
  }else if(effectStyle==2){
    col+=c1*glow1+c2*glow2+c3*glow3;
    float sparkle=hash(uv*50.0+TIME);
    col*=0.8+0.4*sparkle;
  }else if(effectStyle==3){
    float f=fbm(uv*3.0+TIME*0.5);
    col+=c1*(0.01/(md1+0.005))*f*3.0+c2*(0.01/(md2+0.005))*f*3.0+c3*(0.01/(md3+0.005))*f*3.0;
    col+=vec3(1.0,0.3,0.05)*f*0.15;
  }else if(effectStyle==4){
    float n1=0.02/(md1*md1+0.0004),n2=0.02/(md2*md2+0.0004),n3=0.02/(md3*md3+0.0004);
    col+=c1*n1+c2*n2+c3*n3;
    col=min(col,vec3(2.0));
  }else if(effectStyle==5){
    float arc1=0.005/(abs(md1-md2)+0.005);
    float arc2=0.005/(abs(md2-md3)+0.005);
    float arc3=0.005/(abs(md1-md3)+0.005);
    float n=fbm(uv*8.0+TIME*2.0);
    col+=(c1+c2)*arc1*n+(c2+c3)*arc2*n+(c1+c3)*arc3*n;
  }else if(effectStyle==6){
    float n=fbm(uv*4.0-TIME*0.3);
    float dust=n*0.3;
    col+=c1*(0.012/(md1+0.008))+c2*(0.012/(md2+0.008))+c3*(0.012/(md3+0.008));
    col+=vec3(0.1,0.05,0.2)*dust;
  }else if(effectStyle==7){
    float line1=0.003/(abs(md1-md2)+0.003);
    float line2=0.003/(abs(md2-md3)+0.003);
    float line3=0.003/(abs(md1-md3)+0.003);
    col+=(c1+c2)*0.5*line1+(c2+c3)*0.5*line2+(c1+c3)*0.5*line3;
    col+=c1*(0.005/(md1+0.005))+c2*(0.005/(md2+0.005))+c3*(0.005/(md3+0.005));
  }else if(effectStyle==8){
    vec2 kuv=uv;
    float ang=atan(kuv.y,kuv.x);
    float rad=length(kuv);
    ang=mod(ang,1.0472)-0.5236;
    kuv=vec2(cos(ang),sin(ang))*rad;
    float kd1=length(kuv-lp1.xy),kd2=length(kuv-lp2.xy),kd3=length(kuv-lp3.xy);
    col+=c1*(0.01/(kd1+0.005))+c2*(0.01/(kd2+0.005))+c3*(0.01/(kd3+0.005));
  }else if(effectStyle==9){
    float scan=0.8+0.2*sin(gl_FragCoord.y*3.0+TIME*10.0);
    float shift=0.02*sin(TIME*5.0);
    col.r+=0.01/(md1+shift+0.005);col.g+=0.01/(md2+0.005);col.b+=0.01/(md3-shift+0.005);
    col*=scan;
    col+=vec3(hash(uv+TIME))*0.05;
  }else if(effectStyle==10){
    float n1=fbm(uv*2.0+lp1.xy);
    float n2=fbm(uv*2.0+lp2.xy);
    float n3=fbm(uv*2.0+lp3.xy);
    float g=0.1/(md1+0.05)+0.1/(md2+0.05)+0.1/(md3+0.05);
    col+=c1*n1*0.3+c2*n2*0.3+c3*n3*0.3;
    col*=1.0+g*0.5;
  }else if(effectStyle==11){
    float b1=0.01/(md1+0.005),b2=0.01/(md2+0.005),b3=0.01/(md3+0.005);
    col+=c1*b1+c2*b2+c3*b3;
    float bloom=(b1+b2+b3)*0.15;
    col+=vec3(bloom);
    col=1.0-exp(-col*1.5);
  }

  // ── SynthVision Integration ──
  // Chaos: FBM noise perturbation
  if(svChaos>0.01){
    float cn=fbm(uv*4.0+TIME*svChaos*3.0);
    col+=col*svChaos*cn*2.0;
  }
  // Glow boost
  col*=1.0+svGlow*3.0;
  // Pump brightness flash
  col*=1.0+svPump*3.0;

  col=clamp(col,0.0,1.0);
  gl_FragColor=vec4(col,1.0);
}
