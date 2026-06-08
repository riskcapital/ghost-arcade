/*{
    "DESCRIPTION": "Smooth animated morph between cube and sphere with metallic surface, color transitions, ground reflection, and beat-triggered morphing",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "morphSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "surfaceRoughness", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// --- SDF primitives ---
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

float sdPlane(vec3 p, float h) {
    return p.y - h;
}

// --- Scene ---
float morphAmount;

float map(vec3 p) {
    // The morphing shape
    float cubeSize = 1.0;
    float sphereR = 1.2;

    float dCube = sdBox(p, vec3(cubeSize));
    float dSphere = sdSphere(p, sphereR);

    // Smooth blend between cube and sphere
    float shape = mix(dCube, dSphere, morphAmount);

    // Ground plane for reflection
    float ground = sdPlane(p, -1.8);

    return min(shape, ground);
}

// Separate shape-only map (no ground) for reflection
float mapShape(vec3 p) {
    float cubeSize = 1.0;
    float sphereR = 1.2;
    float dCube = sdBox(p, vec3(cubeSize));
    float dSphere = sdSphere(p, sphereR);
    return mix(dCube, dSphere, morphAmount);
}

// --- Normal ---
vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
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
        float h = 0.01 + 0.15 * fi;
        float d = map(p + n * h);
        ao += (h - d) * scale;
        scale *= 0.55;
    }
    return clamp(1.0 - 3.0 * ao, 0.0, 1.0);
}

// --- Soft shadow ---
float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 32; i++) {
        if (t > maxt) break;
        float h = mapShape(ro + rd * t);
        res = min(res, k * h / t);
        if (h < 0.001) return 0.0;
        t += clamp(h, 0.02, 0.2);
    }
    return clamp(res, 0.0, 1.0);
}

// --- HSV to RGB ---
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// --- Environment map approximation ---
vec3 envMap(vec3 rd) {
    float y = rd.y * 0.5 + 0.5;
    vec3 sky = mix(vec3(0.15, 0.1, 0.2), vec3(0.05, 0.05, 0.15), y);
    // Horizon glow
    float horizon = exp(-abs(rd.y) * 5.0) * 0.3;
    sky += vec3(0.3, 0.2, 0.4) * horizon;
    return sky;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    float t = TIME * speed;

    // Morph amount: smooth oscillation + beat trigger
    float baseOsc = sin(t * morphSpeed) * 0.5 + 0.5; // 0 to 1
    // Beat creates a quick snap toward sphere
    float beatSnap = audioBeat * 0.4;
    morphAmount = clamp(baseOsc + beatSnap, 0.0, 1.0);
    // Smooth the morph for visual appeal
    morphAmount = smoothstep(0.0, 1.0, morphAmount);

    // Camera orbits
    float camAngle = t * 0.4;
    float camH = 1.5 + sin(t * 0.25) * 0.5;
    vec3 ro = vec3(
        cos(camAngle) * camDist,
        camH,
        sin(camAngle) * camDist
    );
    vec3 target = vec3(0.0, 0.0, 0.0);

    // Camera matrix
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    // Background
    vec3 bgColor = envMap(rd);
    vec3 col = bgColor;

    // Lighting setup
    vec3 lightDir = normalize(vec3(2.0, 4.0, 3.0));
    vec3 lightCol = vec3(1.0, 0.95, 0.85) * intensity;

    // Ray march
    float dist = 0.0;
    bool hit = false;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * dist;
        float d = map(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (dist > 30.0) break;
        dist += d;
    }

    if (hit) {
        vec3 p = ro + rd * dist;
        vec3 n = calcNormal(p);
        float ao = calcAO(p, n);

        bool isGround = p.y < -1.7;

        if (isGround) {
            // Ground plane: dark reflective surface
            vec3 groundCol = vec3(0.05, 0.05, 0.07);

            // Checkerboard pattern (subtle)
            float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
            groundCol += vec3(0.02) * checker;

            // Diffuse
            float diff = max(dot(n, lightDir), 0.0);
            float shadow = softShadow(p + n * 0.01, lightDir, 0.02, 10.0, 16.0);

            col = groundCol * (0.1 + diff * shadow * 0.5) * ao;

            // Reflection of the shape
            vec3 reflDir = reflect(rd, n);
            float reflDist = 0.0;
            bool reflHit = false;
            for (int i = 0; i < 48; i++) {
                vec3 rp = p + reflDir * reflDist;
                float rd2 = mapShape(rp);
                if (rd2 < 0.002) {
                    reflHit = true;
                    break;
                }
                if (reflDist > 15.0) break;
                reflDist += rd2;
            }

            if (reflHit) {
                vec3 reflP = p + reflDir * reflDist;
                // Simple coloring of reflection
                float reflMorph = morphAmount;
                float hue = colorShift / 6.28 + reflMorph * 0.3;
                vec3 reflCol = hsv2rgb(vec3(hue, 0.4, 0.8));

                vec3 reflN = calcNormal(reflP);
                float reflDiff = max(dot(reflN, lightDir), 0.0);
                reflCol *= (0.2 + reflDiff * 0.8);

                // Fresnel-based reflection amount
                float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
                float reflAmount = 0.3 + fresnel * 0.5;

                // Distance fade
                float fade = exp(-reflDist * 0.15);
                col += reflCol * reflAmount * fade * intensity * 0.5;
            }
        } else {
            // The morphing shape: metallic surface
            float hue = colorShift / 6.28 + morphAmount * 0.3 + 0.5;
            float sat = 0.3 + morphAmount * 0.3;
            vec3 baseCol = hsv2rgb(vec3(hue, sat, 0.85));

            // Cube state: more angular coloring
            // Sphere state: smoother coloring
            float angularity = 1.0 - morphAmount;
            vec3 absN = abs(n);
            float faceMask = max(absN.x, max(absN.y, absN.z));
            float faceColor = mix(1.0, faceMask, angularity * 0.5);
            baseCol *= faceColor;

            // Metallic lighting
            float diff = max(dot(n, lightDir), 0.0);
            float shadow = softShadow(p + n * 0.02, lightDir, 0.02, 10.0, 16.0);

            // Specular: sharper for smooth surface, broader for rough
            float specPow = mix(128.0, 16.0, surfaceRoughness);
            vec3 refl = reflect(rd, n);
            float spec = pow(max(dot(refl, lightDir), 0.0), specPow);
            float specStrength = mix(2.0, 0.5, surfaceRoughness);

            // Fresnel
            float NdotV = max(dot(n, -rd), 0.0);
            float fresnel = pow(1.0 - NdotV, 4.0);

            // Fill light
            vec3 fillDir = normalize(vec3(-1.0, 0.5, -2.0));
            float fillDiff = max(dot(n, fillDir), 0.0) * 0.2;

            // Environment reflection
            vec3 envCol = envMap(refl);
            float envAmount = mix(0.1, 0.6, fresnel) * (1.0 - surfaceRoughness * 0.5);

            float lighting = 0.08 + (diff * shadow + fillDiff) * ao;
            col = baseCol * lightCol * lighting * intensity;
            col += vec3(spec * specStrength) * lightCol * shadow * intensity;
            col += envCol * envAmount * intensity;

            // Rim light
            float rim = pow(1.0 - NdotV, 3.0) * 0.3;
            vec3 rimCol = hsv2rgb(vec3(hue + 0.15, 0.6, 1.0));
            col += rimCol * rim * intensity;
        }

        // Fog
        float fog = 1.0 - exp(-0.005 * dist * dist);
        col = mix(col, bgColor, fog);
    }

    // Audio beat subtle flash
    col += vec3(0.05, 0.04, 0.06) * audioBeat * intensity * 0.3;

    // Vignette
    float vignette = 1.0 - 0.35 * length(uv);
    col *= vignette;

    col = clamp(col, 0.0, 1.0);
    // Slight tone mapping
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
