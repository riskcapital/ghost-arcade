/*{
    "DESCRIPTION": "Reflective chrome and gold metallic spheres orbiting in space with environment reflections",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 12.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "reflectivity", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "sphereCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 3.0, "MAX": 7.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- Environment / sky ---
vec3 envMap(vec3 rd, float shift) {
    // Gradient sky with subtle color bands
    float t = 0.5 + 0.5 * rd.y;
    vec3 sky1 = vec3(0.02, 0.02, 0.06);  // dark bottom
    vec3 sky2 = vec3(0.08, 0.06, 0.15);  // mid
    vec3 sky3 = vec3(0.15, 0.12, 0.25);  // upper
    vec3 sky = mix(sky1, sky2, smoothstep(0.0, 0.4, t));
    sky = mix(sky, sky3, smoothstep(0.4, 1.0, t));

    // Fake sun highlight
    float sun = pow(max(dot(rd, normalize(vec3(1.0, 0.8, 0.5))), 0.0), 64.0);
    sky += vec3(1.0, 0.9, 0.7) * sun * 0.8;

    // Horizontal band shimmer
    float band = sin(rd.x * 10.0 + rd.z * 8.0 + shift) * 0.5 + 0.5;
    sky += vec3(0.05, 0.04, 0.08) * band * smoothstep(0.3, 0.5, abs(rd.y));

    return sky;
}

// --- Sphere positions (7 max, animated) ---
vec3 spherePos(int idx, float t) {
    float fi = float(idx);
    float angle = fi * 1.256 + t * (0.3 + fi * 0.07);
    float r = 1.5 + 0.5 * sin(fi * 2.1 + t * 0.2);
    float h = sin(fi * 1.7 + t * 0.35) * 1.2;

    // Audio pulse on position
    float pulse = 1.0 + audioBeat * 0.15;
    r *= pulse;

    return vec3(cos(angle) * r, h, sin(angle) * r);
}

float sphereRadius(int idx) {
    float fi = float(idx);
    return 0.5 + 0.3 * sin(fi * 3.7 + 1.0);
}

// --- Is sphere silver or gold? ---
float sphereMetal(int idx) {
    float fi = float(idx);
    // Alternate: 0.0 = silver, 1.0 = gold
    return step(0.5, fract(fi * 0.618 + 0.1));
}

// --- Scene SDF ---
int gHitSphere;

float map(vec3 p, float t) {
    float d = 1e10;
    int count = int(floor(sphereCount));
    gHitSphere = 0;

    for (int i = 0; i < 7; i++) {
        if (i >= count) break;
        vec3 sp = spherePos(i, t);
        float r = sphereRadius(i);
        // Audio-reactive radius
        float beatR = r * (1.0 + audioBass * 0.1);
        float sd = length(p - sp) - beatR;
        if (sd < d) {
            d = sd;
            gHitSphere = i;
        }
    }

    // Ground plane (subtle, far below)
    float ground = p.y + 3.0;
    if (ground < d) {
        d = ground;
        gHitSphere = -1;
    }

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

// --- Soft shadow ---
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k, float t) {
    float res = 1.0;
    float dist = mint;
    for (int i = 0; i < 32; i++) {
        float d = map(ro + rd * dist, t);
        if (d < 0.001) return 0.0;
        res = min(res, k * d / dist);
        dist += clamp(d, 0.02, 0.5);
        if (dist > maxt) break;
    }
    return clamp(res, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Orbiting camera
    float camAngle = t * 0.3;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        1.5 + sin(t * 0.15) * 0.8,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Background
    vec3 bg = envMap(rd, colorShift);
    vec3 col = bg;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p, t);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 40.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        map(p, t); // re-evaluate for gHitSphere
        int hitId = gHitSphere;
        vec3 n = calcNormal(p, t);

        vec3 lightDir = normalize(vec3(2.0, 4.0, 1.5));
        float diff = max(dot(n, lightDir), 0.0);

        // Shadow
        float shadow = softShadow(p + n * 0.01, lightDir, 0.02, 20.0, 8.0, t);

        if (hitId >= 0) {
            // Sphere: chrome/metallic
            float metalType = sphereMetal(hitId);

            // Base metal color: silver vs gold
            vec3 metalCol;
            if (metalType < 0.5) {
                metalCol = vec3(0.85, 0.87, 0.9); // silver
            } else {
                metalCol = vec3(0.95, 0.78, 0.35); // gold
            }

            // Apply colorShift as subtle hue rotation
            float cs = cos(colorShift * 0.3);
            float ss = sin(colorShift * 0.3);
            float mr = metalCol.r * cs - metalCol.b * ss;
            float mb = metalCol.r * ss + metalCol.b * cs;
            metalCol.r = clamp(mr, 0.0, 1.0);
            metalCol.b = clamp(mb, 0.0, 1.0);

            // Reflection
            vec3 refl = reflect(rd, n);
            vec3 envCol = envMap(refl, colorShift);

            // Fresnel
            float fresnel = pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
            fresnel = mix(0.04, 1.0, fresnel);
            float reflAmt = mix(0.3, 1.0, reflectivity);
            fresnel *= reflAmt;

            // Specular highlight
            vec3 halfDir = normalize(lightDir - rd);
            float spec = pow(max(dot(n, halfDir), 0.0), 128.0);

            // Combine
            vec3 diffCol = metalCol * (0.15 + diff * 0.6 * shadow);
            col = mix(diffCol, envCol * metalCol, fresnel);
            col += vec3(1.0, 0.95, 0.9) * spec * 2.0 * shadow;

            // Audio glow at silhouette
            float rim = 1.0 - max(dot(-rd, n), 0.0);
            col += metalCol * pow(rim, 4.0) * audioMid * 0.3;

        } else {
            // Ground plane
            float checker = step(0.5, fract(p.x * 0.3)) + step(0.5, fract(p.z * 0.3));
            checker = mod(checker, 2.0);
            vec3 groundCol = mix(vec3(0.04, 0.04, 0.06), vec3(0.06, 0.06, 0.1), checker);
            col = groundCol * (0.3 + diff * 0.5 * shadow);

            // Reflection on ground
            vec3 refl = reflect(rd, n);
            vec3 envCol = envMap(refl, colorShift);
            float fresnel = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
            col = mix(col, envCol * 0.3, fresnel * reflectivity * 0.5);
        }

        // Distance fog
        float fog = 1.0 - exp(-0.006 * dist * dist);
        col = mix(col, bg, fog);
    }

    col *= intensity;

    // Vignette
    float vig = 1.0 - 0.35 * length(uv);
    col *= vig;

    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
