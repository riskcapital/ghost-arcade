/*{
	"DESCRIPTION": "Your shader description",
	"CREDIT": "by you",
	"CATEGORIES": [
		"Your category"
	],
	"INPUTS": [
	{
			"NAME": "ITERATIONS",
			"TYPE": "float",
			"DEFAULT": 80.0,
			"MIN": 0.0,
			"MAX": 100.0
		},
		{
			"NAME": "TIMEOFFSET",
			"TYPE": "float",
			"DEFAULT": 0.0,
			"MIN": -1.0,
			"MAX": 1.0
		},
		{
			"NAME": "SPIRAL",
			"TYPE": "float",
			"DEFAULT": 0.87,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "STRUCTURE",
			"TYPE": "float",
			"DEFAULT": 0.65,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "ZOOM",
			"TYPE": "float",
			"DEFAULT": 0.1,
			"MIN": -1.0,
			"MAX": 1.0
		},
		{
			"NAME": "TINT",
			"TYPE": "float",
			"DEFAULT": 1.0,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "COLOUR",
			"TYPE": "float",
			"DEFAULT": 1.0,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "ShiftX",
			"TYPE": "float",
			"DEFAULT": 0.5,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "ShiftY",
			"TYPE": "float",
			"DEFAULT": 0.5,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "DustDensity",
			"TYPE": "float",
			"DEFAULT": 0.02,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "CentralCore",
			"TYPE": "float",
			"DEFAULT": 0.9,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "CoreHaze",
			"TYPE": "float",
			"DEFAULT": 0.066,
			"MIN": 0.001,
			"MAX": 1.0
		},
		{
			"NAME": "CoreIntensity",
			"TYPE": "float",
			"DEFAULT": 0.9,
			"MIN": 0.0,
			"MAX": 1.0
		},
		{
			"NAME": "StarsGreen",
			"TYPE": "float",
			"DEFAULT": 0.56,
			"MIN": 0.001,
			"MAX": 1.0
		},
		{
			"NAME": "StarsBlue",
			"TYPE": "float",
			"DEFAULT": 0.51,
			"MIN": 0.001,
			"MAX": 1.0
		}
	]
}*/

vec3 iResolution = vec3(RENDERSIZE.x, RENDERSIZE.y*(RENDERSIZE.x/RENDERSIZE.y), 1.);
float iGlobalTime = TIME;


// Based on: "Galaxy of Universes" by FabriceNeyret2: https://www.shadertoy.com/view/XdsSRS
// Optimized from original by Dave_Hoskins: https://www.shadertoy.com/view/MdXSzS


void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
	vec2 uv = (fragCoord.xy/iResolution.xy);
	
	uv.x -= ShiftX;
	uv.y -= ShiftY/(RENDERSIZE.x/RENDERSIZE.y);
	
	float len = length(uv.xy)*(1.0-ZOOM);
	
    float t = .1*iGlobalTime+TIMEOFFSET;
	float time = t  +  (5.+sin(t))*.11 / (len+1.-SPIRAL); // spiraling
	float si = sin(time), co = cos(time);
	uv *= mat2(co, si, -si, co);                    // rotation

	float c=0., v1=0., v2=0., v3;  vec3 p;
	
	for (int i = 0; i < 100; i++) {
		
		if (i > int(ITERATIONS)) {break;}
		
		p = .035*float(i) *  vec3(uv, 1.);
		p += vec3(.622,  .3,  -1.5 -sin(t*1.3)*.1);
		
		for (int i = 0; i < 10; i++)                // IFS
		
			p = abs(p) / dot(p,p) - STRUCTURE;

		float p2 = dot(p,p)*.0015;
		v1 += p2 * ( 1.8 + sin(len*13.0  +.5 -t*2.) );
		v2 += p2 * ( 1.5 + sin(len*13.5 +2.2 -t*3.) );
	}
	
	c = length(p.xy) * DustDensity;
	v1 *= smoothstep(StarsGreen*.7 , .0, len);
	v2 *= smoothstep(StarsBlue*.7 , .0, len);
	v3  = smoothstep(CoreHaze, .0, len/2.);

	vec3 col = vec3(c,  (v2+c)*.25,  v1);
	col = col  +  v3*(.7+CentralCore *.3)*CoreIntensity;                      // useless: clamp(col, 0.,1.)
	fragColor = vec4(col.r*COLOUR,col.g,col.b*TINT, 1.);
}

void main(void) {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}