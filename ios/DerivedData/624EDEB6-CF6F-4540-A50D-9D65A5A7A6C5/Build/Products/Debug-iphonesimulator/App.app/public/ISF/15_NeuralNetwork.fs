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

// Get node position by index
vec2 getNodePos(float i, float t) {
    float h1 = hash(i * 1.7 + 0.3);
    float h2 = hash(i * 2.3 + 7.1);
    float h3 = hash(i * 3.1 + 1.3);
    return vec2(
        (h1 - 0.5) * 1.2 + sin(t * 0.2 * (h3 + 0.3) + i) * 0.08,
        (h2 - 0.5) * 0.8 + cos(t * 0.15 * (h3 + 0.3) + i * 1.3) * 0.06
    );
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.0);

    // Draw connections
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= nodes) break;
        vec2 posI = getNodePos(i, t);
        for (float j = 0.0; j < 30.0; j++) {
            if (j <= i) continue;
            if (j >= nodes) break;
            vec2 posJ = getNodePos(j, t);
            float dist = length(posI - posJ);
            if (dist < threshold) {
                float ld = line(uv, posI, posJ);
                float alpha = (1.0 - dist / threshold);
                float pulse = 0.5 + 0.5 * sin(t * 2.0 + (i + j) * 0.5);
                col += vec3(0.4, 0.5, 1.0) * 0.001 / (ld + 0.003) * alpha * pulse;
            }
        }
    }

    // Draw nodes
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= nodes) break;
        vec2 pos = getNodePos(i, t);
        float d = length(uv - pos);
        float pulse = 0.8 + 0.2 * sin(t * 3.0 + i * 1.5);
        col += vec3(0.6, 0.7, 1.0) * 0.003 / (d * d + 0.001) * pulse;
    }

    gl_FragColor = vec4(col, 1.0);
}
