/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "EQ-style vertical bars. Each bar's height is a sine of (column index + TIME) — looks like a graphic equalizer. When the audio FFT routing ships, wire individual bands per bar.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "barCount", "TYPE": "float", "DEFAULT": 16.0, "MIN": 2.0, "MAX": 64.0},
        {"NAME": "speed", "TYPE": "float", "DEFAULT": 2.0, "MIN": 0.0, "MAX": 8.0},
        {"NAME": "minHeight", "TYPE": "float", "DEFAULT": 0.05, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "maxHeight", "TYPE": "float", "DEFAULT": 0.95, "MIN": 0.05, "MAX": 1.0},
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [0.2, 1.0, 0.6, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.05, 0.05, 0.08, 1.0]}
    ]
}*/

void main() {
    vec2 uv = gl_FragCoord.xy / RENDERSIZE.xy;
    float col = floor(uv.x * barCount);
    float colCenter = (col + 0.5) / barCount;
    float gap = 0.06 / barCount; // tiny gutter between bars
    float inBar = step(abs(uv.x - colCenter), 0.5 / barCount - gap);
    float wave = 0.5 + 0.5 * sin(TIME * speed + col * 0.7);
    wave = mix(wave, 1.0, audioLevel * 0.7);
    float h = mix(minHeight, maxHeight, wave);
    float lit = step(uv.y, h) * inBar;
    vec3 c = mix(color2.rgb, color1.rgb, lit);
    gl_FragColor = vec4(c, 1.0);
}
