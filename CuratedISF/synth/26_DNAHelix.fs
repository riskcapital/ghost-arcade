/*{
    "DESCRIPTION": "DNA helix molecular strand with connected nodes",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "helixTwist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "nodeSize", "TYPE": "float", "DEFAULT": 0.015, "MIN": 0.005, "MAX": 0.03}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float line(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 col = vec3(0.0);
    
    float helixR = 0.12;
    int nodeCount = 30;
    
    vec2 prevA, prevB;
    
    for (int i = 0; i < 30; i++) {
        float fi = float(i);
        float y = (fi / 30.0 - 0.5) * 1.0;
        float angle = fi * PI * 2.0 / (30.0 / helixTwist) + t;
        
        float x1 = cos(angle) * helixR;
        float x2 = cos(angle + PI) * helixR;
        
        // Z-depth for 3D feel
        float z1 = sin(angle);
        float z2 = sin(angle + PI);
        
        vec2 posA = vec2(x1, y);
        vec2 posB = vec2(x2, y);
        
        // Nodes
        float dA = length(uv - posA);
        float dB = length(uv - posB);
        
        float brightA = 0.5 + 0.5 * z1;
        float brightB = 0.5 + 0.5 * z2;
        
        col += vec3(0.3, 0.4, 0.8) * nodeSize / (dA + 0.003) * brightA;
        col += vec3(0.3, 0.4, 0.8) * nodeSize / (dB + 0.003) * brightB;
        
        // Cross-links (rungs)
        if (mod(fi, 3.0) < 1.0) {
            float ld = line(uv, posA, posB);
            float linkBright = min(brightA, brightB);
            col += vec3(0.2, 0.3, 0.6) * 0.001 / (ld + 0.003) * linkBright;
        }
        
        // Spine connections
        if (i > 0) {
            float ldA = line(uv, prevA, posA);
            float ldB = line(uv, prevB, posB);
            col += vec3(0.25, 0.35, 0.7) * 0.0005 / (ldA + 0.003) * brightA;
            col += vec3(0.25, 0.35, 0.7) * 0.0005 / (ldB + 0.003) * brightB;
        }
        
        prevA = posA;
        prevB = posB;
    }
    
    // Halftone dots pattern overlay
    vec2 grid = uv * 60.0;
    vec2 gv = fract(grid) - 0.5;
    float dot = length(gv);
    float pattern = smoothstep(0.15, 0.14, dot) * 0.03;
    
    gl_FragColor = vec4(col, 1.0);
}
