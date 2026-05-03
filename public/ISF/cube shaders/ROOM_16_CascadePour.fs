/*{
    "DESCRIPTION": "Window into a room where warm amber fluid cascades down the back wall and pools at the bottom",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Room Shaders"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0},
        {"NAME": "intensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "depth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 6.28},
        {"NAME": "flowRate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "viscosity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.5}
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
    float edgeDist = max(abs(fromCenter.x), abs(fromCenter.y));

    float beat = audioBeat;
    float high = audioHigh;

    vec3 col = vec3(0.0);

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float z = (fi + 1.0) / 8.0 * depth;

        // Parallax shrink toward center
        float parallax = 1.0 - z * 0.45;
        vec2 luv = fromCenter * parallax;
        luv.x *= aspect;

        // Flow UV: downward cascade with sine-wave domain warping
        float flowT = t * flowRate * (0.6 + fi * 0.12);
        vec2 flowUV = luv * (2.5 + fi * 0.8) * viscosity;

        // Increasing UV distortion toward bottom (gravity pull)
        float gravWarp = (1.0 - uv.y) * 0.6 * viscosity;
        flowUV.x += sin(flowUV.y * 3.0 + flowT * 1.5 + fi) * gravWarp;
        flowUV.x += sin(flowUV.y * 7.0 - flowT * 0.8 + fi * 2.0) * gravWarp * 0.4;

        // Scrolling downward
        flowUV.y -= flowT * 0.5;

        // Fluid pattern: layered sine warps for glossy look
        float n1 = noise(flowUV);
        float n2 = noise(flowUV * 2.1 + vec2(fi * 3.0, flowT * 0.3));
        float fluid = n1 * 0.6 + n2 * 0.4;

        // Shape into flowing streaks
        float streak = sin(flowUV.x * 6.0 + fluid * 4.0 + fi * 1.7) * 0.5 + 0.5;
        streak = smoothstep(0.2, 0.8, streak * fluid);

        // Glossy specular highlight on fluid surface
        float specular = pow(max(0.0, sin(flowUV.x * 12.0 + fluid * 8.0 + flowT)), 8.0);
        specular *= 0.3 * (1.0 - z * 0.6);

        // Pool accumulation at bottom
        float poolZone = smoothstep(0.15, -0.05, uv.y - 0.15);
        float poolWave = noise(vec2(luv.x * 4.0 + t * 0.3, fi * 5.0)) * poolZone;
        streak = max(streak, poolWave * 0.7);

        // Depth brightness
        float brightness = (1.0 - z * 0.65) * intensity;
        brightness *= 1.0 + beat * 0.2 * (1.0 - z);

        // Warm amber/honey/gold palette
        float hue = colorShift + fi * 0.15;
        vec3 fluidCol = vec3(
            0.95 + 0.05 * sin(hue),
            0.55 + 0.15 * sin(hue + 0.8) - z * 0.15,
            0.08 + 0.08 * sin(hue + 2.0)
        );
        // Lighter golden for specular
        vec3 specCol = vec3(1.0, 0.9, 0.5);

        col += fluidCol * streak * brightness * 0.22;
        col += specCol * specular * brightness * (1.0 + high * 0.4);
    }

    // Warm glow at bottom from pooling
    float poolGlow = exp(-(uv.y * uv.y) * 12.0) * 0.2 * intensity;
    col += vec3(1.0, 0.6, 0.1) * poolGlow * (1.0 + beat * 0.3);

    // Subtle top light source where fluid originates
    float topGlow = exp(-((1.0 - uv.y) * (1.0 - uv.y)) * 8.0) * 0.08 * intensity;
    col += vec3(1.0, 0.85, 0.5) * topGlow;

    // Room wall vignette
    float vignette = 1.0 - edgeDist * 0.35;
    col *= vignette;

    gl_FragColor = vec4(col, 1.0);
}
