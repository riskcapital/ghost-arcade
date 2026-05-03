/*{
    "CREDIT": "Converted from Three.js by Claude",
    "DESCRIPTION": "Infinite Grid - Layered grids with orange fracture lines, purple pillars, void core, and dust",
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
            "NAME": "gridLayers",
            "TYPE": "float",
            "MIN": 1.0,
            "MAX": 15.0,
            "DEFAULT": 8.0
        },
        {
            "NAME": "gridIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "orangeLineIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "pillarIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "coreIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "dustAmount",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "beamIntensity",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 2.0,
            "DEFAULT": 1.0
        },
        {
            "NAME": "cameraHeight",
            "TYPE": "float",
            "MIN": 0.0,
            "MAX": 1.0,
            "DEFAULT": 0.5
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

// Hash functions
float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

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

// Grid color function (replaces array)
vec3 getGridColor(int idx) {
    if (idx == 0) return vec3(0.05, 0.1, 0.3);
    else if (idx == 1) return vec3(0.08, 0.15, 0.4);
    else return vec3(0.03, 0.08, 0.25);
}

// Grid pattern with perspective
float grid(vec2 uv, float divisions, float lineWidth) {
    vec2 g = abs(fract(uv * divisions - 0.5) - 0.5);
    vec2 fw = fwidth(uv * divisions);
    fw = max(fw, vec2(0.001)); // Prevent division by zero
    g = g / fw;
    float line = min(g.x, g.y);
    return 1.0 - min(line / lineWidth, 1.0);
}

// Layered infinite grids
vec3 infiniteGrids(vec2 uv, float t, float depth) {
    vec3 col = vec3(0.0);
    int numLayers = int(gridLayers);

    for (int i = 0; i < 15; i++) {
        if (i >= numLayers) break;

        float fi = float(i);
        float layerDepth = depth + fi * 0.15;

        // Perspective scaling
        float scale = 1.0 / (1.0 + layerDepth * 0.5);
        vec2 layerUV = uv * scale;

        // Rotation per layer
        float angle = t * 0.01 * speed * (mod(fi, 2.0) < 1.0 ? 1.0 : -1.0) * 0.5;
        float c = cos(angle);
        float s = sin(angle);
        layerUV = vec2(layerUV.x * c - layerUV.y * s, layerUV.x * s + layerUV.y * c);

        // Wave distortion
        float wave = sin(layerUV.x * 0.5 + t * 0.5 * speed) * cos(layerUV.y * 0.5 + t * 0.3 * speed);
        layerUV.y += wave * 0.1 * (1.0 + depth * 0.3);

        // Grid divisions increase with depth
        float divisions = 4.0 + fi * 0.5;
        float lineWidth = 3.0 + fi * 0.5;

        float g = grid(layerUV, divisions, lineWidth);

        // Color based on layer
        int colorIdx = int(mod(fi, 3.0));
        vec3 gridColor = getGridColor(colorIdx);

        // Pulse
        float pulse = 0.8 + sin(t * 2.0 * speed + layerUV.x * 10.0 + layerUV.y * 10.0) * 0.2;

        // Fade with depth
        float fade = max(0.1, 0.5 - fi * 0.03);

        col += gridColor * g * pulse * fade * gridIntensity;
    }

    return col;
}

// Orange fracture lines
vec3 orangeLines(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    // Hot orange/amber colors
    vec3 coreColor = vec3(1.0, 0.5, 0.1);
    vec3 glowColor = vec3(1.0, 0.3, 0.05);
    vec3 hotColor = vec3(1.0, 0.8, 0.4);

    for (int layer = 0; layer < 8; layer++) {
        float fl = float(layer);

        for (int i = 0; i < 15; i++) {
            float fi = float(i) + fl * 100.0;
            float h = hash(fi * 12.34);

            // Fracture line position
            float angle = hash(fi * 23.45) * PI * 2.0;
            float radius = hash(fi * 34.56) * 1.5;

            float x1 = cos(angle) * radius + (hash(fi * 45.67) - 0.5) * 0.3;
            float y1 = sin(angle) * radius + (hash(fi * 56.78) - 0.5) * 0.3;

            // Branch angle and length
            float branchAngle = angle + (hash(fi * 67.89) - 0.5) * 1.5;
            float branchLength = 0.1 + hash(fi * 78.90) * 0.4;

            float x2 = x1 + cos(branchAngle) * branchLength;
            float y2 = y1 + sin(branchAngle) * branchLength;

            // Spread over time
            float spread = 1.0 + t * speed * 0.01;
            x1 *= spread; y1 *= spread;
            x2 *= spread; y2 *= spread;

            // Movement
            float move = sin(t * 2.0 * speed + x1 * 0.05) * 0.05;
            y1 += move; y2 += move;

            // Distance to line segment
            vec2 a = vec2(x1, y1);
            vec2 b = vec2(x2, y2);
            vec2 pa = uv - a;
            vec2 ba = b - a;
            float th = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            float dist = length(pa - ba * th);

            float lineWidth = 0.008 + hash(fi * 89.01) * 0.01;

            if (dist < lineWidth * 3.0) {
                // Pulse intensity
                float pulse = 0.7 + sin(t * 3.0 * speed) * 0.3;
                float flicker = 0.9 + sin(t * 17.0 * speed) * 0.1;

                vec3 color = mix(glowColor, coreColor, pulse);
                color = mix(color, hotColor, sin(t * 5.0 * speed + h * 10.0) * 0.3 + 0.3);

                float alpha = (1.0 - dist / (lineWidth * 3.0)) * pulse * flicker;
                alpha *= max(0.2, 1.0 - fl * 0.1);

                col += color * alpha * 0.3 * orangeLineIntensity;
            }
        }
    }

    return col;
}

// Purple pillars
vec3 pillars(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    vec3 deepPurple = vec3(0.2, 0.05, 0.35);
    vec3 brightPurple = vec3(0.5, 0.2, 0.7);
    vec3 magenta = vec3(0.7, 0.1, 0.5);

    for (int ring = 0; ring < 3; ring++) {
        float ringDist = 0.4 + float(ring) * 0.35;

        for (int i = 0; i < 8; i++) {
            float fi = float(i) + float(ring) * 8.0;
            float angle = float(i) / 8.0 * PI * 2.0 + float(ring) * 0.3;

            float px = cos(angle) * ringDist;
            float py = sin(angle) * ringDist;

            // Pillar width varies
            float width = 0.03 + hash(fi * 12.34) * 0.02;

            float dist = length(uv - vec2(px, py));

            if (dist < width * 3.0) {
                // Emergence animation
                float emergence = min(1.0, max(0.0, (t * speed - fi * 0.2) * 0.1));
                if (emergence <= 0.0) continue;

                // Fresnel-like effect (simulated)
                float fresnel = 1.0 - smoothstep(0.0, width, dist);
                fresnel = pow(fresnel, 2.0);

                vec3 color = mix(deepPurple, brightPurple, fresnel);

                // Glowing horizontal bands
                float band = sin(uv.y * 20.0 + t * 1.5 * speed);
                band = smoothstep(0.7, 1.0, band);
                color = mix(color, magenta, band * 0.6);

                // Vertical energy lines
                float vLine = sin(atan(uv.y - py, uv.x - px) * 15.0);
                vLine = smoothstep(0.9, 1.0, vLine);
                color += vec3(0.3, 0.1, 0.4) * vLine;

                // Edge glow
                color += brightPurple * fresnel * 0.5;

                float alpha = (0.4 + fresnel * 0.3 + band * 0.2) * emergence;

                col += color * alpha * pillarIntensity * (1.0 - dist / (width * 3.0));
            }
        }
    }

    return col;
}

// Central void core
vec3 voidCore(vec2 uv, float t) {
    float dist = length(uv);
    float coreSize = 0.15;

    if (dist > coreSize * 2.0) return vec3(0.0);

    vec3 dark = vec3(0.02, 0.02, 0.05);
    vec3 purple = vec3(0.15, 0.05, 0.25);
    vec3 orange = vec3(0.8, 0.3, 0.1);

    // Organic pulsing
    float pulse = sin(t * 0.5 * speed) * 0.1 + 1.0;
    float effectiveDist = dist / pulse;

    // Fresnel
    float fresnel = 1.0 - effectiveDist / coreSize;
    fresnel = pow(clamp(fresnel, 0.0, 1.0), 3.0);

    vec3 color = mix(dark, purple, fresnel * 0.5);

    // Orange cracks
    float angle = atan(uv.y, uv.x);
    float crack = sin(angle * 5.0 + t * speed) * sin(dist * 30.0 + t * 0.7 * speed);
    crack = smoothstep(0.8, 1.0, crack);
    color = mix(color, orange, crack * 0.7);

    // Rotation
    float rotation = t * 0.1 * speed;
    vec2 rotUV = vec2(
        uv.x * cos(rotation) - uv.y * sin(rotation),
        uv.x * sin(rotation) + uv.y * cos(rotation)
    );

    // Noise displacement effect
    float n = sin(rotUV.x * 10.0 + t * speed) * sin(rotUV.y * 10.0 + t * 0.7 * speed) * sin((rotUV.x + rotUV.y) * 10.0 + t * 1.3 * speed);
    color += purple * n * 0.3;

    float alpha = smoothstep(coreSize * 2.0, coreSize * 0.5, dist);

    return color * alpha * coreIntensity;
}

// Vertical energy beams
vec3 beams(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    vec3 orange = vec3(1.0, 0.4, 0.1);
    vec3 yellow = vec3(1.0, 0.7, 0.2);

    for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float angle = fi / 16.0 * PI * 2.0 + t * 0.05 * speed * (mod(fi, 2.0) < 1.0 ? 1.0 : -1.0);
        float radius = 0.25 + mod(fi, 3.0) * 0.1;

        float bx = cos(angle) * radius;
        float by = sin(angle) * radius;

        float dist = abs(length(uv - vec2(bx, by)));

        if (dist < 0.02) {
            // Core brightness
            float core = 1.0 - dist / 0.02;
            core = pow(core, 2.0);

            // Flowing energy
            float flow = sin(uv.y * 30.0 - t * 8.0 * speed) * 0.5 + 0.5;
            float flow2 = sin(uv.y * 50.0 - t * 12.0 * speed) * 0.5 + 0.5;

            vec3 color = mix(orange, yellow, flow * flow2);
            color *= core;

            float alpha = core * 0.4 * (flow * 0.5 + 0.5);

            col += color * alpha * beamIntensity;
        }
    }

    return col;
}

// Dust particles
vec3 dust(vec2 uv, float t) {
    vec3 col = vec3(0.0);

    vec3 orangeDust = vec3(0.6, 0.3, 0.1);
    vec3 blueDust = vec3(0.2, 0.3, 0.5);

    for (int i = 0; i < 100; i++) {
        float fi = float(i);
        float h = hash(fi * 12.34);
        float spd = 0.1 + hash(fi * 23.45) * 0.5;

        float angle = hash(fi * 34.56) * PI * 2.0;
        float radius = 0.1 + hash(fi * 45.67) * 1.5;

        // Orbital motion
        float orbitAngle = t * spd * 0.5 * speed + fi * 0.1;
        float px = cos(angle + orbitAngle) * radius;
        float py = sin(angle + orbitAngle) * radius;

        // Vertical cycling
        float height = mod(h + t * spd * 0.3 * speed, 2.0) - 1.0;
        py = height;

        float dist = length(uv - vec2(px, py));
        float size = 0.003 + hash(fi * 56.78) * 0.006;

        if (dist < size * 3.0) {
            // Color based on height
            float heightFactor = (py + 1.0) * 0.5;
            vec3 dustColor = mix(orangeDust, blueDust, heightFactor);

            float alpha = (1.0 - dist / (size * 3.0)) * 0.3 * (1.0 - abs(py));

            col += dustColor * alpha * dustAmount;
        }
    }

    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - RENDERSIZE.xy * 0.5) / min(RENDERSIZE.x, RENDERSIZE.y);
    uv /= zoom;

    float t = TIME;

    // Camera height affects perspective
    float depth = 0.5 + cameraHeight * 0.5;

    // Apply slight camera orbit
    float camAngle = t * 0.03 * speed;
    float camRadius = 0.1;
    uv -= vec2(sin(camAngle), cos(camAngle)) * camRadius * (1.0 - cameraHeight);

    // Background - very dark blue
    vec3 col = vec3(0.008, 0.008, 0.03);

    // Layer the effects
    col += infiniteGrids(uv, t, depth);
    col += orangeLines(uv, t);
    col += pillars(uv, t);
    col += beams(uv, t);
    col += voidCore(uv, t);
    col += dust(uv, t);

    // Fog based on distance from center
    float fogDist = length(uv);
    vec3 fogColor = vec3(0.008, 0.008, 0.04);
    col = mix(col, fogColor, smoothstep(0.5, 2.0, fogDist) * 0.5);

    // Subtle vignette
    float vignette = 1.0 - fogDist * 0.3;
    col *= vignette;

    // Tone mapping
    col = col / (1.0 + col * 0.5);
    col = pow(col, vec3(0.95));

    gl_FragColor = vec4(col, 1.0);
}
