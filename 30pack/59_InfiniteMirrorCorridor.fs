/*{
    "DESCRIPTION": "Infinite Mirror Corridor - raymarched reflective tunnel with neon edge lighting",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "corridorWidth", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.5, "MAX": 3.0},
        {"NAME": "corridorHeight", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "neonColor1", "TYPE": "color", "DEFAULT": [0.2, 0.4, 1.0, 1.0]},
        {"NAME": "neonColor2", "TYPE": "color", "DEFAULT": [0.8, 0.2, 0.9, 1.0]},
        {"NAME": "fogDensity", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.0, "MAX": 0.15},
        {"NAME": "pulseRate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "cameraRoll", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "mirrorReflections", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "edgeGlow", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 4.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

float box(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float scene(vec3 p) {
    // Infinite corridor via repetition
    float rep = 4.0;
    float id = floor(p.z / rep);
    p.z = mod(p.z, rep) - rep*0.5;
    
    // Box interior (inverted)
    float corridor = -box(p, vec3(corridorWidth, corridorHeight, rep*0.5));
    
    // Cross beams
    float beam = box(p - vec3(0.0, corridorHeight - 0.05, 0.0), vec3(corridorWidth, 0.03, 0.03));
    float beam2 = box(p - vec3(corridorWidth - 0.05, 0.0, 0.0), vec3(0.03, corridorHeight, 0.03));
    float beam3 = box(p - vec3(-corridorWidth + 0.05, 0.0, 0.0), vec3(0.03, corridorHeight, 0.03));
    
    float d = corridor;
    d = max(d, -beam);
    d = max(d, -beam2);
    d = max(d, -beam3);
    
    return d;
}

vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        scene(p+e.xyy)-scene(p-e.xyy),
        scene(p+e.yxy)-scene(p-e.yxy),
        scene(p+e.yyx)-scene(p-e.yyx)
    ));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Camera with roll
    uv *= rot(sin(t*0.3) * cameraRoll);
    
    vec3 ro = vec3(sin(t*0.2)*0.3, cos(t*0.15)*0.2, t*3.0);
    vec3 rd = normalize(vec3(uv, 1.5));
    
    // Apply look direction wobble
    rd.xy *= rot(sin(t*0.25)*0.1);
    rd.xz *= rot(cos(t*0.2)*0.08);
    
    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * totalDist;
        float d = scene(p);
        
        if (d < 0.001) {
            vec3 n = getNormal(p);
            
            // Neon edge lighting from repeating strips
            float rep = 4.0;
            float localZ = mod(p.z, rep) - rep*0.5;
            float edgeDist = min(
                min(abs(abs(p.x) - corridorWidth), abs(abs(p.y) - corridorHeight)),
                abs(localZ)
            );
            
            float pulse = 0.5 + 0.5*sin(p.z*0.5 - t*pulseRate*3.0);
            float pulse2 = 0.5 + 0.5*sin(p.z*0.3 + t*pulseRate*2.0 + PI);
            
            float neonStrip = exp(-edgeDist*edgeDist*200.0) * edgeGlow;
            
            vec3 neon = mix(neonColor1.rgb, neonColor2.rgb, pulse) * neonStrip;
            neon += neonColor1.rgb * pulse2 * 0.1;
            
            // Reflective floor/walls
            float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0) * mirrorReflections;
            vec3 reflCol = mix(neonColor1.rgb, neonColor2.rgb, 0.5) * fresnel * 0.3;
            
            // Distance-based fog color
            float fog = 1.0 - exp(-totalDist * fogDensity);
            vec3 fogCol = mix(neonColor1.rgb, neonColor2.rgb, 0.5) * 0.15;
            
            col = neon + reflCol + vec3(0.01);
            col = mix(col, fogCol, fog);
            break;
        }
        
        totalDist += d;
        if (totalDist > 60.0) break;
    }
    
    // Volumetric fog glow
    float fogAccum = 0.0;
    for (int i = 0; i < 20; i++) {
        float ft = float(i) * 3.0;
        vec3 fp = ro + rd * ft;
        float pulse = 0.5 + 0.5*sin(fp.z*0.5 - t*pulseRate*3.0);
        fogAccum += pulse * exp(-ft * fogDensity * 2.0) * 0.02;
    }
    col += mix(neonColor1.rgb, neonColor2.rgb, 0.5) * fogAccum;
    
    // Gamma
    col = pow(col, vec3(0.85));
    
    gl_FragColor = vec4(col, 1.0);
}
