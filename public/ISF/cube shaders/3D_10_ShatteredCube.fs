/*{
    "DESCRIPTION": "A cube shattered into fragments that spread outward with breathing animation and dramatic lighting",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "shatter", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "fragmentCount", "TYPE": "float", "DEFAULT": 6.0, "MIN": 3.0, "MAX": 12.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Rotation matrices
mat3 rotX(float a) {
    float c = cos(a); float s = sin(a);
    return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}
mat3 rotY(float a) {
    float c = cos(a); float s = sin(a);
    return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}
mat3 rotZ(float a) {
    float c = cos(a); float s = sin(a);
    return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
}

// Box SDF
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Hash for pseudo-random per fragment
float hash1(float n) {
    return fract(sin(n) * 43758.5453);
}

vec3 hash3(float n) {
    return vec3(
        fract(sin(n) * 43758.5453),
        fract(sin(n + 1.0) * 27183.8147),
        fract(sin(n + 2.0) * 31415.9265)
    );
}

// Scene map
float mapScene(vec3 p, float t, float beat, out float fragId) {
    float d = 1e10;
    fragId = 0.0;

    // Breathing animation + beat pulse
    float breathe = sin(t * 0.6) * 0.5 + 0.5; // 0 to 1
    float spread = shatter * (breathe + beat * 0.8);

    int count = int(fragmentCount);

    // Fragment generation: faces split into shards
    // 6 main face fragments + extra sub-fragments
    for (int i = 0; i < 12; i++) {
        if (i >= count) break;
        float fi = float(i);

        // Direction this fragment flies (based on cube face normals + variation)
        vec3 dir;
        float fmod6 = fi - 6.0 * floor(fi / 6.0); // manual mod
        if (fmod6 < 1.0) dir = vec3(1.0, 0.0, 0.0);
        else if (fmod6 < 2.0) dir = vec3(-1.0, 0.0, 0.0);
        else if (fmod6 < 3.0) dir = vec3(0.0, 1.0, 0.0);
        else if (fmod6 < 4.0) dir = vec3(0.0, -1.0, 0.0);
        else if (fmod6 < 5.0) dir = vec3(0.0, 0.0, 1.0);
        else dir = vec3(0.0, 0.0, -1.0);

        // Add randomized offset to direction for secondary fragments
        vec3 rnd = hash3(fi * 7.13) * 2.0 - 1.0;
        if (fi >= 6.0) {
            dir = normalize(dir + rnd * 0.8);
        }

        // Fragment displacement
        float fragSpread = spread * (0.5 + hash1(fi * 3.7) * 0.5);
        vec3 offset = dir * fragSpread;

        // Fragment rotation (tumble)
        float tumbleSpeed = hash1(fi * 5.3) * 2.0 - 1.0;
        vec3 tumbleAxis = normalize(hash3(fi * 11.7) * 2.0 - 1.0);
        float tumbleAngle = t * tumbleSpeed * 0.5 * spread;

        // Fragment size (slab-like pieces of the cube)
        vec3 fragSize;
        if (fmod6 < 1.0 || fmod6 >= 5.0) {
            fragSize = vec3(0.18, 0.45, 0.4) * (0.7 + hash1(fi * 2.1) * 0.6);
        } else if (fmod6 < 3.0) {
            fragSize = vec3(0.4, 0.18, 0.42) * (0.7 + hash1(fi * 4.3) * 0.6);
        } else {
            fragSize = vec3(0.42, 0.4, 0.18) * (0.7 + hash1(fi * 6.1) * 0.6);
        }

        // Transform point
        vec3 fp = p - offset;

        // Apply tumble rotation
        mat3 rot = rotX(tumbleAngle * tumbleAxis.x) *
                   rotY(tumbleAngle * tumbleAxis.y) *
                   rotZ(tumbleAngle * tumbleAxis.z);
        fp = rot * fp;

        float fd = sdBox(fp, fragSize);

        if (fd < d) {
            d = fd;
            fragId = fi;
        }
    }

    return d;
}

// Normal calculation (ignoring fragId output)
float mapSimple(vec3 p, float t, float beat) {
    float dummy;
    return mapScene(p, t, beat, dummy);
}

vec3 calcNormal(vec3 p, float t, float beat) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        mapSimple(p + e.xyy, t, beat) - mapSimple(p - e.xyy, t, beat),
        mapSimple(p + e.yxy, t, beat) - mapSimple(p - e.yxy, t, beat),
        mapSimple(p + e.yyx, t, beat) - mapSimple(p - e.yyx, t, beat)
    ));
}

// Soft shadow approximation
float calcShadow(vec3 ro, vec3 rd, float t, float beat) {
    float res = 1.0;
    float tDist = 0.05;
    for (int i = 0; i < 24; i++) {
        float d = mapSimple(ro + rd * tDist, t, beat);
        res = min(res, 8.0 * d / tDist);
        tDist += clamp(d, 0.02, 0.5);
        if (d < 0.001 || tDist > 10.0) break;
    }
    return clamp(res, 0.0, 1.0);
}

// HSV to RGB
vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);
    float t = TIME * speed;
    float beat = audioBeat;

    // Camera orbit
    float ca = t * 0.25;
    float camY = 2.0 + sin(t * 0.18) * 1.0;
    vec3 ro = vec3(sin(ca) * camDist, camY, cos(ca) * camDist);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

    // Dramatic side light
    vec3 lightDir = normalize(vec3(3.0, 2.0, -1.0));

    // Ray march
    float totalDist = 0.0;
    float hitFlag = -1.0;
    float hitFragId = 0.0;
    vec3 p;
    for (int i = 0; i < 90; i++) {
        p = ro + rd * totalDist;
        float fragId;
        float d = mapScene(p, t, beat, fragId);
        if (d < 0.001) {
            hitFlag = 1.0;
            hitFragId = fragId;
            break;
        }
        if (totalDist > 25.0) break;
        totalDist += d;
    }

    vec3 col = vec3(0.015, 0.01, 0.02); // very dark bg

    if (hitFlag > 0.0) {
        vec3 n = calcNormal(p, t, beat);

        // Diffuse
        float diff = max(dot(n, lightDir), 0.0);

        // Fill light
        vec3 fillDir = normalize(vec3(-1.0, 0.5, 2.0));
        float fill = max(dot(n, fillDir), 0.0) * 0.3;

        // Specular
        vec3 refl = reflect(rd, n);
        float spec = pow(max(dot(refl, lightDir), 0.0), 32.0);

        // Shadow
        float shadow = calcShadow(p + n * 0.01, lightDir, t, beat);

        // Edge highlight: Fresnel
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

        // Fragment coloring: dark moody with subtle per-fragment variation
        float hue = fract(hitFragId * 0.13 + colorShift / 6.28);
        vec3 fragColor = hsv2rgb(vec3(hue, 0.15, 0.25)); // very desaturated, dark

        // Bright edges
        vec3 edgeColor = hsv2rgb(vec3(fract(hue + 0.1), 0.5, 1.0));

        // Compose
        col = fragColor * (diff * shadow * 0.8 + fill + 0.1);
        col += vec3(0.9, 0.85, 0.8) * spec * shadow * 0.7;
        col += edgeColor * fresnel * 0.6;

        // Inner glow between fragments (based on proximity to center)
        float centerDist = length(p);
        float innerGlow = exp(-centerDist * 1.5);
        vec3 glowColor = hsv2rgb(vec3(fract(0.05 + colorShift / 6.28), 0.7, 1.0));
        col += glowColor * innerGlow * 0.3 * (1.0 + beat * 0.5);

        col *= intensity;

        // Distance fog
        float fog = exp(-totalDist * 0.05);
        col = mix(vec3(0.015, 0.01, 0.02), col, fog);
    } else {
        // Volumetric light shaft hint from the main light
        float lightDot = max(dot(rd, lightDir), 0.0);
        float shaft = pow(lightDot, 16.0);
        col += vec3(0.08, 0.06, 0.04) * shaft;
    }

    // Vignette
    vec2 vuv = gl_FragCoord.xy / RENDERSIZE;
    float vig = 1.0 - 0.4 * length((vuv - 0.5) * 1.7);
    col *= vig;

    // Tone mapping
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.92));

    gl_FragColor = vec4(col, 1.0);
}
