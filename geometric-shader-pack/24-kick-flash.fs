/*{
    "CREDIT": "Ghost Arcade",
    "DESCRIPTION": "Full-screen flash that fires when audioLevel crosses threshold, then decays. Wire audioLevel to a kick-band envelope and decay to taste — looks like a stadium camera flash on every drum hit.",
    "ISFVSN": "2.0",
    "CATEGORIES": [ "Geometric", "Generator" ],
    "INPUTS": [
        {"NAME": "audioLevel", "TYPE": "float", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "threshold", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.0, "MAX": 1.0},
        {"NAME": "decay", "TYPE": "float", "DEFAULT": 0.55, "MIN": 0.05, "MAX": 1.0},
        {"NAME": "color1", "TYPE": "color", "DEFAULT": [1.0, 1.0, 1.0, 1.0]},
        {"NAME": "color2", "TYPE": "color", "DEFAULT": [0.0, 0.0, 0.0, 1.0]}
    ]
}*/

void main() {
    // Hard threshold: above = full flash, below = decay-shaped reading of the level.
    float over = step(threshold, audioLevel);
    float fall = pow(audioLevel / max(threshold, 0.001), 1.0 / max(decay, 0.05));
    float lit = max(over, clamp(fall, 0.0, 1.0));
    vec3 col = mix(color2.rgb, color1.rgb, lit);
    gl_FragColor = vec4(col, 1.0);
}
