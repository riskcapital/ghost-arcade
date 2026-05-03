/*{
    "DESCRIPTION": "Sand particles falling and accumulating at the bottom, cascading off piles and frame edges",
    "CREDIT": "LumiVision ISF Collection",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Projection Mapping"],
    "INPUTS": [
        {"NAME": "particleDensity", "TYPE": "float", "MIN": 20.0, "MAX": 100.0, "DEFAULT": 50.0},
        {"NAME": "fallSpeed", "TYPE": "float", "MIN": 0.3, "MAX": 3.0, "DEFAULT": 1.0},
        {"NAME": "pileHeight", "TYPE": "float", "MIN": 0.05, "MAX": 0.5, "DEFAULT": 0.2},
        {"NAME": "sandColor", "TYPE": "color", "DEFAULT": [0.9, 0.75, 0.4, 1.0]},
        {"NAME": "darkSand", "TYPE": "color", "DEFAULT": [0.6, 0.45, 0.2, 1.0]},
        {"NAME": "streamWidth", "TYPE": "float", "MIN": 0.01, "MAX": 0.15, "DEFAULT": 0.05},
        {"NAME": "scatter", "TYPE": "float", "MIN": 0.0, "MAX": 0.3, "DEFAULT": 0.1}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * fallSpeed;
    vec3 col = vec3(0.02, 0.015, 0.01);
    int count = int(particleDensity);
    
    // Sand pile shape at bottom
    float pileShape = pileHeight;
    // Create natural pile with peak in center
    float pileCurve = 1.0 - pow(abs(uv.x - 0.5) * 2.0, 1.5);
    float pileNoise = noise(vec2(uv.x * 20.0, 1.0)) * 0.02;
    float pileSurface = pileShape * pileCurve + pileNoise;
    
    // Side accumulation against walls
    float leftPile = smoothstep(0.15, 0.0, uv.x) * pileHeight * 0.6;
    float rightPile = smoothstep(0.85, 1.0, uv.x) * pileHeight * 0.6;
    pileSurface = max(pileSurface, max(leftPile, rightPile));
    
    // Draw pile
    if (uv.y < pileSurface) {
        float depth = (pileSurface - uv.y) / pileHeight;
        vec3 pileCol = mix(sandColor.rgb, darkSand.rgb, depth * 0.7);
        // Surface texture
        float grain = hash2(floor(uv * 200.0)) * 0.15;
        pileCol += vec3(grain * 0.1, grain * 0.08, grain * 0.03);
        // Shading from pile shape
        float shadow = smoothstep(0.0, 0.02, pileSurface - uv.y);
        pileCol *= 0.7 + shadow * 0.3;
        col = pileCol;
    }
    
    // Surface highlight
    float surfDist = abs(uv.y - pileSurface);
    col += sandColor.rgb * smoothstep(0.005, 0.0, surfDist) * 0.3;
    
    // Falling particles
    for (int i = 0; i < 100; i++) {
        if (i >= count) break;
        float id = float(i);
        float phase = hash(id * 127.1);
        float speed_var = 0.5 + hash(id * 73.3) * 0.5;
        
        float yPos = fract(-(t * speed_var * 0.2 + phase));
        
        // Particles fall in a stream from top center, scattering
        float streamCenter = 0.5 + sin(TIME * 0.3) * 0.1;
        float xOffset = (hash(id * 311.7) - 0.5) * streamWidth;
        xOffset += sin(t * 2.0 + id * 3.0) * scatter * 0.1;
        float xPos = streamCenter + xOffset;
        
        // Bounce off side edges
        xPos = clamp(xPos, 0.01, 0.99);
        
        // Only draw above pile
        if (yPos > pileSurface + 0.01) {
            float pSize = 0.003 + hash(id * 47.3) * 0.003;
            vec2 diff = uv - vec2(xPos, yPos);
            diff.x *= RENDERSIZE.x / RENDERSIZE.y;
            float dist = length(diff);
            
            float particle = smoothstep(pSize, pSize * 0.2, dist);
            float pColor = 0.7 + hash(id * 183.7) * 0.3;
            col += sandColor.rgb * particle * pColor;
        }
    }
    
    col = clamp(col, 0.0, 1.0);
    gl_FragColor = vec4(col, 1.0);
}
