/*{
    "CREDIT": "Converted from Three.js by Claude",
    "DESCRIPTION": "State of the Planet - Infinite flythrough with particles, tendrils, and orbs",
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
            "NAME": "tendrilIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "orbBrightness",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "warmCoolMix",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3
        },
        {
            "NAME": "turbulence",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 0.7
        },
        {
            "NAME": "fogDensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.3
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

// Simplex noise functions
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

// Hash function for random values
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Color palettes - using procedural generation instead of arrays
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

// Particle field - creates infinite flythrough effect
vec3 particleField(vec2 uv, float t, float z) {
    vec3 col = vec3(0.0);
    float density = particleDensity;

    // Multiple particle layers at different depths
    for (int layer = 0; layer < 5; layer++) {
        float layerZ = z + float(layer) * 0.3;
        float layerScale = 1.0 + float(layer) * 0.5;

        // Tile the space
        vec2 tileUV = uv * (3.0 + float(layer) * 2.0) * density;
        vec2 tileID = floor(tileUV);
        vec2 tilePos = fract(tileUV) - 0.5;

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 offset = vec2(float(x), float(y));
                vec2 id = tileID + offset;

                float h = hash2(id + layerZ * 0.1);
                if (h > 0.6 * density) continue;

                vec2 particlePos = vec2(
                    hash2(id * 1.23 + 0.1) - 0.5,
                    hash2(id * 2.34 + 0.2) - 0.5
                );

                // Drift animation
                float drift = snoise(vec3(id * 0.1, t * 0.1 * speed)) * turbulence;
                particlePos.x += drift * 0.2;
                particlePos.y += snoise(vec3(id * 0.2, t * 0.15 * speed, 0.0)) * turbulence * 0.15;

                vec2 d = tilePos - offset - particlePos;
                float dist = length(d);

                // Size variation based on noise
                float sizeNoise = snoise(vec3(id * 0.3, layerZ * 0.1, 0.0));
                float size = 0.02 + pow((sizeNoise + 1.0) * 0.5, 2.0) * 0.08;
                size /= layerScale;

                if (dist < size) {
                    // Color based on noise
                    float colorNoise = snoise(vec3(id * 0.1, layerZ * 0.05, 0.0));
                    vec3 particleColor;
                    if (colorNoise < warmCoolMix - 0.5) {
                        particleColor = warmColor(hash2(id * 3.45));
                    } else {
                        particleColor = coolColor(hash2(id * 4.56));
                    }

                    // Soft glow
                    float glow = 1.0 - smoothstep(0.0, size, dist);
                    float core = exp(-dist / size * 3.5) * 0.5;

                    // Depth fade
                    float depthFade = 1.0 - float(layer) * 0.15;

                    col += particleColor * (glow * 0.5 + core) * depthFade * (0.7 + hash2(id) * 0.5);
                }
            }
        }
    }

    return col;
}

// Tendril effect
vec3 tendrils(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float phase = hash(fi * 12.34) * PI * 2.0;
        float spd = 0.3 + hash(fi * 23.45) * 0.4;
        float amp = 0.3 + hash(fi * 34.56) * 0.4;

        // Starting position
        float startX = (hash(fi * 45.67) - 0.5) * 2.0;
        float startY = (hash(fi * 56.78) - 0.5) * 1.5;

        // Animated tendril path
        float tx = startX + sin(t * spd * speed + phase) * amp * 0.5;
        float ty = startY + cos(t * spd * 0.8 * speed + phase) * amp * 0.3;

        // Noise-based displacement
        float noiseX = snoise(vec3(uv.y * 3.0 + phase + t * spd * speed * 0.5, t * 0.2 * speed, fi)) * amp;
        float noiseY = snoise(vec3(fi, uv.y * 3.0 + phase + t * spd * speed * 0.5, t * 0.15 * speed)) * amp * 0.8;

        tx += noiseX;
        ty += noiseY;

        // Distance to tendril line
        float dist = abs(uv.x - tx);

        // Tendril thickness varies along length
        float thickness = 0.02 + sin(uv.y * 2.0 + t * speed + phase) * 0.01;

        if (dist < thickness * 3.0) {
            // Color - mix of warm and cool based on tendril index
            vec3 tendrilColor;
            if (mod(fi, 2.0) < 1.0) {
                tendrilColor = warmColor(fi * 0.1 + t * 0.1);
            } else {
                tendrilColor = coolColor(fi * 0.15 + t * 0.1);
            }

            // Fresnel-like glow
            float glow = 1.0 - smoothstep(0.0, thickness * 3.0, dist);
            float core = exp(-dist / thickness * 2.0);

            // Pulse
            float pulse = 0.85 + 0.15 * sin(uv.y * 8.0 - t * speed * 1.5);

            // Taper at ends
            float taper = sin(clamp((uv.y + 1.0) * 0.5, 0.0, 1.0) * PI);

            col += tendrilColor * (glow * 0.4 + core * 0.6) * pulse * taper * tendrilIntensity;
        }
    }

    return col;
}

// Floating orbs
vec3 orbs(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float phase = hash(fi * 67.89) * PI * 2.0;
        float spd = 0.08 + hash(fi * 78.90) * 0.15;
        float orbitRadius = 0.2 + hash(fi * 89.01) * 0.5;

        // Base position
        float baseX = (hash(fi * 90.12) - 0.5) * 2.5;
        float baseY = (hash(fi * 01.23) - 0.5) * 1.8;

        // Orbital motion
        float orbX = baseX + sin(t * spd * speed + phase) * orbitRadius;
        float orbY = baseY + cos(t * spd * 0.8 * speed + phase) * orbitRadius * 0.7;

        float dist = length(uv - vec2(orbX, orbY));
        float size = 0.05 + hash(fi * 12.34) * 0.1;

        if (dist < size * 2.0) {
            // Color
            vec3 orbColor;
            if (hash(fi * 23.45) < 0.5) {
                orbColor = warmColor(hash(fi * 34.56));
            } else {
                orbColor = coolColor(hash(fi * 45.67));
            }

            // Sphere shading
            float sphere = 1.0 - dist / size;
            sphere = clamp(sphere, 0.0, 1.0);

            // Fresnel rim
            float fresnel = pow(1.0 - sphere, 2.5);
            vec3 rim = vec3(0.7, 0.85, 1.0) * fresnel * 0.5;

            // Inner glow
            float inner = pow(sphere, 1.5);

            vec3 orbFinal = orbColor * inner * 0.8 + rim + orbColor * 0.15;
            orbFinal = min(orbFinal, vec3(1.0));

            float alpha = smoothstep(size * 2.0, size * 0.5, dist) * 0.85;
            col += orbFinal * alpha * orbBrightness;
        }
    }

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - RENDERSIZE.xy * 0.5) / min(RENDERSIZE.x, RENDERSIZE.y);
    uv /= zoom;

    float t = TIME;

    // Camera movement - slow drift forward
    float cameraZ = t * speed * 0.1;

    // Subtle camera sway
    float swayX = sin(t * 0.06 * speed) * 0.05 + sin(t * 0.11 * speed) * 0.025;
    float swayY = cos(t * 0.05 * speed) * 0.03 + cos(t * 0.09 * speed) * 0.015;
    uv += vec2(swayX, swayY);

    // Background - very dark blue
    vec3 col = vec3(0.008, 0.008, 0.016);

    // Add fog/atmosphere gradient
    float fogGradient = length(uv) * fogDensity;
    vec3 fogColor = vec3(0.02, 0.02, 0.04);

    // Particle field
    col += particleField(uv, t, cameraZ);

    // Tendrils
    col += tendrils(uv, t);

    // Orbs
    col += orbs(uv, t);

    // Apply fog
    col = mix(col, fogColor, fogGradient * 0.3);

    // Tone mapping
    col = col / (1.0 + col);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
