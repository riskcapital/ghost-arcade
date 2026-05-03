/*{
    "DESCRIPTION": "Deep Organic Iridescence - flowing blue/purple biological forms with specular highlights",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.1, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "formScale", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0},
        {"NAME": "warpIntensity", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "foldComplexity", "TYPE": "float", "DEFAULT": 7.0, "MIN": 3.0, "MAX": 10.0},
        {"NAME": "iridescence", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "wetness", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.0, "MAX": 1.5, "LABEL": "Specular Wetness"},
        {"NAME": "blueDepth", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "purpleShift", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "subsurfaceGlow", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "lightPosX", "TYPE": "float", "DEFAULT": 0.4, "MIN": -1.0, "MAX": 1.0},
        {"NAME": "lightPosY", "TYPE": "float", "DEFAULT": 0.5, "MIN": -1.0, "MAX": 1.0},
        {"NAME": "foldDepth", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0, "LABEL": "Surface Depth"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

float noise(vec2 p) {
    vec2 i=floor(p); vec2 f=fract(p);
    f=f*f*f*(f*(f*6.0-15.0)+10.0); // Quintic
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
               mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

float fbm(vec2 p, float oct) {
    float v=0.0, a=0.5;
    mat2 m = mat2(1.6,1.2,-1.2,1.6);
    for (int i=0; i<10; i++) {
        if (float(i)>=oct) break;
        v += a*noise(p); p=m*p; a*=0.5;
    }
    return v;
}

float ridged(vec2 p, float oct) {
    float v=0.0, a=0.5, prev=1.0;
    mat2 m = mat2(1.6,1.2,-1.2,1.6);
    for (int i=0; i<10; i++) {
        if (float(i)>=oct) break;
        float n = abs(noise(p)*2.0-1.0);
        n = 1.0 - n;
        n = n*n;
        v += a*n*prev;
        prev = n;
        p=m*p; a*=0.5;
    }
    return v;
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453);
}

float voronoiSmooth(vec2 p, float k) {
    vec2 n=floor(p), f=fract(p);
    float res = 0.0;
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
        vec2 g=vec2(float(i),float(j));
        vec2 o=hash2(n+g);
        float d=length(g+o-f);
        res += exp(-k*d);
    }
    return -log(res)/k;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // === DOMAIN WARPING (3 levels for deep organic distortion) ===
    vec2 p = uv * formScale;
    
    vec2 q = vec2(
        fbm(p + t*0.05, 5.0),
        fbm(p + vec2(5.2,1.3) + t*0.04, 5.0)
    ) * warpIntensity;
    
    vec2 r = vec2(
        fbm(p + q*1.5 + vec2(1.7,9.2) + t*0.03, 5.0),
        fbm(p + q*1.5 + vec2(8.3,2.8) + t*0.035, 5.0)
    ) * warpIntensity * 0.8;
    
    vec2 s = vec2(
        fbm(p + r*1.2 + vec2(3.1,5.7) + t*0.02, 4.0),
        fbm(p + r*1.2 + vec2(7.1,1.9) + t*0.025, 4.0)
    ) * warpIntensity * 0.5;
    
    // === HEIGHT FIELD (multiple combined textures) ===
    float height = 0.0;
    
    // Smooth folded base
    height += fbm(p + s*1.3, foldComplexity) * 0.4 * foldDepth;
    
    // Ridged detail (vein-like)
    height += ridged(p*1.5 + r, foldComplexity - 1.0) * 0.25 * foldDepth;
    
    // Smooth voronoi (cellular membrane)
    float cells = voronoiSmooth(p*2.0 + q*0.5, 6.0);
    height += cells * 0.15 * foldDepth;
    
    // Micro detail
    height += noise(p*8.0 + s) * 0.08 * foldDepth;
    height += noise(p*16.0 + r) * 0.03 * foldDepth;
    
    // === NORMALS (central differences) ===
    float eps = 0.003;
    vec2 e = vec2(eps, 0.0);
    
    // Approximate derivatives with offset noise samples
    float hL = fbm((p-e.xy)+s*1.3, 4.0)*0.4 + ridged((p-e.xy)*1.5+r, 4.0)*0.25;
    float hR = fbm((p+e.xy)+s*1.3, 4.0)*0.4 + ridged((p+e.xy)*1.5+r, 4.0)*0.25;
    float hD = fbm((p-e.yx)+s*1.3, 4.0)*0.4 + ridged((p-e.yx)*1.5+r, 4.0)*0.25;
    float hU = fbm((p+e.yx)+s*1.3, 4.0)*0.4 + ridged((p+e.yx)*1.5+r, 4.0)*0.25;
    
    vec3 normal = normalize(vec3(
        (hL - hR) / (2.0*eps) * foldDepth * 0.3,
        (hD - hU) / (2.0*eps) * foldDepth * 0.3,
        1.0
    ));
    
    // === LIGHTING ===
    vec3 lightDir = normalize(vec3(lightPosX, lightPosY, 0.8));
    float diff = max(dot(normal, lightDir), 0.0);
    float amb = 0.06;
    
    // Fresnel-enhanced specular (wet look)
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float NdotH = max(dot(normal, halfDir), 0.0);
    float spec = pow(NdotH, 64.0) * wetness;
    float spec2 = pow(NdotH, 16.0) * wetness * 0.3; // Broader specular
    
    // Fresnel
    float NdotV = max(dot(normal, viewDir), 0.0);
    float fresnel = pow(1.0 - NdotV, 4.0);
    
    // Subsurface scattering
    float sss = pow(max(dot(viewDir, -normal + lightDir*0.5), 0.0), 3.0) * subsurfaceGlow;
    
    // === IRIDESCENT COLOR ===
    // Base: deep blue-purple
    vec3 baseColor = mix(
        vec3(0.08, 0.1, 0.35),  // Deep blue
        vec3(0.2, 0.08, 0.35),  // Deep purple
        purpleShift
    );
    
    // Iridescent shift based on normal angle and view angle
    float iriAngle = dot(normal.xy, vec2(cos(t*0.3), sin(t*0.3)));
    vec3 iriColor = vec3(
        0.5 + 0.5 * sin(iriAngle*6.0 + 0.0),
        0.5 + 0.5 * sin(iriAngle*6.0 + 2.1),
        0.5 + 0.5 * sin(iriAngle*6.0 + 4.2)
    );
    iriColor = mix(vec3(0.5), iriColor, iridescence);
    
    // Shift toward blue-purple palette
    iriColor *= mix(vec3(0.3, 0.4, 1.0), vec3(0.5, 0.3, 0.8), purpleShift);
    
    // Combine base with iridescence based on surface angle
    vec3 surfaceColor = mix(baseColor, baseColor + iriColor * 0.4, fresnel * iridescence + height * 0.5);
    
    // Modulate with surface detail
    surfaceColor *= 0.6 + 0.6 * height;
    surfaceColor += vec3(0.05, 0.08, 0.2) * cells * blueDepth;
    
    // === FINAL COMPOSITING ===
    vec3 col = surfaceColor * (diff * 0.8 + amb);
    col += vec3(0.7, 0.75, 1.0) * spec * 0.6;   // Sharp specular
    col += vec3(0.4, 0.45, 0.7) * spec2;          // Broad specular
    col += vec3(0.15, 0.1, 0.3) * fresnel * 0.3;  // Fresnel rim
    col += baseColor * 1.5 * sss;                   // Subsurface
    
    // Deep blue shadow in crevices
    float ao = pow(height, 0.5);
    col *= 0.4 + 0.6 * ao;
    
    gl_FragColor = vec4(col, 1.0);
}
