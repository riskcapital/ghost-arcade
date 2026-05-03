/*{
    "DESCRIPTION": "Tidal Pool - Caustic light patterns that bunch up and intensify near edges and corners",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "causticScale", "TYPE": "float", "DEFAULT": 6.0, "MIN": 2.0, "MAX": 15.0},
        {"NAME": "causticIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "waveSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "edgeCompression", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "waterColor", "TYPE": "color", "DEFAULT": [0.0, 0.15, 0.3, 1.0]},
        {"NAME": "causticColor", "TYPE": "color", "DEFAULT": [0.3, 0.8, 0.9, 1.0]},
        {"NAME": "shoreColor", "TYPE": "color", "DEFAULT": [0.7, 0.6, 0.4, 1.0]},
        {"NAME": "foamColor", "TYPE": "color", "DEFAULT": [0.9, 0.95, 1.0, 1.0]},
        {"NAME": "depthFade", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
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

// Caustic pattern via Voronoi-based approach
float caustic(vec2 p, float t) {
    float val = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 q = p * (1.0 + fi * 0.5);
        q += vec2(sin(t * (0.3 + fi * 0.1)), cos(t * (0.2 + fi * 0.15))) * 0.5;
        
        vec2 n = floor(q);
        vec2 f = fract(q);
        float md = 8.0;
        
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 g = vec2(float(x), float(y));
                vec2 o = vec2(
                    hash2(n + g + fi * 100.0),
                    hash2(n + g + fi * 100.0 + 50.0)
                );
                o = 0.5 + 0.5 * sin(t * (0.5 + fi * 0.2) + o * 6.28);
                float d = length(g + o - f);
                md = min(md, d);
            }
        }
        val += md;
    }
    return val / 3.0;
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
    
    // Depth: deeper in center, shallow at edges
    float depth = smoothstep(0.0, 0.3, edgeDist) * depthFade;
    
    // Compress caustic UV near edges (caustics bunch up at boundaries)
    vec2 causticUV = uv;
    float compression = 1.0 + (1.0 - smoothstep(0.0, 0.15, edgeDist)) * edgeCompression * 3.0;
    causticUV = (causticUV - 0.5) * compression + 0.5;
    
    // Water surface waves affecting caustic position
    float wave1 = sin(uv.x * 8.0 + t * waveSpeed * 3.0) * cos(uv.y * 6.0 + t * waveSpeed * 2.0);
    float wave2 = sin((uv.x + uv.y) * 10.0 - t * waveSpeed * 4.0);
    vec2 waveOffset = vec2(wave1, wave2) * 0.03;
    
    // Generate caustics
    float c1 = caustic(causticUV * causticScale + waveOffset, t);
    float c2 = caustic(causticUV * causticScale * 1.3 + waveOffset * 1.5 + 50.0, t * 0.8);
    
    float causticVal = pow(c1, 2.0) * pow(c2, 1.5);
    causticVal = pow(causticVal, 0.5) * causticIntensity;
    
    // Caustics intensify near edges (light focuses near boundaries)
    float edgeBoost = 1.0 + (1.0 - smoothstep(0.0, 0.1, edgeDist)) * edgeCompression * 2.0;
    causticVal *= edgeBoost;
    
    // Base water color (darker deeper)
    vec3 col = mix(waterColor.rgb * 0.4, waterColor.rgb, depth);
    
    // Apply caustics
    vec3 causticCol = causticColor.rgb * causticVal;
    col += causticCol;
    
    // Shore/sand at very edge
    float shoreMask = smoothstep(0.05, 0.0, edgeDist);
    col = mix(col, shoreColor.rgb, shoreMask * 0.6);
    
    // Foam lines near edges
    float foamWave = sin(edgeDist * 60.0 - t * 3.0) * 0.5 + 0.5;
    float foamMask = smoothstep(0.08, 0.02, edgeDist) * pow(foamWave, 3.0);
    col = mix(col, foamColor.rgb, foamMask * 0.6);
    
    // Dappled surface light
    float surfaceLight = noise(uv * 15.0 + t * 0.3) * noise(uv * 25.0 - t * 0.2);
    surfaceLight = pow(surfaceLight, 1.5);
    col += causticColor.rgb * surfaceLight * 0.15 * (1.0 - depth * 0.5);
    
    // Corner pools (extra accumulation)
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0);
    corners[1] = vec2(1.0, 0.0);
    corners[2] = vec2(1.0, 1.0);
    corners[3] = vec2(0.0, 1.0);
    for (int i = 0; i < 4; i++) {
        float cd = length(uv - corners[i]);
        float cornerCaustic = exp(-cd * 8.0) * causticVal * 0.5;
        col += causticColor.rgb * cornerCaustic;
    }
    
    // Subtle ripple rings from edges
    float ripple = sin(edgeDist * 80.0 - t * 6.0) * exp(-edgeDist * 10.0);
    col += foamColor.rgb * max(ripple, 0.0) * 0.1;
    
    gl_FragColor = vec4(col, 1.0);
}
