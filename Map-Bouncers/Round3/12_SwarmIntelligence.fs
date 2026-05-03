/*{
    "DESCRIPTION": "Swarm Intelligence - A flock of boids school through the shape, banking and splitting at edges",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator", "Shape Reactive"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "boidCount", "TYPE": "float", "DEFAULT": 50.0, "MIN": 10.0, "MAX": 100.0},
        {"NAME": "boidSize", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.0},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "cohesion", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "boidColor", "TYPE": "color", "DEFAULT": [0.3, 0.8, 1.0, 1.0]},
        {"NAME": "trailColor", "TYPE": "color", "DEFAULT": [0.1, 0.3, 0.5, 1.0]},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.2, 0.5, 0.8, 1.0]},
        {"NAME": "edgeAvoidColor", "TYPE": "color", "DEFAULT": [1.0, 0.4, 0.2, 1.0]},
        {"NAME": "connectionLines", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Deterministic boid position based on time
vec2 boidPos(float id, float t) {
    float seed = id * 17.31;
    
    // Complex Lissajous-like path that stays in bounds
    float fx = 0.1 + 0.8 * (0.5 + 0.5 * sin(t * (0.3 + hash(seed) * 0.4) + hash(seed + 1.0) * 6.28));
    float fy = 0.1 + 0.8 * (0.5 + 0.5 * sin(t * (0.25 + hash(seed + 2.0) * 0.35) + hash(seed + 3.0) * 6.28));
    
    // Flock center influence
    float flockPhase = t * 0.2;
    float flockX = 0.5 + sin(flockPhase) * 0.25;
    float flockY = 0.5 + cos(flockPhase * 0.7) * 0.25;
    
    fx = mix(fx, flockX, cohesion * 0.5);
    fy = mix(fy, flockY, cohesion * 0.5);
    
    // Sub-flock grouping
    float group = mod(id, 3.0);
    float gOffset = group * 0.1;
    fx += sin(t * 0.5 + group * 2.0) * gOffset;
    fy += cos(t * 0.4 + group * 2.5) * gOffset;
    
    return clamp(vec2(fx, fy), vec2(0.02), vec2(0.98));
}

vec2 boidVel(float id, float t) {
    vec2 p0 = boidPos(id, t - 0.01);
    vec2 p1 = boidPos(id, t + 0.01);
    return normalize(p1 - p0);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    float t = TIME * speed;
    
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    
    vec3 col = vec3(0.01, 0.015, 0.025);
    
    // Connection lines between nearby boids
    float connections = 0.0;
    
    // Draw boids
    float totalNearby = 0.0;
    for (int i = 0; i < 100; i++) {
        if (float(i) >= boidCount) break;
        float fi = float(i);
        
        vec2 pos = boidPos(fi, t);
        vec2 vel = boidVel(fi, t);
        
        // Distance to this boid
        float d = length(uv - pos);
        
        // Boid shape (triangle pointing in velocity direction)
        vec2 toUv = uv - pos;
        float along = dot(toUv, vel);
        float perp = abs(dot(toUv, vec2(-vel.y, vel.x)));
        
        float bSize = boidSize * 0.012;
        float bodyLen = bSize * 2.0;
        float bodyWidth = bSize * (1.0 - along / bodyLen * 0.5);
        
        float body = 0.0;
        if (along > -bSize && along < bodyLen) {
            float w = bodyWidth * (1.0 - along / bodyLen);
            body = smoothstep(w, w * 0.3, perp);
        }
        
        // Edge proximity warning color
        float boidEdgeDist = min(min(pos.x, 1.0 - pos.x), min(pos.y, 1.0 - pos.y));
        vec3 bCol = mix(boidColor.rgb, edgeAvoidColor.rgb, smoothstep(0.1, 0.02, boidEdgeDist));
        
        col += bCol * body * 0.8;
        
        // Boid glow
        float glow = exp(-d * d * 800.0) * 0.15;
        col += glowColor.rgb * glow;
        
        // Trail
        if (trailLength > 0.0) {
            for (int tt = 1; tt < 8; tt++) {
                float ftt = float(tt);
                float trailT = t - ftt * 0.03 * trailLength;
                vec2 trailPos = boidPos(fi, trailT);
                float td = length(uv - trailPos);
                float trail = exp(-td * td * 2000.0) * (1.0 - ftt / 8.0);
                col += trailColor.rgb * trail * trailLength * 0.3;
            }
        }
        
        // Connection lines to nearby boids
        if (connectionLines > 0.0 && fi < 30.0) {
            for (int j = 0; j < 30; j++) {
                float fj = float(j);
                if (fj <= fi || fj >= boidCount) continue;
                vec2 otherPos = boidPos(fj, t);
                float boidDist = length(pos - otherPos);
                if (boidDist < 0.15) {
                    // Check if pixel is near the line between boids
                    vec2 pa = uv - pos;
                    vec2 ba = otherPos - pos;
                    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                    float lineDist = length(pa - ba * h);
                    float line = exp(-lineDist * lineDist * 50000.0);
                    float fade = 1.0 - boidDist / 0.15;
                    connections += line * fade * connectionLines * 0.1;
                }
            }
        }
    }
    
    col += glowColor.rgb * min(connections, 0.5);
    
    // Edge proximity field
    float edgeField = exp(-edgeDist * 12.0) * 0.08;
    col += edgeAvoidColor.rgb * edgeField;
    
    gl_FragColor = vec4(col, 1.0);
}
