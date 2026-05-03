/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Morphing lava flow with voronoi-based cells",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "flowSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 2.0, "DEFAULT": 0.3},
        {"NAME": "cellScale", "TYPE": "float", "MIN": 2.0, "MAX": 15.0, "DEFAULT": 6.0},
        {"NAME": "heatIntensity", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7},
        {"NAME": "morphAmount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "colorTemp", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Voronoi with smooth morphing
vec3 voronoi(vec2 p, float t) {
    vec2 n = floor(p);
    vec2 f = fract(p);

    float md = 8.0;
    vec2 mg, mr;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);

            // Animate cell centers
            o = 0.5 + 0.5 * sin(t * 0.5 + 6.2831 * o);

            vec2 r = g + o - f;
            float d = dot(r, r);

            if (d < md) {
                md = d;
                mr = r;
                mg = g;
            }
        }
    }

    // Edge detection
    md = 8.0;
    for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
            vec2 g = mg + vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            o = 0.5 + 0.5 * sin(t * 0.5 + 6.2831 * o);

            vec2 r = g + o - f;
            if (dot(mr - r, mr - r) > 0.00001)
                md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
        }
    }

    return vec3(md, mr);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * flowSpeed;

    // Apply flow distortion
    vec2 flow = uv;
    flow.y += sin(uv.x * 3.0 + t) * 0.1 * morphAmount;
    flow.x += cos(uv.y * 2.0 + t * 0.7) * 0.1 * morphAmount;

    // Get voronoi cells
    vec3 c = voronoi(flow * cellScale, t);

    // Cell distance for coloring
    float cellDist = c.x;

    // Heat based on cell edges (edges are hotter)
    float heat = 1.0 - smoothstep(0.0, 0.15, cellDist);
    heat = pow(heat, 1.5) * heatIntensity;

    // Interior glow
    float interior = smoothstep(0.15, 0.0, cellDist);

    // Pulsing
    float pulse = sin(t * 3.0 + length(c.yz) * 10.0) * 0.5 + 0.5;

    // Color gradient: black -> red -> orange -> yellow -> white
    vec3 col;
    float temp = heat + interior * 0.3 + pulse * 0.2;
    temp = clamp(temp, 0.0, 1.0);

    // Adjust color temperature
    float hueShift = (colorTemp - 0.5) * 0.1;

    if (temp < 0.33) {
        col = mix(vec3(0.1, 0.0, 0.0), vec3(0.8, 0.1 + hueShift, 0.0), temp * 3.0);
    } else if (temp < 0.66) {
        col = mix(vec3(0.8, 0.1 + hueShift, 0.0), vec3(1.0, 0.5 + hueShift, 0.0), (temp - 0.33) * 3.0);
    } else {
        col = mix(vec3(1.0, 0.5 + hueShift, 0.0), vec3(1.0, 1.0, 0.8), (temp - 0.66) * 3.0);
    }

    // Add dark cracks
    float crack = smoothstep(0.02, 0.0, cellDist);
    col = mix(col, vec3(0.05, 0.0, 0.0), crack * 0.8);

    // Emissive glow
    col += vec3(1.0, 0.3, 0.0) * heat * 0.5;

    gl_FragColor = vec4(col, 1.0);
}
