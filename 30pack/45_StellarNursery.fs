/*{
    "DESCRIPTION": "Stellar nursery - nebula with proto-stars and dust lanes",
    "CREDIT": "Justin / Elite Results Marketing",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.15, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "nebulaScale", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.5, "MAX": 5.0},
        {"NAME": "dustDensity", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "starFormation", "TYPE": "float", "DEFAULT": 0.6, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "emissionBrightness", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "colorSaturation", "TYPE": "float", "DEFAULT": 0.7, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "dustLaneStrength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "protostarCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 0.0, "MAX": 10.0},
        {"NAME": "turbulenceScale", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "pillarStrength", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0, "LABEL": "Dust Pillars"}
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
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 8; i++) {
        if (float(i) >= octaves) break;
        v += a * noise(p);
        p = m * p;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE.xy) / RENDERSIZE.y;
    float t = TIME * speed;
    
    vec2 p = uv * nebulaScale;
    
    // Domain warping for turbulence
    vec2 q = vec2(
        fbm(p + t * 0.05, 6.0),
        fbm(p + vec2(5.2, 1.3) + t * 0.04, 6.0)
    ) * turbulenceScale;
    
    vec2 r = vec2(
        fbm(p + q * 2.0 + vec2(1.7, 9.2) + t * 0.03, 5.0),
        fbm(p + q * 2.0 + vec2(8.3, 2.8) + t * 0.035, 5.0)
    );
    
    float f = fbm(p + r * 1.5, 6.0);
    
    // Emission nebula base
    float emission = pow(f, 1.5) * emissionBrightness;
    
    // Color gradient: deep blue -> purple -> magenta -> pale
    vec3 nebulaCol = vec3(0.0);
    nebulaCol = mix(vec3(0.05, 0.05, 0.15), vec3(0.2, 0.1, 0.4), f);
    nebulaCol = mix(nebulaCol, vec3(0.5, 0.2, 0.5), pow(f, 2.0) * colorSaturation);
    nebulaCol = mix(nebulaCol, vec3(0.7, 0.5, 0.8), pow(f, 3.0) * colorSaturation);
    
    vec3 col = nebulaCol * emission;
    
    // Dust lanes (dark absorption)
    float dust = fbm(p * 1.5 + vec2(3.0, 7.0) + t * 0.02, 5.0);
    float dustLane = smoothstep(0.3, 0.6, dust) * dustDensity;
    
    // Dust pillars (vertical structures)
    float pillar = fbm(vec2(p.x * 3.0, p.y * 0.5) + t * 0.01, 4.0);
    pillar = smoothstep(0.4, 0.6, pillar) * pillarStrength;
    
    col *= 1.0 - dustLane * dustLaneStrength;
    col *= 1.0 - pillar * 0.5;
    
    // Proto-stars
    for (float i = 0.0; i < 10.0; i++) {
        if (i >= protostarCount) break;
        
        vec2 starPos = vec2(
            (hash(vec2(i, 1.0)) - 0.5) * 1.2,
            (hash(vec2(i, 2.0)) - 0.5) * 0.8
        );
        
        float sd = length(uv - starPos);
        float starBright = hash(vec2(i, 3.0)) * 0.5 + 0.5;
        
        // Star with nebula illumination
        float star = starBright * starFormation * 0.005 / (sd * sd + 0.001);
        vec3 starCol = mix(vec3(0.8, 0.8, 1.0), vec3(1.0, 0.9, 0.7), hash(vec2(i, 4.0)));
        col += starCol * star;
        
        // Reflection nebula around star
        float reflection = starBright * starFormation * exp(-sd * sd / 0.01) * 0.15;
        col += vec3(0.3, 0.4, 0.8) * reflection;
        
        // Diffraction spikes
        vec2 dp = uv - starPos;
        float spike = exp(-abs(dp.x) * 150.0) * exp(-abs(dp.y) * 20.0) +
                     exp(-abs(dp.y) * 150.0) * exp(-abs(dp.x) * 20.0);
        col += starCol * spike * starBright * starFormation * 0.1;
    }
    
    // Background stars
    vec2 starUV = uv * 40.0;
    float bgStar = hash(floor(starUV));
    if (bgStar > 0.96) {
        float sd = length(fract(starUV) - 0.5);
        col += vec3(0.5, 0.5, 0.6) * 0.003 / (sd + 0.01) * 0.2 * (1.0 - dustLane);
    }
    
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
