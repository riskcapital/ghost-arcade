/*{
    "DESCRIPTION": "Logarithmic spiral voronoi tunnel with wireframe edge rendering. Voronoi cell interiors fade to near-black while edges glow with prismatic dispersion, creating a crystalline tunnel effect.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Tunnel"],
    "INPUTS": [
        { "NAME": "tunnelSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Tunnel Speed" },
        { "NAME": "spiralTwist", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5, "LABEL": "Spiral Twist" },
        { "NAME": "fogDensity", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0, "LABEL": "Fog Density" },
        { "NAME": "cellCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 12.0, "LABEL": "Cell Count" },
        { "NAME": "palette", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Color Palette" },
        { "NAME": "wireGlow", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.3, "MAX": 3.0, "LABEL": "Wire Glow" },
        { "NAME": "rotateView", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14159, "MAX": 3.14159, "LABEL": "View Rotation" },
        { "NAME": "edgeWidth", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.02, "MAX": 0.2, "LABEL": "Edge Width" },
        { "NAME": "prismSpread", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Prismatic Spread" },
        { "NAME": "cellDim", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 0.3, "LABEL": "Cell Brightness" },
        { "NAME": "dustAmount", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0, "LABEL": "Cosmic Dust" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 rgb = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(rgb - 1.0, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(43.71, 17.33))) * 4378.5453);
}

vec3 voronoi(vec2 uv) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 nb = vec2(float(i), float(j));
            vec2 pt = hash2(ip + nb);
            pt = 0.5 + 0.5 * sin(TIME * tunnelSpeed * 0.7 + 6.2831 * pt);
            vec2 diff = nb + pt - fp;
            float dist = length(diff);
            if (dist < d1) {
                d2 = d1; d1 = dist;
                id = hash1(ip + nb);
            } else if (dist < d2) {
                d2 = dist;
            }
        }
    }
    return vec3(d1, d2, id);
}

float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip);
    float b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1));
    float d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    // View rotation
    float ca = cos(rotateView + TIME * tunnelSpeed * 0.1);
    float sa = sin(rotateView + TIME * tunnelSpeed * 0.1);
    uv = mat2(ca, -sa, sa, ca) * uv;

    // Log-polar tunnel transform
    float radius = max(length(uv), 0.001);
    float angle = atan(uv.y, uv.x);
    float logR = log2(radius);
    float depth = -logR + TIME * tunnelSpeed;
    float twistedAngle = angle + depth * spiralTwist;

    // Voronoi in tunnel space
    vec2 tunnelUV = vec2(twistedAngle * cellCount / 6.2831, depth * cellCount * 0.5);
    vec3 vor = voronoi(tunnelUV);

    float edge = vor.y - vor.x;
    float depthShade = exp(-abs(logR) * 0.3);

    // ── WIREFRAME EDGE RENDERING ──

    // Edge detection: sharp wire at voronoi boundaries
    float wire = smoothstep(edgeWidth, edgeWidth * 0.2, edge);

    // Secondary grid lines within cells (fold-plane style)
    float gridX = abs(fract(tunnelUV.x * 2.0) - 0.5);
    float gridY = abs(fract(tunnelUV.y * 2.0) - 0.5);
    float gridEdge = smoothstep(edgeWidth * 0.6, 0.0, min(gridX, gridY));
    wire = max(wire, gridEdge * 0.3);

    // Per-cell hue
    float hue = fract(vor.z * 0.7 + palette + depth * 0.02);

    // Prismatic RGB dispersion on edges
    vec3 prismatic;
    prismatic.r = hsv2rgb(vec3(fract(hue - prismSpread * 0.12), 0.6, 1.0)).r;
    prismatic.g = hsv2rgb(vec3(hue, 0.6, 1.0)).g;
    prismatic.b = hsv2rgb(vec3(fract(hue + prismSpread * 0.12), 0.6, 1.0)).b;

    // Dim cell interior, bright wireframe edges
    float cellVal = cellDim * depthShade;
    vec3 cellCol = hsv2rgb(vec3(hue, 0.5, cellVal));
    vec3 wireCol = prismatic * wireGlow * depthShade;

    vec3 col = mix(cellCol, wireCol, wire);

    // Fresnel-like edge brightening near tunnel center
    float centerFresnel = exp(-radius * radius * 6.0) * 0.3;
    col += prismatic * centerFresnel * wire;

    // Edge bloom / glow halo
    float edgeBloom = exp(-edge * 12.0) * wireGlow * 0.4 * depthShade;
    col += hsv2rgb(vec3(fract(hue + 0.15), 0.4, edgeBloom));

    // Volumetric fog (subtle, doesn't overwhelm wireframe)
    float fog = noise(vec2(twistedAngle * 2.0, depth * 1.5) + TIME * 0.1);
    fog *= exp(-abs(logR) * 0.5) * fogDensity * 0.3;
    vec3 fogCol = hsv2rgb(vec3(fract(palette + 0.5), 0.2, 0.4));
    col = mix(col, fogCol, clamp(fog, 0.0, 0.5));

    // Cosmic dust sparkles
    if (dustAmount > 0.01) {
        float dust = 0.0;
        for (float i = 0.0; i < 3.0; i += 1.0) {
            vec2 dp = tunnelUV * (2.0 + i) + vec2(TIME * 0.05 * (i + 1.0), 0.0);
            float n = noise(dp * 8.0);
            dust += smoothstep(0.75, 0.8, n) * exp(-abs(logR) * 0.4);
        }
        col += dust * dustAmount * vec3(0.8, 0.9, 1.0);
    }

    // Vignette
    float vig = 1.0 - dot(uv * 0.8, uv * 0.8);
    col *= clamp(vig, 0.0, 1.0);

    // Tone map
    col = 1.0 - exp(-col * 1.8);

    gl_FragColor = vec4(col, 1.0);
}
