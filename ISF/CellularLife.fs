/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Organic cellular structures",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "cellScale", "TYPE": "float", "MIN": 2.0, "MAX": 15.0, "DEFAULT": 6.0},
        {"NAME": "morphSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "membraneWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.2, "DEFAULT": 0.08},
        {"NAME": "nucleusSize", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.2},
        {"NAME": "hueBase", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0);
float iTime = TIME;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime * morphSpeed;
    vec2 p = uv * cellScale;

    // Voronoi for cell structure
    vec2 n = floor(p);
    vec2 f = fract(p);

    float md = 8.0;
    float md2 = 8.0;
    vec2 cellId = vec2(0.0);

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);

            // Animate cell centers
            o = 0.5 + 0.4 * sin(t * 2.0 + 6.2831 * o);

            vec2 r = g + o - f;
            float d = dot(r, r);

            if (d < md) {
                md2 = md;
                md = d;
                cellId = n + g;
            } else if (d < md2) {
                md2 = d;
            }
        }
    }

    md = sqrt(md);
    md2 = sqrt(md2);

    // Cell membrane
    float membrane = md2 - md;
    float edge = smoothstep(membraneWidth, 0.0, membrane);

    // Nucleus
    float nucleus = smoothstep(nucleusSize, nucleusSize * 0.5, md);

    // Cell interior
    float interior = 1.0 - edge - nucleus;

    // Colors
    float cellHue = fract(dot(cellId, vec2(0.1, 0.13)) + hueBase);
    vec3 membraneCol = hsv2rgb(vec3(cellHue, 0.6, 0.9));
    vec3 interiorCol = hsv2rgb(vec3(cellHue + 0.05, 0.4, 0.3));
    vec3 nucleusCol = hsv2rgb(vec3(cellHue + 0.1, 0.7, 0.8));

    // Add organelles
    float organelles = sin(md * 30.0 + t) * sin(atan(f.y - 0.5, f.x - 0.5) * 5.0 + t);
    organelles = smoothstep(0.3, 0.5, organelles) * 0.3;

    vec3 col = membraneCol * edge;
    col += interiorCol * interior * (1.0 + organelles);
    col += nucleusCol * nucleus;

    // Subtle pulsing
    col *= 0.9 + 0.1 * sin(t * 3.0 + dot(cellId, vec2(1.0)));

    fragColor = vec4(col, 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
