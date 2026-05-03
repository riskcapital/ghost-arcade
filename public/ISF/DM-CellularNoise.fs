/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Organic cellular noise pattern with animation",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Noise"],
    "INPUTS": [
        {"NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 10.0, "DEFAULT": 4.0, "LABEL": "Scale"},
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5, "LABEL": "Speed"},
        {"NAME": "edgeWidth", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1, "LABEL": "Edge Width"},
        {"NAME": "cellStyle", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0, "LABEL": "Style"},
        {"NAME": "cellColor", "TYPE": "color", "DEFAULT": [0.1, 0.1, 0.2, 1.0], "LABEL": "Cell Color"},
        {"NAME": "edgeColor", "TYPE": "color", "DEFAULT": [0.0, 1.0, 0.8, 1.0], "LABEL": "Edge Color"},
        {"NAME": "animate", "TYPE": "bool", "DEFAULT": true, "LABEL": "Animate"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

vec3 voronoi(vec2 x, float t) {
    vec2 n = floor(x);
    vec2 f = fract(x);

    float md = 8.0;
    float md2 = 8.0;
    vec2 mg;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);

            if (animate) {
                o = 0.5 + 0.5 * sin(t + 6.2831 * o);
            }

            vec2 r = g + o - f;
            float d = dot(r, r);

            if (d < md) {
                md2 = md;
                md = d;
                mg = g;
            } else if (d < md2) {
                md2 = d;
            }
        }
    }

    return vec3(md, md2, md2 - md);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;

    float t = TIME * speed;
    vec2 p = uv * scale;

    vec3 v = voronoi(p, t);

    vec3 col;
    if (cellStyle < 1.0) {
        // Standard cells with edges
        float edge = smoothstep(0.0, edgeWidth, v.z);
        col = mix(edgeColor.rgb, cellColor.rgb, edge);
    } else if (cellStyle < 2.0) {
        // Distance field style
        col = mix(edgeColor.rgb, cellColor.rgb, sqrt(v.x));
    } else {
        // Difference style
        col = mix(cellColor.rgb, edgeColor.rgb, v.z * 3.0);
    }

    gl_FragColor = vec4(col, 1.0);
}
