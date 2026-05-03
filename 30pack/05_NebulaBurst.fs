/*{
    "DESCRIPTION": "Nebula cloud explosion - purple/blue cosmic burst",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float val = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 6; i++) {
        val += amp * noise(p);
        p *= 2.0;
        amp *= 0.5;
    }
    return val;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    
    // Turbulent nebula
    vec2 q = vec2(fbm(uv * 3.0 * turbulence + t * 0.2), fbm(uv * 3.0 * turbulence + vec2(5.2, 1.3) + t * 0.15));
    vec2 r = vec2(fbm(uv * 3.0 + q + vec2(1.7, 9.2) + t * 0.1), fbm(uv * 3.0 + q + vec2(8.3, 2.8) + t * 0.12));
    float f = fbm(uv * 3.0 + r);
    
    // Radial burst
    float burst = exp(-d * 2.0) * (0.5 + 0.5 * f);
    
    // Color: purple to blue to white
    vec3 color = mix(vec3(0.3, 0.1, 0.6), vec3(0.4, 0.5, 1.0), f * colorShift);
    color = mix(color, vec3(0.8, 0.7, 1.0), burst * 0.5);
    color = mix(color, vec3(1.0), pow(burst, 3.0));
    
    color *= burst * 2.0 + f * 0.3;
    
    gl_FragColor = vec4(color, 1.0);
}
