/*{
    "DESCRIPTION": "Fractured cubic architecture - ruined city blocks in purple light",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "complexity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0},
        {"NAME": "lightAngle", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision mediump float;
#endif

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

float box(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float map(vec3 p) {
    float d = 1e10;
    
    // Grid of boxes
    vec3 q = p;
    vec3 id = floor(q + 0.5);
    q = fract(q + 0.5) - 0.5;
    
    float h = hash(id);
    float height = h * 0.4 * (0.5 + 0.5 * sin(id.x * 0.5 + id.z * 0.3));
    
    if (h > 0.3) {
        d = box(q, vec3(0.35, height, 0.35));
    }
    
    // Ground plane
    d = min(d, p.y + 0.1);
    
    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    // Camera
    vec3 ro = vec3(sin(t * 0.3) * 3.0, 1.5, cos(t * 0.3) * 3.0) * complexity;
    vec3 ta = vec3(0.0, 0.0, 0.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0, 1, 0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.5 * ww);
    
    // March
    float td = 0.0;
    vec3 col = vec3(0.0);
    
    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * td;
        float d = map(p);
        if (d < 0.001) {
            // Normal estimation
            vec2 e = vec2(0.001, 0.0);
            vec3 n = normalize(vec3(
                map(p + e.xyy) - map(p - e.xyy),
                map(p + e.yxy) - map(p - e.yxy),
                map(p + e.yyx) - map(p - e.yyx)
            ));
            
            // Lighting
            vec3 light = normalize(vec3(lightAngle, 0.8, 0.3));
            float diff = max(dot(n, light), 0.0);
            float amb = 0.15;
            
            col = vec3(0.4, 0.35, 0.6) * (diff + amb);
            col += vec3(0.2, 0.15, 0.3) * pow(max(dot(reflect(-light, n), -rd), 0.0), 8.0);
            
            // Fog
            col = mix(col, vec3(0.1, 0.08, 0.15), 1.0 - exp(-td * 0.15));
            break;
        }
        td += d;
        if (td > 20.0) break;
    }
    
    // Sky gradient
    if (td > 20.0) {
        col = mix(vec3(0.15, 0.1, 0.25), vec3(0.05, 0.03, 0.1), uv.y + 0.5);
    }
    
    gl_FragColor = vec4(col, 1.0);
}
