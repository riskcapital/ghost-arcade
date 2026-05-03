/*{
    "DESCRIPTION": "Void Architecture - infinite recursive columns and impossible arches",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "columnSpacing", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.5, "MAX": 5.0},
        {"NAME": "columnRadius", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.05, "MAX": 0.5},
        {"NAME": "archHeight", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.0, "MAX": 4.0},
        {"NAME": "lightColor", "TYPE": "color", "DEFAULT": [0.3, 0.4, 1.0, 1.0]},
        {"NAME": "fogColor", "TYPE": "color", "DEFAULT": [0.02, 0.01, 0.06, 1.0]},
        {"NAME": "fogDensity", "TYPE": "float", "DEFAULT": 0.04, "MIN": 0.0, "MAX": 0.1},
        {"NAME": "cameraHeight", "TYPE": "float", "DEFAULT": 0.5, "MIN": -1.0, "MAX": 2.0},
        {"NAME": "volumetricLight", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0},
        {"NAME": "floorReflect", "TYPE": "float", "DEFAULT": 0.4, "MIN": 0.0, "MAX": 1.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float sdCylinder(vec3 p, float r, float h){
    vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(r,h);
    return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

float scene(vec3 p){
    float rep = columnSpacing;
    
    // Infinite column grid
    vec3 q = p;
    q.xz = mod(q.xz + rep*0.5, rep) - rep*0.5;
    float col = sdCylinder(q, columnRadius, archHeight);
    
    // Cross beams/arches
    vec3 r = p;
    r.x = mod(r.x + rep*0.5, rep) - rep*0.5;
    float beam = length(vec2(r.x, r.y - archHeight)) - 0.08;
    
    vec3 s = p;
    s.z = mod(s.z + rep*0.5, rep) - rep*0.5;
    float beam2 = length(vec2(s.z, s.y - archHeight)) - 0.08;
    
    float d = min(col, min(beam, beam2));
    
    // Floor
    d = min(d, p.y + 0.5);
    
    // Ceiling
    d = min(d, archHeight + 0.3 - p.y);
    
    return d;
}

vec3 getNormal(vec3 p){
    vec2 e=vec2(0.001,0.0);
    return normalize(vec3(scene(p+e.xyy)-scene(p-e.xyy),
                          scene(p+e.yxy)-scene(p-e.yxy),
                          scene(p+e.yyx)-scene(p-e.yyx)));
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    vec3 ro = vec3(t*2.0, cameraHeight, sin(t*0.3)*0.5);
    vec3 rd = normalize(vec3(uv.x, uv.y+0.1, 1.0));
    
    float ca=sin(t*0.1)*0.05;
    rd.xz = mat2(cos(ca),-sin(ca),sin(ca),cos(ca)) * rd.xz;
    
    vec3 col = vec3(0.0);
    float td = 0.0;
    float glow = 0.0;
    
    for(int i=0;i<80;i++){
        vec3 p=ro+rd*td;
        float d=scene(p);
        glow += exp(-d*5.0)*0.005;
        
        if(d<0.001){
            vec3 n=getNormal(p);
            
            // Point lights at column intersections
            vec3 lighting = vec3(0.0);
            float rep=columnSpacing;
            vec3 nearCol = vec3(
                floor(p.x/rep+0.5)*rep,
                archHeight,
                floor(p.z/rep+0.5)*rep
            );
            
            for(float lx=-1.0;lx<=1.0;lx++){
                for(float lz=-1.0;lz<=1.0;lz++){
                    vec3 lp = nearCol + vec3(lx*rep, 0.0, lz*rep);
                    vec3 ld = normalize(lp-p);
                    float dist = length(lp-p);
                    float atten = 1.0/(1.0+dist*dist*0.1);
                    float diff = max(dot(n,ld),0.0);
                    
                    float pulse = 0.7+0.3*sin(t*2.0+lp.x*0.5+lp.z*0.3);
                    lighting += lightColor.rgb * diff * atten * pulse;
                }
            }
            
            float spec = pow(max(dot(reflect(rd,n),normalize(vec3(0,1,0))),0.0),32.0);
            
            // Floor reflection
            float isFloor = 1.0-step(0.01, p.y+0.49);
            vec3 matCol = mix(vec3(0.08,0.06,0.1), vec3(0.04,0.03,0.06), isFloor);
            matCol += lightColor.rgb * spec * 0.2 * floorReflect * isFloor;
            
            col = matCol + lighting * 0.3;
            
            float fog = 1.0-exp(-td*fogDensity);
            col = mix(col, fogColor.rgb, fog);
            break;
        }
        td+=d;
        if(td>50.0)break;
    }
    
    col += lightColor.rgb * glow * volumetricLight * 0.3;
    col = pow(col, vec3(0.9));
    gl_FragColor = vec4(col, 1.0);
}
