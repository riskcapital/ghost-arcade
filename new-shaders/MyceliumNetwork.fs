/*{
    "DESCRIPTION": "Underground mycelium network visualization. The exponential terrain sin-layers become fungal hyphae growing through soil strata. Voronoi cells represent nutrient exchange nodes where multiple hyphae converge. Signal molecules pulse through the network in waves, with fruiting bodies erupting at high-activity nodes.",
    "CREDIT": "Shrink Wrap",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "3D", "Organic"],
    "INPUTS": [
        { "NAME": "growthRate", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.5, "LABEL": "Growth Rate" },
        { "NAME": "networkDensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.0, "LABEL": "Network Density" },
        { "NAME": "nutrientFlow", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.5, "LABEL": "Nutrient Flow" },
        { "NAME": "soilLayers", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 1.5, "LABEL": "Soil Depth" },
        { "NAME": "sporulation", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0, "LABEL": "Sporulation" },
        { "NAME": "hyphaeWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0, "LABEL": "Hyphae Width" },
        { "NAME": "fruitingBodies", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Fruiting Bodies" },
        { "NAME": "biolumGlow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.5, "LABEL": "Bioluminescence" },
        { "NAME": "rotateView", "TYPE": "float", "DEFAULT": 0.0, "MIN": -1.5, "MAX": 1.5, "LABEL": "Rotate" },
        { "NAME": "tiltView", "TYPE": "float", "DEFAULT": -0.3, "MIN": -1.5, "MAX": 1.5, "LABEL": "Tilt" },
        { "NAME": "signalColor", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0, "MAX": 1.0, "LABEL": "Signal Color" },
        { "NAME": "decomposition", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Decomposition" }
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

float noise(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    fp = fp * fp * (3.0 - 2.0 * fp);
    float a = hash1(ip), b = hash1(ip + vec2(1, 0));
    float c = hash1(ip + vec2(0, 1)), d = hash1(ip + vec2(1, 1));
    return mix(mix(a, b, fp.x), mix(c, d, fp.x), fp.y);
}

vec3 voronoiNetwork(vec2 uv, float anim) {
    vec2 ip = floor(uv), fp = fract(uv);
    float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 pt = hash2(ip + nb);
        pt = 0.5 + 0.45 * sin(anim * 0.15 + 6.2831 * pt);
        float dist = length(nb + pt - fp);
        if (dist < d1) { d2 = d1; d1 = dist; id = hash1(ip + nb); }
        else if (dist < d2) { d2 = dist; }
    }
    return vec3(d1, d2, id);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y);

    float t = TIME * growthRate;

    // 3D view (looking into the soil cross-section)
    vec3 viewDir = normalize(vec3(uv, 1.0));
    viewDir.xz *= rot2(rotateView);
    viewDir.yz *= rot2(tiltView);
    vec2 puv = viewDir.xy / viewDir.z;

    vec3 col = vec3(0.0);

    // Soil background strata
    float strataDepth = puv.y * soilLayers;
    float strata = 0.0;
    for (float i = 0.0; i < 5.0; i++) {
        float strataLine = sin(strataDepth * (3.0 + i * 2.0) + noise(puv * (4.0 + i)) * 2.0);
        strata += smoothstep(0.02, 0.0, abs(strataLine)) * 0.15;
    }

    // Soil color: gets darker with depth
    float soilDark = 0.15 - puv.y * 0.05 * soilLayers;
    vec3 soilCol = mix(
        vec3(0.12, 0.08, 0.04),  // dark humus
        vec3(0.18, 0.14, 0.08),  // lighter soil
        noise(puv * 5.0)
    );
    soilCol *= soilDark + strata * 0.5;

    // Decomposing organic matter (patches)
    float decomp = noise(puv * 3.0 + t * 0.05);
    decomp = smoothstep(0.5, 0.8, decomp) * decomposition;
    soilCol += vec3(0.06, 0.08, 0.02) * decomp;

    col = soilCol;

    // === MYCELIUM NETWORK ===
    // Reinterpretation of the exponential terrain algorithm:
    // Original uses exp(sin(p.z/a+t)-3)*a for terrain height
    // We use it as hyphae growth probability in 2D cross-section

    vec2 networkUV = puv * 6.0 * networkDensity;

    // Multi-scale hyphae (from the a*=0.8 loop in original)
    float hyphaeTotal = 0.0;
    float hyphaeEdge = 0.0;
    float activeHyphae = 0.0;
    float a = soilLayers;

    for (float scale = 0.0; scale < 8.0; scale++) {
        if (a < 0.01) break;

        vec2 hUV = networkUV;
        hUV *= rot2(4.0 * scale); // rotation per scale from original p.xz*=rotate2D(4.)

        // Exponential growth function (from exp(sin(p.z/a+t)-3)*a)
        float growthField = exp(sin(hUV.y / a + t * (1.0 + scale * 0.2)) - 3.0) * a;

        // Hyphae branching via sin cross-product (from abs(dot(sin(p.zx/a*.3)*a, r/r)))
        float branching = abs(sin(hUV.x / a * 0.3) * a + sin(hUV.y / a * 0.5) * a);

        // Hyphae are thin lines
        float hyphaDist = abs(growthField - branching);
        float hypha = smoothstep(hyphaeWidth * 0.04, 0.0, hyphaDist);

        hyphaeTotal += hypha * a;
        hyphaeEdge += smoothstep(hyphaeWidth * 0.06, hyphaeWidth * 0.02, hyphaDist) * a;

        // Signal propagation along hyphae
        float signal = sin(hUV.x * 3.0 - t * nutrientFlow * 4.0 + scale * 1.5);
        signal = max(signal, 0.0);
        activeHyphae += hypha * signal * a;

        a *= 0.8;
    }

    // Hyphae coloring
    float hyphaeHue = signalColor;
    vec3 hyphaeCol = hsv2rgb(vec3(hyphaeHue, 0.3, 0.6));
    col = mix(col, hyphaeCol, clamp(hyphaeTotal * 2.0, 0.0, 0.8));

    // Signal pulse glow along active hyphae
    vec3 signalGlowCol = hsv2rgb(vec3(fract(signalColor + 0.15), 0.5, 1.0));
    col += signalGlowCol * activeHyphae * biolumGlow * 0.8;

    // Hyphae edge glow (bioluminescent rim)
    vec3 edgeGlowCol = hsv2rgb(vec3(fract(signalColor + 0.3), 0.4, 0.8));
    col += edgeGlowCol * hyphaeEdge * biolumGlow * 0.3;

    // === NUTRIENT EXCHANGE NODES (Voronoi) ===
    vec3 vor = voronoiNetwork(networkUV * 0.8, t);
    float nodeEdge = vor.y - vor.x;
    float nodeId = vor.z;

    // Nodes are where hyphae converge
    float nodeGlow = exp(-vor.x * vor.x * 10.0) * nutrientFlow;
    float nodePulse = 0.5 + 0.5 * sin(t * 2.0 + nodeId * 6.28);

    vec3 nodeCol = hsv2rgb(vec3(fract(signalColor + nodeId * 0.2), 0.6, nodeGlow * nodePulse));
    col += nodeCol;

    // Network edge connections (visible mycelial cords)
    float cordGlow = smoothstep(0.08, 0.02, nodeEdge) * 0.4;
    vec3 cordCol = hsv2rgb(vec3(fract(signalColor + 0.1), 0.4, cordGlow));
    // Signal traveling along cords
    float cordSignal = sin(nodeEdge * 40.0 - t * nutrientFlow * 5.0 + nodeId * 8.0);
    cordSignal = max(cordSignal, 0.0) * cordGlow;
    col += cordCol + signalGlowCol * cordSignal * biolumGlow * 0.5;

    // === FRUITING BODIES ===
    // Mushrooms erupt at high-activity nodes
    if (fruitingBodies > 0.01) {
        float fruitThreshold = 1.0 - fruitingBodies;
        float fruitActive = smoothstep(fruitThreshold, fruitThreshold + 0.2, nodeId);

        if (fruitActive > 0.01) {
            // Cap shape
            float capDist = vor.x * 5.0;
            float cap = exp(-capDist * capDist * 2.0) * fruitActive;

            // Gill pattern under cap
            float gillAngle = atan(vor.x, nodeEdge);
            float gills = abs(sin(gillAngle * 12.0)) * cap * 0.5;

            vec3 capCol = hsv2rgb(vec3(fract(signalColor + nodeId * 0.5 + 0.05), 0.5, 0.7));
            col += capCol * cap;
            col -= vec3(gills * 0.1);

            // Spore release
            if (sporulation > 0.01) {
                float sporeTime = fract(t * 0.3 + nodeId);
                float sporeBurst = exp(-sporeTime * 3.0) * sporulation * fruitActive;
                float sporeNoise = noise(puv * 20.0 + t + nodeId * 10.0);
                float spores = smoothstep(0.6, 0.8, sporeNoise) * sporeBurst;
                col += hsv2rgb(vec3(fract(signalColor + 0.2), 0.3, spores * 0.8));
            }
        }
    }

    // Ambient soil glow (bioluminescent fungi scattered)
    float ambientBio = noise(puv * 15.0 + t * 0.1);
    ambientBio = smoothstep(0.7, 0.9, ambientBio) * biolumGlow * 0.1;
    col += hsv2rgb(vec3(fract(signalColor + 0.4), 0.5, ambientBio));

    // Vignette
    float vig = 1.0 - dot(uv * 0.6, uv * 0.6);
    col *= clamp(vig, 0.0, 1.0);

    col = col / (1.0 + col);
    col = pow(col, vec3(0.93));

    gl_FragColor = vec4(col, 1.0);
}
