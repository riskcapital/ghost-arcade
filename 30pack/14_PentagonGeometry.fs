/*{
    "DESCRIPTION": "Pentagon sacred geometry with connected vertices",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "layers", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "glow", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
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
    float col = 0.0;
    
    for (float layer = 0.0; layer < 6.0; layer++) {
        if (layer >= layers) break;
        
        float r = 0.1 + layer * 0.08;
        float rotOffset = t * 0.2 * (1.0 + layer * 0.3) + layer * 0.3;
        
        // Pentagon vertices
        vec2 verts[5];
        for (int i = 0; i < 5; i++) {
            float a = float(i) * PI * 2.0 / 5.0 + rotOffset;
            verts[i] = r * vec2(cos(a), sin(a));
        }
        
        // Draw edges
        for (int i = 0; i < 5; i++) {
            int j = int(mod(float(i) + 1.0, 5.0));
            float d = line(uv, verts[i], verts[j]);
            col += 0.001 / (d + 0.002) * 0.5;
        }
        
        // Draw diagonals (pentagram)
        for (int i = 0; i < 5; i++) {
            int j = int(mod(float(i) + 2.0, 5.0));
            float d = line(uv, verts[i], verts[j]);
            col += 0.0005 / (d + 0.002) * 0.3;
        }
        
        // Vertex dots
        for (int i = 0; i < 5; i++) {
            float d = length(uv - verts[i]);
            col += 0.002 / (d * d + 0.0005);
        }
    }
    
    col *= glow;
    gl_FragColor = vec4(vec3(col), 1.0);
}
