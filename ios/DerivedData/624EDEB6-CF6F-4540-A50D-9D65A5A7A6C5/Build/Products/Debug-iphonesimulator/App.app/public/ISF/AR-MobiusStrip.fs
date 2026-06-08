/*{
    "DESCRIPTION": "Raymarched Mobius strip with waveform displacement along the loop. Strip width modulated by FFT, twist count shifts with spectral centroid. Smooth camera orbit with emissive coloring.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "stripWidth", "TYPE": "float", "MIN": 0.1, "MAX": 0.5, "DEFAULT": 0.25},
        {"NAME": "stripRadius", "TYPE": "float", "MIN": 0.8, "MAX": 1.8, "DEFAULT": 1.1},
        {"NAME": "twistCount", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "waveScale", "TYPE": "float", "MIN": 0.05, "MAX": 0.4, "DEFAULT": 0.2},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.2, "DEFAULT": 0.08},
        {"NAME": "emission", "TYPE": "float", "MIN": 1.0, "MAX": 4.0, "DEFAULT": 2.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359
#define TAU 6.28318530718
#define MAX_STEPS 80
#define MAX_DIST 12.0
#define SURF_DIST 0.002

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Mobius strip SDF
// Parametric: for angle theta around loop, local coord v across width
// The strip center traces a circle of radius R,
// with a half-twist (or twistCount twists) applied to the cross-section
float mobiusSDF(vec3 p) {
    // Audio-driven twist modulation
    float centroidFallback = 0.4 + 0.2 * sin(TIME * 0.5);
    float centroid = max(audioSpectralCentroid, centroidFallback);
    float twist = twistCount + (centroid - 0.4) * 0.5;

    // Find nearest point on the center circle
    float angle = atan(p.x, p.z); // -PI to PI
    float theta = angle; // parameter along the loop

    // Center of strip at this angle
    vec3 center = vec3(stripRadius * sin(theta), 0.0, stripRadius * cos(theta));

    // Waveform displacement
    float waveU = fract(theta / TAU + 0.5);
    float wave = sampleWaveform(waveU);
    float waveFallback = sin(theta * 3.0 + TIME * 2.0) * 0.5;
    float audioActive = step(0.01, audioLevel);
    wave = mix(waveFallback, wave, audioActive);

    // Displace center radially by waveform
    vec2 radDir = normalize(vec2(sin(theta), cos(theta)));
    center.xz += radDir * wave * waveScale;
    center.y += wave * waveScale * 0.3;

    // Local frame at this point on the loop
    // Tangent to the circle
    vec3 tangent = normalize(vec3(cos(theta), 0.0, -sin(theta)));

    // Normal pointing outward from circle center (before twist)
    vec3 outward = normalize(vec3(sin(theta), 0.0, cos(theta)));
    vec3 upDir = vec3(0.0, 1.0, 0.0);

    // Apply the Mobius twist: rotate the cross-section normal
    float halfAngle = theta * twist * 0.5;
    float ct = cos(halfAngle);
    float st = sin(halfAngle);
    vec3 normal = outward * ct + upDir * st;
    vec3 binormal = -outward * st + upDir * ct;

    // FFT-modulated strip width
    float fftU = fract(theta / TAU + 0.5);
    float fftVal = sampleFFT(fftU);
    float fftFallback = 0.35 + 0.2 * sin(TIME + theta * 2.0);
    fftVal = max(fftVal, fftFallback);
    float localWidth = stripWidth * (0.7 + 0.6 * fftVal);

    // Distance from point to the strip surface
    vec3 diff = p - center;
    float dn = dot(diff, normal);   // distance along normal (thickness)
    float db = dot(diff, binormal); // distance along binormal (width)
    float dt = dot(diff, tangent);  // distance along tangent

    // Strip cross-section: flat ribbon
    float thickness = 0.025 + 0.01 * fftVal;
    float d = max(abs(dn) - thickness, abs(db) - localWidth);

    return d;
}

vec3 getNormal(vec3 p) {
    float e = 0.003;
    float d = mobiusSDF(p);
    return normalize(vec3(
        mobiusSDF(p + vec3(e, 0.0, 0.0)) - d,
        mobiusSDF(p + vec3(0.0, e, 0.0)) - d,
        mobiusSDF(p + vec3(0.0, 0.0, e)) - d
    ));
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    // Camera orbit
    float camAngle = TIME * cameraSpeed;
    float camR = 3.2;
    float camY = 0.8 + sin(TIME * cameraSpeed * 0.6) * 0.6;
    vec3 camPos = vec3(camR * sin(camAngle), camY, camR * cos(camAngle));
    vec3 target = vec3(0.0, 0.0, 0.0);

    vec3 fwd = normalize(target - camPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd * 1.6 + right * screen.x + up * screen.y);

    // Raymarch
    float t = 0.0;
    vec3 hitPos = camPos;
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        hitPos = camPos + rd * t;
        float d = mobiusSDF(hitPos);
        if (d < SURF_DIST) {
            hit = true;
            break;
        }
        if (t > MAX_DIST) break;
        t += d * 0.6;
    }

    vec3 col = vec3(0.0);

    if (hit) {
        vec3 n = getNormal(hitPos);

        // Color based on position on the loop
        float theta = atan(hitPos.x, hitPos.z);
        float loopParam = fract(theta / TAU + 0.5);

        // FFT for this position
        float fftVal = sampleFFT(loopParam);
        float fftFallback = 0.35 + 0.2 * sin(TIME + loopParam * 8.0);
        fftVal = max(fftVal, fftFallback);

        // Spectral flux approximation from beat
        float beatFallback = 0.15 + 0.15 * sin(TIME * 2.5);
        float beat = max(audioBeat, beatFallback);

        float hue = fract(loopParam * 0.7 + TIME * 0.04 + fftVal * 0.15 + beat * 0.1);
        float sat = 0.65 + 0.3 * fftVal;
        float val = 0.6 + 0.4 * fftVal;

        vec3 baseCol = hsv2rgb(vec3(hue, sat, val));

        // Lighting
        vec3 lightDir = normalize(vec3(0.4, 1.0, 0.5));
        float diff = max(dot(n, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), 48.0);

        // Ambient + diffuse + specular
        col = baseCol * (0.15 + 0.5 * diff);
        col += vec3(1.0, 0.95, 0.9) * spec * 0.35;

        // Emission: self-illumination scaled by audio
        float bassFallback = 0.3 + 0.15 * sin(TIME * 0.8);
        float bass = max(audioBass, bassFallback);
        col += baseCol * emission * (0.2 + 0.3 * fftVal + 0.2 * bass);

        // Fresnel rim glow
        float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0);
        vec3 rimCol = hsv2rgb(vec3(fract(hue + 0.25), 0.8, 1.0));
        col += rimCol * fresnel * (0.6 + beat * 1.5);

        // Edge highlight along strip boundary
        float edgeBright = pow(abs(dot(n, vec3(0.0, 1.0, 0.0))), 0.5) * 0.3;
        col += baseCol * edgeBright;

        // Depth fade
        float fog = exp(-t * 0.1);
        col *= fog;

    } else {
        // Background: dark with subtle color
        float bgGlow = exp(-length(screen) * 2.0) * 0.06;
        float midFallback = 0.3 + 0.1 * sin(TIME * 1.3);
        float mid = max(audioMid, midFallback);
        col = vec3(0.015, 0.01, 0.03) + vec3(0.04, 0.01, 0.06) * bgGlow * (1.0 + mid);
    }

    // Beat flash overlay
    float beatFallback2 = 0.1 + 0.1 * sin(TIME * 2.5);
    float beatFlash = max(audioBeat, beatFallback2);
    col += col * beatFlash * 0.15;

    // Tone mapping
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
