/*{
    "DESCRIPTION": "Signal propagation - interference ripples from multiple emitters",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "emitterCount", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 7.0},
        {"NAME": "wavelength", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.01, "MAX": 0.15},
        {"NAME": "decay", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 6.0},
        {"NAME": "emitterSpread", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "lineThickness", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "colorMode", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Mono/Color"},
        {"NAME": "emitterGlow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "interference", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0, "LABEL": "Interference Vis"},
        {"NAME": "rotation", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    uv *= rot(rotation);
    float t = TIME * speed;
    
    float totalWave = 0.0;
    float totalAmp = 0.0;
    vec3 col = vec3(0.0);
    
    for (float i = 0.0; i < 7.0; i++) {
        if (i >= emitterCount) break;
        
        // Emitter positions in circular arrangement
        float a = i * PI * 2.0 / emitterCount + t * 0.1;
        vec2 emitter = emitterSpread * vec2(cos(a), sin(a));
        
        float d = length(uv - emitter);
        
        // Expanding wave fronts
        float wave = sin((d - t * 0.1) * PI * 2.0 / wavelength);
        float amplitude = exp(-d * decay);
        
        totalWave += wave * amplitude;
        totalAmp += amplitude;
        
        // Emitter point glow
        col += mix(vec3(0.5, 0.6, 1.0), vec3(0.4 + hash(i) * 0.6, 0.5, 0.9), colorMode) 
               * emitterGlow * 0.005 / (d * d + 0.002);
        
        // Wave rings visualization
        float ringPhase = fract((d - t * 0.1) / wavelength);
        float ring = exp(-pow((ringPhase - 0.5) * 2.0 / lineThickness, 2.0));
        ring *= amplitude * 0.3;
        col += vec3(0.2, 0.3, 0.6) * ring;
    }
    
    // Interference pattern
    float interferenceVal = totalWave / max(emitterCount, 1.0);
    
    // Constructive interference highlights
    float constructive = pow(max(interferenceVal, 0.0), 2.0) * interference;
    float destructive = pow(max(-interferenceVal, 0.0), 2.0) * interference * 0.3;
    
    vec3 intCol;
    if (colorMode < 0.5) {
        intCol = vec3(0.5, 0.6, 0.9) * constructive - vec3(0.05, 0.05, 0.1) * destructive;
    } else {
        intCol = mix(vec3(0.2, 0.3, 0.8), vec3(0.8, 0.5, 1.0), constructive) * constructive;
        intCol -= vec3(0.1, 0.05, 0.0) * destructive;
    }
    col += intCol;
    
    // Nodal lines (zero amplitude) subtle highlight
    float nodal = 1.0 - smoothstep(0.0, 0.05, abs(interferenceVal));
    col += vec3(0.1, 0.1, 0.15) * nodal * interference * 0.3;
    
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
