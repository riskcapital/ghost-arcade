/*{
    "DESCRIPTION": "Fractal Cathedral - raymarched Menger sponge interior with volumetric light",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "iterations", "TYPE": "float", "DEFAULT": 4.0, "MIN": 1.0, "MAX": 6.0},
        {"NAME": "scale", "TYPE": "float", "DEFAULT": 3.0, "MIN": 2.0, "MAX": 4.0},
        {"NAME": "foldOffset", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.5, "MAX": 1.5},
        {"NAME": "lightColor", "TYPE": "color", "DEFAULT": [0.5, 0.6, 1.0, 1.0]},
        {"NAME": "ambientColor", "TYPE": "color", "DEFAULT": [0.05, 0.02, 0.1, 1.0]},
        {"NAME": "volumetric", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.5},
        {"NAME": "cameraPath", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "glowIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "colorShift", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}

float mengerSponge(vec3 p) {
    float d = length(max(abs(p) - 1.0, 0.0));
    float s = 1.0;
    
    for (int i = 0; i < 6; i++) {
        if (float(i) >= iterations) break;
        
        vec3 a = mod(p * s, 2.0) - 1.0;
        s *= scale;
        vec3 r = abs(1.0 - 3.0 * abs(a));
        
        float da = max(r.x, r.y);
        float db = max(r.y, r.z);
        float dc = max(r.z, r.x);
        float c = (min(da, min(db, dc)) - foldOffset) / s;
        d = max(d, c);
    }
    return d;
}

vec3 getNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        mengerSponge(p+e.xyy)-mengerSponge(p-e.xyy),
        mengerSponge(p+e.yxy)-mengerSponge(p-e.yxy),
        mengerSponge(p+e.yyx)-mengerSponge(p-e.yyx)
    ));
}

float ao(vec3 p, vec3 n) {
    float r = 0.0;
    float w = 1.0;
    for (int i = 1; i <= 5; i++) {
        float d = float(i) * 0.05;
        r += w * (d - mengerSponge(p + n * d));
        w *= 0.5;
    }
    return 1.0 - clamp(r * 5.0, 0.0, 1.0);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Flythrough camera
    vec3 ro = vec3(
        sin(t*0.7) * 0.5 * cameraPath,
        cos(t*0.5) * 0.3 * cameraPath,
        t * 2.0
    );
    
    vec3 ta = ro + vec3(sin(t*0.3)*0.2, cos(t*0.4)*0.15, 2.0);
    vec3 ww = normalize(ta - ro);
    vec3 uu = normalize(cross(ww, vec3(0,1,0)));
    vec3 vv = cross(uu, ww);
    vec3 rd = normalize(uv.x*uu + uv.y*vv + 1.5*ww);
    
    vec3 col = vec3(0.0);
    float td = 0.0;
    
    // Raymarch
    float glow = 0.0;
    for (int i = 0; i < 100; i++) {
        vec3 p = ro + rd * td;
        float d = mengerSponge(p);
        
        // Accumulate glow from near-misses
        glow += exp(-d * 15.0) * 0.015;
        
        if (d < 0.0005) {
            vec3 n = getNormal(p);
            float occ = ao(p, n);
            
            // Multiple light sources along corridor
            vec3 lighting = vec3(0.0);
            for (float li = 0.0; li < 3.0; li++) {
                vec3 lp = ro + vec3(sin(t+li*2.0)*0.3, cos(t+li*1.5)*0.3, t*2.0 + li*3.0);
                vec3 ld = normalize(lp - p);
                float diff = max(dot(n, ld), 0.0);
                float dist = length(lp - p);
                float atten = 1.0 / (1.0 + dist * dist * 0.3);
                
                float hue = fract(li * 0.33 + colorShift + p.z * 0.02);
                vec3 lc = 0.5 + 0.5*cos(6.28*(hue + vec3(0.0, 0.33, 0.67)));
                lc = mix(lc, lightColor.rgb, 0.5);
                
                lighting += lc * diff * atten;
            }
            
            col = (ambientColor.rgb * 0.3 + lighting * 0.8) * occ;
            
            // Depth fog
            float fog = 1.0 - exp(-td * 0.08);
            col = mix(col, ambientColor.rgb, fog);
            break;
        }
        
        td += d;
        if (td > 40.0) break;
    }
    
    // Volumetric glow
    col += lightColor.rgb * glow * glowIntensity * 0.4;
    
    // Volumetric light shafts
    float volLight = 0.0;
    for (int i = 0; i < 30; i++) {
        float vt = float(i) * 1.0;
        vec3 vp = ro + rd * vt;
        float vd = mengerSponge(vp);
        if (vd > 0.1) {
            float pulse = 0.5 + 0.5*sin(vp.z*0.5 - t*3.0);
            volLight += exp(-vt * 0.1) * 0.01 * pulse;
        }
    }
    col += lightColor.rgb * volLight * volumetric;
    
    col = pow(col, vec3(0.9));
    
    gl_FragColor = vec4(col, 1.0);
}
