/*{"DESCRIPTION":"Gravity Fabric - 3D spacetime grid deformed by orbiting masses","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.3,"MIN":0.0,"MAX":1.0},{"NAME":"gridDensity","TYPE":"float","DEFAULT":20.0,"MIN":8.0,"MAX":40.0},{"NAME":"wellStrength","TYPE":"float","DEFAULT":1.5,"MIN":0.0,"MAX":4.0},{"NAME":"wellCount","TYPE":"float","DEFAULT":3.0,"MIN":1.0,"MAX":5.0},{"NAME":"gridColor","TYPE":"color","DEFAULT":[0.2,0.4,0.8,1.0]},{"NAME":"wellColor","TYPE":"color","DEFAULT":[0.8,0.4,1.0,1.0]},{"NAME":"cameraHeight","TYPE":"float","DEFAULT":2.5,"MIN":0.5,"MAX":5.0},{"NAME":"waveRipples","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.5},{"NAME":"perspective","TYPE":"float","DEFAULT":1.5,"MIN":0.5,"MAX":3.0},{"NAME":"fabricGlow","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(float n){return fract(sin(n)*43758.5453);}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    vec3 col=vec3(0.008,0.004,0.018);
    vec3 ro=vec3(sin(t*0.15)*3.0,cameraHeight,cos(t*0.1)*3.0);
    vec3 rd=normalize(vec3(uv.x,uv.y-0.4,perspective));
    float ca=t*0.08;
    float cc=cos(ca),ss=sin(ca);
    rd.xz=vec2(rd.x*cc+rd.z*ss,-rd.x*ss+rd.z*cc);
    // Well positions
    vec3 wells[5];
    for(int w=0;w<5;w++){
        float fw=float(w);
        wells[w]=vec3(sin(t*0.25+fw*2.1)*2.5,0.0,cos(t*0.18+fw*1.7)*2.5);
    }
    // March through grid fabric
    for(float i=0.0;i<60.0;i++){
        float td=i*0.25+0.2;
        vec3 p=ro+rd*td;
        vec2 gp=p.xz;
        // Gravitational deformation
        float deform=0.0;
        float wellProx=0.0;
        for(int w=0;w<5;w++){
            if(float(w)>=wellCount)break;
            float dist=length(gp-wells[w].xz);
            deform-=wellStrength/(dist*dist+0.3);
            wellProx+=1.0/(dist+0.5);
            deform+=sin(dist*6.0-t*4.0)*waveRipples*0.08*exp(-dist*0.3);
        }
        float fabricY=deform;
        if(abs(p.y-fabricY)<0.08){
            float gs=gridDensity*0.1;
            vec2 gf=fract(gp*gs);
            float gridLine=min(abs(gf.x-0.5),abs(gf.y-0.5))*2.0;
            float line=smoothstep(0.04,0.0,gridLine);
            // Intersection nodes
            vec2 gi=floor(gp*gs);
            vec2 nearNode=(gi+0.5)/gs;
            float nodeDist=length(gp-nearNode);
            float node=smoothstep(0.04,0.0,nodeDist);
            float fog=exp(-td*0.06);
            vec3 lineCol=mix(gridColor.rgb,wellColor.rgb,clamp(wellProx*0.2,0.0,1.0));
            // Deformation brightness (stretched = brighter)
            float stretch=1.0+abs(deform)*0.5;
            col+=lineCol*(line*0.3+node*0.5)*fog*fabricGlow*0.3*stretch;
        }
    }
    // Well singularity glow
    for(int w=0;w<5;w++){
        if(float(w)>=wellCount)break;
        vec3 toWell=wells[w]-ro;
        float along=dot(toWell,rd);
        if(along>0.0){
            vec3 cl=ro+rd*along;
            float wd=length(cl-wells[w]);
            col+=wellColor.rgb*0.015/(wd*wd+0.03)*fabricGlow;
        }
    }
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
