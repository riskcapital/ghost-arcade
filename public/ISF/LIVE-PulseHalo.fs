/*{
    "DESCRIPTION": "Minimal techno halo — beat-emitted shockwave rings with chromatic fringing around a breathing core. Clean, dark, surgical.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["Audio Reactive", "Generator"],
    "INPUTS": [
        {"NAME": "baseRadius", "TYPE": "float", "DEFAULT": 0.16, "MIN": 0.05, "MAX": 0.4},
        {"NAME": "ringSpeed",  "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.1,  "MAX": 1.5},
        {"NAME": "sharpness",  "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.2,  "MAX": 1.0},
        {"NAME": "chroma",     "TYPE": "float", "DEFAULT": 0.5,  "MIN": 0.0,  "MAX": 1.0},
        {"NAME": "hue",        "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0,  "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float ringShape(float r, float target, float width) {
    return exp(-pow((r - target) / max(width, 0.002), 2.0));
}

vec3 tintOf(float h) {
    return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float level = max(audioLevel, 0.25 + 0.1 * sin(TIME * 0.7));
    float bass = max(audioBass, 0.3 + 0.12 * sin(TIME * 0.5));
    float beat = audioBeat;
    float beatPhase = audioBeatPhase;

    float r = length(uv);
    float ringWidth = mix(0.05, 0.008, sharpness);
    vec3 tint = tintOf(hue);

    vec3 col = vec3(0.0);

    // Three shockwaves in flight, phase-staggered off the beat clock. Each
    // ring launches at a beat and decays as it travels outward.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float phase = beatPhase + fi;                    // ring age in beats
        float dist = baseRadius + phase * ringSpeed * 0.5;
        float life = exp(-phase * 1.15);
        float w = ringWidth * (1.0 + phase * 2.2);       // rings soften as they age

        // Chromatic fringe: R/G/B rings at slightly different radii.
        float off = chroma * 0.012 * (1.0 + phase);
        col.r += ringShape(r, dist + off, w) * life;
        col.g += ringShape(r, dist, w) * life;
        col.b += ringShape(r, dist - off, w) * life;
    }
    col *= tint * (0.9 + beat * 0.8);

    // Breathing core: level sets the resting size, bass adds the push.
    float core = baseRadius * (0.85 + level * 0.25 + bass * 0.12);
    float coreEdge = smoothstep(core + 0.012, core - 0.012, r);
    float coreRim = ringShape(r, core, 0.01 + bass * 0.012);
    // The disc is void-black with a burning rim — negative space is the look.
    col *= 1.0 - coreEdge;
    col += tint * coreRim * (1.4 + beat * 1.2);
    col += tintOf(hue + 0.5) * ringShape(r, core * 0.82, 0.006) * 0.5;

    // Hairline crosshair — barely-there stage geometry.
    float cross = max(
        exp(-pow(uv.y / 0.0016, 2.0)) * smoothstep(1.1, 0.2, abs(uv.x)),
        exp(-pow(uv.x / 0.0016, 2.0)) * smoothstep(1.1, 0.2, abs(uv.y))
    );
    col += tint * cross * 0.12 * (1.0 + beat);

    // Off-beat micro-grain in the darkness keeps blacks alive on LED walls.
    float grain = fract(sin(dot(gl_FragCoord.xy + fract(TIME), vec2(12.9898, 78.233))) * 43758.5453);
    col += vec3(grain) * 0.012;

    col = col / (col + 0.7);
    col = pow(col, vec3(0.85));

    gl_FragColor = vec4(col, 1.0);
}
