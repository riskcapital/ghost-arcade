/*{
    "CREDIT": "GhostArcade",
    "DESCRIPTION": "Corner pin markers and edge ticks for projector geometry setup",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Utility", "Calibration"],
    "INPUTS": [
        {"NAME":"markerSize","TYPE":"float","MIN":0.01,"MAX":0.12,"DEFAULT":0.05,"LABEL":"Marker Size"},
        {"NAME":"lineWidth","TYPE":"float","MIN":0.001,"MAX":0.02,"DEFAULT":0.004,"LABEL":"Line Width"},
        {"NAME":"bgColor","TYPE":"color","DEFAULT":[0.03,0.03,0.035,1.0],"LABEL":"Background"},
        {"NAME":"markerColor","TYPE":"color","DEFAULT":[0.5,0.95,1.0,1.0],"LABEL":"Marker Color"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

float lseg(vec2 uv, vec2 a, vec2 b, float w) {
    vec2 pa = uv - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * h);
    return 1.0 - smoothstep(w, w * 1.8, d);
}

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    vec3 color = bgColor.rgb;

    float s = markerSize;
    float w = lineWidth;
    float m = 0.0;

    m += lseg(uv, vec2(0.0, 1.0), vec2(s, 1.0), w);
    m += lseg(uv, vec2(0.0, 1.0), vec2(0.0, 1.0 - s), w);
    m += lseg(uv, vec2(1.0, 1.0), vec2(1.0 - s, 1.0), w);
    m += lseg(uv, vec2(1.0, 1.0), vec2(1.0, 1.0 - s), w);
    m += lseg(uv, vec2(0.0, 0.0), vec2(s, 0.0), w);
    m += lseg(uv, vec2(0.0, 0.0), vec2(0.0, s), w);
    m += lseg(uv, vec2(1.0, 0.0), vec2(1.0 - s, 0.0), w);
    m += lseg(uv, vec2(1.0, 0.0), vec2(1.0, s), w);

    m += lseg(uv, vec2(0.5, 0.0), vec2(0.5, s * 0.8), w);
    m += lseg(uv, vec2(0.5, 1.0), vec2(0.5, 1.0 - s * 0.8), w);
    m += lseg(uv, vec2(0.0, 0.5), vec2(s * 0.8, 0.5), w);
    m += lseg(uv, vec2(1.0, 0.5), vec2(1.0 - s * 0.8, 0.5), w);

    color = mix(color, markerColor.rgb, clamp(m, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
}

