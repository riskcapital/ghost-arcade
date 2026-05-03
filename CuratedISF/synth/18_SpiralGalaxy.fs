/*{
    "DESCRIPTION": "Spiral galaxy vortex with purple/blue tones",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "arms", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "twist", "TYPE": "float", "DEFAULT": 3.0, "MIN": 0.5, "MAX": 8.0}
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

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    
    // Spiral arms
    float spiral = sin(angle * arms - d * twist * 10.0 + t) * 0.5 + 0.5;
    spiral = pow(spiral, 2.0);
    
    // Falloff from center
    float falloff = exp(-d * 3.0);
    
    // Noise variation
    float n = noise(uv * 10.0 + t * 0.1) * 0.3;
    
    float brightness = spiral * falloff + n * falloff;
    
    // Core glow
    brightness += 0.5 * exp(-d * 8.0);
    
    // Scattered stars
    float stars = 0.0;
    for (float i = 0.0; i < 40.0; i++) {
        float h1 = hash(vec2(i, 1.0));
        float h2 = hash(vec2(i, 2.0));
        vec2 sp = vec2((h1 - 0.5) * 1.5, (h2 - 0.5) * 1.0);
        float sd = length(uv - sp);
        stars += 0.0001 / (sd * sd + 0.0001) * 0.01;
    }
    
    vec3 col = mix(vec3(0.2, 0.1, 0.4), vec3(0.4, 0.4, 0.9), brightness);
    col *= brightness * 1.5;
    col += vec3(1.0, 0.9, 1.0) * pow(falloff, 4.0) * 0.5;
    col += vec3(0.7, 0.8, 1.0) * stars;
    
    gl_FragColor = vec4(col, 1.0);
}
