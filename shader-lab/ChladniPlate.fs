/*{
    "DESCRIPTION": "Chladni Plate — Eigenmodes of a vibrating rectangular membrane. Superposed modes phi_{m,n} = sin(m*pi*x)*sin(n*pi*y) satisfy Dirichlet boundary conditions, so the wavefunction is mathematically zero at the edges. Nodal lines (the zero-set of the superposition) bloom into Chladni figures — edges literally hold the math.",
    "CREDIT": "Shader Lab / Ghost-Arcade",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "speed",           "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.0,   "MAX": 2.5},
        {"NAME": "modeCount",       "TYPE": "float", "DEFAULT": 7.0,  "MIN": 2.0,   "MAX": 12.0},
        {"NAME": "modeRange",       "TYPE": "float", "DEFAULT": 9.0,  "MIN": 3.0,   "MAX": 22.0},
        {"NAME": "amplitudeVary",   "TYPE": "float", "DEFAULT": 0.85, "MIN": 0.0,   "MAX": 1.0},
        {"NAME": "lineWidth",       "TYPE": "float", "DEFAULT": 0.004,"MIN": 0.0005,"MAX": 0.02},
        {"NAME": "lineBrightness",  "TYPE": "float", "DEFAULT": 2.2,  "MIN": 0.0,   "MAX": 5.0},
        {"NAME": "fieldBrightness", "TYPE": "float", "DEFAULT": 0.7,  "MIN": 0.0,   "MAX": 2.0},
        {"NAME": "edgeHairline",    "TYPE": "float", "DEFAULT": 1.4,  "MIN": 0.0,   "MAX": 4.0},
        {"NAME": "cornerContrast",  "TYPE": "float", "DEFAULT": 1.0,  "MIN": 0.0,   "MAX": 3.0},
        {"NAME": "reshuffleRate",   "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0,   "MAX": 0.5},
        {"NAME": "bgColor",         "TYPE": "color", "DEFAULT": [0.005, 0.008, 0.015, 1.0]},
        {"NAME": "posColor",        "TYPE": "color", "DEFAULT": [0.1, 0.55, 1.0, 1.0]},
        {"NAME": "negColor",        "TYPE": "color", "DEFAULT": [1.0, 0.35, 0.7, 1.0]},
        {"NAME": "nodeColor",       "TYPE": "color", "DEFAULT": [1.0, 0.98, 0.82, 1.0]}
    ]
}*/

#define PI 3.14159265359

float hash1(float n) { return fract(sin(n * 43.1 + 17.3) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    int K = int(modeCount);

    // --- Superpose K eigenmodes. Compute u AND its gradient in the same loop
    //     so we can render nodal lines with geometrically uniform width. ---
    float u = 0.0;
    float dudx = 0.0;
    float dudy = 0.0;
    float ampSum = 0.0;

    // Slow integer shuffle: a new "mode set" rotates in over time
    float era = floor(t * reshuffleRate);
    float eraBlend = fract(t * reshuffleRate);

    for (int k = 0; k < 12; k++) {
        if (k >= K) break;
        float fk = float(k);

        // Two eras' worth of integer (m, n) modes, cross-faded
        float m0 = floor(2.0 + hash1(fk * 1.31 + era * 7.0)  * (modeRange - 2.0));
        float n0 = floor(2.0 + hash1(fk * 2.73 + era * 11.0) * (modeRange - 2.0));
        float m1 = floor(2.0 + hash1(fk * 1.31 + (era+1.0) * 7.0)  * (modeRange - 2.0));
        float n1 = floor(2.0 + hash1(fk * 2.73 + (era+1.0) * 11.0) * (modeRange - 2.0));

        float wA = 1.0 - smoothstep(0.0, 1.0, eraBlend);
        float wB = 1.0 - wA;

        // Per-mode breathing amplitude
        float ampPhase = hash1(fk * 3.14) * 6.2831853;
        float ampSpd   = 0.3 + hash1(fk * 4.19) * 0.7;
        float amp = mix(1.0, 0.5 + 0.5 * sin(t * ampSpd + ampPhase), amplitudeVary)
                    / (1.0 + fk * 0.15);

        // Eigenvalue → natural temporal frequency
        for (int era_i = 0; era_i < 2; era_i++) {
            float m = (era_i == 0) ? m0 : m1;
            float n = (era_i == 0) ? n0 : n1;
            float w = (era_i == 0) ? wA : wB;
            if (w < 0.001) continue;

            float mx = m * PI * uv.x;
            float ny = n * PI * uv.y;
            float sx = sin(mx), cx = cos(mx);
            float sy = sin(ny), cy = cos(ny);

            float omega = sqrt(m * m + n * n);
            float c = cos(omega * t * 0.15 + fk * 2.0 + float(era_i) * 1.1);

            float wAmp = amp * w;
            u    += wAmp * sx * sy * c;
            dudx += wAmp * m * PI * cx * sy * c;
            dudy += wAmp * n * PI * sx * cy * c;
            ampSum += wAmp;
        }
    }
    float invAmp = 1.0 / max(ampSum, 0.001);
    u    *= invAmp;
    dudx *= invAmp;
    dudy *= invAmp;

    // Geometric distance to nearest nodal line: |u| / |grad u|
    float gradMag = length(vec2(dudx, dudy));
    float nodeDist = abs(u) / max(gradMag, 0.02);
    float nodeLine = smoothstep(lineWidth * 4.0, 0.0, nodeDist);

    // Sign-based field color — positive vs negative lobes of the wavefunction
    vec3 field = mix(negColor.rgb, posColor.rgb, smoothstep(-0.4, 0.4, u));
    field *= abs(u) * fieldBrightness;

    vec3 col = bgColor.rgb + field + nodeColor.rgb * nodeLine * lineBrightness;

    // Edge hairline — the mathematical boundary, made visible
    float ex = min(uv.x, 1.0 - uv.x);
    float ey = min(uv.y, 1.0 - uv.y);
    float edgeDist = min(ex, ey);
    float hair = smoothstep(0.005, 0.0, edgeDist);
    col += nodeColor.rgb * hair * edgeHairline;

    // Corner accent — low-amplitude color where two zero-boundaries meet
    float cornerD = length(vec2(ex, ey));
    float cornerGlow = exp(-cornerD * 12.0);
    vec3 cornerCol = mix(posColor.rgb, negColor.rgb, 0.5 + 0.5 * sin(t * 0.9));
    col += cornerCol * cornerGlow * cornerContrast * 0.35;

    gl_FragColor = vec4(col, 1.0);
}
