/*{
    "DESCRIPTION": "Living plasma calligraphy: iterative rotation and domain tiling reinterpreted as sentient ink strokes that write themselves across the void. Each rotation layer is a brush stroke with voronoi-textured ink that flows, pools, and evaporates. The dot-product accumulation becomes ink density building up at intersection points.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "2D", "Artistic"],
    "INPUTS": [
        { "NAME": "brushLayers", "TYPE": "float", "DEFAULT": 30.0, "MIN": 5.0, "MAX": 50.0, "LABEL": "Brush Strokes" },
        { "NAME": "inkViscosity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ink Viscosity" },
        { "NAME": "strokeWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0, "LABEL": "Stroke Width" },
        { "NAME": "writingSpeed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.5, "LABEL": "Writing Speed" },
        { "NAME": "inkColor", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ink Color" },
        { "NAME": "plasmaEnergy", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.5, "LABEL": "Plasma Energy" },
        { "NAME": "poolingGlow", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 2.0, "LABEL": "Pooling Glow" },
        { "NAME": "evaporation", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Evaporation" },
        { "NAME": "paperTexture", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Paper Texture" },
        { "NAME": "trailFade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Trail Persistence" },
        { "NAME": "rotationBias", "TYPE": "float", "DEFAULT": 5.0, "MIN": 0.0, "MAX": 12.0, "LABEL": "Rotation Pattern" },
        { "NAME": "symmetry", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Radial Symmetry" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip), b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1)), d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * writingSpeed;

    // Paper background with texture
    float paperNoise = noise(uv * 30.0) * 0.15 + noise(uv * 60.0) * 0.08;
    float paperBase = 0.92 - paperTexture * paperNoise;
    vec3 paper = vec3(paperBase, paperBase * 0.98, paperBase * 0.95);

    // Optional radial symmetry
    vec2 origUV = uv;
    if (symmetry > 0.01) {
        float angle = atan(uv.y, uv.x);
        float r = length(uv);
        float symSectors = mix(1.0, 6.0, symmetry);
        angle = mod(angle, 6.2831 / symSectors) - 3.14159 / symSectors;
        uv = vec2(cos(angle), sin(angle)) * r;
    }

    // === CALLIGRAPHY ENGINE ===
    // Reinterpretation of the iterative rotation + domain rep algorithm:
    // Original: p*=m (rotate), q=p*S+..., a+=dot(cos(q)/S), n+=sin(q), N+=q/(S+60)
    // We interpret each iteration as a brush stroke with ink pooling

    vec2 p = uv;
    vec2 n = vec2(0.0);
    vec2 N = vec2(0.0);
    float inkDensity = 0.0;
    float plasmaField = 0.0;
    float S = 5.0;
    mat2 brushRot = rot2(rotationBias);
    float maxLayers = brushLayers;

    for (float j = 0.0; j < 50.0; j++) {
        if (j >= maxLayers) break;

        // Rotate brush direction (from p*=m in original)
        p *= brushRot;
        n *= brushRot;

        // Stroke path computation (from q=p*S+j+n+t*4+sin(t*4)*.8)
        vec2 q = p * S + j + n + t * 4.0 + sin(t * 4.0 + j * 0.5) * 0.8;

        // Ink density accumulation (from a+=dot(cos(q)/S))
        float strokeDensity = (cos(q.x) + cos(q.y)) / S;
        inkDensity += strokeDensity;

        // Ink flow vectors (from n+=sin(q))
        vec2 flow = sin(q);
        n += flow;

        // Pooling accumulation (from N+=q/(S+60))
        N += flow / (S + 60.0);

        // Scale progression
        S *= 1.2;
    }

    // === INK RENDERING ===

    // Base ink from accumulated density
    float ink = 0.1 - inkDensity * 0.1;

    // Ink darkness (viscous ink is more opaque)
    float inkOpacity = clamp(ink * (1.0 + inkViscosity), 0.0, 1.0);

    // Pooling glow where ink accumulates (bright plasma spots)
    float poolDist = length(N);
    float pool = min(0.7, 0.001 / max(poolDist, 0.0001)) * poolingGlow;

    // Stroke width modulation
    float strokeMask = smoothstep(strokeWidth * 0.5, 0.0, abs(ink - 0.5) - 0.3);

    // === PLASMA RENDERING ===
    // The ink is made of plasma - it glows at edges and pools

    // Plasma glow along stroke edges
    float edgeGlow = exp(-abs(ink) * 10.0 * (1.0 - plasmaEnergy * 0.5));

    // Evaporation: strokes dissolve at thin points
    float evapMask = smoothstep(0.0, evaporation, abs(inkDensity * 0.1));

    // Color
    vec3 inkCol;
    if (inkColor < 0.01) {
        // Sumi-e black ink mode
        inkCol = vec3(0.05, 0.04, 0.06);
    } else {
        inkCol = hsv2rgb(vec3(inkColor, 0.7, 0.3));
    }

    // Plasma emission color (the living energy within the ink)
    vec3 plasmaCol = hsv2rgb(vec3(fract(inkColor + 0.3), 0.6, 1.0));
    vec3 poolCol = hsv2rgb(vec3(fract(inkColor + 0.15), 0.4, 1.0));

    // Red channel boost from original (o.r*=5)
    float redBoost = max(inkOpacity * 5.0, 0.0);

    // Composite
    vec3 col = paper;

    // Ink layer
    float inkMask = clamp(inkOpacity * (1.0 - evapMask * 0.5), 0.0, 0.9);
    col = mix(col, inkCol, inkMask);

    // Plasma edge glow
    col += plasmaCol * edgeGlow * plasmaEnergy * 0.3 * (1.0 - evapMask * 0.7);

    // Pooling bright spots
    col += poolCol * pool;

    // Red energy bias (nod to original)
    col.r += edgeGlow * plasmaEnergy * 0.15;

    // Trail persistence: ink density visualization
    float trail = dot(abs(n), vec2(1.0)) * 0.002 * trailFade;
    col += hsv2rgb(vec3(fract(inkColor + 0.5), 0.3, trail));

    // Vignette (from original: o-=o*dot(p,p)*.7)
    float vig = dot(origUV, origUV) * 0.7;
    col -= col * vig;

    // Ink saturation at thick pools
    float saturation = noise(origUV * 20.0 + t) * paperTexture * 0.05;
    col -= vec3(saturation) * inkMask;

    col = clamp(col, 0.0, 1.0);
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
