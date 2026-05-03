/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Animated network of connected nodes with glowing lines",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Abstract"],
    "INPUTS": [
        {"NAME": "nodeCount", "TYPE": "float", "MIN": 5.0, "MAX": 30.0, "DEFAULT": 15.0, "LABEL": "Node Count"},
        {"NAME": "connectionDist", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25, "LABEL": "Connect Distance"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "nodeSize", "TYPE": "float", "MIN": 0.005, "MAX": 0.03, "DEFAULT": 0.015, "LABEL": "Node Size"},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.01, "DEFAULT": 0.003, "LABEL": "Line Width"},
        {"NAME": "hue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "Color Hue"},
        {"NAME": "pulseAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "Pulse"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(float n) { return fract(sin(n) * 43758.5453123); }
vec2 hash2(float n) { return vec2(hash(n), hash(n + 57.3)); }

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 getNodePos(float i, float t) {
    vec2 base = hash2(i * 127.1);
    float speed1 = hash(i * 31.7) * 0.5 + 0.5;
    float speed2 = hash(i * 47.3) * 0.5 + 0.5;
    return vec2(
        base.x + sin(t * speed1 + i) * 0.15,
        base.y + cos(t * speed2 + i * 1.3) * 0.15
    );
}

float lineDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;
    vec3 col = vec3(0.0);

    vec3 nodeColor = hsv2rgb(vec3(hue, 0.8, 1.0));
    vec3 lineColor = hsv2rgb(vec3(hue + 0.1, 0.6, 0.8));

    // Draw connections first
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= nodeCount) break;
        vec2 p1 = getNodePos(i, t);
        p1.x *= RENDERSIZE.x / RENDERSIZE.y;

        for (float j = 0.0; j < 30.0; j++) {
            if (j <= i) continue;
            if (j >= nodeCount) break;
            vec2 p2 = getNodePos(j, t);
            p2.x *= RENDERSIZE.x / RENDERSIZE.y;

            float dist = length(p2 - p1);
            if (dist < connectionDist) {
                float lineFade = 1.0 - dist / connectionDist;
                float d = lineDist(uv, p1, p2);
                float line = smoothstep(lineWidth, 0.0, d) * lineFade;

                float pulse = mix(1.0, 0.7 + 0.3 * sin(t * 3.0 + i + j), pulseAmount);
                line *= pulse;

                col += line * lineColor * 0.5;
            }
        }
    }

    // Draw nodes on top
    for (float i = 0.0; i < 30.0; i++) {
        if (i >= nodeCount) break;
        vec2 np = getNodePos(i, t);
        np.x *= RENDERSIZE.x / RENDERSIZE.y;

        float d = length(uv - np);
        float node = smoothstep(nodeSize, nodeSize * 0.3, d);
        float glow = smoothstep(nodeSize * 3.0, nodeSize, d) * 0.5;

        col += (node + glow) * nodeColor;
    }

    gl_FragColor = vec4(col, 1.0);
}
