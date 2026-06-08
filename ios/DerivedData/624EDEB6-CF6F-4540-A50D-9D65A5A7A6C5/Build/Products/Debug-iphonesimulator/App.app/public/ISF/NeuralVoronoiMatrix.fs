/*{
    "DESCRIPTION": "Organic neural-network voronoi with synaptic connections, pulse propagation, and bioluminescent cell membranes. Voronoi edges become neural pathways with signal transmission animation.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Voronoi"],
    "INPUTS": [
        { "NAME": "pulseSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Pulse Speed" },
        { "NAME": "synapseWidth", "TYPE": "float", "DEFAULT": 0.06, "MIN": 0.01, "MAX": 0.2, "LABEL": "Synapse Width" },
        { "NAME": "cellScale", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 10.0, "LABEL": "Cell Scale" },
        { "NAME": "bioLuminance", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 2.0, "LABEL": "Bioluminance" },
        { "NAME": "signalIntensity", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 2.0, "LABEL": "Signal Intensity" },
        { "NAME": "organicWarp", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Organic Warp" },
        { "NAME": "rotateX", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.0, "MAX": 1.0, "LABEL": "Tilt X" },
        { "NAME": "rotateY", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.0, "MAX": 1.0, "LABEL": "Tilt Y" },
        { "NAME": "depthLayers", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0, "LABEL": "Depth Layers" },
        { "NAME": "colorScheme", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.0, "MAX": 1.0, "LABEL": "Color Scheme" }
    ]
}*/

precision highp float;

vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip);
    float b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1));
    float d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

// Extended voronoi returning closest point position
vec4 voronoiExt(vec2 uv, float anim) {
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);
    float d1 = 8.0, d2 = 8.0;
    float id = 0.0;
    vec2 closest = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 nb = vec2(float(i), float(j));
            vec2 pt = hash2(ip + nb);
            pt = 0.5 + 0.5 * sin(anim + 6.2831 * pt);
            vec2 diff = nb + pt - fp;
            float dist = length(diff);
            if (dist < d1) {
                d2 = d1; d1 = dist;
                id = hash1(ip + nb);
                closest = ip + nb + pt;
            } else if (dist < d2) {
                d2 = dist;
            }
        }
    }
    return vec4(d1, d2, id, d2 - d1);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * pulseSpeed;

    // 3D perspective
    float cx = cos(rotateX), sx = sin(rotateX);
    float cy = cos(rotateY), sy = sin(rotateY);
    vec3 viewDir = normalize(vec3(uv, 1.0));
    viewDir.yz = mat2(cx, -sx, sx, cx) * viewDir.yz;
    viewDir.xz = mat2(cy, -sy, sy, cy) * viewDir.xz;
    vec2 puv = viewDir.xy / viewDir.z;

    // Organic domain warp
    float warpX = noise(puv * 3.0 + t * 0.2) * organicWarp * 0.3;
    float warpY = noise(puv * 3.0 + vec2(5.0, 3.0) + t * 0.15) * organicWarp * 0.3;
    puv += vec2(warpX, warpY);

    vec3 col = vec3(0.0);

    int layers = int(depthLayers);
    for (int layer = 0; layer < 5; layer++) {
        if (layer >= layers) break;
        float fl = float(layer);
        float depthFade = exp(-fl * 0.5);
        float layerScale = cellScale * (1.0 + fl * 0.3);

        vec2 layerUV = puv * layerScale + vec2(fl * 1.7, fl * 2.3);
        vec4 vor = voronoiExt(layerUV, t * (0.8 + fl * 0.2));

        float d1 = vor.x;
        float d2 = vor.y;
        float cellId = vor.z;
        float edge = vor.w;

        // Neural membrane - cell boundary
        float membrane = smoothstep(synapseWidth + 0.02, synapseWidth, edge);
        float membraneGlow = exp(-edge * edge / (synapseWidth * synapseWidth * 2.0));

        // Synaptic signal propagation
        float signalPhase = fract(t * 0.5 + cellId * 3.0);
        float signal = sin(edge * 30.0 - t * 8.0 + cellId * 12.0);
        signal = smoothstep(0.3, 1.0, signal) * membraneGlow;

        // Pulse traveling along edges
        float pulseWave = sin(d1 * 20.0 - t * 6.0 + cellId * 6.28);
        pulseWave = max(pulseWave, 0.0) * membraneGlow;

        // Cell interior - nucleus glow
        float nucleusGlow = exp(-d1 * d1 * 8.0) * 0.5;
        float nucleusPulse = 0.7 + 0.3 * sin(t * 2.0 + cellId * 6.28);

        // Color per layer
        float hue = fract(colorScheme + cellId * 0.3 + fl * 0.12);
        float sat = 0.6 + 0.3 * sin(cellId * 5.0);

        // Membrane color (bioluminescent edge)
        vec3 membraneCol = hsv2rgb(vec3(fract(hue + 0.1), sat * 0.7, 1.0));
        membraneCol *= membraneGlow * bioLuminance * depthFade;

        // Signal color (brighter, shifted hue)
        vec3 signalCol = hsv2rgb(vec3(fract(hue + 0.3), 0.4, 1.0));
        signalCol *= (signal + pulseWave) * signalIntensity * depthFade;

        // Nucleus color
        vec3 nucleusCol = hsv2rgb(vec3(hue, sat * 0.5, nucleusGlow * nucleusPulse));
        nucleusCol *= depthFade;

        // Cell body - very subtle fill
        float cellBody = (1.0 - d1) * 0.05 * depthFade;
        vec3 bodyCol = hsv2rgb(vec3(hue, sat * 0.3, cellBody));

        // Dendrite tendrils (secondary connections)
        float dendrite = 0.0;
        for (float d = 1.0; d < 4.0; d++) {
            float dAngle = hash1(vec2(cellId, d)) * 6.28;
            vec2 dDir = vec2(cos(dAngle), sin(dAngle));
            float dDist = abs(dot(puv * layerScale - vor.xy, dDir));
            dendrite += exp(-dDist * 40.0) * exp(-d1 * 3.0) * 0.15;
        }
        vec3 dendriteCol = hsv2rgb(vec3(fract(hue + 0.2), 0.5, dendrite)) * depthFade;

        col += membraneCol + signalCol + nucleusCol + bodyCol + dendriteCol;
    }

    // Global ambient pulse
    float ambientPulse = 0.03 * sin(t * 0.5) + 0.03;
    col += hsv2rgb(vec3(colorScheme, 0.2, ambientPulse));

    // Vignette
    float vig = 1.0 - dot(uv * 0.6, uv * 0.6);
    col *= clamp(vig, 0.0, 1.0);

    // Tone map
    col = col / (1.0 + col);
    col = pow(col, vec3(0.92));

    gl_FragColor = vec4(col, 1.0);
}
