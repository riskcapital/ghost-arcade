/*{
    "DESCRIPTION": "Pressure Map - Color and intensity shift based on edge proximity, narrow sections glow hot",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "sensitivity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 3.0},
        {"NAME": "contourLines", "TYPE": "float", "DEFAULT": 15.0, "MIN": 0.0, "MAX": 30.0},
        {"NAME": "stressWave", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "noiseAmount", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "hotColor", "TYPE": "color", "DEFAULT": [1.0, 0.2, 0.05, 1.0]},
        {"NAME": "warmColor", "TYPE": "color", "DEFAULT": [1.0, 0.8, 0.0, 1.0]},
        {"NAME": "coolColor", "TYPE": "color", "DEFAULT": [0.0, 0.3, 1.0, 1.0]},
        {"NAME": "coldColor", "TYPE": "color", "DEFAULT": [0.0, 0.05, 0.2, 1.0]},
        {"NAME": "gridOverlay", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0}
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
    
    // Distance field from all edges
    float edgeL = uv.x;
    float edgeR = 1.0 - uv.x;
    float edgeB = uv.y;
    float edgeT = 1.0 - uv.y;
    float edgeDist = min(min(edgeL, edgeR), min(edgeB, edgeT));
    
    // Normalized pressure (0 at edges = max pressure, 1 at center = min pressure)
    float maxDist = 0.5;
    float pressure = edgeDist / maxDist;
    pressure = pow(pressure, 1.0 / sensitivity);
    
    // Animated stress waves
    float wave = sin(edgeDist * 40.0 - t * 5.0) * stressWave * 0.1;
    pressure += wave;
    
    // Noise perturbation
    float stressNoise = fbm(uv * 8.0 + t * 0.2) * noiseAmount * 0.2;
    pressure += stressNoise;
    
    pressure = clamp(pressure, 0.0, 1.0);
    
    // Thermal colormap: hot (edges) -> warm -> cool -> cold (center)
    vec3 col;
    if (pressure < 0.25) {
        col = mix(hotColor.rgb, warmColor.rgb, pressure / 0.25);
    } else if (pressure < 0.5) {
        col = mix(warmColor.rgb, coolColor.rgb, (pressure - 0.25) / 0.25);
    } else if (pressure < 0.75) {
        col = mix(coolColor.rgb, coldColor.rgb, (pressure - 0.5) / 0.25);
    } else {
        col = mix(coldColor.rgb, coldColor.rgb * 0.5, (pressure - 0.75) / 0.25);
    }
    
    // Contour lines (iso-pressure curves)
    if (contourLines > 0.0) {
        float contour = fract(edgeDist * contourLines);
        float contourLine = smoothstep(0.02, 0.0, abs(contour - 0.5) - 0.47);
        col = mix(col, vec3(1.0), contourLine * 0.3);
    }
    
    // Corner stress concentration (corners have highest stress)
    vec2 corners[4];
    corners[0] = vec2(0.0, 0.0);
    corners[1] = vec2(1.0, 0.0);
    corners[2] = vec2(1.0, 1.0);
    corners[3] = vec2(0.0, 1.0);
    
    for (int i = 0; i < 4; i++) {
        float cd = length(uv - corners[i]);
        float cornerStress = exp(-cd * cd * 30.0) * 0.4;
        float pulse = 0.7 + 0.3 * sin(t * 4.0 + float(i) * 1.57);
        col += hotColor.rgb * cornerStress * pulse;
    }
    
    // Directional stress vectors
    vec2 stressDir = vec2(edgeR - edgeL, edgeT - edgeB);
    float stressMag = length(stressDir);
    
    // Stress flow lines
    float flowAngle = atan(stressDir.y, stressDir.x);
    float flowLines = sin(flowAngle * 8.0 + fbm(uv * 5.0) * 3.0) * 0.5 + 0.5;
    flowLines = smoothstep(0.4, 0.6, flowLines);
    col += vec3(flowLines * 0.05) * (1.0 - pressure);
    
    // Grid overlay
    if (gridOverlay > 0.0) {
        float gridScale = 20.0;
        vec2 grid = abs(fract(uv * gridScale) - 0.5);
        float gridLine = smoothstep(0.48, 0.5, max(grid.x, grid.y));
        
        // Grid distortion under stress
        float distortion = (1.0 - pressure) * 0.3;
        vec2 distorted = uv + stressDir * distortion * 0.01;
        vec2 dGrid = abs(fract(distorted * gridScale) - 0.5);
        float dGridLine = smoothstep(0.48, 0.5, max(dGrid.x, dGrid.y));
        
        col = mix(col, col + vec3(0.1), dGridLine * gridOverlay * 0.5);
    }
    
    // Pulsing edge warning
    float edgeWarn = step(edgeDist, 0.03);
    float warnPulse = sin(t * 8.0) * 0.5 + 0.5;
    col = mix(col, hotColor.rgb * 1.5, edgeWarn * warnPulse * 0.3);
    
    // Center readout crosshair
    float ch = smoothstep(0.002, 0.0, abs(uv.x - 0.5)) * step(abs(uv.y - 0.5), 0.03);
    ch += smoothstep(0.002, 0.0, abs(uv.y - 0.5)) * step(abs(uv.x - 0.5), 0.03);
    col += vec3(ch * 0.15);
    
    gl_FragColor = vec4(col, 1.0);
}
