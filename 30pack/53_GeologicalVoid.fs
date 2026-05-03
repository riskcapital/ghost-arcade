/*{
    "DESCRIPTION": "Geological Void - mineral surface with dark cavity, pitted terrain, volcanic texture",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.08, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "terrainScale", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 10.0},
        {"NAME": "voidSize", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.05, "MAX": 0.4},
        {"NAME": "voidDepth", "TYPE": "float", "DEFAULT": 0.9, "MIN": 0.3, "MAX": 1.0},
        {"NAME": "voidX", "TYPE": "float", "DEFAULT": 0.1, "MIN": -0.4, "MAX": 0.4},
        {"NAME": "voidY", "TYPE": "float", "DEFAULT": 0.05, "MIN": -0.3, "MAX": 0.3},
        {"NAME": "roughness", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "mineralDetail", "TYPE": "float", "DEFAULT": 7.0, "MIN": 3.0, "MAX": 10.0},
        {"NAME": "lightAngle", "TYPE": "float", "DEFAULT": 0.8, "MIN": -1.5, "MAX": 1.5},
        {"NAME": "lightHeight", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.1, "MAX": 1.5},
        {"NAME": "specularHardness", "TYPE": "float", "DEFAULT": 32.0, "MIN": 4.0, "MAX": 128.0},
        {"NAME": "pebbleDensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453);
}

float noise(vec2 p) {
    vec2 i=floor(p); vec2 f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

float fbm(vec2 p, float oct) {
    float v=0.0, a=0.5;
    mat2 m = mat2(1.6,1.2,-1.2,1.6);
    for (int i=0; i<10; i++) {
        if (float(i)>=oct) break;
        v += a*noise(p);
        p = m*p;
        a *= 0.5;
    }
    return v;
}

float ridged(vec2 p, float oct) {
    float v=0.0, a=0.5;
    mat2 m = mat2(1.6,1.2,-1.2,1.6);
    for (int i=0; i<10; i++) {
        if (float(i)>=oct) break;
        float n = noise(p);
        n = 1.0 - abs(n*2.0-1.0);
        n = n*n;
        v += a*n;
        p = m*p;
        a *= 0.5;
    }
    return v;
}

float voronoi(vec2 p) {
    vec2 n=floor(p), f=fract(p);
    float md=8.0;
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
        vec2 g=vec2(float(i),float(j));
        vec2 o=hash2(n+g);
        float d=length(g+o-f);
        md=min(md,d);
    }
    return md;
}

float terrain(vec2 p) {
    float t = TIME * speed;
    
    // Multi-octave terrain
    float h = fbm(p * terrainScale + t*0.05, mineralDetail) * 0.5;
    h += ridged(p * terrainScale * 2.0 + t*0.03, mineralDetail - 1.0) * 0.3;
    
    // Voronoi for pebble/mineral grain structure
    float v = voronoi(p * terrainScale * 3.0 * pebbleDensity);
    h += v * 0.15 * roughness;
    
    // Fine grain texture
    h += noise(p * terrainScale * 12.0) * 0.05 * roughness;
    h += noise(p * terrainScale * 25.0) * 0.02 * roughness;
    
    // Void cavity
    vec2 voidCenter = vec2(voidX, voidY);
    float voidDist = length(p - voidCenter);
    float voidMask = smoothstep(voidSize, voidSize * 0.3, voidDist);
    
    // Void depression with sharp rim
    h -= voidMask * voidDepth * 0.5;
    
    // Raised rim around void
    float rimDist = abs(voidDist - voidSize);
    float rim = exp(-rimDist*rimDist*200.0) * 0.15;
    h += rim;
    
    return h;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    float h = terrain(uv);
    
    // Normal estimation
    float eps = 0.002;
    float hx = terrain(uv + vec2(eps, 0.0));
    float hy = terrain(uv + vec2(0.0, eps));
    vec3 normal = normalize(vec3((h-hx)/eps, (h-hy)/eps, 1.0));
    
    // Lighting
    vec3 lightDir = normalize(vec3(cos(lightAngle), sin(lightAngle)*0.5, lightHeight));
    float diff = max(dot(normal, lightDir), 0.0);
    float amb = 0.08;
    
    // Specular
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), specularHardness);
    
    // Subsurface scattering approximation
    float sss = pow(max(dot(-normal, lightDir), 0.0), 2.0) * 0.1;
    
    // Base color: gray mineral with subtle warm/cool variation
    vec3 baseCol = vec3(0.45, 0.43, 0.42);
    float mineralVar = noise(uv * terrainScale * 8.0 + t*0.01);
    baseCol = mix(baseCol, vec3(0.5, 0.48, 0.44), mineralVar);
    
    // Pebble grain coloring
    float grain = voronoi(uv * terrainScale * 3.0 * pebbleDensity);
    baseCol *= 0.8 + 0.4 * grain;
    
    vec3 col = baseCol * (diff * 0.7 + amb) + vec3(0.6) * spec * 0.4 + baseCol * sss;
    
    // Void darkness
    vec2 voidCenter = vec2(voidX, voidY);
    float voidDist = length(uv - voidCenter);
    float voidMask = smoothstep(voidSize * 0.8, voidSize * 0.2, voidDist);
    col = mix(col, vec3(0.01, 0.01, 0.015), voidMask * voidDepth);
    
    // Rim highlight around void
    float rimHighlight = smoothstep(voidSize * 1.2, voidSize, voidDist) * 
                         smoothstep(voidSize * 0.7, voidSize, voidDist);
    col += vec3(0.15, 0.14, 0.13) * rimHighlight * diff;
    
    // Interior void texture (barely visible deep texture)
    if (voidMask > 0.3) {
        float innerTex = fbm(uv * 20.0, 4.0) * 0.03;
        col += vec3(innerTex) * (1.0 - voidMask * 0.8);
    }
    
    // Edge darkening
    float vigDist = length(uv * 1.2);
    col *= 1.0 - vigDist * 0.3;
    
    gl_FragColor = vec4(col, 1.0);
}
