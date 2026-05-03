/*{
    "DESCRIPTION": "Hypercube Tesseract - 4D wireframe projected through 3D with dual rotation",
    "CREDIT": "Justin / Syntax Projects",
    "ISFVSN": "2",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "rotXW", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 2.0, "LABEL": "4D Rotation XW"},
        {"NAME": "rotYZ", "TYPE": "float", "DEFAULT": 0.3, "MIN": 0.0, "MAX": 2.0, "LABEL": "4D Rotation YZ"},
        {"NAME": "rotXY", "TYPE": "float", "DEFAULT": 0.2, "MIN": 0.0, "MAX": 2.0, "LABEL": "3D Rotation XY"},
        {"NAME": "innerScale", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.2, "MAX": 0.9},
        {"NAME": "lineWeight", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 3.0},
        {"NAME": "glowColor", "TYPE": "color", "DEFAULT": [0.3, 0.5, 1.0, 1.0]},
        {"NAME": "trailLength", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "vertexGlow", "TYPE": "float", "DEFAULT": 1.5, "MIN": 0.0, "MAX": 4.0},
        {"NAME": "perspective4D", "TYPE": "float", "DEFAULT": 2.0, "MIN": 1.0, "MAX": 4.0}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

#define PI 3.14159265359

float lineSeg(vec2 p, vec2 a, vec2 b){
    vec2 pa=p-a,ba=b-a;
    float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
    return length(pa-ba*h);
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*RENDERSIZE.xy)/RENDERSIZE.y;
    float t = TIME * speed;
    
    float size = 0.25;
    
    // 16 vertices of tesseract
    vec2 projected[16];
    float depths[16];
    
    for(int i=0; i<16; i++){
        // 4D coordinates from bit pattern
        vec4 v = vec4(
            float((i>>0)&1)-0.5,
            float((i>>1)&1)-0.5,
            float((i>>2)&1)-0.5,
            float((i>>3)&1)-0.5
        ) * size * 2.0;
        
        // 4D rotations
        float a1 = t * rotXW;
        float c1=cos(a1),s1=sin(a1);
        float tmp = v.x*c1-v.w*s1;
        v.w = v.x*s1+v.w*c1;
        v.x = tmp;
        
        float a2 = t * rotYZ;
        float c2=cos(a2),s2=sin(a2);
        tmp = v.y*c2-v.z*s2;
        v.z = v.y*s2+v.z*c2;
        v.y = tmp;
        
        // 4D to 3D projection
        float w4 = perspective4D / (perspective4D + v.w);
        vec3 p3 = v.xyz * w4;
        
        // 3D rotation
        float a3 = t * rotXY;
        float c3=cos(a3),s3=sin(a3);
        p3.xy = vec2(p3.x*c3-p3.y*s3, p3.x*s3+p3.y*c3);
        
        float a4 = t * rotXY * 0.7;
        float c4=cos(a4),s4=sin(a4);
        p3.xz = vec2(p3.x*c4+p3.z*s4, -p3.x*s4+p3.z*c4);
        
        // 3D to 2D projection
        float w3 = 1.5 / (1.5 + p3.z);
        projected[i] = p3.xy * w3;
        depths[i] = p3.z;
    }
    
    vec3 col = vec3(0.0);
    float w = 0.002 * lineWeight;
    
    // 32 edges of tesseract: connect vertices differing by one bit
    for(int i=0; i<16; i++){
        for(int bit=0; bit<4; bit++){
            int j = i ^ (1 << bit);
            if(j > i){ // avoid duplicates
                float ld = lineSeg(uv, projected[i], projected[j]);
                
                float avgDepth = (depths[i]+depths[j])*0.5;
                float zBright = 0.3 + 0.7*(0.5+0.5*avgDepth/size);
                
                // Color by which dimension the edge spans
                float hue = float(bit) * 0.25;
                vec3 edgeCol = 0.5+0.5*cos(6.28*(hue+vec3(0.0,0.33,0.67)));
                edgeCol = mix(edgeCol, glowColor.rgb, 0.5);
                
                float glow = w/(ld+w) * zBright;
                col += edgeCol * glow * 0.2;
                
                // Soft bloom
                col += edgeCol * exp(-ld*ld/(0.001*lineWeight)) * zBright * 0.03;
            }
        }
    }
    
    // Vertex glow
    for(int i=0; i<16; i++){
        float vd = length(uv - projected[i]);
        float zBright = 0.3+0.7*(0.5+0.5*depths[i]/size);
        
        // Larger glow for outer vertices
        float isOuter = float((i>>3)&1);
        float glowSize = mix(0.8, 1.2, isOuter);
        
        col += glowColor.rgb * vertexGlow * 0.003 * glowSize/(vd*vd+0.0005) * zBright;
    }
    
    // Trail echo (previous frame positions)
    if(trailLength > 0.0){
        float tPrev = t - 0.05 * trailLength;
        for(int i=0; i<16; i++){
            vec4 v = vec4(
                float((i>>0)&1)-0.5,
                float((i>>1)&1)-0.5,
                float((i>>2)&1)-0.5,
                float((i>>3)&1)-0.5
            ) * size * 2.0;
            
            float c1=cos(tPrev*rotXW),s1=sin(tPrev*rotXW);
            float tmp=v.x*c1-v.w*s1; v.w=v.x*s1+v.w*c1; v.x=tmp;
            float c2=cos(tPrev*rotYZ),s2=sin(tPrev*rotYZ);
            tmp=v.y*c2-v.z*s2; v.z=v.y*s2+v.z*c2; v.y=tmp;
            float w4=perspective4D/(perspective4D+v.w);
            vec3 p3=v.xyz*w4;
            float c3=cos(tPrev*rotXY),s3=sin(tPrev*rotXY);
            p3.xy=vec2(p3.x*c3-p3.y*s3,p3.x*s3+p3.y*c3);
            float c4=cos(tPrev*rotXY*0.7),s4=sin(tPrev*rotXY*0.7);
            p3.xz=vec2(p3.x*c4+p3.z*s4,-p3.x*s4+p3.z*c4);
            float w3=1.5/(1.5+p3.z);
            vec2 prevProj=p3.xy*w3;
            
            float vd=length(uv-prevProj);
            col += glowColor.rgb * 0.3 * trailLength * 0.001/(vd*vd+0.0003);
        }
    }
    
    col = pow(col, vec3(0.9));
    gl_FragColor = vec4(col, 1.0);
}
