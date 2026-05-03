/*{
    "DESCRIPTION": "Raymarched 3D SDF scene with primitive shapes morphing between forms. Shape blend weights driven by frequency bands with iridescent material and waveform displacement.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "morphSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.5},
        {"NAME": "scale", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "smoothK", "TYPE": "float", "MIN": 0.1, "MAX": 0.8, "DEFAULT": 0.3},
        {"NAME": "emission", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.15},
        {"NAME": "waveDisplace", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

mat3 rotY(float a) {
    float c = cos(a); float s = sin(a);
    return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c);
}

mat3 rotX(float a) {
    float c = cos(a); float s = sin(a);
    return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdOctahedron(vec3 p, float s) {
    p = abs(p);
    return (p.x + p.y + p.z - s) * 0.57735;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Smooth min for blending SDFs
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sceneSDF(vec3 p) {
    float t = TIME * morphSpeed;

    // Audio weights with fallbacks
    float wBass = max(audioBass, 0.3 + 0.2 * sin(t * 0.5));
    float wLowMid = max(audioMid * 0.7, 0.2 + 0.15 * sin(t * 0.7));
    float wMid = max(audioMid, 0.2 + 0.15 * cos(t * 0.6));
    float wHigh = max(audioHigh, 0.15 + 0.1 * sin(t * 0.9));

    // Slow rotation of the forms
    p *= rotY(t * 0.3);

    float r = 0.8 * scale;

    // Sphere (bass)
    float sphere = sdSphere(p, r * (0.5 + 0.5 * wBass));

    // Torus (low-mid)
    float torus = sdTorus(p, vec2(r * 0.65, r * 0.2 * (0.5 + wLowMid)));

    // Octahedron (mid)
    float octa = sdOctahedron(p, r * (0.5 + 0.5 * wMid));

    // Box (high)
    float box = sdBox(p, vec3(r * 0.4 * (0.5 + wHigh)));

    // Waveform surface displacement
    float waveAngle = atan(p.z, p.x) / 6.28318 + 0.5;
    float wave = sampleWaveform(waveAngle) * waveDisplace;

    // Blend all shapes together
    float k = smoothK;
    float d = smin(sphere, torus, k);
    d = smin(d, octa, k);
    d = smin(d, box, k);

    d += wave;

    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
}

// Iridescent thin-film color
vec3 iridescence(float cosTheta, float thickness) {
    float delta = thickness * cosTheta;
    vec3 color;
    color.r = 0.5 + 0.5 * cos(6.28318 * (delta * 1.0 + 0.0));
    color.g = 0.5 + 0.5 * cos(6.28318 * (delta * 1.1 + 0.33));
    color.b = 0.5 + 0.5 * cos(6.28318 * (delta * 1.2 + 0.66));
    return color;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    float t = TIME;

    // Camera orbit
    float camAngle = t * cameraSpeed;
    float camHeight = 0.3 * sin(t * cameraSpeed * 0.7);
    vec3 ro = vec3(3.0 * cos(camAngle), 1.5 + camHeight, 3.0 * sin(camAngle));
    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + screen.x * right + screen.y * up);

    // Raymarch
    float totalDist = 0.0;
    float minDist = 999.0;
    vec3 col = vec3(0.0);
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * totalDist;
        float d = sceneSDF(p);
        minDist = min(minDist, d);
        if (d < 0.001) {
            // Surface hit
            vec3 n = calcNormal(p);
            vec3 lightDir = normalize(vec3(1.0, 1.0, -0.5));

            float diff = max(dot(n, lightDir), 0.0);
            float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 32.0);

            // Fresnel
            float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);

            // Iridescent color based on view angle and audio
            float filmThickness = 2.0 + audioSpectralCentroid * 3.0 + audioBeat;
            vec3 iriColor = iridescence(dot(n, -rd), filmThickness);

            // Base material
            vec3 baseCol = mix(vec3(0.15, 0.1, 0.2), iriColor, 0.6 + 0.4 * fresnel);

            col = baseCol * (diff * 0.6 + 0.2) + vec3(1.0) * spec * 0.5;
            col += iriColor * fresnel * emission * 0.3;
            col *= emission * 0.5;

            // Beat flash
            col += vec3(0.2, 0.15, 0.3) * audioBeat * 0.5;

            hit = true;
            break;
        }
        if (totalDist > 10.0) break;
        totalDist += d;
    }

    if (!hit) {
        // Background glow from near misses
        float glowStr = exp(-minDist * 8.0) * 0.5;
        float hue = fract(TIME * 0.03 + audioSpectralCentroid * 0.5);
        col = hsv2rgb(vec3(hue, 0.5, glowStr));

        // Subtle background gradient
        col += vec3(0.01, 0.005, 0.02) * (1.0 - length(screen));
    }

    // Tone map
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
