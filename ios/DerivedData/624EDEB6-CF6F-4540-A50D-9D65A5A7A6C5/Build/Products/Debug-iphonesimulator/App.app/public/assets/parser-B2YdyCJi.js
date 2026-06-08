const $=["audioLevel","audioBass","audioMid","audioHigh","audioBeat","audioBeatPhase","audioBPM","audioSpectralCentroid","audioFFT","audioWaveform","sampleFFT","sampleWaveform"];function M(i){return $.some(s=>new RegExp(`\\b${s}\\b`).test(i))}function D(i){const s=i.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);let e={INPUTS:[]},r=i;if(s)try{e=JSON.parse(s[1]),r=i.replace(s[0],"")}catch(o){console.warn("Failed to parse ISF metadata:",o)}return e.INPUTS||(e.INPUTS=[]),{metadata:e,fragmentShader:F(r,e),isAudioReady:M(r)}}function g(i){let s=i;const e=new Set,r=/#define\s+(\w+)\s+(\d+)/g;let o;for(;(o=r.exec(s))!==null;)e.add(o[1]);function d(n){const a=n.trim();return/^\s*-?\d+\s*$/.test(a)||e.has(a)}s=s.replace(/for\s*\(\s*int\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([^;]+?);\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)/g,(n,a,u,l,t,f)=>{const c=d(u),m=d(t);if(c&&m)return n;const E=c?u.trim():"0";let I=m?t.trim():"100";const p=`for(int ${a} = ${E}; ${a} ${l} ${I}; ${a}${f})`;return(!c||!m)&&console.log("[ISF Parser] Fixed non-constant loop:",n,"->",p),p});const v=/for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\w+)\s*;\s*\1\s*\+\+\s*\)/g;return s=s.replace(v,(n,a,u,l)=>{if(d(l))return n;const t=`for(int ${a} = ${u}; ${a} < 64; ${a}++) /* was: ${l} */`;return console.log("[ISF Parser] Fixed variable loop bound:",n,"->",t),t}),s=s.replace(/for\s*\(\s*int\s+(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\d+)\s*;\s*\1\s*\+=\s*(\w+)\s*\)/g,(n,a,u,l,t)=>{if(/^\d+$/.test(t))return n;const f=`for(int ${a} = ${u}; ${a} < ${l}; ${a}++) /* was: += ${t} */`;return console.log("[ISF Parser] Fixed variable step:",n,"->",f),f}),s=s.replace(/for\s*\(\s*float\s+(\w+)\s*=\s*([^;]+?);\s*\1\s*([<>=!]+)\s*([\d.]+)\s*;\s*\1\s*(\+\+|--|\+=\s*[\d.]+|-=\s*[\d.]+)\s*\)/g,(n,a,u,l,t,f)=>{if(/^\s*-?[\d.]+\s*$/.test(u))return n;const c=`for(float ${a} = 0.0; ${a} ${l} ${t}; ${a}${f})`;return console.log("[ISF Parser] Fixed float loop non-constant init:",n,"->",c),c}),s=s.replace(/for\s*\(\s*float\s+(\w+)\s*=\s*(-?[\d.]+)\s*;\s*\1\s*([<>=!]+)\s*(-?[\d.]+)\s*;\s*\1\s*\+=\s*([^)]+?)\s*\)/g,(n,a,u,l,t,f)=>{if(/^\s*-?[\d.]+\s*$/.test(f))return n;const c=Math.abs(parseFloat(t)-parseFloat(u)),m=Math.min(Math.ceil(c*30),128),E=`for(float ${a} = ${u}; ${a} ${l} ${t}; ${a} += (${t} - (${u})) / ${m}.0)`;return console.log("[ISF Parser] Fixed float loop non-constant step:",n,"->",E),E}),/\bwhile\s*\(/.test(s)&&!/for\s*\(\s*;\s*;\s*\)/.test(s)&&console.warn("[ISF Parser] Shader contains while loop - may cause issues"),s}function F(i,s){let e=g(i);const r=/\b(dFdx|dFdy|fwidth)\s*\(/.test(e);e=e.replace(/^\s*vec3\s+iResolution\s*=\s*vec3\s*\(\s*RENDERSIZE\.x\s*,\s*RENDERSIZE\.y\s*,\s*[\d.]+\s*\)\s*;/gm,"#define iResolution vec3(RENDERSIZE.x, RENDERSIZE.y, 1.0)"),e=e.replace(/^\s*float\s+iTime\s*=\s*TIME\s*;/gm,"#define iTime TIME"),e=e.replace(/#ifdef\s+GL_ES\s*\n\s*precision\s+(highp|mediump|lowp)\s+float\s*;\s*\n\s*#endif/g,""),e=e.replace(/^precision\s+(highp|mediump|lowp)\s+float\s*;\s*$/gm,"");let o="";r&&(o+=`#extension GL_OES_standard_derivatives : enable
`),!e.includes("uniform vec2 RENDERSIZE")&&!e.includes("uniform vec2 renderSize")&&(o+=`uniform vec2 RENDERSIZE;
`),e.includes("renderSize")&&!e.includes("uniform vec2 renderSize")&&(o+=`#define renderSize RENDERSIZE
`),e.includes("uniform float TIME")||(o+=`uniform float TIME;
`),e.includes("uniform float TIMEDELTA")||(o+=`uniform float TIMEDELTA;
`),e.includes("uniform int FRAMEINDEX")||(o+=`uniform int FRAMEINDEX;
`),e.includes("uniform vec4 DATE")||(o+=`uniform vec4 DATE;
`),o+=`varying vec2 vUv;
`;for(const n of s.INPUTS)if(!new RegExp(`uniform\\s+\\w+\\s+${n.NAME}\\s*;`).test(e))switch(n.TYPE){case"float":case"event":o+=`uniform float ${n.NAME};
`;break;case"bool":o+=`uniform bool ${n.NAME};
`;break;case"long":o+=`uniform int ${n.NAME};
`;break;case"point2D":o+=`uniform vec2 ${n.NAME};
`;break;case"color":o+=`uniform vec4 ${n.NAME};
`;break;case"image":o+=`uniform sampler2D ${n.NAME};
`,o+=`uniform vec2 _${n.NAME}_imgSize;
`;break}/vec4\s+IMG_NORM_PIXEL\s*\(/.test(e)||(o+=`
vec4 IMG_NORM_PIXEL(sampler2D img, vec2 uv) {
  return texture2D(img, uv);
}
`),/vec4\s+IMG_PIXEL\s*\(/.test(e)||(o+=`
vec4 IMG_PIXEL(sampler2D img, vec2 coord) {
  return texture2D(img, coord / RENDERSIZE);
}
`),e.includes("uniform sampler2D audioFFT")||(o+=`uniform sampler2D audioFFT;
`),e.includes("uniform sampler2D audioWaveform")||(o+=`uniform sampler2D audioWaveform;
`);const d=["audioLevel","audioBass","audioMid","audioHigh","audioBeat","audioBeatPhase","audioBPM","audioSpectralCentroid"];for(const n of d)e.includes(`uniform float ${n}`)||(o+=`uniform float ${n};
`);return e.includes("float sampleFFT(")||(o+=`
float sampleFFT(float u) {
  return texture2D(audioFFT, vec2(u, 0.5)).r;
}
`),e.includes("float sampleWaveform(")||(o+=`
float sampleWaveform(float u) {
  return texture2D(audioWaveform, vec2(u, 0.5)).r * 2.0 - 1.0;
}
`),o+=`
#define isf_FragNormCoord (gl_FragCoord.xy / RENDERSIZE)
`,e=`precision highp float;
${o}
`+e,e}function S(i){if(i.DEFAULT!==void 0)return i.DEFAULT;switch(i.TYPE){case"float":return i.MIN!==void 0?i.MIN:0;case"bool":return!1;case"long":return 0;case"point2D":return[.5,.5];case"color":return[1,1,1,1];case"event":return 0;default:return 0}}function T(i){const s={RENDERSIZE:{value:null},renderSize:{value:null},TIME:{value:0},TIMEDELTA:{value:.016},FRAMEINDEX:{value:0},DATE:{value:null},audioFFT:{value:null},audioWaveform:{value:null},audioLevel:{value:0},audioBass:{value:0},audioMid:{value:0},audioHigh:{value:0},audioBeat:{value:0},audioBeatPhase:{value:0},audioBPM:{value:0},audioSpectralCentroid:{value:0}};for(const e of i){const r=S(e);switch(e.TYPE){case"float":case"event":s[e.NAME]={value:r};break;case"bool":s[e.NAME]={value:r};break;case"long":s[e.NAME]={value:r};break;case"point2D":s[e.NAME]={value:r};break;case"color":s[e.NAME]={value:r};break;case"image":s[e.NAME]={value:null},s[`_${e.NAME}_imgSize`]={value:null};break}}return s}export{T as c,S as g,D as p};
