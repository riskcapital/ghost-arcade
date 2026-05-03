/*{
    "DESCRIPTION": "Breathing Membrane - Interior pulses like a living membrane with ripples from edges converging to center",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "breathRate", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 2.0},
        {"NAME": "membraneDepth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "rippleCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "organicDetail", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "membraneColor", "TYPE": "color", "DEFAULT": [0.8, 0.2, 0.3, 1.0]},
        {"NAME": "veinColor", "TYPE": "color", "DEFAULT": [0.5, 0.05, 0.1, 1.0]},
        {"NAME": "pulseColor", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.4, 1.0]},
        {"NAME": "innerGlow", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.6, 1.0]},
        {"NAME": "translucency", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

// Worley noise for cell/vein patterns
float worley(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float md = 1.0;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = vec2(hash2(n + g), hash2(n + g + 100.0));
            float d = length(g + o - f);
            md = min(md, d);
        }
    }
    return md;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    // Edge distances
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    float maxEdgeDist = 0.5; // max possible distance from edge
    float normEdge = edgeDist / maxEdgeDist;
    
    // Breathing cycle
    float breath = sin(t * breathRate * 3.14159) * 0.5 + 0.5;
    float heartbeat = pow(sin(t * breathRate * 3.14159), 16.0);
    
    // Membrane surface with organic displacement
    vec2 displaced = uv;
    float breathDisp = breath * membraneDepth * 0.05;
    displaced += vec2(
        fbm(uv * 4.0 + t * 0.3) * breathDisp,
        fbm(uv * 4.0 + 100.0 + t * 0.3) * breathDisp
    );
    
    // Base membrane tissue
    float tissue = fbm(displaced * 6.0 + t * 0.1) * organicDetail;
    vec3 col = mix(membraneColor.rgb, membraneColor.rgb * 0.6, tissue);
    
    // Vein network (Worley-based)
    float veinScale = 8.0 + organicDetail * 8.0;
    float veins = worley(displaced * veinScale);
    float veinLines = smoothstep(0.1, 0.0, veins);
    float veinGlow = smoothstep(0.3, 0.0, veins) * 0.3;
    
    // Veins pulse with heartbeat
    float veinPulse = veinLines * (0.5 + heartbeat * 0.5);
    col = mix(col, veinColor.rgb, veinPulse * 0.7);
    col += pulseColor.rgb * veinGlow * heartbeat * 0.3;
    
    // Edge-originating ripples converging to center
    float ripples = 0.0;
    for (int i = 0; i < 10; i++) {
        if (float(i) >= rippleCount) break;
        float fi = float(i);
        float phase = fract(t * breathRate * 0.3 + fi / rippleCount);
        float ripplePos = (1.0 - phase); // moves from edge (1) to center (0)
        float rippleDist = abs(normEdge - ripplePos * 0.5);
        float ripple = smoothstep(0.03, 0.0, rippleDist) * (1.0 - phase);
        ripples += ripple;
    }
    col += pulseColor.rgb * ripples * 0.4;
    
    // Center glow that breathes
    float centerDist = length(uv - vec2(0.5));
    float centerGlow = exp(-centerDist * centerDist * 8.0) * breath;
    col += innerGlow.rgb * centerGlow * 0.3;
    
    // Translucent subsurface scattering effect
    float sss = exp(-edgeDist * 10.0) * translucency;
    float sssNoise = fbm(uv * 8.0 + t * 0.5);
    col += pulseColor.rgb * sss * sssNoise * (0.5 + heartbeat * 0.5);
    
    // Surface tension at edges
    float edgeTension = exp(-edgeDist * 25.0);
    float tensionPulse = 0.5 + 0.5 * sin(edgeDist * 80.0 - t * 5.0);
    col += membraneColor.rgb * edgeTension * tensionPulse * 0.2;
    
    // Membrane thickness variation (darker near edges, lighter in middle)
    float thickness = smoothstep(0.0, 0.3, edgeDist);
    col *= 0.6 + thickness * 0.4;
    
    // Peristaltic wave
    float peristalsis = sin(uv.y * 10.0 - t * 3.0) * 0.5 + 0.5;
    peristalsis *= sin(uv.x * 10.0 - t * 2.5) * 0.5 + 0.5;
    col += membraneColor.rgb * peristalsis * membraneDepth * 0.1;
    
    // Overall heartbeat brightness pulse
    col *= 0.85 + heartbeat * 0.15;
    
    gl_FragColor = vec4(col, 1.0);
}
