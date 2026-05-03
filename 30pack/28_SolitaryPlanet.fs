/*{
    "DESCRIPTION": "Solitary dark planet floating in deep space",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "planetSize", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.05, "MAX": 0.3},
        {"NAME": "atmosphere", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Offset planet slightly
    vec2 center = vec2(-0.05, 0.05);
    float d = length(uv - center);
    
    vec3 col = vec3(0.01, 0.01, 0.03); // Deep space
    
    // Background stars
    vec2 starUV = uv * 40.0;
    vec2 starId = floor(starUV);
    float star = hash(starId);
    if (star > 0.97) {
        float sd = length(fract(starUV) - 0.5);
        float twinkle = 0.5 + 0.5 * sin(t * 3.0 + star * 100.0);
        col += vec3(0.5, 0.5, 0.7) * 0.005 / (sd + 0.01) * twinkle * 0.3;
    }
    
    // Planet
    if (d < planetSize) {
        float z = sqrt(planetSize * planetSize - d * d);
        vec3 normal = normalize(vec3(uv - center, z));
        
        // Terminator lighting
        vec3 lightDir = normalize(vec3(0.5, 0.3, 0.8));
        float diff = max(dot(normal, lightDir), 0.0);
        
        vec3 planetCol = vec3(0.08, 0.08, 0.12) * diff + vec3(0.02, 0.02, 0.04);
        
        // Subtle surface variation
        float surface = hash(floor((uv - center) * 200.0)) * 0.05;
        planetCol += surface * diff;
        
        col = planetCol;
    }
    
    // Atmosphere glow
    float atmosDist = d - planetSize;
    if (atmosDist > 0.0 && atmosDist < 0.1 * atmosphere) {
        float atmosGlow = exp(-atmosDist * 30.0 / atmosphere);
        col += vec3(0.15, 0.2, 0.4) * atmosGlow * atmosphere;
    }
    
    // Faint ring
    float ringDist = abs(length(vec2(uv.x - center.x, (uv.y - center.y) * 3.0)) - 0.25);
    float ring = smoothstep(0.01, 0.0, ringDist) * 0.1;
    if (d > planetSize) {
        col += vec3(0.2, 0.2, 0.3) * ring;
    }
    
    gl_FragColor = vec4(col, 1.0);
}
