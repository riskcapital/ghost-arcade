/*{
    "DESCRIPTION": "Twisted torus knot with metallic iridescent surface, orbiting camera, and beat-reactive twist animation",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "tubeRadius", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "twistAmount", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.5, "MAX": 8.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Rotation ---
mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// --- SDF Torus ---
float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

// --- Torus knot SDF ---
// Approximate torus knot by twisting space before evaluating torus
float map(vec3 p, float t) {
    // Beat-reactive twist
    float beatTwist = twistAmount + audioBeat * 1.5 * intensity;

    // Torus knot parameters: p,q winding numbers
    // We use a (2,3) torus knot twist approach
    float torusR = 1.5; // major radius

    // Get angle around the torus
    float angle = atan(p.z, p.x);

    // Twist the cross-section as we go around
    vec3 q = p;
    q.xz = rot2(0.0) * q.xz; // identity, just for consistency

    // Transform to torus-relative coords
    float r = length(p.xz);
    vec3 tp = vec3(r - torusR, p.y, 0.0);

    // Apply the knot twist: rotate the cross-section based on angle
    float twistAngle = angle * beatTwist + t * 2.0;
    tp.xy = rot2(twistAngle) * tp.xy;

    // The tube
    float d = length(tp.xy) - tubeRadius;

    // Second winding: create interlocking loops
    // Offset angle for a second tube pass
    float angle2 = angle + 3.14159;
    float r2 = length(p.xz);
    vec3 tp2 = vec3(r2 - torusR, p.y, 0.0);
    float twistAngle2 = angle2 * beatTwist + t * 2.0 + 3.14159;
    tp2.xy = rot2(twistAngle2) * tp2.xy;
    float d2 = length(tp2.xy) - tubeRadius;

    // Third winding for (3,2) knot appearance
    float angle3 = angle + 3.14159 * 2.0 / 3.0;
    vec3 tp3 = vec3(r - torusR, p.y, 0.0);
    float twistAngle3 = angle3 * beatTwist + t * 2.0 + 3.14159 * 0.666;
    tp3.xy = rot2(twistAngle3) * tp3.xy;
    float d3 = length(tp3.xy) - tubeRadius;

    d = min(d, min(d2, d3));

    return d;
}

// --- Normal ---
vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy, t) - map(p - e.xyy, t),
        map(p + e.yxy, t) - map(p - e.yxy, t),
        map(p + e.yyx, t) - map(p - e.yyx, t)
    ));
}

// --- Ambient occlusion ---
float calcAO(vec3 p, vec3 n, float t) {
    float ao = 0.0;
    float scale = 1.0;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float h = 0.01 + 0.12 * fi;
        float d = map(p + n * h, t);
        ao += (h - d) * scale;
        scale *= 0.6;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
}

// --- Iridescent color based on angle ---
vec3 iridescence(float cosTheta, float shift) {
    // Thin-film interference approximation
    float x = cosTheta;
    vec3 col;
    col.r = 0.5 + 0.5 * cos(6.28318 * (x * 1.0 + 0.0 + shift));
    col.g = 0.5 + 0.5 * cos(6.28318 * (x * 1.0 + 0.33 + shift));
    col.b = 0.5 + 0.5 * cos(6.28318 * (x * 1.0 + 0.67 + shift));
    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Camera orbits
    float camAngle = t * 0.5;
    float camH = sin(t * 0.3) * 1.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH + 0.5,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Dark gradient background
    vec3 bgColor = mix(vec3(0.02, 0.02, 0.05), vec3(0.05, 0.03, 0.08), uv.y + 0.5);
    vec3 col = bgColor;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p, t);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 20.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        vec3 n = calcNormal(p, t);
        float ao = calcAO(p, n, t);

        // View-dependent iridescence
        float NdotV = max(dot(n, -rd), 0.0);
        float fresnel = pow(1.0 - NdotV, 4.0);

        // Rainbow iridescent color
        float iriAngle = atan(p.z, p.x) / 6.28318 + t * 0.1;
        vec3 iriCol = iridescence(NdotV + iriAngle, colorShift / 6.28);

        // Metallic base
        vec3 metalBase = vec3(0.8, 0.8, 0.85);

        // Lighting
        vec3 lightDir1 = normalize(vec3(2.0, 3.0, 2.0));
        vec3 lightDir2 = normalize(vec3(-2.0, 1.0, -1.0));

        float diff1 = max(dot(n, lightDir1), 0.0);
        float diff2 = max(dot(n, lightDir2), 0.0) * 0.3;

        // Strong specular for metallic look
        vec3 refl = reflect(rd, n);
        float spec1 = pow(max(dot(refl, lightDir1), 0.0), 64.0) * 1.5;
        float spec2 = pow(max(dot(refl, lightDir2), 0.0), 32.0) * 0.5;

        // Environment reflection approximation
        vec3 envCol = mix(vec3(0.1, 0.1, 0.2), vec3(0.4, 0.5, 0.7), refl.y * 0.5 + 0.5);

        // Combine: metallic + iridescent
        vec3 surfCol = mix(metalBase, iriCol, 0.6 + fresnel * 0.4);
        float lighting = 0.1 + (diff1 + diff2) * ao;

        col = surfCol * lighting * intensity;
        col += vec3(spec1 + spec2) * iriCol * intensity;
        col += envCol * fresnel * 0.4 * intensity;

        // Fog
        float fog = 1.0 - exp(-0.01 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Subtle audio-reactive rim around the knot
    float rimGlow = exp(-length(uv) * length(uv) * 3.0) * audioBeat * 0.15;
    col += vec3(0.3, 0.2, 0.5) * rimGlow * intensity;

    // Vignette
    float vignette = 1.0 - 0.35 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    // Tone mapping
    col = col / (col + 0.5) * 1.3;

    gl_FragColor = vec4(col, 1.0);
}
