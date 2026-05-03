/*
{
  "CATEGORIES" : [
    "Automatically Converted",
    "GLSLSandbox"
  ],
  "INPUTS" : [
	{
      "NAME" : "speed",
      "TYPE" : "float",
      "MAX" : 5.0,
      "DEFAULT" : 1.0,
      "MIN" : -3.0
    },
    {
      "NAME" : "r_par",
      "TYPE" : "float",
      "MAX" : 50.0,
      "DEFAULT" : 20.0,
      "MIN" : 0.0
    },
    {
      "NAME" : "zoom",
      "TYPE" : "float",
      "MAX" : 3.0,
      "DEFAULT" : 1.0,
      "MIN" : 0.2
    },
    {
      "NAME" : "par_2",
      "TYPE" : "float",
      "MAX" : 0.01,
      "DEFAULT" : 0.001,
      "MIN" : 0.0001
    }
  ],
  "DESCRIPTION" : "Automatically converted from http:\/\/glslsandbox.com\/e#61327.0"
}
*/


#ifdef GL_ES
precision mediump float;
#endif

// #extension GL_OES_standard_derivatives : enable


void main(void){
	
	vec2 p = (gl_FragCoord.xy * 2.0 - RENDERSIZE) / min(RENDERSIZE.x, RENDERSIZE.y)/zoom;
	vec3 color = vec3(abs(sin(TIME / 2.) / 2.), 0.3, 0.5);
	
	float f = 0.0;
	float PI = 3.141592;
	for(float i = 0.0; i < 10.0; i++){
		
		float s = sin((TIME*speed) + i * PI / r_par) * .5;
		float c = cos((TIME*speed) + i * PI / r_par) * .5;
 
		f += par_2 / ((p.x + c) * (p.y + s) );
	}
	
	
	gl_FragColor = vec4(vec3(f * color), 1.0);
}