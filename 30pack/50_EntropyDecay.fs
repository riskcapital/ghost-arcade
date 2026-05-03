/*{
    "DESCRIPTION": "Entropy decay - ordered geometry dissolving into noise and back",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "entropy", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Disorder Level"},
        {"NAME": "geometryType", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Hex/Square Grid"},
        {"NAME": "gridScale", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 20.0},
        {"NAME": "noiseScale", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 15.0},
        {"NAME": "dissolvePattern", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Radial/Random"},
        {"NAME": "orderColor", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0, "LABEL": "Order Hue"},
        {"NAME": "chaosColor", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0, "LABEL": "Chaos Hue"},
        {"NAME": "autoAnimate", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 1.0, "LABEL": "Auto Cycle"},
        {"NAME": "borderGlow", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "Transition Edge Glow"}
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

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
    return v;
}

// Hexagonal grid
vec2 hexGrid(vec2 p) {
    vec2 q = vec2(p.x * 2.0 / sqrt(3.0), p.y + p.x / sqrt(3.0));
    vec2 pi = floor(q);
    vec2 pf = fract(q);
    float v = mod(pi.x + pi.y, 3.0);
    float ca = step(1.0, v);
    float cb = step(2.0, v);
    vec2 ma = step(pf.xy, pf.yx);
    return pi + ca - cb * ma;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Auto-animate entropy
    float e = entropy;
    if (autoAnimate > 0.5) {
        e = 0.5 + 0.5 * sin(t * 0.5);
    }
    
    float d = length(uv);
    
    // Dissolve threshold
    float dissolveThresh;
    if (dissolvePattern < 0.5) {
        // Radial dissolve
        dissolveThresh = d * 2.0;
    } else {
        // Random dissolve
        dissolveThresh = fbm(uv * noiseScale + t * 0.2);
    }
    dissolveThresh = mix(dissolveThresh, fbm(uv * noiseScale + t * 0.2), dissolvePattern);
    
    float isOrder = step(e, dissolveThresh);
    float transitionEdge = 1.0 - abs(dissolveThresh - e) * 10.0;
    transitionEdge = max(transitionEdge, 0.0);
    
    vec3 col = vec3(0.0);
    
    // Ordered geometry
    vec2 gridP = uv * gridScale;
    vec2 cellId;
    vec2 cellFract;
    
    if (geometryType < 0.5) {
        cellId = hexGrid(gridP);
        cellFract = fract(gridP) - 0.5;
    } else {
        cellId = floor(gridP);
        cellFract = fract(gridP) - 0.5;
    }
    
    float cellHash = hash(cellId);
    
    // Ordered pattern: clean geometric shapes
    float shape;
    if (geometryType < 0.5) {
        shape = length(cellFract) - 0.3;
    } else {
        shape = max(abs(cellFract.x), abs(cellFract.y)) - 0.35;
    }
    
    float orderPattern = smoothstep(0.02, 0.0, abs(shape));
    orderPattern += smoothstep(0.01, 0.0, abs(shape + 0.1)) * 0.3;
    
    // Order color
    vec3 ordCol = mix(vec3(0.3, 0.5, 0.9), vec3(0.5, 0.4, 0.8), orderColor);
    ordCol *= (0.5 + 0.5 * cellHash);
    
    // Chaos pattern: turbulent noise
    float chaosPattern = fbm(uv * noiseScale + t * 0.3);
    chaosPattern += fbm(uv * noiseScale * 2.0 + t * 0.5) * 0.5;
    chaosPattern = pow(chaosPattern, 1.5);
    
    vec3 chsCol = mix(vec3(0.5, 0.2, 0.4), vec3(0.3, 0.3, 0.7), chaosColor);
    
    // Blend based on entropy
    float localEntropy = smoothstep(e - 0.1, e + 0.1, dissolveThresh);
    
    col += ordCol * orderPattern * localEntropy;
    col += chsCol * chaosPattern * (1.0 - localEntropy) * 0.5;
    
    // Transition edge glow
    col += vec3(0.6, 0.5, 0.9) * transitionEdge * borderGlow;
    
    // Partially dissolved geometry (geometry breaking apart)
    float breakup = noise(uv * 20.0 + t);
    float partialOrder = orderPattern * smoothstep(e - 0.2, e, breakup);
    col += ordCol * partialOrder * 0.3 * (1.0 - localEntropy);
    
    gl_FragColor = vec4(col, 1.0);
}
