/*{
    "DESCRIPTION": "Volumetric Nebula Flythrough - raymarched 3D clouds with star birth",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "density", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 1.5},
        {"NAME": "absorption", "TYPE": "float", "DEFAULT": 0.8, "MIN": 0.1, "MAX": 2.0},
        {"NAME": "colorA", "TYPE": "color", "DEFAULT": [0.1, 0.15, 0.5, 1.0]},
        {"NAME": "colorB", "TYPE": "color", "DEFAULT": [0.5, 0.1, 0.4, 1.0]},
        {"NAME": "emissionStrength", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "starCount", "TYPE": "float", "DEFAULT": 5.0, "MIN": 0.0, "MAX": 10.0},
        {"NAME": "turbulence", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.2, "MAX": 3.0},
        {"NAME": "cameraSpeed", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.0, "MAX": 3.0},
        {"NAME": "volumeSteps", "TYPE": "float", "DEFAULT": 40.0, "MIN": 15.0, "MAX": 64.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}

float noise3d(vec3 p){
    vec3 i=floor(p),f=fract(p);
    f=f*f*(3.0-2.0*f);
    float n=i.x+i.y*157.0+113.0*i.z;
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                   mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                   mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}

float fbm3d(vec3 p){
    float v=0.0,a=0.5;
    mat3 m = mat3(0.0,0.8,0.6,-0.8,0.36,-0.48,-0.6,-0.48,0.64);
    for(int i=0;i<6;i++){
        v+=a*noise3d(p);
        p=m*p*2.0;
        a*=0.5;
    }
    return v;
}

float nebulaDensity(vec3 p, float t){
    vec3 q = p * turbulence;
    float d = fbm3d(q + t*0.05);
    d += fbm3d(q*2.0 - t*0.03) * 0.5;
    
    // Carve out voids
    float voids = fbm3d(q*0.5 + vec3(5.0,3.0,7.0));
    d -= smoothstep(0.4, 0.6, voids) * 0.4;
    
    return max(d - 0.3, 0.0) * density;
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    // Flythrough camera
    vec3 ro = vec3(sin(t*0.3)*2.0, cos(t*0.2)*1.0, t*cameraSpeed*2.0);
    vec3 rd = normalize(vec3(uv, 1.5));
    
    // Camera rotation
    float ca = sin(t*0.15)*0.2;
    float sa = cos(t*0.15)*0.2;
    rd.xy = mat2(cos(ca),-sin(ca),sin(ca),cos(ca)) * rd.xy;
    rd.xz = mat2(cos(sa),-sin(sa),sin(sa),cos(sa)) * rd.xz;
    
    vec3 col = vec3(0.0);
    float transmittance = 1.0;
    
    float stepSize = 8.0 / volumeSteps;
    
    for(float i=0.0; i<64.0; i++){
        if(i>=volumeSteps || transmittance<0.01) break;
        
        float td = i * stepSize;
        vec3 p = ro + rd * td;
        
        float d = nebulaDensity(p, t);
        
        if(d > 0.001){
            // Emission color varies with position
            float colorMix = fbm3d(p*0.3 + t*0.02);
            vec3 emitCol = mix(colorA.rgb, colorB.rgb, colorMix);
            
            // Local illumination from embedded stars
            float starLight = 0.0;
            for(float s=0.0; s<10.0; s++){
                if(s>=starCount) break;
                vec3 sp = vec3(
                    sin(s*2.4+1.0)*3.0,
                    cos(s*1.7+2.0)*2.0,
                    s*4.0 + t*cameraSpeed*2.0 - 5.0
                );
                float sd = length(p-sp);
                starLight += 1.0/(sd*sd+0.5);
            }
            
            vec3 luminance = emitCol * (d * emissionStrength + starLight * 0.3);
            
            float stepAbsorption = exp(-d * absorption * stepSize);
            col += luminance * transmittance * (1.0 - stepAbsorption) * stepSize;
            transmittance *= stepAbsorption;
        }
    }
    
    // Background stars through remaining transmittance
    vec2 starUV = rd.xy * 40.0 + rd.z * 13.7;
    float starH = hash(vec3(floor(starUV), 0.0));
    if(starH > 0.97){
        float sd = length(fract(starUV)-0.5);
        float twinkle = 0.5+0.5*sin(t*3.0+starH*100.0);
        col += vec3(0.6,0.65,0.9) * 0.005/(sd+0.01) * twinkle * transmittance;
    }
    
    // Embedded stars (bright points)
    for(float s=0.0; s<10.0; s++){
        if(s>=starCount) break;
        vec3 sp = vec3(sin(s*2.4+1.0)*3.0, cos(s*1.7+2.0)*2.0, s*4.0+t*cameraSpeed*2.0-5.0);
        vec3 toStar = sp - ro;
        float along = dot(toStar, rd);
        if(along > 0.0){
            vec3 closest = ro + rd * along;
            float sd = length(closest - sp);
            float bloom = 0.02/(sd*sd+0.01) * transmittance;
            col += vec3(1.0,0.9,0.8) * bloom;
        }
    }
    
    col = pow(col, vec3(0.85));
    gl_FragColor = vec4(col, 1.0);
}
