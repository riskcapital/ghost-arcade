/*{
    "DESCRIPTION": "Kinetic sculpture - architectural structure with rotating rods",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "rodCount", "TYPE": "float", "DEFAULT": 12.0, "MIN": 4.0, "MAX": 20.0},
        {"NAME": "perspective", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }

float capsule(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(0.75, 0.75, 0.78); // Light gray background
    
    // Central ring structure
    float d = length(uv);
    float ring1 = abs(d - 0.15) - 0.005;
    float ring2 = abs(d - 0.18) - 0.003;
    col -= vec3(0.3) * smoothstep(0.005, 0.0, ring1);
    col -= vec3(0.2) * smoothstep(0.003, 0.0, ring2);
    
    // Rods extending from center
    for (float i = 0.0; i < 20.0; i++) {
        if (i >= rodCount) break;
        
        float angle = i * PI * 2.0 / rodCount + t * 0.2;
        float tilt = sin(t * 0.5 + i * 0.8) * 0.3;
        
        vec2 base = 0.15 * vec2(cos(angle), sin(angle));
        float rodLen = 0.15 + 0.05 * sin(t + i * 0.5);
        vec2 tip = base + rodLen * vec2(cos(angle + tilt), sin(angle + tilt));
        
        float rod = capsule(uv, base, tip, 0.003);
        
        // 3D-like shading
        float shade = 0.3 + 0.4 * dot(normalize(tip - base), normalize(vec2(0.5, 0.8)));
        col = mix(col, vec3(shade), smoothstep(0.002, 0.0, rod));
        
        // Sphere at tip
        float tipD = length(uv - tip) - 0.01;
        float sphereShade = 0.4 + 0.5 * smoothstep(0.015, 0.0, tipD);
        col = mix(col, vec3(sphereShade), smoothstep(0.002, 0.0, tipD));
    }
    
    // Cross-bracing curves
    for (float i = 0.0; i < 3.0; i++) {
        float angle = i * PI * 2.0 / 3.0 + t * 0.15;
        float r = 0.22 + 0.03 * sin(t + i);
        float curveD = abs(length(uv - 0.02 * vec2(cos(angle), sin(angle))) - r) - 0.003;
        col = mix(col, vec3(0.5), smoothstep(0.003, 0.0, curveD));
    }
    
    gl_FragColor = vec4(col, 1.0);
}
