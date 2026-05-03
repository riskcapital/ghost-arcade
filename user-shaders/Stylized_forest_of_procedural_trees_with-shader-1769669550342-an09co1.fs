/*{
  "DESCRIPTION": "Stylized forest of procedural trees with gentle swaying animation",
  "CREDIT": "AI Generated",
  "CATEGORIES": ["generator", "nature"],
  "INPUTS": [
    { "NAME": "treeCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 2.0, "MAX": 10.0, "LABEL": "Tree Density" },
    { "NAME": "windStrength", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Wind Strength" },
    { "NAME": "trunkColor", "TYPE": "color", "DEFAULT": [0.35, 0.2, 0.1, 1.0], "LABEL": "Trunk Color" },
    { "NAME": "leafColor", "TYPE": "color", "DEFAULT": [0.2, 0.6, 0.15, 1.0], "LABEL": "Leaf Color" },
    { "NAME": "skyBrightness", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.2, "MAX": 1.0, "LABEL": "Sky Brightness" }
  ]
}*/

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdTriangle(vec2 p, vec2 a, vec2 b, vec2 c) {
    vec2 e0 = b - a;
    vec2 e1 = c - b;
    vec2 e2 = a - c;
    vec2 v0 = p - a;
    vec2 v1 = p - b;
    vec2 v2 = p - c;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

float drawTree(vec2 uv, vec2 pos, float height, float sway, float seed) {
    vec2 p = uv - pos;
    
    float swayAmount = sway * sin(TIME * 1.5 + seed * 6.28) * p.y * 0.5;
    p.x -= swayAmount;
    
    float trunkWidth = 0.015 + height * 0.01;
    float trunkHeight = height * 0.35;
    float trunk = sdBox(p - vec2(0.0, trunkHeight * 0.5), vec2(trunkWidth, trunkHeight));
    
    float canopy = 1.0;
    float canopyBase = trunkHeight * 0.7;
    float layerHeight = height * 0.25;
    
    for(int i = 0; i < 3; i++) {
        float fi = float(i);
        float layerY = canopyBase + fi * layerHeight * 0.6;
        float layerWidth = (0.12 + height * 0.05) * (1.0 - fi * 0.25);
        float tri = sdTriangle(p, 
            vec2(-layerWidth, layerY),
            vec2(0.0, layerY + layerHeight * (1.0 - fi * 0.15)),
            vec2(layerWidth, layerY));
        canopy = min(canopy, tri);
    }
    
    return min(trunk, canopy);
}

float isCanopy(vec2 uv, vec2 pos, float height, float sway, float seed) {
    vec2 p = uv - pos;
    float swayAmount = sway * sin(TIME * 1.5 + seed * 6.28) * p.y * 0.5;
    p.x -= swayAmount;
    
    float canopy = 1.0;
    float trunkHeight = height * 0.35;
    float canopyBase = trunkHeight * 0.7;
    float layerHeight = height * 0.25;
    
    for(int i = 0; i < 3; i++) {
        float fi = float(i);
        float layerY = canopyBase + fi * layerHeight * 0.6;
        float layerWidth = (0.12 + height * 0.05) * (1.0 - fi * 0.25);
        float tri = sdTriangle(p, 
            vec2(-layerWidth, layerY),
            vec2(0.0, layerY + layerHeight * (1.0 - fi * 0.15)),
            vec2(layerWidth, layerY));
        canopy = min(canopy, tri);
    }
    
    return canopy;
}

void main() {
    vec2 uv = isf_FragNormCoord;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y;
    
    vec3 skyTop = vec3(0.4, 0.6, 0.9) * skyBrightness;
    vec3 skyBottom = vec3(0.7, 0.85, 1.0) * skyBrightness;
    vec3 col = mix(skyBottom, skyTop, uv.y);
    
    vec3 groundColor = vec3(0.25, 0.45, 0.2);
    float groundLine = 0.08 + 0.02 * sin(uv.x * 10.0);
    col = mix(groundColor, col, smoothstep(groundLine - 0.02, groundLine + 0.02, uv.y));
    
    int numTrees = int(treeCount);
    
    for(int i = 0; i < 10; i++) {
        if(i >= numTrees) break;
        
        float fi = float(i);
        float seed = hash(fi * 127.1);
        float xPos = 0.1 + fi * (1.4 / treeCount) + (seed - 0.5) * 0.15;
        float height = 0.25 + seed * 0.2;
        float depth = hash(fi * 311.7);
        
        vec2 treePos = vec2(xPos, groundLine);
        float tree = drawTree(uv, treePos, height, windStrength, seed);
        float canopy = isCanopy(uv, treePos, height, windStrength, seed);
        
        if(tree < 0.002) {
            float depthShade = 0.7 + depth * 0.3;
            if(canopy < 0.002) {
                vec3 leafShade = leafColor.rgb * depthShade;
                leafShade *= 0.8 + 0.2 * sin(uv.y * 50.0 + seed * 10.0);
                col = leafShade;
            } else {
                col = trunkColor.rgb * depthShade;
            }
        }
    }
    
    gl_FragColor = vec4(col, 1.0);
}