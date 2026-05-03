/*{"DESCRIPTION":"Neural Lattice - 3D brain-like network with firing synapses","CREDIT":"Justin / Syntax Projects","ISFVSN":"2","CATEGORIES":["Generator"],"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.4,"MIN":0.0,"MAX":2.0},{"NAME":"nodeCount","TYPE":"float","DEFAULT":30.0,"MIN":10.0,"MAX":50.0},{"NAME":"connectionThreshold","TYPE":"float","DEFAULT":0.8,"MIN":0.3,"MAX":1.5},{"NAME":"nodeColor","TYPE":"color","DEFAULT":[0.4,0.6,1.0,1.0]},{"NAME":"fireColor","TYPE":"color","DEFAULT":[1.0,0.7,0.3,1.0]},{"NAME":"fireRate","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"nodeGlow","TYPE":"float","DEFAULT":1.0,"MIN":0.0,"MAX":3.0},{"NAME":"dendrites","TYPE":"float","DEFAULT":0.5,"MIN":0.0,"MAX":1.0},{"NAME":"cameraDistance","TYPE":"float","DEFAULT":3.0,"MIN":1.5,"MAX":5.0},{"NAME":"rotationSpeed","TYPE":"float","DEFAULT":0.2,"MIN":0.0,"MAX":1.0}]}*/
#ifdef GL_ES
precision highp float;
#endif
#define PI 3.14159265359
float hash(float n){return fract(sin(n)*43758.5453);}
float lineSeg2d(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h);}
void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t=TIME*speed;
    float ca=t*rotationSpeed;
    vec3 ro=vec3(sin(ca),sin(t*0.15)*0.5,cos(ca))*cameraDistance;
    vec3 ww=normalize(-ro),uu=normalize(cross(ww,vec3(0,1,0))),vv=cross(uu,ww);
    vec3 col=vec3(0.01,0.005,0.02);
    // Generate 3D node positions
    vec2 projNodes[50];
    float nodeDepths[50];
    for(int i=0;i<50;i++){
        if(float(i)>=nodeCount)break;
        float fi=float(i);
        vec3 np=vec3((hash(fi*1.7)-0.5)*2.0,(hash(fi*2.3+5.0)-0.5)*1.5,(hash(fi*3.1+9.0)-0.5)*2.0);
        np+=vec3(sin(t*0.2+fi),cos(t*0.15+fi*1.3),sin(t*0.1+fi*0.7))*0.1;
        vec3 toN=np-ro;
        float along=dot(toN,ww);
        projNodes[i]=vec2(dot(toN,uu),dot(toN,vv))/along*1.5;
        nodeDepths[i]=along;
    }
    // Draw connections
    for(int i=0;i<50;i++){
        if(float(i)>=nodeCount)break;
        for(int j=i+1;j<50;j++){
            if(float(j)>=nodeCount)break;
            float dist=length(projNodes[i]-projNodes[j]);
            float dist3d=abs(nodeDepths[i]-nodeDepths[j]);
            if(dist<connectionThreshold*0.3&&dist3d<connectionThreshold){
                float ld=lineSeg2d(uv,projNodes[i],projNodes[j]);
                float avgD=(nodeDepths[i]+nodeDepths[j])*0.5;
                float zB=1.0/(1.0+avgD*0.2);
                // Firing pulse
                float firePhase=fract(t*fireRate*0.3+hash(float(i*50+j))*5.0);
                float pulse=exp(-pow(firePhase-0.5,2.0)*50.0);
                vec3 lineCol=mix(nodeColor.rgb,fireColor.rgb,pulse);
                col+=lineCol*0.0003/(ld+0.002)*zB*(0.3+pulse*0.7);
                // Dendrite branching
                if(dendrites>0.0){
                    vec2 mid=(projNodes[i]+projNodes[j])*0.5;
                    vec2 perp=normalize(vec2(-(projNodes[j]-projNodes[i]).y,(projNodes[j]-projNodes[i]).x));
                    vec2 branch=mid+perp*0.03*sin(t+float(i));
                    float bd=lineSeg2d(uv,mid,branch);
                    col+=nodeColor.rgb*0.0001/(bd+0.003)*dendrites*zB;
                }
            }
        }
    }
    // Draw nodes
    for(int i=0;i<50;i++){
        if(float(i)>=nodeCount)break;
        float nd=length(uv-projNodes[i]);
        float zB=1.0/(1.0+nodeDepths[i]*0.2);
        float fire=0.5+0.5*sin(t*fireRate*3.0+float(i)*2.0);
        fire=pow(fire,4.0);
        vec3 nCol=mix(nodeColor.rgb,fireColor.rgb,fire);
        col+=nCol*nodeGlow*0.002/(nd*nd+0.0003)*zB;
    }
    col=pow(col,vec3(0.9));
    gl_FragColor=vec4(col,1.0);
}
