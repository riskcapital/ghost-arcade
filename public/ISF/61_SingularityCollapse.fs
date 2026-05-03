/*{
    "DESCRIPTION": "Singularity Collapse - imploding sphere with gravitational distortion and particle jets",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "collapsePhase", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "distortionPower", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "accretionColor", "TYPE": "color", "DEFAULT": [0.3, 0.5, 1.0, 1.0]},
        {"NAME": "jetColor", "TYPE": "color", "DEFAULT": [0.8, 0.4, 1.0, 1.0]},
        {"NAME": "ringCount", "TYPE": "float", "DEFAULT": 6.0, "MIN": 1.0, "MAX": 12.0},
        {"NAME": "jetIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "noiseDetail", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "eventHorizon", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.03, "MAX": 0.3},
        {"NAME": "cameraDistance", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.5, "MAX": 6.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}

float noise3d(vec3 p) {
    vec3 i=floor(p); vec3 f=fract(p);
    f=f*f*(3.0-2.0*f);
    float n = i.x + i.y*157.0 + 113.0*i.z;
    return mix(mix(mix(hash(i), hash(i+vec3(1.0,0.0,0.0)), f.x),
                   mix(hash(i+vec3(0.0,1.0,0.0)), hash(i+vec3(1.0,1.0,0.0)), f.x), f.y),
               mix(mix(hash(i+vec3(0.0,0.0,1.0)), hash(i+vec3(1.0,0.0,1.0)), f.x),
                   mix(hash(i+vec3(0.0,1.0,1.0)), hash(i+vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}

float fbm3d(vec3 p) {
    float v=0.0, a=0.5;
    for(int i=0; i<6; i++){
        if(float(i)>=noiseDetail) break;
        v+=a*noise3d(p); p*=2.0; a*=0.5;
    }
    return v;
}

float sdSphere(vec3 p, float r){return length(p)-r;}

float scene(vec3 p, float t) {
    float phase = collapsePhase + sin(t*0.5)*0.2;
    
    // Main collapsing sphere
    float sphereR = mix(0.8, eventHorizon, phase);
    float sphere = sdSphere(p, sphereR);
    
    // Distortion noise on surface
    float noiseDist = fbm3d(p * 4.0 + t * 0.3) * 0.15 * (1.0 - phase);
    sphere += noiseDist;
    
    // Accretion rings
    float rings = 1e10;
    for(float i=0.0; i<12.0; i++){
        if(i>=ringCount) break;
        float r = sphereR + 0.1 + i*0.08;
        float tilt = sin(i*1.3+t*0.2)*0.3;
        vec3 rp = p;
        rp.yz *= rot(tilt);
        float ringD = abs(length(rp.xz)-r) - 0.005;
        ringD = max(ringD, abs(rp.y) - 0.01 - 0.005*sin(atan(rp.z,rp.x)*8.0+t*2.0));
        rings = min(rings, ringD);
    }
    
    return min(sphere, rings);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Camera orbiting
    float camAngle = t * 0.3;
    vec3 ro = vec3(sin(camAngle)*cameraDistance, sin(t*0.2)*0.5, cos(camAngle)*cameraDistance);
    vec3 ta = vec3(0.0);
    vec3 ww = normalize(ta-ro);
    vec3 uu = normalize(cross(ww,vec3(0.0,1.0,0.0)));
    vec3 vv = cross(uu,ww);
    
    // Gravitational lensing on ray direction
    vec3 rd = normalize(uv.x*uu + uv.y*vv + 1.8*ww);
    float screenDist = length(uv);
    vec3 toCenter = normalize(-ro);
    float lensAngle = distortionPower * eventHorizon / (screenDist + 0.1);
    rd = normalize(rd + toCenter * lensAngle * 0.1);
    
    vec3 col = vec3(0.0);
    float td = 0.0;
    float glow = 0.0;
    float ringGlow = 0.0;
    
    for(int i=0; i<100; i++){
        vec3 p = ro + rd * td;
        float d = scene(p, t);
        
        // Accumulate glow
        float dist2center = length(p);
        glow += exp(-d*20.0) * exp(-dist2center*0.5) * 0.02;
        
        // Ring proximity glow
        float phase = collapsePhase + sin(t*0.5)*0.2;
        float sphereR = mix(0.8, eventHorizon, phase);
        for(float ri=0.0; ri<6.0; ri++){
            float r = sphereR + 0.1 + ri*0.08;
            float rDist = abs(length(p.xz)-r);
            ringGlow += exp(-rDist*30.0) * exp(-abs(p.y)*10.0) * 0.003;
        }
        
        if(d < 0.001){
            // Surface hit
            vec2 e = vec2(0.001,0.0);
            vec3 n = normalize(vec3(
                scene(p+e.xyy,t)-scene(p-e.xyy,t),
                scene(p+e.yxy,t)-scene(p-e.yxy,t),
                scene(p+e.yyx,t)-scene(p-e.yyx,t)
            ));
            
            vec3 lightDir = normalize(vec3(0.5,0.8,0.3));
            float diff = max(dot(n,lightDir),0.0);
            float spec = pow(max(dot(reflect(-lightDir,n),-rd),0.0),32.0);
            
            float isRing = step(length(p), eventHorizon + 0.5) * step(eventHorizon, length(p));
            vec3 matCol = mix(vec3(0.05), accretionColor.rgb, isRing);
            
            col = matCol * (diff*0.8 + 0.1) + vec3(spec*0.5);
            
            // Event horizon blackness
            if(length(p) < eventHorizon + 0.02){
                col *= smoothstep(eventHorizon, eventHorizon+0.05, length(p));
            }
            
            float fog = 1.0-exp(-td*0.1);
            col = mix(col, vec3(0.01,0.005,0.02), fog);
            break;
        }
        
        td += d * 0.8;
        if(td > 30.0) break;
    }
    
    // Accretion glow
    col += accretionColor.rgb * ringGlow * 2.0;
    col += mix(accretionColor.rgb, jetColor.rgb, 0.5) * glow * 1.5;
    
    // Polar jets
    float jetAxis = abs(uv.y) - abs(uv.x) * 0.3;
    float jet = smoothstep(0.0, 0.05, jetAxis) * exp(-abs(uv.x)*8.0);
    jet *= 0.5 + 0.5*sin(uv.y*20.0 - t*5.0);
    col += jetColor.rgb * jet * jetIntensity * smoothstep(0.1, 0.3, abs(uv.y));
    
    col = pow(col, vec3(0.9));
    gl_FragColor = vec4(col, 1.0);
}
