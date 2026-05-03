/*{"DESCRIPTION":"Aurora Veil - volumetric aurora curtains in 3D space","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"curtainCount","TYPE":"float","DEFAULT":4.0,"MIN":1.0,"MAX":8.0},{"NAME":"curtainHeight","TYPE":"float","DEFAULT":3.0,"MIN":1.0,"MAX":6.0},{"NAME":"colorA","TYPE":"color","DEFAULT":[0.1,0.8,0.3,1.0]},{"NAME":"colorB","TYPE":"color","DEFAULT":[0.3,0.2,0.8,1.0]},{"NAME":"colorC","TYPE":"color","DEFAULT":[0.8,0.2,0.4,1.0]},{"NAME":"waveSpeed","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"density","TYPE":"float","DEFAULT":0.5,"MIN":0.1,"MAX":1.5},{"NAME":"cameraLookUp","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"shimmer","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    vec3 col=vec3(0.005,0.005,0.015);
    // Camera looking slightly up
    vec3 rd=normalize(vec3(uv.x,uv.y+cameraLookUp,1.0));
    float ca=t*0.05;
    rd.xz=mat2(cos(ca),-sin(ca),sin(ca),cos(ca))*rd.xz;
    vec3 ro=vec3(0.0,0.0,0.0);
    // March through aurora volume
    for(float i=0.0;i<50.0;i++){
        float td=i*0.3+0.5;
        vec3 p=ro+rd*td;
        if(p.y<0.5)continue; // Aurora above horizon
        // Multiple curtain sheets
        for(float c=0.0;c<8.0;c++){
            if(c>=curtainCount)break;
            float fc=c;
            float curtainZ=fc*2.0+sin(p.x*0.5+t*waveSpeed+fc)*1.5;
            float distToCurtain=abs(p.z-curtainZ);
            if(distToCurtain<0.5){
                // Curtain shape
                float wave=fbm(vec2(p.x*0.3+t*waveSpeed*0.3+fc*5.0,p.y*0.2))*2.0;
                float heightFade=smoothstep(0.5,1.5,p.y)*smoothstep(curtainHeight,curtainHeight-1.0,p.y);
                float curtainDens=exp(-distToCurtain*distToCurtain*10.0)*heightFade;
                curtainDens*=0.5+0.5*sin(wave*3.0+p.y*2.0);
                // Shimmer
                float shim=0.5+0.5*sin(p.y*20.0+t*5.0+fc*3.0)*shimmer;
                curtainDens*=0.5+shim;
                // Color by height
                float hNorm=(p.y-0.5)/(curtainHeight-0.5);
                vec3 auroraCol=mix(colorA.rgb,colorB.rgb,hNorm);
                auroraCol=mix(auroraCol,colorC.rgb,pow(hNorm,2.0));
                auroraCol=mix(auroraCol,vec3(1.0),pow(hNorm,4.0)*0.3);
                float fogFade=exp(-td*0.05);
                col+=auroraCol*curtainDens*density*0.015*fogFade;
            }
        }
    }
    // Stars
    vec2 starUV=rd.xy*30.0+rd.z*17.0;
    float starH=hash(floor(starUV));
    if(starH>0.97&&rd.y>0.0){
        float sd=length(fract(starUV)-0.5);
        col+=vec3(0.5,0.5,0.6)*0.003/(sd+0.008);
    }
    col=pow(col,vec3(0.85));
    gl_FragColor=vec4(col,1.0);
}
