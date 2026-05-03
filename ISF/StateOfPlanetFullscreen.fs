/*{
    "CREDIT": "Converted from Three.js by Claude",
    "DESCRIPTION": "State of the Planet - Static view with multi-colored tendrils, particles, orbs, and embers",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {
            "NAME": "speed",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 3.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "particleDensity",
            "TYPE": "float",
            "MIN": 0.1,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "tendrilCount",
            "TYPE": "float",
            "MIN": 5.0,
            "MAX": 50.0,
            "DEFAULT": 25.0
        },
        {
            "NAME": "tendrilIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "emberIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "orbCount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 20.0,
            "DEFAULT": 10.0
        },
        {
            "NAME": "warmCoolMix",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.4
        },
        {
            "NAME": "turbulence",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 0.7
        },
        {
            "NAME": "waveAmplitude",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.2
        },
        {
            "NAME": "showFrame",
            "TYPE": "bool",
            "DEFAULT": true
        },
        {
            "NAME": "zoom",
            "TYPE": "float",
            "MIN": 0.5,
            "MAX": 3.0,
            "DEFAULT": 1.0
        }
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.141592653589793

// Simplex noise
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

// Hash functions
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Warm colors - procedural instead of array
vec3 warmColor(float t) {
    t = fract(t);
    vec3 c1 = vec3(0.95, 0.25, 0.2);
    vec3 c2 = vec3(0.98, 0.4, 0.25);
    vec3 c3 = vec3(0.95, 0.5, 0.35);
    vec3 c4 = vec3(0.85, 0.15, 0.3);

    if (t < 0.25) return mix(c1, c2, t * 4.0);
    else if (t < 0.5) return mix(c2, c3, (t - 0.25) * 4.0);
    else if (t < 0.75) return mix(c3, c4, (t - 0.5) * 4.0);
    else return mix(c4, c1, (t - 0.75) * 4.0);
}

// Cool colors - procedural instead of array
vec3 coolColor(float t) {
    t = fract(t);
    vec3 c1 = vec3(0.15, 0.4, 0.95);
    vec3 c2 = vec3(0.2, 0.55, 0.95);
    vec3 c3 = vec3(0.3, 0.65, 0.95);
    vec3 c4 = vec3(0.45, 0.25, 0.85);

    if (t < 0.25) return mix(c1, c2, t * 4.0);
    else if (t < 0.5) return mix(c2, c3, (t - 0.25) * 4.0);
    else if (t < 0.75) return mix(c3, c4, (t - 0.5) * 4.0);
    else return mix(c4, c1, (t - 0.75) * 4.0);
}

// 3D box frame
float boxFrame(vec2 uv, vec2 size) {
    vec2 d = abs(uv) - size;
    float outside = length(max(d, 0.0));
    float inside = min(max(d.x, d.y), 0.0);
    float dist = outside + inside;

    // Draw edges
    float edge = 1.0 - smoothstep(0.0, 0.015, abs(dist));
    return edge;
}

// Particle layers
vec3 particleLayers(vec2 uv, float t) {
    vec3 col = vec3(0.0);
    float density = particleDensity;

    // Three layers with different sizes
    for (int layer = 0; layer < 3; layer++) {
        float baseSize;
        float tileCount;
        if (layer == 0) { baseSize = 0.04; tileCount = 3.0; }
        else if (layer == 1) { baseSize = 0.02; tileCount = 5.0; }
        else { baseSize = 0.01; tileCount = 8.0; }

        tileCount *= density;

        vec2 tileUV = uv * tileCount;
        vec2 tileID = floor(tileUV);
        vec2 tilePos = fract(tileUV) - 0.5;

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 offset = vec2(float(x), float(y));
                vec2 id = tileID + offset;

                float h = hash2(id + float(layer) * 100.0);
                if (h > 0.7 * density) continue;

                // Original position
                float ox = hash2(id * 1.23 + 0.1) - 0.5;
                float oy = hash2(id * 2.34 + 0.2) - 0.5;
                float oz = hash2(id * 3.45 + 0.3) - 0.5;

                // Apply noise displacement
                float slowTime = t * 0.08 * speed;
                float n1 = snoise(vec3(ox*0.5 + slowTime*0.4, oy*0.5 + slowTime*0.25, oz*0.5)) * waveAmplitude;
                float n2 = snoise(vec3(ox*0.8, oy*0.8 + slowTime*0.3, oz*0.8 + slowTime*0.15)) * waveAmplitude * 0.5;
                float t1 = snoise(vec3(ox*1.5 + slowTime*0.6, oy*1.5, oz*1.5)) * turbulence * 0.15;

                float px = ox + n1 * 0.3 + t1;
                float py = oy + n2 * 0.4 + sin(oy * 1.5 + slowTime) * 0.12 * waveAmplitude;

                vec2 particlePos = vec2(px, py);
                vec2 d = tilePos - offset - particlePos;
                float dist = length(d);

                // Size variation
                float sizeNoise = snoise(vec3(id * 0.3, float(layer), 0.0));
                float size = baseSize * (0.5 + pow((sizeNoise + 1.0) * 0.5, 2.0) * 1.5);

                if (dist < size * 2.0) {
                    // Color
                    float colorNoise = snoise(vec3(ox * 0.5, oy * 0.5, oz * 0.5));
                    float colorMix = (colorNoise + 1.0) * 0.5;
                    vec3 particleColor;
                    if (colorMix < 0.6 - warmCoolMix * 0.3) {
                        particleColor = warmColor(hash2(id * 3.45));
                    } else {
                        particleColor = coolColor(hash2(id * 4.56));
                    }

                    // Glow
                    float core = exp(-dist / size * 4.0) * (0.5 + hash2(id) * 0.5) * 0.4;
                    float edge = 1.0 - smoothstep(size * 0.3, size, dist);
                    float rim = smoothstep(size * 0.4, size * 0.8, dist) * (1.0 - smoothstep(size * 0.8, size, dist));

                    // Backlight effect
                    vec3 backlight = vec3(0.0, 0.87, 1.0) * rim * 0.3;

                    vec3 finalColor = particleColor * (0.7 + core * 0.5) + backlight;

                    col += finalColor * edge * 0.75;
                }
            }
        }
    }

    return col;
}

// Tendrils
vec3 tendrils(vec2 uv, float t) {
    vec3 col = vec3(0.0);
    int numTendrils = int(tendrilCount);

    for (int i = 0; i < 50; i++) {
        if (i >= numTendrils) break;

        float fi = float(i);
        float phase = hash(fi * 12.34) * PI * 2.0;
        float spd = 0.15 + hash(fi * 23.45) * 0.25;
        float amp = 0.3 + hash(fi * 34.56) * 0.4;
        float noiseOffset = hash(fi * 45.67) * 100.0;

        float startX = (hash(fi * 56.78) - 0.5) * 3.2;
        float startY = (hash(fi * 67.89) - 0.5) * 2.2;

        float slowTime = t * 0.1 * speed;

        // Sample points along the tendril
        float minDist = 999.0;
        float closestT = 0.0;

        for (int seg = 0; seg <= 15; seg++) {
            float segT = float(seg) / 15.0;

            float noiseX = snoise(vec3(segT*3.0 + noiseOffset + slowTime*spd, slowTime*0.2, phase)) * amp;
            float noiseY = snoise(vec3(phase, segT*3.0 + noiseOffset + slowTime*spd, slowTime*0.15)) * amp * 0.8;

            float tx = startX + noiseX + sin(slowTime*0.25 + phase + segT*2.0) * 0.4;
            float ty = startY + noiseY + cos(slowTime*0.2 + phase*1.3 + segT*2.0) * 0.3;

            vec2 tendrilPt = vec2(tx, ty);
            float d = length(uv - tendrilPt);

            if (d < minDist) {
                minDist = d;
                closestT = segT;
            }
        }

        // Tendril thickness with variation
        float thickness = 0.015 + sin(t * speed + phase) * 0.008;

        if (minDist < thickness * 4.0) {
            // Color from palette - alternating warm/cool
            vec3 tendrilColor;
            int colorIdx = int(mod(fi, 13.0));
            if (colorIdx < 7) {
                tendrilColor = warmColor(fi * 0.077);
            } else {
                tendrilColor = coolColor((fi - 7.0) * 0.167);
            }

            // Fresnel-like backlight
            vec3 backlight = mix(vec3(0.0, 0.7, 1.0), vec3(1.0, 0.4, 0.2), tendrilColor.r) * 0.9;
            float fresnel = 1.0 - smoothstep(0.0, thickness * 3.0, minDist);
            fresnel = pow(fresnel, 2.0);

            vec3 core = tendrilColor * (0.5 + (0.5 + hash(fi * 89.01) * 0.4) * 0.3);

            vec3 finalColor = core + backlight * fresnel;

            // Pulse
            float pulse = 0.85 + 0.15 * sin(closestT * 10.0 - t * 1.5 * speed);
            finalColor *= pulse;

            // Taper
            float taper = sin(closestT * PI);

            float alpha = (1.0 - smoothstep(0.0, thickness * 3.0, minDist)) * 0.6 * taper;
            col += finalColor * alpha * tendrilIntensity;
        }
    }

    return col;
}

// Rising embers
vec3 embers(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    for (int i = 0; i < 50; i++) {
        float fi = float(i);
        float h = hash(fi * 12.34);

        // Starting position at bottom
        float startX = (hash(fi * 23.45) - 0.5) * 3.0;

        // Velocity
        float vx = (hash(fi * 34.56) - 0.5) * 0.3;
        float vy = 0.15 + hash(fi * 45.67) * 0.4;

        // Current position (loop when reaching top)
        float lifetime = mod(t * speed * vy + hash(fi * 56.78), 2.5);
        float ex = startX + vx * lifetime + sin(t * 2.0 * speed + fi) * 0.05;
        float ey = -1.0 + lifetime;

        if (ey > 1.2) continue;

        float dist = length(uv - vec2(ex, ey));
        float size = 0.008 + hash(fi * 67.89) * 0.015;

        if (dist < size * 3.0) {
            // Orange/yellow ember color
            vec3 emberColor = vec3(1.0, 0.3 + hash(fi * 78.90) * 0.4, 0.1);

            float glow = exp(-dist / size * 4.0);
            float alpha = glow * 0.7 * (1.0 - lifetime / 2.5);

            col += emberColor * alpha * emberIntensity;
        }
    }

    return col;
}

// Orbs
vec3 orbs(vec2 uv, float t) {
    vec3 col = vec3(0.0);
    int numOrbs = int(orbCount);

    for (int i = 0; i < 20; i++) {
        if (i >= numOrbs) break;

        float fi = float(i);
        float phase = hash(fi * 89.01) * PI * 2.0;
        float spd = 0.08 + hash(fi * 90.12) * 0.15;

        vec3 originalPos = vec3(
            (hash(fi * 01.23) - 0.5) * 3.0,
            (hash(fi * 12.34) - 0.5) * 2.0,
            (hash(fi * 23.45) - 0.5) * 1.5
        );

        // Orbital motion
        float ox = originalPos.x + sin(t * spd * speed + phase) * 0.2;
        float oy = originalPos.y + cos(t * spd * 0.8 * speed + phase) * 0.15;

        float size = 0.04 + hash(fi * 34.56) * 0.06;
        float dist = length(uv - vec2(ox, oy));

        if (dist < size * 2.0) {
            // Color
            vec3 orbColor;
            if (hash(fi * 45.67) < 0.5) {
                orbColor = warmColor(hash(fi * 56.78));
            } else {
                orbColor = coolColor(hash(fi * 67.89));
            }

            // 3D sphere shading
            float sphere = 1.0 - dist / size;
            sphere = clamp(sphere, 0.0, 1.0);

            float fresnel = pow(1.0 - sphere, 2.5);
            vec3 rim = vec3(0.8, 0.9, 1.0) * fresnel * 0.4;
            float inner = pow(sphere, 1.5);

            vec3 finalColor = min(orbColor * inner * 0.9 + rim + orbColor * 0.2, vec3(1.0));

            float alpha = smoothstep(size * 2.0, size * 0.3, dist) * 0.85;
            col += finalColor * alpha;
        }
    }

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - RENDERSIZE.xy * 0.5) / min(RENDERSIZE.x, RENDERSIZE.y);
    uv /= zoom;

    float t = TIME;

    // Background
    vec3 col = vec3(0.012, 0.012, 0.024);

    // Fog gradient
    float fogDist = length(uv);
    vec3 fogColor = vec3(0.02, 0.02, 0.04);

    // Particle layers
    col += particleLayers(uv, t);

    // Tendrils
    col += tendrils(uv, t);

    // Embers (rising from bottom)
    col += embers(uv, t);

    // Orbs
    col += orbs(uv, t);

    // Box frame
    if (showFrame) {
        float frame = boxFrame(uv, vec2(1.4, 1.0));
        float outerFrame = boxFrame(uv, vec2(1.42, 1.02));
        col += vec3(1.0) * frame * 0.3;
        col += vec3(0.67, 0.8, 1.0) * outerFrame * 0.1;
    }

    // Apply fog
    col = mix(col, fogColor, fogDist * 0.15);

    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
