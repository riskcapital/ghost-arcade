/*
{
  "CATEGORIES" : [
    "Automatically Converted",
    "GLSLSandbox"
  ],
  "INPUTS" : [

  ],
  "DESCRIPTION" : "Automatically converted from http:\/\/glslsandbox.com\/e#59411.1"
}
*/


// global remix - Del 30/10/2019
#ifdef GL_ES
precision highp float;
#endif

// #extension GL_OES_standard_derivatives : enable


float snow(vec2 uv,float scale)
{
	float _t = TIME*0.2;
	 uv.x+=_t/scale; 
	uv*=scale;vec2 s=floor(uv),f=fract(uv),p;float k=40.,d;
	p=.5+.35*sin(8.*fract(sin((s+p+scale)*mat2(2,4,7,6))*6.))-f;d=length(p);k=min(d,k);
	k=smoothstep(0.,k,sin(f.x+f.y)*0.009);
    	return k;
}

void main(void){
	vec2 uv=(gl_FragCoord.xy*2.-RENDERSIZE.xy)/min(RENDERSIZE.x,RENDERSIZE.y); 
	float dd = 1.0-length(uv);
	uv.x += sin(TIME*0.08);
	uv.y += sin(uv.x*1.4)*0.2;
	uv.x *= 0.07;
	float c=snow(uv,30.)*.3;
	c+=snow(uv,25.)*.5;
	c+=snow(uv,15.)*.8;
	c+=snow(uv,10.);
	c+=snow(uv,10.);
	c+=snow(uv,6.);
	c+=snow(uv,5.);
	c*=0.2/dd;
	vec3 finalColor=(vec3(0.7,0.8,0.9))*c*30.0;
	gl_FragColor = vec4(finalColor,1);
}