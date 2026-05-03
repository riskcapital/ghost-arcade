/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Center crosshair and concentric rings for focus and keystone setup",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME":"rings","TYPE":"float","MIN":2.0,"MAX":20.0,"DEFAULT":8.0,"LABEL":"Rings"},
        {"NAME":"lineWidth","TYPE":"float","MIN":0.001,"MAX":0.03,"DEFAULT":0.005,"LABEL":"Line Width"},
        {"NAME":"bg","TYPE":"color","DEFAULT":[0.0,0.0,0.0,1.0],"LABEL":"Background"},
        {"NAME":"fg","TYPE":"color","DEFAULT":[1.0,1.0,1.0,1.0],"LABEL":"Foreground"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec2 p = uv - 0.5;
    p.x *= RENDERSIZE.x / RENDERSIZE.y;
    float d = length(p);

    float cross = 0.0;
    cross += 1.0 - smoothstep(lineWidth, lineWidth * 2.0, abs(uv.x - 0.5));
    cross += 1.0 - smoothstep(lineWidth, lineWidth * 2.0, abs(uv.y - 0.5));

    float ringStep = 0.5 / rings;
    float r = abs(fract(d / ringStep) - 0.5) * 2.0;
    float ring = 1.0 - smoothstep(0.0, lineWidth * 30.0, r);

    vec3 color = bg.rgb;
    color = mix(color, fg.rgb, clamp(cross, 0.0, 1.0));
    color = mix(color, fg.rgb * 0.8, ring * 0.8);

    gl_FragColor = vec4(color, 1.0);
}

