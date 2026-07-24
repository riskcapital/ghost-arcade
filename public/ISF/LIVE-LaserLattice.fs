/*{
    "DESCRIPTION": "Infinite neon grid tunnel flythrough with beat-synced laser sweeps and chromatic glow. Big-room look; BPM drives the sweep cadence.",
    "CREDIT": "Ghost Arcade LIVE pack",
    "ISFVSN": "2",
    "CATEGORIES": ["3D Room", "Audio Reactive"],
    "INPUTS": [
        {"NAME": "speed",     "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0, "MAX": 3.0},
        {"NAME": "gridScale", "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.5, "MAX": 2.5},
        {"NAME": "glow",      "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.1, "MAX": 1.5},
        {"NAME": "hue",       "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "sweep",     "TYPE": "float", "DEFAULT": 0.8,  "MIN": 0.0, "MAX": 1.0},
        {"NAME": "warp",      "TYPE": "float", "DEFAULT": 0.3,  "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

vec3 neon(float h) {
    return 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
}

float gridLine(float x, float width) {
    float f = abs(fract(x) - 0.5);
    return smoothstep(width, 0.0, f);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;

    float bass = max(audioBass, 0.3 + 0.15 * sin(TIME * 0.5));
    float high = max(audioHigh, 0.2 + 0.1 * sin(TIME * 0.8));
    float beat = audioBeat;
    float beatPhase = audioBeatPhase;

    // Tunnel coordinates: square-ish tube with soft corners.
    float t = TIME * speed;
    float twist = sin(t * 0.21) * warp * 1.2;
    uv = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * uv;

    // Bend the tunnel: the center wanders so walls lean into view.
    vec2 wander = vec2(sin(t * 0.43), cos(t * 0.31)) * 0.25 * warp;
    vec2 p = uv - wander;

    // Distance to tube wall (superellipse mixes square and round).
    float r = pow(pow(abs(p.x), 3.0) + pow(abs(p.y), 3.0), 1.0 / 3.0);
    r = max(r, 0.05);
    float depth = 1.0 / r;
    float zPos = depth * gridScale + t * 2.2;
    float angle = atan(p.y, p.x);

    // Grid: rings along depth + spokes around the tube.
    float fog = exp(-depth * 0.16);
    float rings = gridLine(zPos, 0.06 + bass * 0.05);
    float spokes = gridLine(angle * 12.0 / 6.2831, 0.05);
    float lattice = max(rings * 0.9, spokes * 0.7);

    // Wall shading: darker toward the far end, subtle panel glow between lines.
    float panel = 0.04 + 0.05 * sin(zPos * 0.5) * sin(angle * 6.0);
    vec3 base = neon(hue + depth * 0.012) * (panel + lattice * glow) * fog;

    // Beat-synced laser sweep: a bright ring races down the tunnel each beat.
    float sweepZ = fract(1.0 - beatPhase);
    float ringPos = sweepZ * 14.0;
    float sweepHit = exp(-abs(depth - ringPos) * 1.4);
    base += neon(hue + 0.45) * sweepHit * sweep * (0.6 + beat * 1.4) * fog * 2.2;

    // Second counter-sweep on highs for density in drops.
    float sweep2 = exp(-abs(depth - fract(t * 0.5) * 18.0) * 2.0);
    base += neon(hue + 0.2) * sweep2 * high * sweep * fog * 1.2;

    // Chromatic center glow — the vanishing point burns.
    float core = exp(-r * 6.5) * (0.7 + bass * 0.9);
    base += neon(hue + 0.08) * core * 1.6;

    // Vignette + tone map.
    float vig = 1.0 - dot(uv, uv) * 0.55;
    vec3 col = base * max(vig, 0.0);
    col = col / (col + 0.75);
    col = pow(col, vec3(0.85));
    col += (fract(sin(dot(gl_FragCoord.xy + fract(TIME), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

    gl_FragColor = vec4(col, 1.0);
}
