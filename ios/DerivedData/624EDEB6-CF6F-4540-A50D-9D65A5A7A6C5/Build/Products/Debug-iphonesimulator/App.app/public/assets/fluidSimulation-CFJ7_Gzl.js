import{W as v,H as h,R as d,z as u,S as x,O as S,P as D,M as w,V as n,A as a,B as f,C as y}from"./main-4BlCn4xa.js";const T={SMOKE:0},l=`
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  uniform vec2 texelSize;

  void main() {
    vUv = uv;
    vL = vUv - vec2(texelSize.x, 0.0);
    vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y);
    vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,s=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,b=`
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 texelSize;
  uniform float dt;
  uniform float dissipation;
  varying vec2 vUv;

  void main() {
    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
    vec4 result = texture2D(uSource, coord);
    float decay = 1.0 + dissipation * dt;
    gl_FragColor = result / decay;
  }
`,C=`
  precision highp float;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uVelocity, vL).x;
    float R = texture2D(uVelocity, vR).x;
    float T = texture2D(uVelocity, vT).y;
    float B = texture2D(uVelocity, vB).y;

    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`,R=`
  precision highp float;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uVelocity, vL).y;
    float R = texture2D(uVelocity, vR).y;
    float T = texture2D(uVelocity, vT).x;
    float B = texture2D(uVelocity, vB).x;

    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`,V=`
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform float curl;
  uniform float dt;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uCurl, vL).x;
    float R = texture2D(uCurl, vR).x;
    float T = texture2D(uCurl, vT).x;
    float B = texture2D(uCurl, vB).x;
    float C = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= curl * C;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * dt;
    velocity = min(max(velocity, -1000.0), 1000.0);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`,z=`
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  varying vec2 vUv;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;

  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;
    float C = texture2D(uDivergence, vUv).x;

    float pressure = (L + R + T + B - C) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`,U=`
  precision highp float;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  varying vec2 vL;
  varying vec2 vR;
  varying vec2 vT;
  varying vec2 vB;
  varying vec2 vUv;

  void main() {
    float L = texture2D(uPressure, vL).x;
    float R = texture2D(uPressure, vR).x;
    float T = texture2D(uPressure, vT).x;
    float B = texture2D(uPressure, vB).x;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity.xy -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`,P=`
  precision highp float;
  uniform sampler2D uTarget;
  uniform vec2 point;
  uniform vec3 color;
  uniform float radius;
  uniform float aspectRatio;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - point;
    p.x *= aspectRatio;

    vec3 splat = exp(-dot(p, p) / radius) * color;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`,B=`
  precision highp float;
  uniform sampler2D uDensity;
  uniform sampler2D uCamera;
  uniform sampler2D uPrevCamera;
  uniform float strength;
  uniform float motionScale;
  varying vec2 vUv;

  void main() {
    vec3 density = texture2D(uDensity, vUv).rgb;
    vec3 cam = texture2D(uCamera, vec2(1.0 - vUv.x, vUv.y)).rgb; // mirror horizontally
    vec3 prev = texture2D(uPrevCamera, vec2(1.0 - vUv.x, vUv.y)).rgb;

    // Motion detection — difference between current and previous frame
    vec3 diff = abs(cam - prev);
    float motion = (diff.r + diff.g + diff.b) / 3.0;

    // Inject density where motion is detected
    vec3 inject = cam * motion * motionScale;
    gl_FragColor = vec4(density + inject * strength, 1.0);
  }
`,q=`
  precision highp float;
  uniform sampler2D uVelocity;
  uniform sampler2D uCamera;
  uniform sampler2D uPrevCamera;
  uniform float strength;
  varying vec2 vUv;

  void main() {
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    vec2 mirrorUv = vec2(1.0 - vUv.x, vUv.y);

    // Sample camera at surrounding pixels for flow estimation
    float dx = 1.0 / 640.0;
    float dy = 1.0 / 480.0;

    float curr = dot(texture2D(uCamera, mirrorUv).rgb, vec3(0.333));
    float prev = dot(texture2D(uPrevCamera, mirrorUv).rgb, vec3(0.333));
    float motion = abs(curr - prev);

    // Use spatial gradient of current frame for velocity direction
    float currR = dot(texture2D(uCamera, mirrorUv + vec2(dx, 0.0)).rgb, vec3(0.333));
    float currL = dot(texture2D(uCamera, mirrorUv - vec2(dx, 0.0)).rgb, vec3(0.333));
    float currU = dot(texture2D(uCamera, mirrorUv + vec2(0.0, dy)).rgb, vec3(0.333));
    float currD = dot(texture2D(uCamera, mirrorUv - vec2(0.0, dy)).rgb, vec3(0.333));

    vec2 gradient = vec2(currR - currL, currU - currD);
    vec2 camVel = gradient * motion * strength * -200.0; // flip for mirror

    gl_FragColor = vec4(velocity + camVel, 0.0, 1.0);
  }
`,L=`
  precision highp float;
  uniform float value;
  varying vec2 vUv;

  void main() {
    gl_FragColor = vec4(value);
  }
`,F=`
  precision highp float;
  uniform sampler2D uDensity;
  uniform sampler2D uVelocity;
  uniform int mode;
  uniform float intensity;
  uniform float contrast;
  uniform float saturation;
  uniform float hueShift;
  uniform float glow;
  uniform vec3 uBgColor;
  varying vec2 vUv;

  // HSV to RGB conversion
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // RGB to HSV conversion
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  // Thermal colormap
  vec3 thermal(float t) {
    vec3 a = vec3(0.0, 0.0, 0.0);
    vec3 b = vec3(0.3, 0.0, 0.8);
    vec3 c = vec3(0.8, 0.2, 0.0);
    vec3 d = vec3(1.0, 1.0, 0.0);
    vec3 e = vec3(1.0, 1.0, 1.0);

    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) return mix(a, b, t * 4.0);
    else if (t < 0.5) return mix(b, c, (t - 0.25) * 4.0);
    else if (t < 0.75) return mix(c, d, (t - 0.5) * 4.0);
    else return mix(d, e, (t - 0.75) * 4.0);
  }

  // Fire colormap
  vec3 fire(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 black = vec3(0.0, 0.0, 0.0);
    vec3 red = vec3(1.0, 0.0, 0.0);
    vec3 orange = vec3(1.0, 0.5, 0.0);
    vec3 yellow = vec3(1.0, 1.0, 0.0);
    vec3 white = vec3(1.0, 1.0, 1.0);

    if (t < 0.2) return mix(black, red, t * 5.0);
    else if (t < 0.5) return mix(red, orange, (t - 0.2) * 3.33);
    else if (t < 0.8) return mix(orange, yellow, (t - 0.5) * 3.33);
    else return mix(yellow, white, (t - 0.8) * 5.0);
  }

  void main() {
    vec3 density = texture2D(uDensity, vUv).rgb;
    vec2 velocity = texture2D(uVelocity, vUv).xy;

    // Calculate base intensity from density
    float d = length(density);
    d = pow(d * intensity, contrast);

    vec3 color;

    if (mode == 0) {
      // SMOKE - soft white/gray smoke
      color = vec3(d);
    }
    else if (mode == 1) {
      // FIRE - fire colors based on density
      color = fire(d);
    }
    else if (mode == 2) {
      // INK - use density color directly
      color = density * intensity;
      color = pow(color, vec3(contrast));
    }
    else if (mode == 3) {
      // NEON - vibrant glowing colors
      float vel = length(velocity) * 0.1;
      vec3 hsv = vec3(d * 0.5 + vel, 1.0, d);
      color = hsv2rgb(hsv);
      color *= intensity;
    }
    else {
      // THERMAL - heat vision
      color = thermal(d);
    }

    // Apply saturation
    if (saturation < 1.0) {
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(gray), color, saturation);
    }

    // Apply hue shift
    if (hueShift > 0.0) {
      vec3 hsv = rgb2hsv(color);
      hsv.x = fract(hsv.x + hueShift);
      color = hsv2rgb(hsv);
    }

    // Apply glow (bloom-like effect)
    if (glow > 0.0) {
      float bloom = pow(d, 0.5) * glow;
      color += bloom;
    }

    // Mix with background color — use max to blend fluid on top of bg
    color = max(color, uBgColor * (1.0 - clamp(d * 2.0, 0.0, 1.0)));

    gl_FragColor = vec4(color, 1.0);
  }
`;class m{readTarget;writeTarget;constructor(e,t,i){const r={minFilter:y,magFilter:y,format:d,type:h,...i};this.readTarget=new v(e,t,r),this.writeTarget=new v(e,t,r)}get read(){return this.readTarget}get write(){return this.writeTarget}swap(){const e=this.readTarget;this.readTarget=this.writeTarget,this.writeTarget=e}resize(e,t){this.readTarget.setSize(e,t),this.writeTarget.setSize(e,t)}dispose(){this.readTarget.dispose(),this.writeTarget.dispose()}}class M{_width;_height;texelSizeX;texelSizeY;velocity;density;pressure;divergence;curl;params;renderParams;mode;scene;camera;quad;materials;constructor(e=512,t=512){this._width=e,this._height=t,this.texelSizeX=1/e,this.texelSizeY=1/t,this.velocity=new m(e,t),this.density=new m(e,t),this.pressure=new m(e,t),this.divergence=new v(e,t,{minFilter:u,magFilter:u,format:d,type:h}),this.curl=new v(e,t,{minFilter:u,magFilter:u,format:d,type:h}),this.params={viscosity:1e-4,vorticity:30,dissipation:.98,velocityDissipation:.99,pressureIterations:12,curl:30},this.renderParams={intensity:1,contrast:1,saturation:1,hueShift:0,glow:.5,bgColor:[0,0,0]},this.mode=T.SMOKE,this.scene=new x,this.camera=new S(-1,1,1,-1,0,1);const i=new D(2,2);this.quad=new w(i),this.scene.add(this.quad);const r=new n(this.texelSizeX,this.texelSizeY);this.materials={advection:new a({vertexShader:s,fragmentShader:b,uniforms:{uVelocity:{value:null},uSource:{value:null},texelSize:{value:r},dt:{value:.016},dissipation:{value:this.params.dissipation}}}),divergence:new a({vertexShader:l,fragmentShader:C,uniforms:{uVelocity:{value:null},texelSize:{value:r}}}),curl:new a({vertexShader:l,fragmentShader:R,uniforms:{uVelocity:{value:null},texelSize:{value:r}}}),vorticity:new a({vertexShader:l,fragmentShader:V,uniforms:{uVelocity:{value:null},uCurl:{value:null},curl:{value:this.params.curl},dt:{value:.016},texelSize:{value:r}}}),pressure:new a({vertexShader:l,fragmentShader:z,uniforms:{uPressure:{value:null},uDivergence:{value:null},texelSize:{value:r}}}),gradientSubtract:new a({vertexShader:l,fragmentShader:U,uniforms:{uPressure:{value:null},uVelocity:{value:null},texelSize:{value:r}}}),splat:new a({vertexShader:s,fragmentShader:P,uniforms:{uTarget:{value:null},point:{value:new n},color:{value:new f},radius:{value:.001},aspectRatio:{value:e/t}}}),clear:new a({vertexShader:s,fragmentShader:L,uniforms:{value:{value:0}}}),display:new a({vertexShader:s,fragmentShader:F,uniforms:{uDensity:{value:null},uVelocity:{value:null},mode:{value:this.mode},intensity:{value:this.renderParams.intensity},contrast:{value:this.renderParams.contrast},saturation:{value:this.renderParams.saturation},hueShift:{value:this.renderParams.hueShift},glow:{value:this.renderParams.glow},uBgColor:{value:new f(0,0,0)}}}),cameraDensity:new a({vertexShader:s,fragmentShader:B,uniforms:{uDensity:{value:null},uCamera:{value:null},uPrevCamera:{value:null},strength:{value:3},motionScale:{value:8}}}),cameraVelocity:new a({vertexShader:s,fragmentShader:q,uniforms:{uVelocity:{value:null},uCamera:{value:null},uPrevCamera:{value:null},strength:{value:1}}})}}init(e){this.clear(e)}resize(e,t){this._width=e,this._height=t,this.texelSizeX=1/e,this.texelSizeY=1/t;const i=new n(this.texelSizeX,this.texelSizeY);this.materials.advection.uniforms.texelSize.value=i,this.materials.divergence.uniforms.texelSize.value=i,this.materials.curl.uniforms.texelSize.value=i,this.materials.vorticity.uniforms.texelSize.value=i,this.materials.pressure.uniforms.texelSize.value=i,this.materials.gradientSubtract.uniforms.texelSize.value=i,this.materials.splat.uniforms.aspectRatio.value=e/t,this.velocity.resize(e,t),this.density.resize(e,t),this.pressure.resize(e,t),this.divergence.setSize(e,t),this.curl.setSize(e,t)}step(e,t=.016){this.materials.advection.uniforms.dt.value=t,this.materials.vorticity.uniforms.dt.value=t,this.materials.curl.uniforms.uVelocity.value=this.velocity.read.texture,this.quad.material=this.materials.curl,e.setRenderTarget(this.curl),e.render(this.scene,this.camera),this.materials.vorticity.uniforms.uVelocity.value=this.velocity.read.texture,this.materials.vorticity.uniforms.uCurl.value=this.curl.texture,this.quad.material=this.materials.vorticity,e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),this.velocity.swap(),this.materials.divergence.uniforms.uVelocity.value=this.velocity.read.texture,this.quad.material=this.materials.divergence,e.setRenderTarget(this.divergence),e.render(this.scene,this.camera),this.materials.clear.uniforms.value.value=0,this.quad.material=this.materials.clear,e.setRenderTarget(this.pressure.read),e.render(this.scene,this.camera),this.materials.pressure.uniforms.uDivergence.value=this.divergence.texture,this.quad.material=this.materials.pressure;const i=Math.max(1,Math.round(this.params.pressureIterations));for(let r=0;r<i;r++)this.materials.pressure.uniforms.uPressure.value=this.pressure.read.texture,e.setRenderTarget(this.pressure.write),e.render(this.scene,this.camera),this.pressure.swap();this.materials.gradientSubtract.uniforms.uPressure.value=this.pressure.read.texture,this.materials.gradientSubtract.uniforms.uVelocity.value=this.velocity.read.texture,this.quad.material=this.materials.gradientSubtract,e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),this.velocity.swap(),this.materials.advection.uniforms.uVelocity.value=this.velocity.read.texture,this.materials.advection.uniforms.uSource.value=this.velocity.read.texture,this.materials.advection.uniforms.dissipation.value=this.params.velocityDissipation,this.quad.material=this.materials.advection,e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),this.velocity.swap(),this.materials.advection.uniforms.uVelocity.value=this.velocity.read.texture,this.materials.advection.uniforms.uSource.value=this.density.read.texture,this.materials.advection.uniforms.dissipation.value=this.params.dissipation,this.quad.material=this.materials.advection,e.setRenderTarget(this.density.write),e.render(this.scene,this.camera),this.density.swap()}render(e,t){this.materials.display.uniforms.uDensity.value=this.density.read.texture,this.materials.display.uniforms.uVelocity.value=this.velocity.read.texture,this.quad.material=this.materials.display,e.setRenderTarget(t||null),e.render(this.scene,this.camera)}applyForce(e,t,i,r,o=.01){this.materials.splat.uniforms.uTarget.value=this.velocity.read.texture,this.materials.splat.uniforms.point.value.set(e,t),this.materials.splat.uniforms.color.value.set(i,r,0),this.materials.splat.uniforms.radius.value=o,this.quad.material=this.materials.splat}addDensity(e,t,i,r,o,c,p=.01){this.materials.splat.uniforms.uTarget.value=this.density.read.texture,this.materials.splat.uniforms.point.value.set(t,i),this.materials.splat.uniforms.color.value.set(r,o,c),this.materials.splat.uniforms.radius.value=p,this.quad.material=this.materials.splat,e.setRenderTarget(this.density.write),e.render(this.scene,this.camera),this.density.swap()}addVelocity(e,t,i,r,o,c=.01){this.materials.splat.uniforms.uTarget.value=this.velocity.read.texture,this.materials.splat.uniforms.point.value.set(t,i),this.materials.splat.uniforms.color.value.set(r,o,0),this.materials.splat.uniforms.radius.value=c,this.quad.material=this.materials.splat,e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),this.velocity.swap()}clear(e){this.materials.clear.uniforms.value.value=0,this.quad.material=this.materials.clear,e.setRenderTarget(this.velocity.read),e.render(this.scene,this.camera),e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),e.setRenderTarget(this.density.read),e.render(this.scene,this.camera),e.setRenderTarget(this.density.write),e.render(this.scene,this.camera),e.setRenderTarget(this.pressure.read),e.render(this.scene,this.camera),e.setRenderTarget(this.pressure.write),e.render(this.scene,this.camera),e.setRenderTarget(null)}setMode(e){this.mode!==e&&(this.mode=e,this.materials.display.uniforms.mode.value=e)}setParams(e){const t=this.params,i={...t,...e};e.vorticity!==void 0&&e.curl===void 0&&(i.curl=e.vorticity),e.curl!==void 0&&e.vorticity===void 0&&(i.vorticity=e.curl),(i.viscosity!==t.viscosity||i.vorticity!==t.vorticity||i.dissipation!==t.dissipation||i.velocityDissipation!==t.velocityDissipation||i.pressureIterations!==t.pressureIterations||i.curl!==t.curl)&&(this.params=i,i.curl!==t.curl&&(this.materials.vorticity.uniforms.curl.value=i.curl))}setRenderParams(e){const t=this.renderParams,i={...t,...e};(i.intensity!==t.intensity||i.contrast!==t.contrast||i.saturation!==t.saturation||i.hueShift!==t.hueShift||i.glow!==t.glow||i.bgColor[0]!==t.bgColor[0]||i.bgColor[1]!==t.bgColor[1]||i.bgColor[2]!==t.bgColor[2])&&(this.renderParams=i,e.intensity!==void 0&&(this.materials.display.uniforms.intensity.value=e.intensity),e.contrast!==void 0&&(this.materials.display.uniforms.contrast.value=e.contrast),e.saturation!==void 0&&(this.materials.display.uniforms.saturation.value=e.saturation),e.hueShift!==void 0&&(this.materials.display.uniforms.hueShift.value=e.hueShift),e.glow!==void 0&&(this.materials.display.uniforms.glow.value=e.glow),e.bgColor!==void 0&&this.materials.display.uniforms.uBgColor.value.set(e.bgColor[0],e.bgColor[1],e.bgColor[2]))}injectCamera(e,t,i,r=3){this.materials.cameraDensity.uniforms.uDensity.value=this.density.read.texture,this.materials.cameraDensity.uniforms.uCamera.value=t,this.materials.cameraDensity.uniforms.uPrevCamera.value=i,this.materials.cameraDensity.uniforms.strength.value=r,this.quad.material=this.materials.cameraDensity,e.setRenderTarget(this.density.write),e.render(this.scene,this.camera),this.density.swap(),this.materials.cameraVelocity.uniforms.uVelocity.value=this.velocity.read.texture,this.materials.cameraVelocity.uniforms.uCamera.value=t,this.materials.cameraVelocity.uniforms.uPrevCamera.value=i,this.materials.cameraVelocity.uniforms.strength.value=r,this.quad.material=this.materials.cameraVelocity,e.setRenderTarget(this.velocity.write),e.render(this.scene,this.camera),this.velocity.swap()}getTexture(){return this.density.read.texture}dispose(){this.velocity.dispose(),this.density.dispose(),this.pressure.dispose(),this.divergence.dispose(),this.curl.dispose(),Object.values(this.materials).forEach(e=>e.dispose()),this.quad.geometry.dispose()}}export{T as FLUID_MODES,M as FluidSimulation};
