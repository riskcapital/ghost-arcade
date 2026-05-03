/*{
    "DESCRIPTION": "Window into a room containing a pulsing molten core with magma veins, heat shimmer, and rising embers",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "coreSize", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5},
        {"NAME": "heatWarp", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * speed;

    vec2 fromCenter = (uv - 0.5) * 2.0;
    fromCenter.x *= aspect;
    float edgeDist = max(abs(fromCenter.x / aspect), abs(fromCenter.y));
    float centerDist = length(fromCenter);

    float beat = audioBeat;
    float high = audioHigh;

    // Heat shimmer distortion
    vec2 shimmer = vec2(
        sin(fromCenter.y * 12.0 + t * 3.0) * 0.008,
        cos(fromCenter.x * 10.0 + t * 2.5) * 0.006
    ) * heatWarp * (1.0 - centerDist * 0.3);
    vec2 distUV = fromCenter + shimmer;

    vec3 col = vec3(0.0);

    // Core glow: bright pulsing center at deepest point
    float coreR = 0.25 * coreSize;
    float corePulse = 1.0 + sin(t * 2.0) * 0.15 + beat * 0.3;
    float coreDist = length(distUV);
    float coreGlow = exp(-coreDist * coreDist / (coreR * coreR * corePulse));

    // Core color: white-hot center to orange edge
    float hue = colorShift;
    vec3 coreWhite = vec3(1.0, 0.95, 0.85);
    vec3 coreOrange = vec3(1.0, 0.45 + 0.1 * sin(hue), 0.05);
    vec3 coreCol = mix(coreOrange, coreWhite, coreGlow * coreGlow) * intensity;
    col += coreCol * coreGlow * 1.5 * (1.0 + high * 0.2);

    // Magma vein layers at different depths
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax
        float parallax = 1.0 - z * 0.45;
        vec2 luv = distUV * parallax;

        // Magma veins radiating outward from center
        float angle = atan(luv.y, luv.x);
        float radius = length(luv);

        // Vein pattern using sine warping along angle
        float veinAngle = angle * (3.0 + fi * 0.7);
        float veinWarp = noise(vec2(veinAngle + fi * 5.0, radius * 3.0 - t * 0.3));
        float vein = sin(veinAngle + veinWarp * 4.0 + t * 0.2 * (1.0 + fi * 0.1));
        vein = smoothstep(0.6, 0.95, vein);

        // Veins fade outward and are stronger near center
        float radialFade = exp(-radius * radius * (1.5 + fi * 0.3));
        vein *= radialFade;

        // Flowing magma texture along veins
        float magmaFlow = noise(vec2(angle * 2.0 + fi * 3.0, radius * 5.0 - t * 0.5));
        vein *= 0.6 + magmaFlow * 0.4;

        // Depth brightness
        float brightness = (1.0 - z * 0.6) * intensity;
        brightness *= 1.0 + beat * 0.2;

        // Orange/red/yellow magma palette
        vec3 magmaCol = vec3(
            0.95 + 0.05 * sin(hue + fi * 0.3),
            0.3 + 0.2 * sin(hue + fi * 0.5 + 1.0) - z * 0.1,
            0.02 + 0.05 * sin(hue + fi * 0.2 + 2.0)
        );
        magmaCol *= 1.0 + high * 0.15;

        col += magmaCol * vein * brightness * 0.3;
    }

    // Rising embers from the core
    for (int e = 0; e < 6; e++) {
        float fe = float(e);
        float ez = (fe + 1.0) / 6.0 * depth * 0.7;
        float eParallax = 1.0 - ez * 0.4;
        vec2 eluv = distUV * eParallax;

        float gridScale = 8.0 + fe * 3.0;
        vec2 egrid = eluv * gridScale;
        vec2 ecell = floor(egrid);
        vec2 efrac = fract(egrid);

        float eh1 = hash(ecell + fe * 23.7);
        float eh2 = hash(ecell + fe * 41.3 + 200.0);

        if (eh1 > 0.7) {
            // Rise upward from center
            float rise = fract(t * (0.2 + eh2 * 0.5) + eh1);
            vec2 ePos = vec2(
                0.5 + sin(t * 0.5 + eh1 * 6.28) * 0.2,
                fract(0.5 - rise)
            );
            float ed = length(efrac - ePos);
            float eSize = (0.08 - ez * 0.03) * (1.0 - rise * 0.5);
            float eGlow = exp(-ed * ed / (eSize * eSize + 0.001));
            eGlow *= smoothstep(0.0, 0.1, rise) * smoothstep(1.0, 0.7, rise);

            float eBright = (1.0 - ez * 0.5) * intensity;
            vec3 emberCol = mix(vec3(1.0, 0.6, 0.1), vec3(1.0, 0.2, 0.02), rise);
            col += emberCol * eGlow * eBright * 0.4 * (1.0 + beat * 0.3);
        }
    }

    // Cool dark falloff at edges
    float edgeCool = smoothstep(0.3, 1.0, edgeDist);
    col *= 1.0 - edgeCool * 0.7;

    // Faint dark ambient
    col += vec3(0.03, 0.005, 0.0) * (1.0 - edgeDist * 0.5);

    gl_FragColor = vec4(col, 1.0);
}
