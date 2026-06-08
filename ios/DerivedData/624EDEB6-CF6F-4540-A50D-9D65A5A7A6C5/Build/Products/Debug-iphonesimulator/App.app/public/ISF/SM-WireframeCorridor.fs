/*{
    "DESCRIPTION": "Wireframe perspective corridor with grid lines converging from container edges to vanishing point",
    "CREDIT": "GhostArcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Shape Map"],
    "INPUTS": [
        {"NAME": "gridDensity", "TYPE": "float", "MIN": 3.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "depthSpeed", "TYPE": "float", "MIN": 0.1, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "vanishX", "TYPE": "float", "MIN": 0.3, "MAX": 0.7, "DEFAULT": 0.5},
        {"NAME": "vanishY", "TYPE": "float", "MIN": 0.3, "MAX": 0.7, "DEFAULT": 0.5},
        {"NAME": "lineWidth", "TYPE": "float", "MIN": 0.001, "MAX": 0.008, "DEFAULT": 0.003},
        {"NAME": "gridColor", "TYPE": "color", "DEFAULT": [0.0, 0.9, 0.6, 1.0]},
        {"NAME": "accentColor", "TYPE": "color", "DEFAULT": [0.0, 0.4, 1.0, 1.0]},
        {"NAME": "scanLine", "TYPE": "bool", "DEFAULT": true},
        {"NAME": "floorCeiling", "TYPE": "bool", "DEFAULT": true}
    ]
}*/

void main() {
    vec2 uv = isf_FragNormCoord;
    float aspect = RENDERSIZE.x / RENDERSIZE.y;
    float t = TIME * depthSpeed;
    
    vec2 vanish = vec2(vanishX, vanishY);
    vec2 fromVanish = uv - vanish;
    float distFromVanish = length(fromVanish * vec2(aspect, 1.0));
    float angle = atan(fromVanish.y, fromVanish.x * aspect);
    
    vec3 col = vec3(0.005);
    
    // Radial lines from vanishing point to edges
    float radialCount = gridDensity * 2.0;
    float radialAngle = angle / 6.2832 * radialCount;
    float radialLine = abs(fract(radialAngle) - 0.5);
    float radialDist = smoothstep(lineWidth * 8.0, lineWidth * 2.0, radialLine / max(distFromVanish * 3.0, 0.1));
    col += gridColor.rgb * radialDist * 0.3;
    
    // Depth rings - rectangular, starting from container edge
    float depthRings = gridDensity;
    // Use max(abs) for rectangular distance
    float rectDist = max(abs(fromVanish.x) / max(vanishX, 1.0 - vanishX), abs(fromVanish.y) / max(vanishY, 1.0 - vanishY));
    
    // Animated depth rings moving outward from center
    float ringPhase = fract(-t * 0.3);
    float ringCoord = rectDist * depthRings + ringPhase * 1.0;
    float ringLine = abs(fract(ringCoord) - 0.5);
    float ringWidth = lineWidth * (1.0 + rectDist * 2.0);
    float ring = smoothstep(ringWidth * 3.0, ringWidth * 0.5, ringLine);
    float ringFade = 0.3 + rectDist * 0.7;
    col += gridColor.rgb * ring * ringFade * 0.5;
    
    // Floor and ceiling perspective grid
    if (floorCeiling) {
        // Horizontal perspective lines (floor/ceiling)
        float floorY = uv.y;
        float ceilY = 1.0 - uv.y;
        
        // Floor grid
        if (uv.y < vanishY - 0.05) {
            float depth = (vanishY - uv.y) / vanishY;
            float perspZ = 1.0 / max(depth, 0.01);
            float gridX = fract((uv.x - vanishX) * perspZ * gridDensity * 0.3 + 0.5);
            float gridZ = fract(perspZ * 0.5 + t * 0.5);
            float lineX = smoothstep(lineWidth * perspZ, lineWidth * perspZ * 0.2, abs(gridX - 0.5));
            float lineZ = smoothstep(lineWidth * perspZ, lineWidth * perspZ * 0.2, abs(gridZ - 0.5));
            float floorGrid = max(lineX, lineZ) * depth;
            col += accentColor.rgb * floorGrid * 0.25;
        }
        
        // Ceiling grid
        if (uv.y > vanishY + 0.05) {
            float depth = (uv.y - vanishY) / (1.0 - vanishY);
            float perspZ = 1.0 / max(depth, 0.01);
            float gridX = fract((uv.x - vanishX) * perspZ * gridDensity * 0.3 + 0.5);
            float gridZ = fract(perspZ * 0.5 - t * 0.5);
            float lineX = smoothstep(lineWidth * perspZ, lineWidth * perspZ * 0.2, abs(gridX - 0.5));
            float lineZ = smoothstep(lineWidth * perspZ, lineWidth * perspZ * 0.2, abs(gridZ - 0.5));
            float ceilGrid = max(lineX, lineZ) * depth;
            col += accentColor.rgb * ceilGrid * 0.2;
        }
    }
    
    // Scan line traveling from vanish to edges
    if (scanLine) {
        float scanDist = fract(t * 0.4);
        float scanRing = smoothstep(0.02, 0.0, abs(rectDist - scanDist));
        col += gridColor.rgb * scanRing * 0.6;
        // Scan brightens everything it passes
        float scanTrail = smoothstep(scanDist, scanDist - 0.1, rectDist) * smoothstep(scanDist - 0.15, scanDist - 0.1, rectDist);
        col += gridColor.rgb * scanTrail * 0.1;
    }
    
    // Vanishing point glow
    float vpGlow = 0.02 / (distFromVanish + 0.01);
    col += gridColor.rgb * clamp(vpGlow * 0.05, 0.0, 0.15);
    
    // Container edge frame
    float eDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    col += gridColor.rgb * smoothstep(0.008, 0.001, eDist) * 0.4;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
