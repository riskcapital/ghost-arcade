/*{"DESCRIPTION":"Quantum Tunnel - probability wave tube with interference and particle beam","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":2.0},{"NAME":"tunnelRadius","TYPE":"float","DEFAULT":0.4,"MIN":0.15,"MAX":0.8},{"NAME":"waveFreq","TYPE":"float","DEFAULT":8.0,"MIN":2.0,"MAX":20.0},{"NAME":"waveAmplitude","TYPE":"float","DEFAULT":0.4,"MIN":0.0,"MAX":1.0},{"NAME":"waveColor","TYPE":"color","DEFAULT":[0.3,0.5,1.0,1.0]},{"NAME":"antiColor","TYPE":"color","DEFAULT":[0.8,0.3,0.5,1.0]},{"NAME":"flySpeed","TYPE":"float","DEFAULT":2.0,"MIN":0.0,"MAX":5.0},{"NAME":"interference","TYPE":"float","DEFAULT":0.7,"MIN":0.0,"MAX":1.5},{"NAME":"depthRings","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":2.0},{"NAME":"probabilityGlow","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    vec3 ro=vec3(sin(t*0.3)*0.1,cos(t*0.2)*0.1,t*flySpeed);
    vec3 rd=normalize(vec3(uv,1.5));
    rd.xy+=vec2(sin(t*0.5),cos(t*0.3))*0.03;
    vec3 col=vec3(0.0);
    float r=length(rd.xy);
    if(r>0.001){
        float wallDist=tunnelRadius/r;
        vec3 wallP=ro+rd*wallDist;
        float wallAngle=atan(wallP.y-ro.y,wallP.x-ro.x);
        // Standing wave pattern
        float psi1=sin(wallP.z*waveFreq-t*5.0)*waveAmplitude;
        float psi2=sin(wallP.z*waveFreq*1.3+t*3.0+PI*0.5)*waveAmplitude*interference;
        float probability=(psi1*psi1+psi2*psi2)*probabilityGlow;
        float interf=(psi1+psi2);
        // Grid on walls
        float gz=fract(wallP.z*0.5);
        float ga=fract(wallAngle*4.0/PI);
        float grid=smoothstep(0.03,0.0,min(abs(gz-0.5),abs(ga-0.5)))*0.15;
        float fog=exp(-wallDist*0.08);
        vec3 wCol=mix(antiColor.rgb,waveColor.rgb,0.5+0.5*interf/max(waveAmplitude,0.01));
        col+=wCol*probability*0.4*fog;
        col+=waveColor.rgb*grid*fog;
        // Depth rings
        if(depthRings>0.0){
            for(float ri=0.0;ri<15.0;ri++){
                float ringZ=ro.z+ri*2.0;
                float ringScreenR=tunnelRadius/(1.0+ri*0.3);
                float ringDist=abs(length(uv)-ringScreenR);
                float ring=exp(-ringDist*ringDist*500.0)*depthRings;
                ring*=exp(-ri*0.2);
                float pulse=0.5+0.5*sin(ringZ*waveFreq-t*5.0);
                col+=waveColor.rgb*ring*0.1*pulse;
            }
        }
    }
    // Central energy beam
    float beamR=length(uv);
    float beam=exp(-beamR*beamR*15.0)*0.15;
    float beamPulse=0.5+0.5*sin(t*8.0);
    col+=waveColor.rgb*beam*beamPulse;
    // Noise particles
    for(float i=0.0;i<20.0;i++){
        float fi=i;
        float pz=mod(ro.z+fi*1.5,30.0);
        float pa=fi*2.399+t;
        float pr=tunnelRadius*0.3*(0.2+hash(vec3(fi,0,0))*0.8);
        vec3 pp=vec3(cos(pa)*pr,sin(pa)*pr,pz);
        vec3 toP=pp-ro;
        float along=dot(toP,rd);
        if(along>0.0){
            vec3 cl=ro+rd*along;
            float pd=length(cl-pp);
            col+=waveColor.rgb*0.001/(pd*pd+0.001)*exp(-along*0.1);
        }
    }
    col=pow(col,vec3(0.85));
    gl_FragColor=vec4(col,1.0);
}
