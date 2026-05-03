/*{
    "DESCRIPTION": "Cosmic node network with orbital rings and particles",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "nodeCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 15.0},
        {"NAME": "connectionDist", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 0.8}
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
    float col = 0.0;
    
    // Generate node positions
    vec2 nodes[15];
    for (int i = 0; i < 15; i++) {
        if (float(i) >= nodeCount) break;
        float fi = float(i);
        float a = fi * 2.399 + t * (0.1 + 0.05 * hash(fi));
        float r = 0.15 + 0.2 * hash(fi * 7.3);
        nodes[i] = vec2(cos(a), sin(a)) * r;
        
        // Orbital ring around each node
        float nd = length(uv - nodes[i]);
        float ring = abs(nd - 0.03 - 0.01 * sin(t + fi));
        col += 0.0005 / (ring + 0.001);
        
        // Node glow
        col += 0.003 / (nd * nd + 0.001);
    }
    
    // Connect nearby nodes
    for (int i = 0; i < 15; i++) {
        if (float(i) >= nodeCount) break;
        for (int j = i + 1; j < 15; j++) {
            if (float(j) >= nodeCount) break;
            float dist = length(nodes[i] - nodes[j]);
            if (dist < connectionDist) {
                float ld = line(uv, nodes[i], nodes[j]);
                float alpha = 1.0 - dist / connectionDist;
                col += 0.0003 / (ld + 0.002) * alpha;
            }
        }
    }
    
    // Background stars
    vec2 starUV = uv * 30.0;
    vec2 starId = floor(starUV);
    float star = hash(dot(starId, vec2(127.1, 311.7)));
    if (star > 0.97) {
        float sd = length(fract(starUV) - 0.5);
        col += 0.005 / (sd + 0.01) * 0.1;
    }
    
    vec3 color = vec3(0.6, 0.65, 0.9) * col;
    color += vec3(0.3, 0.2, 0.5) * col * 0.5;
    
    gl_FragColor = vec4(color, 1.0);
}
