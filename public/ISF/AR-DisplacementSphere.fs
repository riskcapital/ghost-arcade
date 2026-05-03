/*{
    "DESCRIPTION": "Raymarched sphere with FFT-driven displacement. Latitude maps to frequency bands, surface ripples with waveform. Iridescent thin-film coloring with colored lighting.",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "sphereRadius", "TYPE": "float", "MIN": 0.5, "MAX": 2.0, "DEFAULT": 1.0},
        {"NAME": "displaceAmount", "TYPE": "float", "MIN": 0.1, "MAX": 1.0, "DEFAULT": 0.4},
        {"NAME": "waveDetail", "TYPE": "float", "MIN": 0.0, "MAX": 0.5, "DEFAULT": 0.15},
        {"NAME": "iridescence", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.5},
        {"NAME": "cameraSpeed", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1},
        {"NAME": "brightness", "TYPE": "float", "MIN": 0.5, "MAX": 3.0, "DEFAULT": 1.5}
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

// Get displacement at a point on the sphere
float getDisplacement(vec3 dir) {
    // Latitude: 0 at equator, 1 at poles
    float lat = abs(dir.y);
    // Map latitude to FFT frequency: low freq at equator, high at poles
    float fftU = lat;
    float fftVal = sampleFFT(fftU);

    // Fallback
    float fallback = 0.2 + 0.15 * sin(TIME * 0.4 + lat * 6.0);
    float energy = max(fftVal, fallback);

    // Longitude-based waveform ripple
    float lon = atan(dir.z, dir.x) / 6.28318 + 0.5;
    float wave = sampleWaveform(lon);
    float waveFallback = sin(lon * 12.0 + TIME * 2.0) * 0.3;
    wave = max(abs(wave), abs(waveFallback)) * sign(wave + waveFallback);

    // Combine FFT displacement with waveform detail
    float disp = energy * displaceAmount;
    disp += wave * waveDetail;

    // Add some spherical harmonic-like detail
    float detail = 0.05 * sin(dir.x * 8.0 + TIME) * sin(dir.y * 6.0) * sin(dir.z * 7.0 + TIME * 0.3);
    disp += detail * audioLevel;

    return disp;
}

float sceneSDF(vec3 p) {
    // Slow rotation
    p *= rotY(TIME * cameraSpeed * 0.5);

    float r = length(p);
    vec3 dir = p / max(r, 0.001);

    float disp = getDisplacement(dir);

    return r - sphereRadius - disp;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
}

// Thin-film iridescence
vec3 thinFilm(float cosTheta, float thickness) {
    float d = thickness * 2.0 * cosTheta;
    vec3 col;
    col.r = 0.5 + 0.5 * cos(6.28318 * (d * 0.9 + 0.0));
    col.g = 0.5 + 0.5 * cos(6.28318 * (d * 1.0 + 0.33));
    col.b = 0.5 + 0.5 * cos(6.28318 * (d * 1.1 + 0.67));
    return col;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    // Camera
    float camT = TIME * cameraSpeed;
    vec3 ro = vec3(3.5 * cos(camT), 1.0 + 0.5 * sin(camT * 0.6), 3.5 * sin(camT));
    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, fwd);
    vec3 rd = normalize(fwd + screen.x * right + screen.y * up);

    // Three colored lights
    vec3 light1Dir = normalize(vec3(1.0, 1.0, 0.5));
    vec3 light1Col = vec3(1.0, 0.7, 0.4);   // warm
    vec3 light2Dir = normalize(vec3(-0.8, 0.3, -0.6));
    vec3 light2Col = vec3(0.3, 0.5, 1.0);   // cool blue
    vec3 light3Dir = normalize(vec3(0.0, -1.0, 0.3));
    vec3 light3Col = vec3(0.5, 1.0, 0.5);   // green fill

    // Raymarch
    float totalDist = 0.0;
    float minDist = 999.0;
    vec3 col = vec3(0.0);
    bool hit = false;

    for (int i = 0; i < 90; i++) {
        vec3 p = ro + rd * totalDist;
        float d = sceneSDF(p);
        minDist = min(minDist, d);
        if (d < 0.001) {
            vec3 n = calcNormal(p);

            // Displacement amount at hit point for coloring
            vec3 dir = normalize(p * rotY(-TIME * cameraSpeed * 0.5));
            float dispAmt = getDisplacement(dir);

            // Three-point lighting
            float diff1 = max(dot(n, light1Dir), 0.0);
            float diff2 = max(dot(n, light2Dir), 0.0);
            float diff3 = max(dot(n, light3Dir), 0.0);

            float spec1 = pow(max(dot(reflect(-light1Dir, n), -rd), 0.0), 48.0);
            float spec2 = pow(max(dot(reflect(-light2Dir, n), -rd), 0.0), 48.0);

            // Fresnel
            float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);

            // Iridescent color based on displacement and view angle
            float filmThick = 1.5 + dispAmt * 4.0 * iridescence;
            vec3 iriCol = thinFilm(max(dot(n, -rd), 0.0), filmThick);

            // Combine lighting
            vec3 diffuse = light1Col * diff1 * 0.5 + light2Col * diff2 * 0.3 + light3Col * diff3 * 0.15;
            vec3 specular = light1Col * spec1 * 0.6 + light2Col * spec2 * 0.4;

            // Base color blends between dark and iridescent
            vec3 baseCol = mix(vec3(0.08, 0.05, 0.12), iriCol, 0.5 + 0.5 * fresnel);

            col = baseCol * (diffuse + 0.08) + specular;
            col += iriCol * fresnel * iridescence * 0.4;

            // Audio-reactive emission
            col += iriCol * audioBeat * 0.3;
            col *= brightness * 0.7;

            hit = true;
            break;
        }
        if (totalDist > 8.0) break;
        totalDist += d;
    }

    if (!hit) {
        // Ambient glow from near-miss rays
        float glow = exp(-minDist * 6.0) * 0.4;
        float hue = fract(TIME * 0.02 + 0.6);
        col = hsv2rgb(vec3(hue, 0.4, glow));
        col += vec3(0.005, 0.003, 0.01);
    }

    // Vignette
    float vig = 1.0 - 0.4 * dot(screen, screen);
    col *= vig;

    // Tone map
    col = col / (1.0 + col);

    gl_FragColor = vec4(col, 1.0);
}
