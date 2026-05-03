/*{
    "DESCRIPTION": "Bio-Sculptural Mass - organic purple fibrous form, mycelium/coral growth texture",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.12, "MIN": 0.0, "MAX": 0.5},
        {"NAME": "formScale", "TYPE": "float", "DEFAULT": 2.5, "MIN": 1.0, "MAX": 5.0},
        {"NAME": "fibrousDetail", "TYPE": "float", "DEFAULT": 8.0, "MIN": 3.0, "MAX": 10.0},
        {"NAME": "organicWarp", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "colorSaturation", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "purpleShift", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "formDensity", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.2, "MAX": 1.0, "LABEL": "Mass Thickness"},
        {"NAME": "lightIntensity", "TYPE": "float", "DEFAULT": 1.2, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "specular", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "subsurface", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "textureRoughness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 2.0},
        {"NAME": "verticalBias", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.5, "LABEL": "Vertical Flow"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

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
        v += a*noise(p); p=m*p; a*=0.5;
    }
    return v;
}

float ridged(vec2 p, float oct) {
    float v=0.0, a=0.5;
    mat2 m = mat2(1.6,1.2,-1.2,1.6);
    for (int i=0; i<10; i++) {
        if (float(i)>=oct) break;
        v += a*(1.0-abs(noise(p)*2.0-1.0));
        p=m*p; a*=0.5;
    }
    return v;
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453);
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

float voronoiEdge(vec2 p) {
    vec2 n=floor(p), f=fract(p);
    float md=8.0, md2=8.0;
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
        vec2 g=vec2(float(i),float(j));
        vec2 o=hash2(n+g);
        float d=dot(g+o-f,g+o-f);
        if(d<md) { md2=md; md=d; }
        else if(d<md2) md2=d;
    }
    return md2-md;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Domain warp for organic shape
    vec2 p = uv * formScale;
    
    // Vertical bias (columnar growth)
    p.y *= (1.0 - verticalBias * 0.3);
    
    vec2 q = vec2(
        fbm(p + t*0.05, 5.0),
        fbm(p + vec2(5.2,1.3) + t*0.04, 5.0)
    ) * organicWarp;
    
    vec2 r = vec2(
        fbm(p + q*2.0 + vec2(1.7,9.2) + t*0.03, 5.0),
        fbm(p + q*2.0 + vec2(8.3,2.8) + t*0.035, 5.0)
    ) * organicWarp;
    
    float formField = fbm(p + r * 1.5, fibrousDetail);
    
    // Mass shape: central column with organic boundary
    float centralMask = smoothstep(0.5*formDensity, 0.0, abs(uv.x) - formField*0.15);
    centralMask *= smoothstep(0.6, 0.1, abs(uv.y) - formField*0.1);
    
    // More organic boundary
    float boundary = fbm(uv*8.0 + r + t*0.02, 6.0);
    float organicEdge = smoothstep(formDensity*0.4, formDensity*0.2, 
                                    abs(uv.x) - boundary*0.12 + 0.05*sin(uv.y*10.0+t));
    centralMask = max(centralMask, organicEdge * 0.8);
    
    if (centralMask < 0.01) {
        gl_FragColor = vec4(vec3(0.0), 1.0);
        return;
    }
    
    // === SURFACE DETAIL ===
    
    // Fibrous texture (ridged noise stretched vertically)
    float fibers = ridged(vec2(uv.x * 6.0, uv.y * 2.0 * (1.0+verticalBias)) * textureRoughness + r, fibrousDetail);
    
    // Voronoi cellular structure
    float cells = voronoi((uv + q*0.1) * formScale * 4.0 * textureRoughness);
    float cellEdge = voronoiEdge((uv + q*0.1) * formScale * 4.0 * textureRoughness);
    
    // Fine granular texture
    float grain = noise(uv * 40.0 * textureRoughness + t*0.1);
    
    // Combine into height
    float height = formField * 0.4 + fibers * 0.3 + cells * 0.2 + grain * 0.05;
    
    // Normal estimation
    float eps = 0.003;
    vec2 epsX = vec2(eps, 0.0);
    vec2 epsY = vec2(0.0, eps);
    // Simplified: reuse some calculations
    float hx = height + noise((uv+epsX)*40.0*textureRoughness)*0.05 - noise((uv)*40.0*textureRoughness)*0.05;
    float hy = height + noise((uv+epsY)*40.0*textureRoughness)*0.05 - noise((uv)*40.0*textureRoughness)*0.05;
    hx += fbm((uv+epsX)*formScale+r*1.5, 4.0)*0.2 - fbm(uv*formScale+r*1.5, 4.0)*0.2;
    hy += fbm((uv+epsY)*formScale+r*1.5, 4.0)*0.2 - fbm(uv*formScale+r*1.5, 4.0)*0.2;
    vec3 normal = normalize(vec3((height-hx)/eps*0.5, (height-hy)/eps*0.5, 1.0));
    
    // === LIGHTING ===
    vec3 lightDir = normalize(vec3(0.4, 0.3, lightIntensity));
    float diff = max(dot(normal, lightDir), 0.0);
    float amb = 0.08;
    
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * specular;
    
    // Subsurface scattering (purple glow through material)
    float sss = pow(max(dot(viewDir, -normal + lightDir*0.3), 0.0), 3.0) * subsurface;
    
    // === COLOR ===
    vec3 baseColor = mix(
        vec3(0.55, 0.45, 0.55), // gray-lavender
        vec3(0.5, 0.3, 0.6),    // purple
        purpleShift
    );
    
    // Color variation from cellular structure
    baseColor = mix(baseColor, vec3(0.6, 0.5, 0.7), fibers * 0.3 * colorSaturation);
    baseColor = mix(baseColor, vec3(0.4, 0.25, 0.5), (1.0-cells) * 0.2 * colorSaturation);
    
    // Silver highlights on ridges
    vec3 silverHighlight = vec3(0.75, 0.7, 0.8);
    baseColor = mix(baseColor, silverHighlight, pow(fibers, 3.0) * 0.3);
    
    // Cell edge darkening
    baseColor *= 0.7 + 0.3 * smoothstep(0.0, 0.2, cellEdge);
    
    vec3 col = baseColor * (diff * 0.8 + amb);
    col += silverHighlight * spec * 0.5;
    col += vec3(0.4, 0.2, 0.5) * sss * colorSaturation;
    
    // Apply mask
    col *= centralMask;
    
    // Soft edge glow
    float edgeGlow = centralMask * (1.0 - smoothstep(0.0, 0.3, centralMask));
    col += vec3(0.3, 0.15, 0.35) * edgeGlow * 0.5;
    
    gl_FragColor = vec4(col, 1.0);
}
