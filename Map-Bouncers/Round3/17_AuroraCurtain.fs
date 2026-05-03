/*{
    "DESCRIPTION": "Aurora Curtain - Northern lights ribbons that drape within the shape, compressing where it narrows",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "ribbonCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "foldIntensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "brightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "verticalStretch", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "greenColor", "TYPE": "color", "DEFAULT": [0.1, 0.9, 0.3, 1.0]},
        {"NAME": "blueColor", "TYPE": "color", "DEFAULT": [0.2, 0.3, 0.9, 1.0]},
        {"NAME": "purpleColor", "TYPE": "color", "DEFAULT": [0.6, 0.1, 0.8, 1.0]},
        {"NAME": "pinkColor", "TYPE": "color", "DEFAULT": [0.9, 0.2, 0.4, 1.0]},
        {"NAME": "skyColor", "TYPE": "color", "DEFAULT": [0.01, 0.02, 0.05, 1.0]}
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
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float horizontalSpace = min(uv.x, 1.0 - uv.x) * 2.0;
    
    // Night sky background
    vec3 col = skyColor.rgb;
    
    // Faint stars
    float starField = step(0.98, hash2(floor(uv * 200.0)));
    float twinkle = sin(t * 5.0 + hash2(floor(uv * 200.0)) * 100.0) * 0.5 + 0.5;
    col += vec3(starField * twinkle * 0.3);
    
    // Aurora ribbons
    float aurora = 0.0;
    vec3 auroraCol = vec3(0.0);
    
    for (int i = 0; i < 10; i++) {
        if (float(i) >= ribbonCount) break;
        float fi = float(i);
        
        // Ribbon position - horizontal wave with vertical draping
        float ribbonBase = 0.3 + fi * 0.08;
        float wave = sin(uv.x * (3.0 + fi) + t * (1.0 + fi * 0.3)) * 0.1 * foldIntensity;
        wave += sin(uv.x * (7.0 + fi * 2.0) - t * (0.5 + fi * 0.2)) * 0.05 * foldIntensity;
        float fold = noise(vec2(uv.x * 5.0 + fi * 10.0, t * 0.5 + fi)) * 0.08 * foldIntensity;
        
        float ribbonY = ribbonBase + wave + fold;
        
        // Ribbon brightness varies with folds
        float foldBright = 1.0 + abs(wave) * 5.0;
        
        // Vertical extent - aurora curtain drapes down
        float distToRibbon = uv.y - ribbonY;
        float curtain = exp(-distToRibbon * distToRibbon * (20.0 + verticalStretch * 40.0));
        
        // Downward drape (brighter above, fading below)
        float drape = smoothstep(-0.3, 0.0, distToRibbon) * exp(-max(distToRibbon, 0.0) * 5.0);
        curtain = max(curtain, drape * 0.3);
        
        // Compression near edges (aurora bunches up at boundaries)
        float compression = 1.0 + (1.0 - horizontalSpace) * 2.0;
        curtain *= compression;
        
        // Color by height in aurora
        float colorPhase = fract(fi / ribbonCount + t * 0.1);
        vec3 rCol;
        if (colorPhase < 0.25) rCol = mix(greenColor.rgb, blueColor.rgb, colorPhase / 0.25);
        else if (colorPhase < 0.5) rCol = mix(blueColor.rgb, purpleColor.rgb, (colorPhase - 0.25) / 0.25);
        else if (colorPhase < 0.75) rCol = mix(purpleColor.rgb, pinkColor.rgb, (colorPhase - 0.5) / 0.25);
        else rCol = mix(pinkColor.rgb, greenColor.rgb, (colorPhase - 0.75) / 0.25);
        
        // Shimmer/flicker
        float shimmer = 0.7 + 0.3 * noise(vec2(uv.x * 20.0 + fi * 5.0, t * 3.0));
        
        aurora += curtain * shimmer * foldBright;
        auroraCol += rCol * curtain * shimmer * foldBright;
    }
    
    aurora = min(aurora, 2.0);
    auroraCol = min(auroraCol, vec3(2.0));
    
    col += auroraCol * brightness * 0.4;
    
    // Edge reflection glow
    float edgeGlow = exp(-edgeDist * 10.0) * aurora * 0.15;
    col += auroraCol / max(aurora, 0.01) * edgeGlow;
    
    // Subtle ray structure
    float rays = fbm(vec2(uv.x * 30.0, uv.y * 2.0 + t * 0.5));
    col += auroraCol * 0.05 * rays * aurora * verticalStretch;
    
    gl_FragColor = vec4(col, 1.0);
}
