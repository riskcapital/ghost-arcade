/*{
    "DESCRIPTION": "Turbulent cloudy sphere - procedural moon/planet texture",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "detail", "TYPE": "float", "DEFAULT": 5.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "sphereRadius", "TYPE": "float", "DEFAULT": 0.35, "MIN": 0.1, "MAX": 0.5}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p, float octaves) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= octaves) break;
        v += a * noise(p);
        p *= 2.0; a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    float d = length(uv);
    vec3 col = vec3(0.0);
    
    if (d < sphereRadius) {
        // Spherical UV mapping
        float z = sqrt(sphereRadius * sphereRadius - d * d);
        vec2 sphereUV = vec2(
            atan(uv.x, z) + t * 0.1,
            asin(uv.y / sphereRadius)
        );
        
        // Turbulent cloud texture
        float cloud = fbm(sphereUV * detail, detail);
        float cloud2 = fbm(sphereUV * detail * 2.0 + vec2(t * 0.05, 0.0), detail);
        
        float pattern = cloud * 0.6 + cloud2 * 0.4;
        
        // Lighting
        float light = dot(normalize(vec3(uv, z)), normalize(vec3(0.5, 0.5, 1.0)));
        light = max(light, 0.1);
        
        col = vec3(pattern) * light;
        
        // Edge darkening
        float edge = smoothstep(sphereRadius, sphereRadius - 0.05, d);
        col *= edge;
        
        // Rim light
        float rim = 1.0 - z / sphereRadius;
        col += vec3(0.3, 0.3, 0.4) * rim * rim * 0.5;
    }
    
    // Outer glow
    float outerGlow = smoothstep(sphereRadius + 0.1, sphereRadius, d);
    col += vec3(0.1, 0.1, 0.15) * outerGlow * (1.0 - step(sphereRadius, d) * 0.5);
    
    gl_FragColor = vec4(col, 1.0);
}
