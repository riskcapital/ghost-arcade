/*{
    "DESCRIPTION": "Planetary Rings - 3D planet with volumetric ring system and atmospheric scatter",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "planetRadius", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.3, "MAX": 1.0},
        {"NAME": "ringInner", "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.5, "MAX": 1.2},
        {"NAME": "ringOuter", "TYPE": "float", "DEFAULT": 1.6, "MIN": 1.0, "MAX": 2.5},
        {"NAME": "ringTilt", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "atmosphereColor", "TYPE": "color", "DEFAULT": [0.2, 0.35, 0.8, 1.0]},
        {"NAME": "ringColor", "TYPE": "color", "DEFAULT": [0.6, 0.55, 0.5, 1.0]},
        {"NAME": "ringBands", "TYPE": "float", "DEFAULT": 30.0, "MIN": 5.0, "MAX": 60.0},
        {"NAME": "atmosphereHeight", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 0.3},
        {"NAME": "cameraAngle", "TYPE": "float", "DEFAULT": 0.3, "MIN": -1.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(float n){return fract(sin(n)*43758.5453);}
float hash2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){
    vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<6;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}

float sphereIntersect(vec3 ro, vec3 rd, float r){
    float b=dot(ro,rd), c=dot(ro,ro)-r*r, h=b*b-c;
    if(h<0.0)return -1.0;
    return -b-sqrt(h);
}

float ringDensity(float r, float angle){
    if(r<ringInner||r>ringOuter)return 0.0;
    float norm = (r-ringInner)/(ringOuter-ringInner);
    // Band structure
    float bands = 0.5+0.5*sin(norm*ringBands*PI);
    bands *= 0.5+0.5*sin(norm*ringBands*3.7*PI+1.0);
    // Gap (Cassini division)
    float gap = smoothstep(0.45,0.48,norm)*smoothstep(0.55,0.52,norm);
    bands *= (1.0-gap*0.8);
    // Edge fade
    bands *= smoothstep(0.0,0.05,norm)*smoothstep(1.0,0.95,norm);
    return bands*0.8;
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 ro = vec3(0.0, cameraAngle*2.0, 3.5);
    vec3 rd = normalize(vec3(uv, -1.5));
    
    // Slow orbit
    float ca=cos(t*0.2), sa=sin(t*0.2);
    ro.xz = vec2(ro.x*ca+ro.z*sa, -ro.x*sa+ro.z*ca);
    rd.xz = vec2(rd.x*ca+rd.z*sa, -rd.x*sa+rd.z*ca);
    
    vec3 col = vec3(0.005, 0.005, 0.015); // deep space
    
    // Light direction (sun)
    vec3 sunDir = normalize(vec3(0.8, 0.3, -0.5));
    
    // Ring plane intersection (tilted)
    float ct=cos(ringTilt), st=sin(ringTilt);
    vec3 ringNormal = vec3(0.0, ct, st);
    float ringT = -dot(ro, ringNormal)/dot(rd, ringNormal);
    
    bool ringInFront = false;
    vec3 ringContrib = vec3(0.0);
    float ringDepth = 1e10;
    
    if(ringT > 0.0){
        vec3 rp = ro+rd*ringT;
        float rDist = length(rp);
        float rDens = ringDensity(rDist, atan(rp.z, rp.x));
        
        if(rDens > 0.01){
            // Shadow from planet on rings
            float shadow = 1.0;
            vec3 toSun = sunDir;
            float shadowT = sphereIntersect(rp, toSun, planetRadius);
            if(shadowT > 0.0) shadow = 0.15;
            
            float diff = max(dot(ringNormal, sunDir), 0.0)*0.5+0.5;
            // Backlit translucency
            float backlit = max(dot(-ringNormal, sunDir), 0.0)*0.3;
            
            ringContrib = ringColor.rgb * rDens * (diff*shadow + backlit);
            ringDepth = ringT;
            ringInFront = true;
        }
    }
    
    // Planet sphere
    float planetT = sphereIntersect(ro, rd, planetRadius);
    
    if(planetT > 0.0){
        vec3 p = ro+rd*planetT;
        vec3 n = normalize(p);
        
        float diff = max(dot(n, sunDir), 0.0);
        float terminator = smoothstep(-0.05, 0.1, diff);
        
        // Surface bands
        float lat = asin(n.y)/PI+0.5;
        float bands = fbm(vec2(lat*20.0, atan(n.z,n.x)*3.0+t*0.1));
        
        vec3 surfCol = mix(atmosphereColor.rgb*0.3, atmosphereColor.rgb*0.8, bands);
        surfCol *= terminator;
        
        // Ring shadow on planet
        vec3 shadowCheck = p + sunDir*0.01;
        float shadowRingT = -dot(shadowCheck, ringNormal)/dot(sunDir, ringNormal);
        if(shadowRingT > 0.0){
            vec3 srp = shadowCheck+sunDir*shadowRingT;
            float srd = length(srp);
            float shadowDens = ringDensity(srd, 0.0);
            surfCol *= 1.0-shadowDens*0.6;
        }
        
        // Atmosphere limb
        float limb = pow(1.0-abs(dot(n,-rd)), 3.0);
        surfCol += atmosphereColor.rgb * limb * atmosphereHeight * 5.0;
        
        if(planetT < ringDepth){
            col = surfCol;
            // Ring behind planet already occluded
        } else {
            col = ringContrib;
        }
    } else if(ringInFront){
        col = ringContrib;
    }
    
    // Atmosphere halo
    float atmosT = sphereIntersect(ro, rd, planetRadius+atmosphereHeight);
    if(atmosT > 0.0 && (planetT < 0.0)){
        float thickness = atmosphereHeight*2.0;
        float halo = exp(-length(ro+rd*atmosT)*0.5)*atmosphereHeight*3.0;
        col += atmosphereColor.rgb * halo;
    }
    
    // Background stars
    vec2 starUV = rd.xy*50.0+rd.z*17.0;
    float starH = hash2(floor(starUV));
    if(starH>0.97){
        float sd=length(fract(starUV)-0.5);
        col += vec3(0.5,0.5,0.7)*0.004/(sd+0.008)*(0.5+0.5*sin(t*2.0+starH*50.0));
    }
    
    col = pow(col, vec3(0.9));
    gl_FragColor = vec4(col, 1.0);
}
