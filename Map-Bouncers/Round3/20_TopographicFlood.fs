/*{
    "DESCRIPTION": "Topographic Flood - Concentric contour lines flow inward from edges creating a living relief map",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "contourCount", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 40.0},
        {"NAME": "lineWidth", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "elevation", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "floodLevel", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "lowColor", "TYPE": "color", "DEFAULT": [0.1, 0.3, 0.15, 1.0]},
        {"NAME": "midColor", "TYPE": "color", "DEFAULT": [0.6, 0.5, 0.2, 1.0]},
        {"NAME": "highColor", "TYPE": "color", "DEFAULT": [0.5, 0.35, 0.25, 1.0]},
        {"NAME": "waterColor", "TYPE": "color", "DEFAULT": [0.1, 0.3, 0.6, 1.0]},
        {"NAME": "lineColor", "TYPE": "color", "DEFAULT": [0.3, 0.2, 0.15, 1.0]}
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

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    // Elevation map: base from edge distance + terrain noise
    float baseElevation = edgeDist * 2.0;
    
    // Terrain features
    float terrain = fbm(uv * 5.0 + t * 0.05) * elevation;
    float ridges = fbm(uv * 10.0 + 50.0 + t * 0.03) * elevation * 0.3;
    
    float elev = baseElevation + terrain * 0.4 + ridges * 0.2;
    
    // Animated contour animation (flood rising)
    float flood = fract(t * 0.15) * floodLevel;
    
    // Contour lines
    float contourSpacing = 1.0 / contourCount;
    float contourVal = fract(elev / contourSpacing + flood * contourCount);
    float contourLine = smoothstep(lineWidth * 0.05, lineWidth * 0.01, abs(contourVal - 0.5) - 0.47);
    
    // Major contour lines every 5th
    float majorContour = fract(elev / (contourSpacing * 5.0) + flood * contourCount / 5.0);
    float majorLine = smoothstep(lineWidth * 0.08, lineWidth * 0.02, abs(majorContour - 0.5) - 0.45);
    
    // Elevation colormap
    vec3 col;
    float normElev = clamp(elev, 0.0, 1.0);
    if (normElev < 0.33) {
        col = mix(lowColor.rgb, midColor.rgb, normElev / 0.33);
    } else if (normElev < 0.66) {
        col = mix(midColor.rgb, highColor.rgb, (normElev - 0.33) / 0.33);
    } else {
        col = mix(highColor.rgb, highColor.rgb * 1.3, (normElev - 0.66) / 0.34);
    }
    
    // Water fill
    float waterLevel = flood * 0.5;
    float underwater = smoothstep(waterLevel + 0.01, waterLevel, elev);
    vec3 water = waterColor.rgb * (0.6 + 0.4 * noise(uv * 20.0 + t * 2.0));
    
    // Water caustics
    float caustic = pow(noise(uv * 15.0 + t) * noise(uv * 20.0 - t * 0.7), 2.0);
    water += caustic * 0.2 * waterColor.rgb;
    
    // Shoreline
    float shore = smoothstep(0.02, 0.0, abs(elev - waterLevel));
    
    // Apply contour lines
    col = mix(col, lineColor.rgb, contourLine * 0.4);
    col = mix(col, lineColor.rgb * 0.5, majorLine * 0.6);
    
    // Apply water
    col = mix(col, water, underwater * 0.7);
    col += waterColor.rgb * shore * 0.3;
    
    // Hill shading (illumination from top-left)
    float eps = 0.01;
    float elevR = fbm((uv + vec2(eps, 0.0)) * 5.0 + t * 0.05) * elevation;
    float elevU = fbm((uv + vec2(0.0, eps)) * 5.0 + t * 0.05) * elevation;
    vec2 gradient = vec2(elevR - terrain, elevU - terrain) / eps;
    float shade = dot(normalize(vec2(-1.0, 1.0)), gradient) * 0.3;
    col *= 1.0 + shade;
    
    // Edge frame
    float frame = smoothstep(0.005, 0.0, edgeDist);
    col = mix(col, lineColor.rgb, frame * 0.7);
    
    // Index labels at major contours (simulated with tick marks along edges)
    float edgeTick = smoothstep(0.02, 0.015, edgeDist) * majorLine;
    col += lineColor.rgb * edgeTick * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
