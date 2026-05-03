/*{
    "DESCRIPTION": "Flat brick facade where individual bricks detach from the surface and tumble away revealing void",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "collapseProgress", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5},
        {"NAME": "brickColumns", "TYPE": "float", "MIN": 4.0, "MAX": 20.0, "DEFAULT": 10.0},
        {"NAME": "brickRows", "TYPE": "float", "MIN": 4.0, "MAX": 20.0, "DEFAULT": 14.0},
        {"NAME": "facadeColor", "TYPE": "color", "DEFAULT": [0.85, 0.82, 0.78, 1.0]},
        {"NAME": "mortarColor", "TYPE": "color", "DEFAULT": [0.55, 0.52, 0.48, 1.0]},
        {"NAME": "voidColor", "TYPE": "color", "DEFAULT": [0.02, 0.02, 0.05, 1.0]},
        {"NAME": "animateAuto", "TYPE": "bool", "DEFAULT": true},
        {"NAME": "collapseStyle", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5}
    ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float progress = animateAuto ? (sin(TIME * 0.4) * 0.5 + 0.5) : collapseProgress;
    
    // Brick grid with offset rows
    float row = floor(uv.y * brickRows);
    float rowOffset = mod(row, 2.0) * 0.5 / brickColumns;
    float col_idx = floor((uv.x + rowOffset) * brickColumns);
    
    vec2 brickUV = vec2(
        fract((uv.x + rowOffset) * brickColumns),
        fract(uv.y * brickRows)
    );
    
    vec2 brickID = vec2(col_idx, row);
    float brickHash = hash(brickID);
    float brickHash2 = hash(brickID + vec2(100.0));
    float brickHash3 = hash(brickID + vec2(200.0));
    
    // Determine when this brick falls
    // Mix between center-out and random based on collapseStyle
    vec2 brickCenter = (brickID + 0.5) / vec2(brickColumns, brickRows);
    float centerDist = length(brickCenter - vec2(0.5));
    float edgeDist = min(min(brickCenter.x, 1.0 - brickCenter.x), min(brickCenter.y, 1.0 - brickCenter.y));
    
    float fallOrder = mix(1.0 - edgeDist * 2.0, brickHash, collapseStyle);
    fallOrder = clamp(fallOrder, 0.0, 1.0);
    
    float fallThreshold = fallOrder * 0.8 + brickHash * 0.2;
    float isFalling = smoothstep(fallThreshold - 0.02, fallThreshold, progress);
    float fallTime = max(progress - fallThreshold, 0.0) * 4.0;
    
    // Mortar lines
    float mortarW = 0.06;
    float isMortar = (brickUV.x < mortarW || brickUV.x > 1.0 - mortarW || 
                      brickUV.y < mortarW || brickUV.y > 1.0 - mortarW) ? 1.0 : 0.0;
    
    // Build color
    vec3 finalCol = voidColor.rgb;
    
    if (isFalling < 0.5) {
        // Brick is still in place
        vec3 bCol = facadeColor.rgb * (0.9 + brickHash * 0.1);
        // Subtle variation per brick
        bCol += vec3(brickHash2 - 0.5) * 0.04;
        
        // Add slight weathering
        float weather = hash(brickID * 3.7) * 0.08;
        bCol -= vec3(weather);
        
        // Shadow near edges that are about to fall
        float neighborFall = 0.0;
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) continue;
                vec2 nID = brickID + vec2(float(dx), float(dy));
                float nHash = hash(nID);
                vec2 nCenter = (nID + 0.5) / vec2(brickColumns, brickRows);
                float nEdgeDist = min(min(nCenter.x, 1.0 - nCenter.x), min(nCenter.y, 1.0 - nCenter.y));
                float nOrder = mix(1.0 - nEdgeDist * 2.0, nHash, collapseStyle);
                float nThresh = nOrder * 0.8 + nHash * 0.2;
                neighborFall += smoothstep(nThresh - 0.02, nThresh, progress);
            }
        }
        // Darken edges near missing neighbors
        float edgeShadow = neighborFall * 0.03;
        float edgeProx = min(min(brickUV.x, 1.0 - brickUV.x), min(brickUV.y, 1.0 - brickUV.y));
        bCol -= vec3(edgeShadow * smoothstep(0.2, 0.0, edgeProx));
        
        finalCol = mix(bCol, mortarColor.rgb, isMortar);
        
        // Pre-crack stress lines on bricks about to fall
        float stress = smoothstep(fallThreshold - 0.15, fallThreshold - 0.02, progress);
        float crackLine = smoothstep(0.01, 0.0, abs(brickUV.x - 0.3 - brickHash2 * 0.4)) * stress;
        crackLine += smoothstep(0.01, 0.0, abs(brickUV.y - 0.2 - brickHash3 * 0.6)) * stress * 0.5;
        finalCol -= vec3(crackLine * 0.3);
    } else {
        // Falling brick - render at offset position
        float gravity = fallTime * fallTime * 0.5;
        float rotAngle = fallTime * (brickHash2 - 0.5) * 3.0;
        float lateralDrift = fallTime * (brickHash3 - 0.5) * 0.3;
        
        // Check if pixel is within the falling brick's new position
        vec2 brickWorldPos = (brickID + brickUV) / vec2(brickColumns, brickRows);
        vec2 origCenter = (brickID + 0.5) / vec2(brickColumns, brickRows);
        vec2 fallOffset = vec2(lateralDrift, -gravity * 0.3);
        vec2 fallenCenter = origCenter + fallOffset;
        
        vec2 toPixel = uv - fallenCenter;
        float ca = cos(rotAngle);
        float sa = sin(rotAngle);
        vec2 rotPixel = vec2(toPixel.x * ca + toPixel.y * sa, -toPixel.x * sa + toPixel.y * ca);
        
        vec2 bSize = vec2(0.5 / brickColumns, 0.5 / brickRows);
        float shrink = max(1.0 - fallTime * 0.15, 0.0);
        
        if (abs(rotPixel.x) < bSize.x * shrink && abs(rotPixel.y) < bSize.y * shrink && gravity < 2.0) {
            vec3 fallCol = facadeColor.rgb * (0.7 + brickHash * 0.1);
            // Shade based on rotation
            fallCol *= 0.6 + 0.4 * max(cos(rotAngle), 0.0);
            float alpha = max(1.0 - fallTime * 0.3, 0.0);
            finalCol = mix(finalCol, fallCol, alpha);
        }
    }
    
    // Container edge: subtle shadow frame
    float frameDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float frameLine = smoothstep(0.004, 0.001, frameDist);
    finalCol = mix(finalCol, mortarColor.rgb * 0.5, frameLine * 0.5);
    
    finalCol = clamp(finalCol, 0.0, 1.0);
    gl_FragColor = vec4(finalCol, 1.0);
}
