/*{
    "DESCRIPTION": "Raindrops falling from top, splashing on the bottom edge and accumulating",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "rainDensity", "TYPE": "float", "MIN": 5.0, "MAX": 40.0, "DEFAULT": 20.0},
        {"NAME": "fallSpeed", "TYPE": "float", "MIN": 0.5, "MAX": 4.0, "DEFAULT": 2.0},
        {"NAME": "dropLength", "TYPE": "float", "MIN": 0.02, "MAX": 0.15, "DEFAULT": 0.06},
        {"NAME": "splashSize", "TYPE": "float", "MIN": 0.01, "MAX": 0.08, "DEFAULT": 0.03},
        {"NAME": "rainColor", "TYPE": "color", "DEFAULT": [0.4, 0.6, 1.0, 1.0]},
        {"NAME": "puddleHeight", "TYPE": "float", "MIN": 0.0, "MAX": 0.15, "DEFAULT": 0.04},
        {"NAME": "windAngle", "TYPE": "float", "MIN": -0.3, "MAX": 0.3, "DEFAULT": 0.05}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * fallSpeed;
    vec3 col = vec3(0.01, 0.01, 0.02);
    int density = int(rainDensity);
    
    // Rain streaks
    for (int i = 0; i < 40; i++) {
        if (i >= density) break;
        float id = float(i);
        float x = hash(id * 127.1);
        float speed_var = 0.7 + hash(id * 311.7) * 0.6;
        float phase = hash(id * 73.3);
        
        float yPos = fract(-(t * speed_var + phase));
        float xPos = x + windAngle * (1.0 - yPos);
        xPos = fract(xPos);
        
        vec2 dropTop = vec2(xPos, yPos + dropLength * speed_var);
        vec2 dropBot = vec2(xPos, yPos);
        
        // Simple distance to line segment
        vec2 d = dropTop - dropBot;
        float param = clamp(dot(uv - dropBot, d) / dot(d, d), 0.0, 1.0);
        vec2 closest = dropBot + param * d;
        float dist = length(uv - closest);
        
        float brightness = smoothstep(0.003, 0.001, dist) * speed_var;
        col += rainColor.rgb * brightness * 0.5;
        
        // Splash at bottom
        if (yPos < splashSize * 2.0) {
            float splashPhase = 1.0 - yPos / (splashSize * 2.0);
            float splashRadius = splashSize * splashPhase;
            float splashDist = length(vec2(uv.x - xPos, uv.y - puddleHeight));
            float ring = abs(splashDist - splashRadius);
            float splash = smoothstep(0.004, 0.001, ring) * (1.0 - splashPhase);
            col += rainColor.rgb * splash * 0.6;
        }
    }
    
    // Puddle at bottom
    float puddleSurface = puddleHeight + sin(uv.x * 30.0 + TIME * 3.0) * 0.003 + sin(uv.x * 50.0 - TIME * 2.0) * 0.002;
    if (uv.y < puddleSurface) {
        float depth = (puddleSurface - uv.y) / puddleHeight;
        vec3 puddleCol = rainColor.rgb * 0.3 * (1.0 + depth * 0.5);
        float caustic = sin(uv.x * 40.0 + TIME * 2.0) * sin(uv.y * 40.0 + TIME * 1.5) * 0.1;
        puddleCol += vec3(caustic * 0.3, caustic * 0.4, caustic * 0.5);
        col += puddleCol;
    }
    
    // Surface highlight
    float surfDist = abs(uv.y - puddleSurface);
    col += rainColor.rgb * smoothstep(0.005, 0.0, surfDist) * 0.4;
    
    // Side wall wetness
    float sideWet = smoothstep(0.05, 0.0, uv.x) + smoothstep(0.95, 1.0, uv.x);
    sideWet *= smoothstep(puddleHeight + 0.2, puddleHeight, uv.y);
    col += rainColor.rgb * sideWet * 0.1;
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
