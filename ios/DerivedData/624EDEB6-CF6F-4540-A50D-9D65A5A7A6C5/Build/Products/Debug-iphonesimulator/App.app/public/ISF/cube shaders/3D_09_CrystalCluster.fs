/*{
    "DESCRIPTION": "Cluster of elongated crystal prisms arranged radially with prismatic iridescence",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "crystalCount", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 16.0},
        {"NAME": "sharpness", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Rotation matrix around arbitrary axis
mat3 rotAxis(vec3 axis, float a) {
    float s = sin(a);
    float c = cos(a);
    float oc = 1.0 - c;
    vec3 ax = normalize(axis);
    return mat3(
        oc * ax.x * ax.x + c,        oc * ax.x * ax.y - ax.z * s, oc * ax.z * ax.x + ax.y * s,
        oc * ax.x * ax.y + ax.z * s, oc * ax.y * ax.y + c,        oc * ax.y * ax.z - ax.x * s,
        oc * ax.z * ax.x - ax.y * s, oc * ax.y * ax.z + ax.x * s, oc * ax.z * ax.z + c
    );
}

// Box SDF
float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Elongated box (crystal prism)
float sdCrystal(vec3 p, float length_, float width) {
    // Hexagonal cross-section approximation using rotated boxes
    float d1 = sdBox(p, vec3(width, length_, width * 0.7));
    mat3 r60 = rotAxis(vec3(0.0, 1.0, 0.0), 1.0472); // 60 degrees
    float d2 = sdBox(r60 * p, vec3(width, length_, width * 0.7));
    mat3 r120 = rotAxis(vec3(0.0, 1.0, 0.0), 2.0944); // 120 degrees
    float d3 = sdBox(r120 * p, vec3(width, length_, width * 0.7));
    return max(d1, max(d2, d3));
}

// Scene: cluster of crystals pointing outward from center
float mapScene(vec3 p, float t) {
    float d = 1e10;
    float beat = audioBeat * 0.3;

    // Central core sphere
    float core = length(p) - 0.3;
    d = core;

    int count = int(crystalCount);

    // Generate crystals using two nested loops for spherical distribution
    for (int i = 0; i < 16; i++) {
        if (i >= count) break;
        float fi = float(i);

        // Fibonacci sphere distribution for direction
        float phi = fi * 2.399963; // golden angle
        float cosTheta = 1.0 - (2.0 * fi + 1.0) / (crystalCount * 2.0);
        float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
        vec3 dir = vec3(
            cos(phi) * sinTheta,
            cosTheta,
            sin(phi) * sinTheta
        );

        // Slight animation: crystals gently oscillate
        float osc = sin(t * 0.5 + fi * 1.7) * 0.1;
        vec3 crystalCenter = dir * (0.6 + osc + beat * 0.2);

        // Crystal orientation: align Y axis with direction
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 axis = cross(up, dir);
        float axisLen = length(axis);
        float angle = 0.0;
        if (axisLen > 0.001) {
            axis = axis / axisLen;
            angle = acos(clamp(dot(up, dir), -1.0, 1.0));
        } else {
            axis = vec3(1.0, 0.0, 0.0);
            if (dot(up, dir) < 0.0) angle = 3.14159;
        }

        mat3 rot = rotAxis(axis, angle);

        // Transform point into crystal space
        vec3 cp = rot * (p - crystalCenter);

        // Crystal dimensions vary per crystal
        float crystLen = 0.6 + sin(fi * 3.7) * 0.25;
        float crystWid = 0.06 + sin(fi * 2.3) * 0.02;

        // Add twist along length
        float twist = cp.y * 0.3 * sin(t * 0.3 + fi);
        float cs = cos(twist);
        float sn = sin(twist);
        cp.xz = vec2(cp.x * cs - cp.z * sn, cp.x * sn + cp.z * cs);

        float cd = sdCrystal(cp, crystLen, crystWid);
        d = min(d, cd);
    }

    return d;
}

vec3 calcNormal(vec3 p, float t) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        mapScene(p + e.xyy, t) - mapScene(p - e.xyy, t),
        mapScene(p + e.yxy, t) - mapScene(p - e.yxy, t),
        mapScene(p + e.yyx, t) - mapScene(p - e.yyx, t)
    ));
}

// Prismatic rainbow from angle
vec3 prismColor(float angle, float shift) {
    float hue = fract(angle * 0.5 + 0.5 + shift / 6.28);
    float sat = 0.7;
    float val = 1.0;
    vec3 p = abs(fract(vec3(hue) + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return val * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), sat);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);
    float t = TIME * speed;

    // Camera orbit
    float ca = t * 0.2;
    float camY = 2.0 + sin(t * 0.15) * 1.0;
    vec3 ro = vec3(sin(ca) * camDist, camY, cos(ca) * camDist);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 2.0 * ww);

    // Ray march
    float totalDist = 0.0;
    float hit = -1.0;
    vec3 p;
    for (int i = 0; i < 100; i++) {
        p = ro + rd * totalDist;
        float d = mapScene(p, t);
        if (d < 0.0005) { hit = 1.0; break; }
        if (totalDist > 25.0) break;
        totalDist += d;
    }

    vec3 col = vec3(0.01, 0.01, 0.015); // near-black background

    if (hit > 0.0) {
        vec3 n = calcNormal(p, t);

        // Lighting
        vec3 lightDir1 = normalize(vec3(2.0, 4.0, 3.0));
        vec3 lightDir2 = normalize(vec3(-3.0, 1.0, -1.0));

        float diff1 = max(dot(n, lightDir1), 0.0);
        float diff2 = max(dot(n, lightDir2), 0.0);

        // Sharp specular (glass-like)
        vec3 refl = reflect(rd, n);
        float spec1 = pow(max(dot(refl, lightDir1), 0.0), 64.0 * sharpness);
        float spec2 = pow(max(dot(refl, lightDir2), 0.0), 32.0 * sharpness);

        // Prismatic iridescence based on view angle and normal
        float iridAngle = dot(n, rd);
        vec3 iridColor = prismColor(iridAngle, colorShift);

        // Fresnel for glass-like transparency feel
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0);

        // Crystal base color: clear/glass with prismatic tints
        vec3 baseColor = mix(vec3(0.6, 0.65, 0.7), iridColor, 0.4 + fresnel * 0.3);

        // Additional rainbow dispersion from reflection angle
        float reflAngle = dot(refl, vec3(0.0, 1.0, 0.0));
        vec3 dispersion = prismColor(reflAngle * 1.5, colorShift + 1.0) * 0.3;

        col = baseColor * (diff1 * 0.5 + diff2 * 0.2 + 0.25);
        col += vec3(1.0, 0.98, 0.95) * spec1 * 1.2;
        col += vec3(0.9, 0.95, 1.0) * spec2 * 0.5;
        col += iridColor * fresnel * 0.5;
        col += dispersion * fresnel;

        // Core glow near center
        float coreDist = length(p);
        float coreGlow = exp(-coreDist * 2.0);
        col += vec3(0.5, 0.6, 1.0) * coreGlow * 0.4;

        col *= intensity;

        // Distance fade
        float fog = exp(-totalDist * 0.04);
        col = mix(vec3(0.01, 0.01, 0.015), col, fog);
    }

    // Subtle ambient glow at center of screen
    float screenGlow = exp(-length(uv) * 3.0);
    col += vec3(0.05, 0.06, 0.12) * screenGlow;

    // Vignette
    vec2 vuv = gl_FragCoord.xy / RENDERSIZE;
    float vig = 1.0 - 0.3 * length((vuv - 0.5) * 1.5);
    col *= vig;

    // Tone mapping
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
