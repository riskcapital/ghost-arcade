/*{
  "CREDIT": "by mojovideotech",
  "CATEGORIES": [
    "generator"
  ],
  "INPUTS": [
    {
      "NAME": "grid_size",
      "TYPE": "point2D",
      "DEFAULT": [
        40,
        40
      ],
      "MAX": [
        360,
        360
      ],
      "MIN": [
        6,
        6
      ]
    },
    {
      "NAME": "bright",
      "TYPE": "float",
      "DEFAULT": 0.2,
      "MIN": 0.1,
      "MAX": 0.5
    },
    {
      "NAME": "glow_size",
      "TYPE": "float",
      "DEFAULT": 2,
      "MIN": -20,
      "MAX": 20
    },
    {
      "NAME": "rate",
      "TYPE": "float",
      "DEFAULT": 0.16,
      "MIN": -2,
      "MAX": 2
    },
    {
      "NAME": "rndseed",
      "TYPE": "point2D",
      "DEFAULT": [
        12.9898,
        78.233
      ],
      "MAX": [
        233,
        377
      ],
      "MIN": [
        5,
        7
      ]
    }
  ],
  "DESCRIPTION": ""
}*/
 
 
////////////////////////////////////////////////////////////
// AnotherGridThingy  by mojovideotech
//
// based on :
// glslsandbox/e#22020.0
//
// Creative Commons Attribution-NonCommercial-ShareAlike 3.0
////////////////////////////////////////////////////////////



float rnd(vec2 seed) {
	float value = fract(sin(dot(seed,vec2(rndseed)))*43758.5453);
	return value;
}

float step_to(float value, float steps) {
	float closest_int = floor(value/steps);
	return closest_int * steps;
}

vec4 dot_grid(vec2 pos, bool with_grid) {
	float value = floor(mod(pos.x,grid_size.x))*floor(mod(pos.y,grid_size.y));		
	value = clamp(value, 0.0, 1.0);
	float c_time = TIME*rate;
	vec2 step_pos = vec2(step_to(pos.x,grid_size.x),step_to(pos.y,grid_size.y));
	vec2 norm_pos = step_pos.xy/RENDERSIZE.xy;
	norm_pos = vec2(norm_pos.x+rnd(norm_pos),norm_pos.y+rnd(norm_pos ));
	float r = fract(sin(norm_pos.x));
	float g = fract(sin(norm_pos.y+abs(c_time)));
	float b = abs(r-g);
	if(with_grid == false){value = 1.0;}
	return vec4(r,g,b,1.0) * value;
}

vec4 glow(vec2 pos) {
	vec4 color = clamp(dot_grid(pos,true)*bright,0.0,1.0);
	color += clamp(dot_grid(vec2(pos.x-glow_size,pos.y),false)*bright,0.0,1.0);
	color += clamp(dot_grid(vec2(pos.x+glow_size,pos.y),false)*bright,0.0,1.0);
	color += clamp(dot_grid(vec2(pos.x,pos.y-glow_size),false)*bright,0.0,1.0);
	color += clamp(dot_grid(vec2(pos.x,pos.y+glow_size),false)*bright,0.0,1.0);
	return color;
}

void main( void ) 
{
	vec2 position = gl_FragCoord.xy;
	gl_FragColor = glow(position);
}