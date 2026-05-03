/*{
    "DESCRIPTION": "Particle scatter around a central geodesic sphere",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "particleDensity", "TYPE": "float", "DEFAULT": 50.0, "MIN": 10.0, "MAX": 100.0},
        {"NAME": "sphereSize", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.05, "MAX": 0.4}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    float col = 0.0;
    
    // Central geodesic sphere wireframe
    float d = length(uv);
    float sphere = abs(d - sphereSize);
    col += 0.002 / (sphere + 0.002);
    
    // Geodesic lines on sphere
    float angle = atan(uv.y, uv.x);
    float geodesic = abs(sin(angle * 6.0 + t) * d);
    if (d < sphereSize + 0.02) {
        col += 0.001 / (geodesic + 0.005) * smoothstep(sphereSize + 0.02, sphereSize - 0.02, d);
    }
    
    // Scattered particles
    for (float i = 0.0; i < 100.0; i++) {
        if (i >= particleDensity) break;
        float h1 = hash(vec2(i, 0.0));
        float h2 = hash(vec2(0.0, i));
        float h3 = hash(vec2(i, i));
        
        vec2 pos = vec2(
            (h1 - 0.5) * 1.6 + 0.05 * sin(t * h3 * 2.0),
            (h2 - 0.5) * 1.2 + 0.05 * cos(t * h3 * 2.0)
        );
        
        float pd = length(uv - pos);
        float size = 0.002 + 0.003 * h3;
        col += size / (pd * pd + 0.0001) * 0.0001;
    }
    
    gl_FragColor = vec4(vec3(col), 1.0);
}
