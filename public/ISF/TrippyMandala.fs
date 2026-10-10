/*{
    "DESCRIPTION": "Infinite Mandala Patterns with Psychedelic Zoom",
    "CREDIT": "Ghost Arcade",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator", "Psychedelic"],
    "INPUTS": [
        {
            "NAME": "zoom_speed",
            "TYPE": "float",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 5.0,
            "DESCRIPTION": "Speed of the zoom effect"
        },
        {
            "NAME": "color_speed",
            "TYPE": "float",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 5.0,
            "DESCRIPTION": "Speed of the color transitions"
        },
        {
            "NAME": "chaos_factor",
            "TYPE": "float",
            "DEFAULT": 0.5,
            "MIN": 0.0,
            "MAX": 2.0,
            "DESCRIPTION": "Intensity of the chaotic effect"
        },
        {
            "NAME": "symmetry",
            "TYPE": "float",
            "DEFAULT": 6.0,
            "MIN": 1.0,
            "MAX": 20.0,
            "DESCRIPTION": "Number of symmetrical sections"
        }
    ]
}*/

void main() {
    vec2 uv = (isf_FragNormCoord - 0.5) * 2.0;
    uv.x *= RENDERSIZE.x / RENDERSIZE.y; // Correct aspect ratio

    // Zoom effect
    uv *= zoom_speed * (1.0 + sin(TIME * 0.1));

    float angle = atan(uv.y, uv.x);
    float radius = length(uv);

    // Mandala symmetry
    angle = mod(angle, 2.0 * 3.14159 / symmetry) * symmetry;

    // Chaos factor increases with zoom
    float chaos = chaos_factor * radius * TIME;

    // Mandala pattern
    float pattern = sin(angle * 5.0 + chaos) * cos(radius * 20.0 + chaos);

    // Psychedelic color effect
    vec3 color = 0.5 + 0.5 * cos(TIME * color_speed + vec3(0, 2, 4) + pattern * 10.0);

    // Output to screen
    gl_FragColor = vec4(color, 1.0);
}