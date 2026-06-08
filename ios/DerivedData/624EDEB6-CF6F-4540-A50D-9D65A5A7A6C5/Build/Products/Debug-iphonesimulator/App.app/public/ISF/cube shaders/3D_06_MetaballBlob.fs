/*{
    "DESCRIPTION": "Organic metaball blobs using smooth union SDF with subsurface scattering",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D SDF"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "camDist", "TYPE": "float", "DEFAULT": 4.0, "MIN": 2.0, "MAX": 8.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "smoothness", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 2.0},
        {"NAME": "blobScale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

// Smooth min (smooth union)
float smin(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// Animated blob positions
vec3 blobPos(int idx, float t) {
    float fi = float(idx);
    float a1 = fi * 0.947 + t * 0.7;
    float a2 = fi * 1.317 + t * 0.5;
    float a3 = fi * 0.653 + t * 0.9;
    return vec3(
        sin(a1) * cos(a2) * 1.3,
        sin(a2) * cos(a3) * 1.1,
        sin(a3) * cos(a1) * 1.2
    );
}

float mapScene(vec3 p, float t, float beat) {
    float k = smoothness;
    float sc = blobScale;
    float beatPulse = 1.0 + beat * 0.4;

    // Blob 0
    float d = sdSphere(p - blobPos(0, t), 0.55 * sc * beatPulse);
    // Blob 1
    d = smin(d, sdSphere(p - blobPos(1, t), 0.45 * sc * beatPulse), k);
    // Blob 2
    d = smin(d, sdSphere(p - blobPos(2, t), 0.5 * sc), k);
    // Blob 3
    d = smin(d, sdSphere(p - blobPos(3, t), 0.4 * sc * beatPulse), k);
    // Blob 4
    d = smin(d, sdSphere(p - blobPos(4, t), 0.48 * sc), k);
    // Blob 5
    d = smin(d, sdSphere(p - blobPos(5, t), 0.42 * sc * beatPulse), k);
    // Blob 6
    d = smin(d, sdSphere(p - blobPos(6, t), 0.38 * sc), k);

    return d;
}

vec3 calcNormal(vec3 p, float t, float beat) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        mapScene(p + e.xyy, t, beat) - mapScene(p - e.xyy, t, beat),
        mapScene(p + e.yxy, t, beat) - mapScene(p - e.yxy, t, beat),
        mapScene(p + e.yyx, t, beat) - mapScene(p - e.yyx, t, beat)
    ));
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
    float ca = t * 0.3;
    vec3 ro = vec3(sin(ca) * camDist, 1.5 + sin(t * 0.2) * 0.5, cos(ca) * camDist);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.8 * ww);

    // Ray march
    float totalDist = 0.0;
    float hit = -1.0;
    vec3 p;
    for (int i = 0; i < 80; i++) {
        p = ro + rd * totalDist;
        float d = mapScene(p, t, beat);
        if (d < 0.001) { hit = 1.0; break; }
        if (totalDist > 20.0) break;
        totalDist += d;
    }

    vec3 col = vec3(0.02, 0.01, 0.03); // dark bg

    if (hit > 0.0) {
        vec3 n = calcNormal(p, t, beat);

        // Light directions
        vec3 lightDir1 = normalize(vec3(1.0, 2.0, 1.5));
        vec3 lightDir2 = normalize(vec3(-1.5, 0.5, -1.0));
        vec3 backLight = normalize(vec3(0.0, -0.5, -1.0));

        // Diffuse
        float diff1 = max(dot(n, lightDir1), 0.0);
        float diff2 = max(dot(n, lightDir2), 0.0);

        // Specular
        vec3 halfDir = normalize(lightDir1 - rd);
        float spec = pow(max(dot(n, halfDir), 0.0), 32.0);

        // Subsurface scattering approximation
        // Measure thickness by marching a short distance inward
        float thickness = 0.0;
        vec3 ssPoint = p - n * 0.05;
        for (int j = 0; j < 6; j++) {
            float fj = float(j);
            float ssDist = 0.05 + fj * 0.06;
            thickness += max(0.0, ssDist - mapScene(p - n * ssDist, t, beat));
        }
        thickness = clamp(thickness * 0.5, 0.0, 1.0);

        float backDiff = max(dot(n, backLight), 0.0);
        float sss = thickness * backDiff * 2.0;

        // Organic green/purple coloring based on position
        float hue = 0.4 + p.y * 0.15 + p.x * 0.05 + colorShift / 6.28;
        hue = fract(hue);
        vec3 baseColor;
        // Green to purple gradient
        if (hue < 0.5) {
            baseColor = mix(vec3(0.15, 0.7, 0.3), vec3(0.3, 0.8, 0.5), hue * 2.0);
        } else {
            baseColor = mix(vec3(0.3, 0.8, 0.5), vec3(0.6, 0.2, 0.7), (hue - 0.5) * 2.0);
        }

        // Fresnel rim
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

        col = baseColor * (diff1 * 0.7 + diff2 * 0.3 + 0.15);
        col += vec3(1.0) * spec * 0.6;
        col += vec3(0.3, 0.9, 0.4) * sss * 0.5; // subsurface green tint
        col += vec3(0.5, 0.3, 0.8) * fresnel * 0.4; // purple rim
        col *= intensity;

        // Distance fog
        float fog = exp(-totalDist * 0.08);
        col = mix(vec3(0.02, 0.01, 0.03), col, fog);
    }

    // Subtle vignette
    vec2 vuv = gl_FragCoord.xy / RENDERSIZE;
    float vig = 1.0 - 0.3 * length((vuv - 0.5) * 1.5);
    col *= vig;

    // Tone mapping
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
