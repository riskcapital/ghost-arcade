/*{
    "DESCRIPTION": "Raymarched metallic blob with FFT-driven spikes. Base smooth sphere displaced by directional spikes mapped to frequency bands. Metallic environment reflection with floor reflection.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "spikeHeight", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "spikeCount", "TYPE": "float", "MIN": 4.0, "MAX": 12.0, "DEFAULT": 8.0},
        {"NAME": "metallic", "TYPE": "float", "MIN": 0.3, "MAX": 1.0, "DEFAULT": 0.85},
        {"NAME": "surfaceTension", "TYPE": "float", "MIN": 0.05, "MAX": 0.4, "DEFAULT": 0.15},
        {"NAME": "baseRadius", "TYPE": "float", "MIN": 0.5, "MAX": 1.5, "DEFAULT": 0.9},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

// Smooth minimum for organic blob merging
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Sphere SDF
float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

// Spike direction from index
vec3 spikeDir(float i, float total) {
    float phi = i / total * 6.28318;
    float theta = 0.4 + sin(i * 2.39996 + 0.5) * 1.0;
    return normalize(vec3(
        sin(theta) * cos(phi),
        sin(theta) * sin(phi),
        cos(theta)
    ));
}

// Scene SDF
float sceneSDF(vec3 p) {
    // Audio with fallbacks
    float energy = max(audioLevel, 0.25 + 0.15 * sin(TIME * 0.5));
    float beat = max(audioBeat, 0.0);
    float bassE = max(audioBass, 0.3 + 0.1 * sin(TIME * 0.3));

    // Base sphere with breathing
    float breath = 1.0 + bassE * 0.1 + beat * 0.05;
    float base = sdSphere(p, baseRadius * breath);

    // Add spikes driven by FFT
    float spikes = 1000.0;
    for (int i = 0; i < 12; i++) {
        if (float(i) >= spikeCount) break;
        float fi = float(i);

        vec3 dir = spikeDir(fi, spikeCount);

        // Rotate spike direction slowly
        float rotT = TIME * cameraSpeed * 2.0 + fi * 0.3;
        float cr = cos(rotT);
        float sr = sin(rotT);
        dir = vec3(dir.x * cr - dir.z * sr, dir.y, dir.x * sr + dir.z * cr);

        // FFT energy for this spike
        float fftVal = sampleFFT(fi / spikeCount);
        float fftFallback = 0.3 + 0.25 * sin(TIME * 0.8 + fi * 1.5);
        float fftE = max(fftVal, fftFallback);

        // Spike: elongated sphere along direction
        float h = spikeHeight * fftE * 1.5;
        vec3 spikeCenter = dir * (baseRadius * breath + h * 0.3);
        float spikeR = 0.08 + 0.06 * (1.0 - fftE);

        // Capsule-like spike
        float t2 = clamp(dot(p - dir * baseRadius * breath * 0.8, dir) / max(h, 0.01), 0.0, 1.0);
        vec3 closest = dir * (baseRadius * breath * 0.8) + dir * h * t2;
        float taper = spikeR * (1.0 - t2 * 0.7);
        float spike = length(p - closest) - taper;

        spikes = min(spikes, spike);
    }

    // Smooth merge base and spikes
    float blob = smin(base, spikes, surfaceTension);

    // Floor plane
    float floor2 = p.y + 1.8;

    return min(blob, floor2);
}

// Normal estimation
vec3 getNormal(vec3 p) {
    float e = 0.002;
    float d = sceneSDF(p);
    return normalize(vec3(
        sceneSDF(p + vec3(e, 0.0, 0.0)) - d,
        sceneSDF(p + vec3(0.0, e, 0.0)) - d,
        sceneSDF(p + vec3(0.0, 0.0, e)) - d
    ));
}

// Fake environment map for metallic reflection
vec3 envMap(vec3 rd) {
    float centroid = max(audioSpectralCentroid, 0.4 + 0.1 * sin(TIME * 0.6));

    // Gradient sky
    float skyT = rd.y * 0.5 + 0.5;
    vec3 sky = mix(vec3(0.02, 0.02, 0.05), vec3(0.1, 0.15, 0.3), skyT);

    // Horizon glow
    float horizon = exp(-abs(rd.y) * 5.0);
    vec3 horizonCol = mix(vec3(0.3, 0.15, 0.4), vec3(0.15, 0.3, 0.4), centroid);
    sky += horizonCol * horizon;

    // Bright bands for metallic streaks
    float bands = sin(rd.x * 8.0 + rd.z * 4.0) * 0.5 + 0.5;
    bands = pow(bands, 4.0);
    sky += vec3(0.4, 0.35, 0.5) * bands * 0.3;

    return sky;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - vec2(0.5)) * vec2(aspect, 1.0) * 2.0;

    // Camera orbiting
    float camAngle = TIME * cameraSpeed;
    float camR = 4.0;
    vec3 camPos = vec3(sin(camAngle) * camR, 1.0, cos(camAngle) * camR);
    vec3 target = vec3(0.0, 0.0, 0.0);

    // Camera matrix
    vec3 fwd = normalize(target - camPos);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);

    vec3 rd = normalize(fwd + screen.x * right + screen.y * up);

    // Raymarch
    float t2 = 0.0;
    float d;
    vec3 p;
    bool hit = false;

    for (int i = 0; i < 80; i++) {
        p = camPos + rd * t2;
        d = sceneSDF(p);
        if (d < 0.001) {
            hit = true;
            break;
        }
        if (t2 > 20.0) break;
        t2 += d;
    }

    vec3 col = vec3(0.01, 0.01, 0.02);

    if (hit) {
        vec3 n = getNormal(p);

        // Determine if floor or blob
        bool isFloor = p.y < -1.75;

        if (isFloor) {
            // Checkerboard floor
            float check = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
            col = mix(vec3(0.03, 0.03, 0.05), vec3(0.06, 0.06, 0.1), check);

            // Floor reflection (simplified)
            vec3 reflDir = reflect(rd, n);
            col += envMap(reflDir) * 0.15;

            // Fade with distance
            float floorDist = length(p.xz);
            col *= exp(-floorDist * 0.1);
        } else {
            // Metallic blob shading
            vec3 reflDir = reflect(rd, n);
            vec3 envCol = envMap(reflDir);

            // Fresnel
            float fresnel = pow(1.0 - max(dot(-rd, n), 0.0), 3.0);
            fresnel = mix(0.04, 1.0, fresnel);

            // Diffuse (slight)
            vec3 lightDir = normalize(vec3(1.0, 2.0, 1.0));
            float diff = max(dot(n, lightDir), 0.0);
            vec3 diffCol = vec3(0.02, 0.02, 0.03) * diff;

            // Specular
            vec3 halfDir = normalize(lightDir - rd);
            float spec = pow(max(dot(n, halfDir), 0.0), 64.0);

            // Mix metallic reflection
            col = mix(diffCol, envCol, metallic * fresnel);
            col += vec3(0.8, 0.8, 0.9) * spec * metallic;

            // Dark metallic base tint
            float beat = max(audioBeat, 0.0);
            col *= 1.0 + beat * 0.3;
        }
    }

    // Fog
    float fog = 1.0 - exp(-t2 * 0.05);
    col = mix(col, vec3(0.01, 0.01, 0.02), fog);

    // Vignette
    vec2 vc = uv - vec2(0.5);
    float vig = 1.0 - dot(vc, vc) * 1.0;
    col *= vig;

    // Tone map
    col = col / (1.0 + col);
    // Slight gamma for metallic pop
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
