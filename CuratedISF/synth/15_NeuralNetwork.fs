/*{
    "DESCRIPTION": "Neural network connected nodes graph with glowing edges",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "nodes", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 30.0},
        {"NAME": "threshold", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.8}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(float n) { return fract(sin(n) * 43758.5453); }

float line(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);
    
    // Store positions
    vec2 positions[30];
    for (int i = 0; i < 30; i++) {
        if (float(i) >= nodes) break;
        float fi = float(i);
        float h1 = hash(fi * 1.7 + 0.3);
        float h2 = hash(fi * 2.3 + 7.1);
        float h3 = hash(fi * 3.1 + 1.3);
        
        positions[i] = vec2(
            (h1 - 0.5) * 1.2 + sin(t * 0.2 * (h3 + 0.3) + fi) * 0.08,
            (h2 - 0.5) * 0.8 + cos(t * 0.15 * (h3 + 0.3) + fi * 1.3) * 0.06
        );
    }
    
    // Draw connections
    for (int i = 0; i < 30; i++) {
        if (float(i) >= nodes) break;
        for (int j = i + 1; j < 30; j++) {
            if (float(j) >= nodes) break;
            float dist = length(positions[i] - positions[j]);
            if (dist < threshold) {
                float ld = line(uv, positions[i], positions[j]);
                float alpha = (1.0 - dist / threshold);
                float pulse = 0.5 + 0.5 * sin(t * 2.0 + float(i + j) * 0.5);
                col += vec3(0.4, 0.5, 1.0) * 0.001 / (ld + 0.003) * alpha * pulse;
            }
        }
    }
    
    // Draw nodes
    for (int i = 0; i < 30; i++) {
        if (float(i) >= nodes) break;
        float d = length(uv - positions[i]);
        float pulse = 0.8 + 0.2 * sin(t * 3.0 + float(i) * 1.5);
        col += vec3(0.6, 0.7, 1.0) * 0.003 / (d * d + 0.001) * pulse;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
