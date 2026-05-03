
/*{
    "CREDIT": "",
    "DESCRIPTION": "",
    "CATEGORIES": [ "generator" ],
    "INPUTS": [
        
    ]
}*/

/*
ISF Reference
=========================

1) Valid inputs:
    - "event"
    - "bool"
    - "long"
    - "float"
    - "point2D"
    - "color"
    - "image"
    - "audio"
    - "audioFFT"

2) Functions:
    - IMG_NORM_PIXEL() -> get a pixel from input with normalized coordinates
    - IMG_PIXEL() -> get a pixel from input with screen space coordinates

3) Predefined variables:
    - RENDERSIZE (resolution of the shader)
    - TIME (run time)
    - gl_FragCoord.xy (screen space coordinates of current fragment)
    - isf_FragNormCoord.xy (normalized coordinates)

To learn more see:
https://github.com/mrRay/ISF_Spec/
*/

#define PI 3.1415926535
float TWO_PI = PI*2.;

float map(float x, float in_min, float in_max, float out_min, float out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}

float ease(float p, float g){
  if (p < 0.5)
    return 0.5 * pow(2.*p, g);
  else
    return 1. - 0.5 * pow(2.*(1. - p), g);
}

//  Function from Iñigo Quiles
//  www.iquilezles.org/www/articles/functions/functions.htm
float pcurve( float x, float a, float b ){
    float k = pow(a+b,a+b) / (pow(a,a)*pow(b,b));
    return k * pow( x, a ) * pow( 1.0-x, b );
}

// Precision-adjusted variations of https://www.shadertoy.com/view/4djSRW
float hash(float p) { p = fract(p * 0.011); p *= p + 7.5; p *= p + p; return fract(p); }
float hash(vec2 p) {vec3 p3 = fract(vec3(p.xyx) * 0.13); p3 += dot(p3, p3.yzx + 3.333); return fract((p3.x + p3.y) * p3.z); }

float noise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
}

vec2 random2(vec2 st){
    st = vec2( dot(st,vec2(127.1,311.7)),
              dot(st,vec2(269.5,183.3)) );
    return -1.0 + 2.0*fract(sin(st)*493958.5453123);
}


// Gradient Noise by Inigo Quilez - iq/2013
// https://www.shadertoy.com/view/XdXGW8
float gradientNoise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);

    vec2 u = f*f*(3.0-2.0*f);

    return mix( mix( dot( random2(i + vec2(0.0,0.0) ), f - vec2(0.0,0.0) ),
                     dot( random2(i + vec2(1.0,0.0) ), f - vec2(1.0,0.0) ), u.x),
                mix( dot( random2(i + vec2(0.0,1.0) ), f - vec2(0.0,1.0) ),
                     dot( random2(i + vec2(1.0,1.0) ), f - vec2(1.0,1.0) ), u.x), u.y);
}

float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);

	// Four corners in 2D of a tile
	float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    // Simple 2D lerp using smoothstep envelope between the values.
	// return vec3(mix(mix(a, b, smoothstep(0.0, 1.0, f.x)),
	//			mix(c, d, smoothstep(0.0, 1.0, f.x)),
	//			smoothstep(0.0, 1.0, f.y)));

	// Same code, with the clamps in smoothstep and common subexpressions
	// optimized away.
    vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}


float noise(vec3 x) {
    const vec3 step = vec3(110, 241, 171);

    vec3 i = floor(x);
    vec3 f = fract(x);
 
    // For performance, compute the base input to a 1D hash from the integer part of the argument and the 
    // incremental change to the 1D based on the 3D -> 1D wrapping
    float n = dot(i, step);

    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix( hash(n + dot(step, vec3(0, 0, 0))), hash(n + dot(step, vec3(1, 0, 0))), u.x),
                   mix( hash(n + dot(step, vec3(0, 1, 0))), hash(n + dot(step, vec3(1, 1, 0))), u.x), u.y),
               mix(mix( hash(n + dot(step, vec3(0, 0, 1))), hash(n + dot(step, vec3(1, 0, 1))), u.x),
                   mix( hash(n + dot(step, vec3(0, 1, 1))), hash(n + dot(step, vec3(1, 1, 1))), u.x), u.y), u.z);
}

#define NUM_NOISE_OCTAVES 3

float fbm(float x) {
	float v = 0.0;
	float a = 0.5;
	float shift = float(100);
	for (int i = 0; i < NUM_NOISE_OCTAVES; ++i) {
		v += a * noise(x);
		x = x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}


float fbm(vec2 x) {
	float v = 0.0;
	float a = 0.5;
	vec2 shift = vec2(100);
	// Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
	for (int i = 0; i < NUM_NOISE_OCTAVES; ++i) {
		v += a * noise(x);
		x = rot * x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}


float fbm(vec3 x) {
	float v = 0.0;
	float a = 0.5;
	vec3 shift = vec3(100);
	for (int i = 0; i < NUM_NOISE_OCTAVES; ++i) {
		v += a * noise(x);
		x = x * 2.0 + shift;
		a *= 0.5;
	}
	return v;
}


float distFromCenter(vec2 uv){
    vec2 p = uv - vec2(.5,.5);
	p.x *= RENDERSIZE.x / RENDERSIZE.y;
	return length(p);
}

float tunnelScalarOffset(vec2 uv, float scale, float power ){
  float dist = distFromCenter(uv);
  return scale*pow(dist,power);
}

vec4 glowingTunnel(vec2 uv, float t){
    return vec4(
        tunnelScalarOffset(uv, sin(t), 2.),
        tunnelScalarOffset(uv, cos(t+1.8), 2.2),
        tunnelScalarOffset(uv, sin(t+1.5), 2.3),
        1.
    );
}

vec4 centeredDistanceField(vec2 uv){
    return vec4(vec3(distFromCenter(uv)), 1.);
}

float upwelling(vec2 uv, float t, float noiseIntensity, vec2 noiseScale, float phase){
    
    float uvNoise = fbm(uv*noiseScale*fbm( vec3(uv*noiseScale, t*0.3) ))*noiseIntensity;
    float noiseOffset = uvNoise * smoothstep(0.32, 0.22, distFromCenter(uv));
    float waveOffset = smoothstep(0.8, 0.001, distFromCenter(uv))*18.;
    
    float waveform1 = sin(TWO_PI*(t+noiseOffset+waveOffset+phase));
    return map(waveform1, -1.,1., 0.,1.);
}

vec4 fullscreenMelt(vec2 uv, float t){
    
    float diminishingPhaseShift = smoothstep(0.5, 1., 1.-distFromCenter(uv));
    
    float upwellRed = upwelling( uv, t, 6., vec2(5.5,3.5), 0.1 * diminishingPhaseShift );
    float upwellGreen = upwelling( uv, t, 6., vec2(5.5,3.5), 0.3 * diminishingPhaseShift);
    float upwellBlue = upwelling( uv, t, 6., vec2(5.5,3.5), 0.6 * diminishingPhaseShift);
    
    return vec4(upwellRed, upwellGreen, upwellBlue, 1.0);
}

void main() {
	vec2 uv = gl_FragCoord.xy/RENDERSIZE.xy;

    float fadeFromCenter = 1.-min(ease(distFromCenter(uv)+0.2, 20.), 1.);
    vec4 vignette =  vec4(vec3(fadeFromCenter), 1.);

    gl_FragColor = fullscreenMelt(uv, TIME) * vignette; //vec4(vec3(map(sin(TIME+pcurve(distFromCenter(uv), 3., 2.)*10.), -1.,1., 0.,1.)), 1.);
}