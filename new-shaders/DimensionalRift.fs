/*{
    "DESCRIPTION": "Dimensional rift combining volumetric raymarching with voronoi fracture planes. Space folds along voronoi boundaries revealing parallel dimensions through extruded crystal cracks. Inspired by tweetable GLSL orbital folding and log-space tunnels.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Voronoi"],
    "INPUTS": [
        { "NAME": "riftWidth", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Rift Width" },
        { "NAME": "foldDepth", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 9.0, "LABEL": "Fold Depth" },
        { "NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.5, "LABEL": "Speed" },
        { "NAME": "dimensionBleed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Dimension Bleed" },
        { "NAME": "voronoiDensity", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0, "LABEL": "Fracture Density" },
        { "NAME": "rotateX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Rotate X" },
        { "NAME": "rotateY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Rotate Y" },
        { "NAME": "extrudeRift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5, "LABEL": "Rift Extrusion" },
        { "NAME": "energyColor", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0, "LABEL": "Energy Color" },
        { "NAME": "volumetricDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Volumetric Density" }
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

vec3 voronoi(vec2 uv, float anim) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    float id = 0.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 nb = vec2(float(i), float(j));
            vec2 pt = hash2(ip + nb);
            pt = 0.5 + 0.5 * sin(anim + 6.2831 * pt);
            vec2 diff = nb + pt - fp;
            float dist = length(diff);
            if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
            else if (dist < d2) { d2 = dist; }
        }
    }
    return vec3(d1, d2, id);
}

// Space-folding SDF from tweetable concepts
float riftSDF(vec3 p, float t) {
    float d = 9.0;

    // Iterative folding (from the tweetable orbital patterns)
    int folds = int(foldDepth);
    for (int i = 0; i < 9; i++) {
        if (i >= folds) break;
        float fi = float(i);
        p.xz *= rot2(t * 0.2 - fi * 0.25);
        p.yz *= rot2(t * 0.15 + fi * 0.18);

        // Fold space
        p = abs(p);
        p -= vec3(0.4 + fi * 0.06);

        // Voronoi displacement on fold surfaces
        vec2 vuv = p.xz * voronoiDensity;
        vec3 vor = voronoi(vuv, t * 0.3 + fi);
        float edge = vor.y - vor.x;

        // Rift along voronoi edges
        float riftPlane = abs(p.y) - riftWidth * 0.1 * (1.0 + vor.z * extrudeRift);
        float voronoiCut = edge - riftWidth * 0.15;

        d = min(d, max(riftPlane, -voronoiCut));
        d = min(d, length(max(abs(p) - 0.15 * (1.0 + fi * 0.08), 0.0)) - 0.01);
    }

    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * speed;

    // Camera
    vec3 ro = vec3(0.0, 0.0, -3.0);
    vec3 rd = normalize(vec3(uv, 0.8));

    ro.xz *= rot2(rotateY + t * 0.1);
    rd.xz *= rot2(rotateY + t * 0.1);
    ro.yz *= rot2(rotateX + sin(t * 0.2) * 0.15);
    rd.yz *= rot2(rotateX + sin(t * 0.2) * 0.15);

    vec3 col = vec3(0.0);
    float totalDist = 0.0;
    float volumeAccum = 0.0;

    // Volumetric + surface raymarching hybrid (inspired by tweetable dual-phase approach)
    bool pastMidpoint = false;
    for (int i = 0; i < 100; i++) {
        vec3 pos = ro + rd * totalDist;
        float d = riftSDF(pos, t);

        if (totalDist > 8.0) break;

        // Volumetric accumulation phase
        if (d > 0.01) {
            float glowDist = max(d, 0.05);
            float glow = exp(-glowDist * 3.0) * volumetricDensity * 0.02;

            // Color the volumetric based on position
            vec3 vor = voronoi(pos.xz * voronoiDensity, t * 0.3);
            float hue = fract(energyColor + vor.z * 0.3 + totalDist * 0.02);
            vec3 glowCol = hsv2rgb(vec3(hue, 0.5, 1.0));

            volumeAccum += glow;
            col += glowCol * glow;
        }

        if (d < 0.002) {
            // Surface hit
            vec2 e = vec2(0.003, 0.0);
            vec3 nor = normalize(vec3(
                riftSDF(pos + e.xyy, t) - riftSDF(pos - e.xyy, t),
                riftSDF(pos + e.yxy, t) - riftSDF(pos - e.yxy, t),
                riftSDF(pos + e.yyx, t) - riftSDF(pos - e.yyx, t)
            ));

            vec3 vor = voronoi(pos.xz * voronoiDensity, t * 0.3);
            float edge = vor.y - vor.x;
            float cellId = vor.z;

            // Lighting
            vec3 light = normalize(vec3(0.5, 0.7, -0.4));
            float diff = max(dot(nor, light), 0.0);
            float spec = pow(max(dot(reflect(-light, nor), -rd), 0.0), 32.0);
            float fres = pow(1.0 - abs(dot(nor, -rd)), 3.0);

            // Surface material
            float hue = fract(energyColor + cellId * 0.4);
            vec3 matCol = hsv2rgb(vec3(hue, 0.6, 0.7));

            vec3 surfCol = matCol * (0.1 + diff * 0.6);
            surfCol += spec * 0.5;

            // Rift energy on edges
            float riftEnergy = smoothstep(riftWidth * 0.2, 0.0, edge);
            vec3 riftCol = hsv2rgb(vec3(fract(energyColor + 0.1), 0.4, 1.0));
            surfCol += riftCol * riftEnergy * dimensionBleed * 2.0;

            // Fresnel
            surfCol += fres * 0.3 * hsv2rgb(vec3(fract(hue + 0.2), 0.3, 1.0));

            // "Other dimension" bleed through rift cracks
            float bleed = riftEnergy * dimensionBleed;
            vec3 altDimCol = hsv2rgb(vec3(fract(energyColor + 0.5), 0.8, 1.0));
            float altPulse = 0.5 + 0.5 * sin(t * 3.0 + cellId * 12.0);
            surfCol += altDimCol * bleed * altPulse;

            float fog = exp(-totalDist * 0.2);
            col += surfCol * fog;
            break;
        }

        totalDist += max(d * 0.7, 0.005);
    }

    // Background nebula
    if (totalDist > 7.9) {
        float bg = exp(-length(uv) * 1.5) * 0.08;
        col += hsv2rgb(vec3(energyColor, 0.4, bg));
    }

    // Tone map
    col = 1.0 - exp(-col * 1.5);
    col = pow(col, vec3(0.9));

    gl_FragColor = vec4(col, 1.0);
}
