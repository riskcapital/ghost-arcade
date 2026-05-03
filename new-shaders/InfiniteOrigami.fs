/*{
    "DESCRIPTION": "Infinite paper-folding fractal where iterative polar subdivision creates origami crease patterns. Each fold reveals a new voronoi-patterned surface layer with different material properties. The polar-to-cartesian fract() trick becomes literal paper folds revealing hidden geometry beneath.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Fractal"],
    "INPUTS": [
        { "NAME": "foldLayers", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 7.0, "LABEL": "Fold Layers" },
        { "NAME": "creaseSharpness", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Crease Sharpness" },
        { "NAME": "unfoldAmount", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Unfold Amount" },
        { "NAME": "paperColor", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0, "LABEL": "Paper Hue" },
        { "NAME": "inkPattern", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Ink Pattern" },
        { "NAME": "lightAngle", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 3.14, "LABEL": "Light Angle" },
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.25, "MIN": 0.0, "MAX": 1.0, "LABEL": "Speed" },
        { "NAME": "foldScale", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Fold Scale" },
        { "NAME": "metallicInk", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Metallic Ink" },
        { "NAME": "shadowDepth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Shadow Depth" },
        { "NAME": "rotateX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Tilt X" },
        { "NAME": "rotateY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Tilt Y" }
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

vec3 voronoi(vec2 uv) {
    vec2 ip = floor(uv), fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = hash2(ip + nb) * 0.8 + 0.1;
        float dist = length(nb + pt - fp);
        if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
        else if (dist < d2) { d2 = dist; }
    }
    return vec3(d1, d2, id);
}

// The core origami fold: reinterpretation of the polar subdivision algorithm
// Original does: length->atan->fract->length->atan->fract creating infinite detail
// We interpret each iteration as a physical paper fold
vec4 origamiFold(vec2 uv, float t) {
    float totalCrease = 0.0;
    float layerDepth = 0.0;
    float cellId = 0.0;
    float foldAngle = 0.0;

    vec3 p = vec3(uv, 1.0 - layerDepth);

    // 3D view tilt
    p.zx *= rot2(rotateX + 0.3);

    float vol = 0.1;
    float l, k = t * 0.5;
    int maxFolds = int(foldLayers);

    for (int j = 0; j < 7; j++) {
        if (j >= maxFolds) break;
        float fj = float(j);

        // Scale accumulation (the v*=l from the original)
        l = length(p.xy);
        vol *= l;

        // The fold transformation (reinterpreted from the polar subdivision)
        // Original: vec3(l*5-k, atan/PI, p.z/l + l*3)
        float foldOpenness = mix(1.0, 0.3, unfoldAmount);
        p = vec3(
            l * foldScale - k,
            atan(p.y, p.x) / 3.14159 * foldOpenness,
            p.z / max(l, 0.001) + l * 3.0
        );

        // The crease: fract creates fold lines (this is where paper bends)
        vec2 folded = fract(p.yx + p.x) - 0.5;

        // Crease detection before applying fold
        float creaseDist = min(abs(folded.x), abs(folded.y));
        totalCrease += exp(-creaseDist * 30.0 * creaseSharpness) / (1.0 + fj);

        // Track fold angle for shadow calculation
        foldAngle += atan(folded.y, folded.x);

        p.xy = folded;
        layerDepth += 0.15;
    }

    float finalDist = length(p) * vol;
    return vec4(totalCrease, finalDist, foldAngle, layerDepth);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * speed;

    // View rotation
    uv *= rot2(rotateY);

    vec4 fold = origamiFold(uv * 2.0, t);
    float crease = fold.x;
    float dist = fold.y;
    float angle = fold.z;
    float depth = fold.w;

    // Voronoi ink pattern on the paper surface
    vec3 vor = voronoi(uv * 8.0 + t * 0.1);
    float inkEdge = vor.y - vor.x;
    float inkId = vor.z;

    // Paper base color - varies by fold depth
    float paperHue = fract(paperColor + depth * 0.08);
    float paperSat = 0.15 + 0.1 * depth;
    vec3 paper = hsv2rgb(vec3(paperHue, paperSat, 0.85 - depth * 0.1));

    // Lighting based on fold angle (simulates 3D paper surface normals)
    vec3 lightDir = vec3(cos(lightAngle), sin(lightAngle), 0.5);
    float foldNormalAngle = angle * 0.3;
    vec3 foldNormal = normalize(vec3(cos(foldNormalAngle), sin(foldNormalAngle), 1.0));
    float diffuse = max(dot(foldNormal, lightDir), 0.0);
    float specular = pow(max(dot(reflect(-lightDir, foldNormal), vec3(0, 0, 1)), 0.0), 16.0);

    // Shadows in fold valleys
    float shadow = 1.0 - crease * shadowDepth * 0.5;
    shadow *= 0.6 + 0.4 * diffuse;

    vec3 col = paper * shadow;

    // Crease lines (mountain and valley folds)
    vec3 creaseCol = hsv2rgb(vec3(fract(paperHue + 0.5), 0.3, 0.3));
    col = mix(col, creaseCol, clamp(crease * creaseSharpness, 0.0, 0.8));

    // Ink pattern - voronoi as decorative print on paper
    float inkStrength = inkPattern * (1.0 - crease * 0.5);
    float inkMask = smoothstep(0.1, 0.0, inkEdge) * inkStrength;

    vec3 inkCol = hsv2rgb(vec3(fract(paperHue + inkId * 0.4 + 0.3), 0.7, 0.2));
    // Cell fill with pattern
    float cellPattern = smoothstep(0.3, 0.35, vor.x) * inkStrength * 0.5;
    vec3 fillCol = hsv2rgb(vec3(fract(paperHue + inkId * 0.3), 0.4 + metallicInk * 0.3, 0.6));

    col = mix(col, inkCol, inkMask);
    col = mix(col, fillCol, cellPattern * (1.0 - crease * 0.3));

    // Metallic ink specular
    if (metallicInk > 0.01) {
        float metalSpec = specular * metallicInk * cellPattern * 2.0;
        col += vec3(1.0, 0.95, 0.8) * metalSpec;
    }

    // Raymarched density from original algorithm for volumetric paper texture
    float densityGlow = exp(-max(dist, 0.0) * 2000.0) * 0.02;
    float densityHue = fract(paperHue + depth * 0.2);
    col += hsv2rgb(vec3(densityHue, 1.0, densityGlow));

    // Ambient occlusion in deep folds
    float ao = 1.0 - depth * 0.15 * shadowDepth;
    col *= max(ao, 0.3);

    // Paper edge darkening (burnt edge effect at high crease)
    float burnt = smoothstep(0.6, 0.9, crease) * 0.3;
    col = mix(col, vec3(0.15, 0.08, 0.03), burnt);

    // Tone map
    col = col / (1.0 + col * 0.3);
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
