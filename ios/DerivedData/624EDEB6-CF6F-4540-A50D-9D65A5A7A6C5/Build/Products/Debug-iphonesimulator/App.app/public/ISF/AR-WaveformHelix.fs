/*{
    "DESCRIPTION": "Raymarched 3D helix ribbon with waveform displacement along the spiral path. Ribbon twists with spectral centroid, color driven by amplitude. Camera orbits smoothly.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "helixRadius", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "helixPitch", "TYPE": "float", "MIN": 0.3, "MAX": 1.5, "DEFAULT": 0.7},
        {"NAME": "ribbonWidth", "TYPE": "float", "MIN": 0.03, "MAX": 0.15, "DEFAULT": 0.07},
        {"NAME": "twistRate", "TYPE": "float", "MIN": 1.0, "MAX": 6.0, "DEFAULT": 3.0},
        {"NAME": "waveScale", "TYPE": "float", "MIN": 0.1, "MAX": 0.6, "DEFAULT": 0.3},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.12}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
#define MAX_STEPS 80
#define MAX_DIST 15.0
#define SURF_DIST 0.002

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// Approximate waveform sample along helix parameter
float getWave(float t) {
    float u = fract(t * 0.5);
    float w = sampleWaveform(u);
    // Fallback animation
    float fallback = sin(t * 4.0 + TIME * 3.0) * 0.5;
    return mix(fallback, w, step(0.01, audioLevel));
}

// SDF for the helix ribbon
float helixSDF(vec3 p) {
    // Project onto nearest helix point
    float angle = atan(p.x, p.z);
    float y = p.y;

    // Helix parameter: unwrap y into helix loops
    float loopY = y / helixPitch;
    float nearestLoop = floor(loopY + 0.5);

    float bestDist = MAX_DIST;

    // Check nearest few loops
    for (int i = -1; i < 2; i++) {
        float loop = nearestLoop + float(i);
        float helixY = loop * helixPitch;

        // Helix angle at this loop
        float helixAngle = loop * 2.0 * PI + angle;

        // Helix center point at this angle
        vec3 helixPt = vec3(
            helixRadius * sin(angle),
            helixY,
            helixRadius * cos(angle)
        );

        // Waveform displacement outward from helix axis
        float wave = getWave(helixAngle / (2.0 * PI) + TIME * 0.3);
        float waveMod = wave * waveScale;

        // Displace the helix point radially
        vec2 radDir = normalize(vec2(sin(angle), cos(angle)));
        helixPt.xz += radDir * waveMod;

        // Ribbon twist based on spectral centroid
        float centroidFallback = 0.4 + 0.2 * sin(TIME * 0.5);
        float centroid = max(audioSpectralCentroid, centroidFallback);
        float twist = helixAngle * twistRate * (0.5 + centroid);

        // Vector from helix point to sample point
        vec3 diff = p - helixPt;

        // Local ribbon frame: tangent along helix
        vec3 tangent = normalize(vec3(
            helixRadius * cos(angle),
            helixPitch / (2.0 * PI),
            -helixRadius * sin(angle)
        ));

        // Normal in the plane perpendicular to tangent
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 binormal = normalize(cross(tangent, up));
        vec3 normal = cross(binormal, tangent);

        // Apply twist
        float ct = cos(twist), st = sin(twist);
        vec3 localN = normal * ct + binormal * st;
        vec3 localB = -normal * st + binormal * ct;

        // Distance in ribbon cross-section
        float dN = abs(dot(diff, localN));
        float dB = abs(dot(diff, localB));

        // Ribbon shape: wide in one direction, thin in other
        float ribbonDist = max(dN / (ribbonWidth * 0.3), dB / ribbonWidth) - 1.0;
        float dist = length(diff) * sign(ribbonDist);
        dist = max(length(vec2(dN, dB)) - ribbonWidth, dN - ribbonWidth * 0.3);

        bestDist = min(bestDist, dist);
    }

    return bestDist;
}

float sceneSDF(vec3 p) {
    return helixSDF(p);
}

vec3 getNormal(vec3 p) {
    float e = 0.003;
    float d = sceneSDF(p);
    return normalize(vec3(
        sceneSDF(p + vec3(e, 0.0, 0.0)) - d,
        sceneSDF(p + vec3(0.0, e, 0.0)) - d,
        sceneSDF(p + vec3(0.0, 0.0, e)) - d
    ));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    // Camera orbit
    float camAngle = TIME * cameraSpeed;
    float camR = 3.5;
    float camY = 1.0 + sin(TIME * cameraSpeed * 0.7) * 0.5;
    vec3 camPos = vec3(camR * sin(camAngle), camY, camR * cos(camAngle));
    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 forward = normalize(target - camPos);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    vec3 rd = normalize(forward * 1.5 + right * screen.x + up * screen.y);

    // Raymarch
    float t = 0.0;
    float hitParam = -1.0;
    vec3 hitPos = camPos;

    for (int i = 0; i < 80; i++) {
        hitPos = camPos + rd * t;
        float d = sceneSDF(hitPos);
        if (d < SURF_DIST) {
            hitParam = t;
            break;
        }
        if (t > MAX_DIST) break;
        t += d * 0.7;
    }

    vec3 col = vec3(0.0);

    if (hitParam > 0.0) {
        vec3 n = getNormal(hitPos);

        // Position-based color along helix
        float helixAngle = atan(hitPos.x, hitPos.z);
        float colorParam = fract(helixAngle / (2.0 * PI) + hitPos.y / (helixPitch * 4.0));

        // Audio-driven color
        float fftVal = sampleFFT(colorParam);
        float fftFallback = 0.4 + 0.3 * sin(TIME * 1.5 + colorParam * 6.0);
        fftVal = max(fftVal, fftFallback);

        float hue = colorParam * 0.8 + TIME * 0.05;
        float sat = 0.6 + 0.3 * fftVal;
        float val = 0.7 + 0.3 * fftVal;

        vec3 baseCol = hsv2rgb(vec3(fract(hue), sat, val));

        // Lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 32.0);

        col = baseCol * (0.2 + 0.6 * diff) + vec3(1.0) * spec * 0.4;

        // Edge glow (fresnel)
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0);
        float beatFallback = 0.2 + 0.2 * sin(TIME * 2.5);
        float beat = max(audioBeat, beatFallback);
        col += baseCol * fresnel * (1.0 + beat * 2.0);

        // Depth fade
        float fog = exp(-hitParam * 0.15);
        col *= fog;
    }

    // Background glow
    float bgGlow = exp(-length(screen) * 1.5) * 0.08;
    float bassFallback = 0.3 + 0.1 * sin(TIME);
    float bass = max(audioBass, bassFallback);
    col += vec3(0.05, 0.02, 0.1) * bgGlow * (1.0 + bass);

    // Tone mapping
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
