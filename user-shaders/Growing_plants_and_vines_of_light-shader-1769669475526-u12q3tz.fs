/*{
  "DESCRIPTION": "Growing plants and vines of light",
  "CREDIT": "AI Generated",
  "CATEGORIES": ["generator", "geometric"],
  "INPUTS": [
    { "NAME": "growthSpeed", "TYPE": "float", "DEFAULT": 0.5, "MIN": 0.1, "MAX": 2.0, "LABEL": "Growth Speed" },
    { "NAME": "vineThickness", "TYPE": "float", "DEFAULT": 0.02, "MIN": 0.01, "MAX": 0.05, "LABEL": "Vine Thickness" },
    { "NAME": "lightIntensity", "TYPE": "float", "DEFAULT": 1.0, "MIN": 0.5, "MAX": 2.0, "LABEL": "Light Intensity" },
    { "NAME": "vineDensity", "TYPE": "float", "DEFAULT": 3.0, "MIN": 1.0, "MAX": 5.0, "LABEL": "Vine Density" }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  float time = TIME * growthSpeed;

  float distance = length(uv - vec2(0.5, 0.0));
  float angle = atan(uv.x - 0.5, uv.y);

  float vineValue = sin(distance * 20.0 - time * 5.0 + angle * vineDensity);

  float vineMask = smoothstep(vineThickness, 0.0, abs(vineValue));

  float light = vineMask * lightIntensity;

  gl_FragColor = vec4(light, light * 0.8, light * 0.5, 1.0);
}