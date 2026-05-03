/*{
    "DESCRIPTION": "Tensor field - flow visualization with directional streamlines",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "fieldScale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 8.0},
        {"NAME": "lineLength", "TYPE": "float", "DEFAULT": 20.0, "MIN": 5.0, "MAX": 50.0, "LABEL": "Streamline Steps"},
        {"NAME": "lineDensity", "TYPE": "float", "DEFAULT": 15.0, "MIN": 5.0, "MAX": 30.0},
        {"NAME": "lineOpacity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "singularityCount", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.0, "MAX": 6.0},
        {"NAME": "fieldType", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Curl/Divergence"},
        {"NAME": "noiseInfluence", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "arrowheads", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Show Direction"},
        {"NAME": "colorByMagnitude", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

vec2 field(vec2 p, float t) {
    vec2 v = vec2(0.0);
    
    // Singularities
    for (float i = 0.0; i < 6.0; i++) {
        if (i >= singularityCount) break;
        float a = i * PI * 2.0 / singularityCount + t * 0.2;
        float r = 0.2 + 0.1 * sin(t * 0.3 + i);
        vec2 sp = r * vec2(cos(a), sin(a));
        vec2 dp = p - sp;
        float d2 = dot(dp, dp) + 0.01;
        
        float charge = mod(i, 2.0) < 1.0 ? 1.0 : -1.0;
        
        // Mix of curl (rotation) and divergence (source/sink)
        vec2 curl = vec2(-dp.y, dp.x) / d2;
        vec2 div = dp / d2 * charge;
        
        v += mix(div, curl, fieldType) * 0.05;
    }
    
    // Noise perturbation
    float n1 = noise(p * fieldScale + t * 0.1);
    float n2 = noise(p * fieldScale + vec2(5.2, 1.3) + t * 0.1);
    v += (vec2(n1, n2) - 0.5) * noiseInfluence * 0.2;
    
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    vec3 col = vec3(0.02, 0.02, 0.04);
    
    // Grid of seed points for streamlines
    vec2 grid = uv * lineDensity;
    vec2 cellId = floor(grid);
    vec2 cellFract = fract(grid);
    
    // For each nearby cell
    for (float cy = -1.0; cy <= 1.0; cy++) {
        for (float cx = -1.0; cx <= 1.0; cx++) {
            vec2 neighbor = cellId + vec2(cx, cy);
            
            // Seed point with jitter
            vec2 seedJitter = vec2(hash(neighbor), hash(neighbor + 100.0)) * 0.5;
            vec2 seedPos = (neighbor + 0.25 + seedJitter * 0.5) / lineDensity - 0.5 * RENDERSIZE.xy / RENDERSIZE.y + 
                           (0.5 * RENDERSIZE.xy / RENDERSIZE.y);
            seedPos = (neighbor + 0.25 + seedJitter * 0.5) / lineDensity;
            seedPos = seedPos / lineDensity * 2.0 - 1.0;
            // Simpler: just convert back to UV space
            seedPos = (neighbor + seedJitter) / lineDensity - vec2(0.5 * RENDERSIZE.x / RENDERSIZE.y, 0.5);
            
            // Trace streamline
            vec2 pos = seedPos;
            float totalMag = 0.0;
            
            for (float step = 0.0; step < 50.0; step++) {
                if (step >= lineLength) break;
                
                vec2 v = field(pos, t);
                float mag = length(v);
                totalMag += mag;
                
                vec2 nextPos = pos + normalize(v + 0.0001) * 0.005;
                
                // Distance from this line segment to pixel
                vec2 pa = uv - pos;
                vec2 ba = nextPos - pos;
                float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                float dist = length(pa - ba * h);
                
                float fade = 1.0 - step / lineLength;
                float glow = 0.001 / (dist + 0.002) * fade * lineOpacity;
                
                // Color by magnitude
                vec3 lineCol = mix(
                    vec3(0.2, 0.3, 0.7),
                    vec3(0.7, 0.5, 1.0),
                    mag * 10.0 * colorByMagnitude
                );
                
                col += lineCol * glow * 0.03;
                
                // Arrowhead markers at intervals
                if (arrowheads > 0.0 && mod(step, 5.0) < 1.0) {
                    float ad = length(uv - pos);
                    col += vec3(0.5, 0.6, 0.9) * arrowheads * 0.0005 / (ad * ad + 0.0002) * fade;
                }
                
                pos = nextPos;
            }
        }
    }
    
    // Singularity markers
    for (float i = 0.0; i < 6.0; i++) {
        if (i >= singularityCount) break;
        float a = i * PI * 2.0 / singularityCount + t * 0.2;
        float r = 0.2 + 0.1 * sin(t * 0.3 + i);
        vec2 sp = r * vec2(cos(a), sin(a));
        float sd = length(uv - sp);
        
        vec3 sCol = mod(i, 2.0) < 1.0 ? vec3(0.8, 0.5, 0.3) : vec3(0.3, 0.5, 0.8);
        col += sCol * 0.005 / (sd * sd + 0.001);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
