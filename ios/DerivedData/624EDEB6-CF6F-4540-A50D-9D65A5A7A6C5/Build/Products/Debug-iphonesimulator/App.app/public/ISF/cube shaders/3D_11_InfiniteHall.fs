/*{
    "DESCRIPTION": "Infinite repeating corridor stretching into the distance with columns, dramatic perspective, and warm/cool split lighting",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "hallWidth", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.8, "MAX": 5.0},
        {"NAME": "repeatDist", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 12.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Rotation matrix ---
mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// --- SDF primitives ---
float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

float sdCylinder(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xz) - r, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// --- Hallway scene ---
float map(vec3 p) {
    // Domain repetition along Z
    float hz = repeatDist;
    float cellZ = floor(p.z / hz + 0.5);
    vec3 q = p;
    q.z = mod(p.z + hz * 0.5, hz) - hz * 0.5;

    float hw = hallWidth;
    float hh = hw * 1.2; // hall height proportional to width

    // Outer box (solid)
    float outer = sdBox(q, vec3(hw + 0.3, hh + 0.3, hz * 0.5));
    // Inner box (hollow interior)
    float inner = sdBox(q, vec3(hw, hh, hz * 0.5 + 0.1));
    // Hallway = outer minus inner
    float hall = max(outer, -inner);

    // Floor detail: slight ribbing
    float floorRib = sdBox(q - vec3(0.0, -hh + 0.05, 0.0), vec3(hw + 0.1, 0.08, 0.15));
    hall = min(hall, floorRib);

    // Columns along the sides
    float colSpacing = hz * 0.5;
    vec3 cp = q;
    cp.z = mod(q.z + colSpacing * 0.5, colSpacing) - colSpacing * 0.5;

    // Left column
    vec3 lcP = cp - vec3(-hw + 0.2, 0.0, 0.0);
    float leftCol = sdCylinder(lcP, 0.15, hh);

    // Right column
    vec3 rcP = cp - vec3(hw - 0.2, 0.0, 0.0);
    float rightCol = sdCylinder(rcP, 0.15, hh);

    hall = min(hall, leftCol);
    hall = min(hall, rightCol);

    // Arches at the top connecting columns
    vec3 archP = cp;
    archP.y -= hh * 0.6;
    float archBox = sdBox(archP, vec3(hw, 0.12, 0.12));
    float archCut = length(archP.xz) - hw * 0.8;
    float arch = max(archBox, -archCut);
    hall = min(hall, arch);

    // Ceiling beam running along the center
    vec3 beamP = q;
    beamP.y -= hh - 0.1;
    float beam = sdBox(beamP, vec3(0.08, 0.08, hz * 0.5 + 0.1));
    hall = min(hall, beam);

    return hall;
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// --- Ambient occlusion ---
float calcAO(vec3 p, vec3 n) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.02 + 0.15 * fi;
        float d = map(p + n * h);
        ao += (h - d) * scale;
        scale *= 0.6;
    }
    return clamp(1.0 - 2.5 * ao, 0.0, 1.0);
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera inside the hallway, moving forward
    float camZ = t * 3.0;
    float sway = sin(t * 0.7) * 0.3;
    vec3 ro = vec3(sway, 0.0, camZ);
    vec3 target = vec3(sin(t * 0.3) * 0.5, sin(t * 0.5) * 0.2, camZ + 10.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark background
    vec3 bgColor = vec3(0.02, 0.02, 0.04);
    vec3 col = bgColor;

    // Beat-reactive light intensity
    float beatPulse = 1.0 + audioBeat * 0.8 * intensity;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 96; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 80.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        vec3 n = calcNormal(p);
        float ao = calcAO(p, n);

        // Surface color: warm stone with variation
        float cs = cos(colorShift);
        float ss = sin(colorShift);
        vec3 baseCol = vec3(0.6, 0.5, 0.4);
        // Add subtle variation based on position
        float patt = sin(p.x * 3.0) * sin(p.y * 3.0) * sin(p.z * 3.0);
        baseCol += 0.05 * vec3(patt);
        // Apply color shift
        float rr = baseCol.r * cs - baseCol.g * ss;
        float gg = baseCol.r * ss + baseCol.g * cs;
        baseCol.r = clamp(rr, 0.0, 1.0);
        baseCol.g = clamp(gg, 0.0, 1.0);

        // Warm light from ahead (in +Z direction)
        vec3 warmDir = normalize(vec3(0.0, 0.5, 1.0));
        float warmDiff = max(dot(n, warmDir), 0.0);
        vec3 warmCol = vec3(1.0, 0.85, 0.5) * warmDiff * beatPulse;

        // Cool light from behind
        vec3 coolDir = normalize(vec3(0.0, 0.3, -1.0));
        float coolDiff = max(dot(n, coolDir), 0.0);
        vec3 coolCol = vec3(0.3, 0.5, 1.0) * coolDiff * 0.4;

        // Ambient
        float ambient = 0.08;

        // Specular from warm light
        vec3 halfDir = normalize(warmDir - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 32.0) * 0.3 * beatPulse;

        col = baseCol * (ambient + (warmCol + coolCol) * ao) + vec3(spec);

        // Distance fog - dramatic perspective fade
        float fogDist = dist;
        float fog = 1.0 - exp(-0.003 * fogDist * fogDist);
        // Fog color blends warm/cool
        vec3 fogCol = mix(vec3(0.04, 0.03, 0.06), vec3(0.4, 0.25, 0.1) * beatPulse * 0.3, 0.3);
        col = mix(col, fogCol, fog);

        // Light glow at the far end
        float forwardDot = max(dot(rd, vec3(0.0, 0.0, 1.0)), 0.0);
        float glow = pow(forwardDot, 8.0) * 0.3 * beatPulse;
        vec3 glowCol = vec3(1.0, 0.8, 0.4);
        col += glowCol * glow * (1.0 - fog * 0.5);
    } else {
        // Far-end glow for rays that don't hit
        float forwardDot = max(dot(rd, vec3(0.0, 0.0, 1.0)), 0.0);
        float glow = pow(forwardDot, 4.0) * 0.5 * beatPulse;
        col = vec3(0.4, 0.25, 0.1) * glow;
    }

    // Audio-reactive vignette
    float vignette = 1.0 - 0.4 * length(uv) * (1.0 + audioBass * 0.3);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    // Slight gamma
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
