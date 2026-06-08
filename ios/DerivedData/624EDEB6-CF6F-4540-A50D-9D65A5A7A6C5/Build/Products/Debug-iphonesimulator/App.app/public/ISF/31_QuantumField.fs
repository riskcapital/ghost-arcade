/*{
    "DESCRIPTION": "Quantum field - particles with probability clouds and orbital shells",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "shellCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "probabilitySpread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "quantumNoise", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "shellOpacity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "electronCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 1.0, "MAX": 16.0},
        {"NAME": "colorTemp", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Cool/Warm"},
        {"NAME": "nucleusGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "uncertainty", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Position Uncertainty"},
        {"NAME": "zoom", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1,0)), f.x),
               mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y / zoom;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Probability cloud background
    float cloud = fbm(uv * 4.0 + t * 0.1) * quantumNoise;
    float cloud2 = fbm(uv * 8.0 - t * 0.07) * quantumNoise * 0.5;
    vec3 cloudCol = mix(vec3(0.1, 0.15, 0.3), vec3(0.2, 0.1, 0.25), colorTemp);
    col += cloudCol * (cloud + cloud2) * exp(-d * 3.0) * probabilitySpread;
    
    // Orbital shells with variable thickness
    for (float i = 1.0; i <= 8.0; i++) {
        if (i > shellCount) break;
        float r = i * 0.07 * probabilitySpread + 0.03;
        
        // Shell wobble from quantum noise
        float wobble = noise(vec2(angle * 3.0, t + i * 5.0)) * uncertainty * 0.02;
        float shellDist = abs(d - r - wobble);
        
        // Shell with probability density falloff
        float shell = exp(-shellDist * shellDist * 800.0) * shellOpacity;
        
        // Dashed shell segments
        float dash = smoothstep(0.0, 0.1, sin(angle * (4.0 + i * 2.0) + t * 0.3 * i));
        shell *= 0.4 + 0.6 * dash;
        
        vec3 shellCol = mix(vec3(0.4, 0.5, 0.9), vec3(0.7, 0.5, 0.8), i / shellCount * colorTemp);
        col += shellCol * shell;
    }
    
    // Electrons with uncertainty halos
    for (float i = 0.0; i < 16.0; i++) {
        if (i >= electronCount) break;
        
        float shellIdx = mod(i, shellCount) + 1.0;
        float orbitR = shellIdx * 0.07 * probabilitySpread + 0.03;
        float orbitSpeed = (1.5 - shellIdx * 0.1) * t;
        float phase = i * PI * 2.0 / max(electronCount / shellCount, 1.0) + hash(i) * PI * 2.0;
        
        // Position with quantum uncertainty
        float uncertaintyOffset = noise(vec2(t * 3.0 + i * 7.0, i)) * uncertainty * 0.03;
        vec2 ePos = (orbitR + uncertaintyOffset) * vec2(cos(orbitSpeed + phase), sin(orbitSpeed + phase));
        
        float ed = length(uv - ePos);
        
        // Electron glow
        col += mix(vec3(0.5, 0.6, 1.0), vec3(0.9, 0.7, 1.0), colorTemp) * 0.004 / (ed * ed + 0.0003);
        
        // Uncertainty halo
        float halo = exp(-ed * ed / (uncertainty * 0.003 + 0.0005)) * uncertainty * 0.3;
        col += vec3(0.3, 0.4, 0.7) * halo;
    }
    
    // Nucleus with pulsing glow
    float nucleusPulse = 1.0 + 0.15 * sin(t * 3.0);
    col += mix(vec3(0.6, 0.7, 1.0), vec3(1.0, 0.8, 0.9), colorTemp) * nucleusGlow * 0.015 / (d * d + 0.003) * nucleusPulse;
    
    // Inner nucleus structure
    for (float i = 0.0; i < 4.0; i++) {
        float a = i * PI / 2.0 + t * 0.8;
        vec2 np = 0.012 * vec2(cos(a), sin(a));
        float nd = length(uv - np);
        col += vec3(0.8, 0.8, 1.0) * nucleusGlow * 0.003 / (nd * nd + 0.0003);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
