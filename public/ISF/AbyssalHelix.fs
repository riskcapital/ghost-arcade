/*{
    "DESCRIPTION": "Deep-sea bioluminescent helix organism. Log-polar space spirals reinterpreted as a living abyssal creature with pulsing chromatophores, tentacle geometry, and pressure-reactive luminescence. Each spiral arm is a voronoi-segmented appendage with independent nerve-pulse animation.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Organic"],
    "INPUTS": [
        { "NAME": "spiralArms", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 12.0, "LABEL": "Spiral Arms" },
        { "NAME": "helixTightness", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 3.0, "LABEL": "Helix Tightness" },
        { "NAME": "pulseFreq", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Pulse Frequency" },
        { "NAME": "biolumColor", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Bio Color" },
        { "NAME": "depthPressure", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Depth Pressure" },
        { "NAME": "tentacleLength", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.1, "MAX": 1.5, "LABEL": "Tentacle Length" },
        { "NAME": "chromatophores", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0, "LABEL": "Chromatophores" },
        { "NAME": "rotateView", "TYPE": "float", "DEFAULT": 0.0, "MIN": -3.14, "MAX": 3.14, "LABEL": "Rotate View" },
        { "NAME": "tiltView", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Tilt View" },
        { "NAME": "swimSpeed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Swim Speed" },
        { "NAME": "nervePulseWidth", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.1, "MAX": 1.0, "LABEL": "Nerve Pulse Width" },
        { "NAME": "abyssalFog", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Abyssal Fog" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip), b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1)), d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

// Voronoi for chromatophore cell patterns
vec3 chromatophoreVoronoi(vec2 uv, float anim) {
    vec2 ip = floor(uv), fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = hash2(ip + nb);
        pt = 0.5 + 0.5 * sin(anim + 6.2831 * pt);
        float dist = length(nb + pt - fp);
        if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
        else if (dist < d2) { d2 = dist; }
    }
    return vec3(d1, d2, id);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * swimSpeed;
    vec3 col = vec3(0.0);

    // View transform
    uv *= rot2(rotateView);

    // Build ray in 3D
    vec3 rd = normalize(vec3(uv, 0.4));
    vec3 q = vec3(0.0, 0.0, -1.0);

    // Apply tilt
    rd.yz *= rot2(tiltView);

    float R, e = 0.0;
    vec3 p;

    // Volumetric raymarching through the organism
    // Reinterpreted from: log-polar helix with sin/cos frequency stacking
    for (float i = 0.0; i < 149.0; i++) {
        // Nerve pulse: traveling wave of activation along the creature
        float nervePulse = sin(i * 0.08 - t * 4.0 * pulseFreq) * 0.5 + 0.5;
        nervePulse = pow(nervePulse, 1.0 / nervePulseWidth);

        // Step through volume
        float stepSize = max(e, 0.01) * 0.2;
        p = q += rd * stepSize * (0.8 + 0.2 * nervePulse);

        // Helix rotation - creature's spiral body
        p.xy *= rot2(helixTightness);

        // Transform to log-polar creature space
        R = length(p);
        float logR = log2(max(R, 0.001));
        float phi = -p.z * 1.6 / max(R, 0.001) - 1.0;
        float theta = atan(p.x * 0.1, p.y) - t * 0.3;

        // Spiral arm quantization
        float armAngle = theta * spiralArms;
        float armId = floor(armAngle / 6.2831);
        float armPhase = fract(armAngle / 6.2831);

        // Tentacle tapering along length
        float tentacleTaper = exp(-max(logR - tentacleLength, 0.0) * 2.0);

        // Frequency-stacked density field (the creature's flesh)
        vec3 sp = vec3(logR, phi, theta);
        float density = phi; // base from --p.y equivalent
        float s = 1.0;
        for (float j = 0.0; j < 10.0; j++) {
            s *= 2.0;
            if (s > 1000.0) break;
            // Asymmetric sin/cos stacking creates organic undulation
            density += abs(dot(sin(sp.yzx * s + density * sp.y * 0.3), cos(sp * s))) / s * 0.32;
        }
        density *= tentacleTaper;

        e = density;

        // Chromatophore pattern on the surface
        vec2 chromUV = vec2(theta * 3.0, logR * 4.0);
        vec3 chrom = chromatophoreVoronoi(chromUV, t * pulseFreq * 2.0);
        float chromEdge = chrom.y - chrom.x;
        float chromActive = chrom.z;

        // Each chromatophore activates independently with nerve pulse
        float chromPulse = smoothstep(0.3, 0.7, sin(t * 3.0 * pulseFreq + chromActive * 6.28 + logR * 2.0));

        // Color: deep-sea bioluminescence
        float hue = fract(biolumColor + chromActive * chromatophores * 0.3 + nervePulse * 0.1);
        float sat = 0.5 + chromatophores * 0.4 * chromPulse;
        float val = e / 30.0 * (1.0 + nervePulse * 0.8);

        // Chromatophore spots glow
        float spotGlow = exp(-chrom.x * chrom.x * 8.0) * chromPulse * chromatophores;
        vec3 spotCol = hsv2rgb(vec3(fract(hue + 0.15), 0.6, spotGlow));

        // Edge membrane luminescence
        float membraneGlow = exp(-chromEdge * 20.0) * 0.3 * tentacleTaper;
        vec3 membraneCol = hsv2rgb(vec3(fract(hue + 0.3), 0.3, membraneGlow));

        // Pressure-reactive darkening at depth
        float pressureDarken = 1.0 - depthPressure * 0.5 * smoothstep(0.0, 2.0, R);

        vec3 bodyCol = hsv2rgb(vec3(hue, sat, val * pressureDarken));
        col += (bodyCol + spotCol + membraneCol) * tentacleTaper;
    }

    // Abyssal deep-water fog
    float fogNoise = noise(uv * 3.0 + t * 0.2) * 0.5 + 0.5;
    vec3 abyssCol = hsv2rgb(vec3(fract(biolumColor + 0.5), 0.3, 0.02 * abyssalFog));
    col += abyssCol * fogNoise;

    // Scattered light particles (marine snow)
    for (float i = 0.0; i < 5.0; i++) {
        vec2 snowUV = uv * (2.0 + i) + vec2(t * 0.05 * (i + 1.0), t * 0.02);
        float snow = noise(snowUV * 12.0);
        snow = smoothstep(0.78, 0.82, snow) * 0.15 * abyssalFog;
        col += vec3(0.3, 0.5, 0.7) * snow;
    }

    // Vignette - deep ocean darkness at edges
    float vig = 1.0 - dot(uv * 0.7, uv * 0.7);
    col *= clamp(vig, 0.0, 1.0);

    col = col / (1.0 + col);
    col = pow(col, vec3(0.92));

    gl_FragColor = vec4(col, 1.0);
}
