export const simulationVertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const simulationFragment = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrevious;
uniform vec2 uSize;
uniform vec4 uPointer;
uniform vec3 uBrush;
uniform vec4 uGusts[5];
uniform vec4 uTrailGusts[32];
uniform float uTime;
uniform float uDelta;
uniform float uRecovery;
uniform float uGustDuration;
float gustEnvelope(float age) {
  // Keep the original onset; let the old end of a trail ease gently to zero.
  float tail = 1.0-smoothstep(0.30,uGustDuration,age);
  return smoothstep(0.0,0.12,age)*pow(tail,1.5);
}
float gustFootprint(vec2 delta) {
  float r2 = dot(delta,delta);
  // Preserve the tight swirling core, with a faint wider feather and no cutoff.
  return 0.88*exp(-r2/0.36)+0.12*exp(-r2/0.80);
}
float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p-a, ba = b-a;
  return length(pa-ba*clamp(dot(pa,ba)/max(dot(ba,ba),0.00001),0.0,1.0));
}
void main() {
  vec4 old = texture2D(uPrevious, vUv);
  float fade = exp(-uDelta*5.0/uRecovery);
  vec2 bend = (old.rg*2.0-1.0)*fade;
  float pressed = old.b*fade;
  if (length(bend) < 0.006) bend = vec2(0.0);
  if (pressed < 0.006) pressed = 0.0;
  vec2 p = (vUv-0.5)*uSize;
  float d = capsule(p,uPointer.xy,uPointer.zw);
  // Stronger hover sweep with a soft, low-force outer feather, no hard edge.
  float brush = (0.82*exp(-d*d/0.11)+0.18*exp(-d*d/0.34))*uBrush.z;
  bend = mix(bend,uBrush.xy,brush*0.92);
  pressed = max(pressed,brush*0.86);
  vec2 wind = vec2(0.0);
  float downwash = 0.0;
  for (int i=0; i<5; i++) {
    float age = uTime-uGusts[i].z;
    if (age>=0.0 && age<uGustDuration) {
      vec2 delta = p-uGusts[i].xy;
      float radius = length(delta);
      vec2 radial = delta/(radius+0.09);
      vec2 tangent = vec2(-radial.y,radial.x);
      float envelope = gustEnvelope(age);
      float footprint = gustFootprint(delta);
      float angle = atan(delta.y,delta.x+0.00001);
      float turn = age*3.8;
      float eddy = 0.84+0.16*sin(angle*2.0-turn-radius*2.5);
      float force = envelope*footprint*uGusts[i].w;
      vec2 centreBreeze = vec2(cos(turn),sin(turn))*0.16*exp(-radius*radius/0.07);
      wind += (radial*0.57+tangent*0.91*eddy+centreBreeze)*force*1.65;
      downwash += force*0.82;
    }
  }
  // A trail uses the same local vortex and lifetime as a click. Select the
  // strongest local stamp instead of summing nearby, opposing swirl vectors:
  // overlapping samples must not flatten or cancel the visible rotation.
  vec2 trailWind = vec2(0.0);
  float trailDownwash = 0.0;
  for (int i=0; i<32; i++) {
    float age = uTime-uTrailGusts[i].z;
    if (age>=0.0 && age<uGustDuration) {
      vec2 delta = p-uTrailGusts[i].xy;
      float radius = length(delta);
      vec2 radial = delta/(radius+0.09);
      vec2 tangent = vec2(-radial.y,radial.x);
      float envelope = gustEnvelope(age);
      float footprint = gustFootprint(delta);
      float angle = atan(delta.y,delta.x+0.00001);
      float turn = age*3.8;
      float eddy = 0.84+0.16*sin(angle*2.0-turn-radius*2.5);
      float force = envelope*footprint*uTrailGusts[i].w;
      vec2 centreBreeze = vec2(cos(turn),sin(turn))*0.16*exp(-radius*radius/0.07);
      if(force*0.82>trailDownwash){
        trailWind = (radial*0.57+tangent*0.91*eddy+centreBreeze)*force*1.65;
        trailDownwash = force*0.82;
      }
    }
  }
  if(trailDownwash>downwash){wind=trailWind;downwash=trailDownwash;}
  // Integrating with the same exponential decay is stable across frame rates.
  bend = clamp(bend+wind*(1.0-fade),vec2(-0.98),vec2(0.98));
  pressed = clamp(pressed+downwash*(1.0-fade),0.0,0.95);
  gl_FragColor = vec4(bend*0.5+0.5,pressed,0.5);
}
`;

const palette = /* glsl */`
uniform sampler2D uReference;
uniform vec2 uResolution;
vec3 gardenColour() {
  // A monotone luminance lift preserves hue without introducing a dark contour.
  // The former green/dark masks reversed part of the tone curve and outlined
  // the blue-to-green transition. Keep the original texture spatially intact.
  vec2 screenUv = gl_FragCoord.xy/uResolution;
  vec3 colour = texture2D(uReference,screenUv).rgb;
  float luminance = dot(colour,vec3(0.2126,0.7152,0.0722));
  float lower = 1.0-smoothstep(0.18,0.64,screenUv.y);
  float exposure = mix(1.0,0.56,lower);
  return colour / (exposure+(1.0-exposure)*luminance);
}
`;

export const furVertex = /* glsl */`
precision highp float;
attribute vec4 aRoot;
attribute vec4 aShape;
uniform sampler2D uField;
uniform vec2 uSize;
uniform float uLength;
varying vec2 vRoot;
varying float vHeight;
varying float vLight;
varying float vSeed;
varying float vTip;
varying float vResponse;
void main() {
  vec2 root = aRoot.xy*uSize;
  vec2 fieldUv = aRoot.xy+0.5;
  vec4 interaction = texture2D(uField,fieldUv);
  vec2 brush = interaction.rg*2.0-1.0;
  if (length(brush)<0.006) brush=vec2(0.0);
  brush *= 0.33;
  float pressed = interaction.b;
  float t = position.y;
  float seed = aRoot.z;
  float hairLength = (0.067+aRoot.w*0.060)*uLength;
  vec2 direction = vec2(cos(aShape.w),sin(aShape.w));
  vec2 restLean = direction*hairLength*0.77-aShape.yz*0.072;
  vec2 lean = restLean;
  lean += brush;
  vec2 side = normalize(vec2(-lean.y,lean.x)+vec2(0.0001));
  float width = (0.0023+seed*0.0015)*(1.0-t*0.93);
  vec2 curl = vec2(-direction.y,direction.x)*sin(t*2.8)*0.009*(seed-0.4);
  vec3 pos = vec3(root+lean*(t*t*0.7+t*0.3)+curl+side*position.x*width,
    aShape.x+hairLength*t*(1.0-pressed*0.66));
  vec3 n = normalize(vec3(-aShape.yz,1.0));
  vec3 light = normalize(vec3(-0.8,1.25,0.9));
  float diffuse = max(dot(n,light),0.0);
  float nap = dot(normalize(vec3(lean,0.095)),light)*0.5+0.5;
  vLight = (0.28+diffuse*0.68)*(0.64+nap*0.50);
  vec3 restNormal = normalize(vec3(-aShape.yz,1.0));
  float restDiffuse = max(dot(restNormal,light),0.0);
  float restNap = dot(normalize(vec3(restLean,0.095)),light)*0.5+0.5;
  float restLight = (0.28+restDiffuse*0.68)*(0.64+restNap*0.50);
  // Only moved fibres gain contrast; the untouched garden keeps its pale tone.
  vResponse = clamp((vLight-restLight)*1.15-pressed*0.20,-0.38,0.28);
  vRoot = root;
  vHeight = aShape.x;
  vSeed = seed;
  vTip = t;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}
`;

export const furFragment = /* glsl */`
precision highp float;
varying vec2 vRoot;
varying float vHeight;
varying float vLight;
varying float vSeed;
varying float vTip;
varying float vResponse;
${palette}
void main() {
  vec3 colour = gardenColour();
  // Fine, neutral pile contrast centred near unity. Large dark concentric
  // lighting bands previously overwhelmed the supplied gradient; omit them.
  float fibre = mix(0.84,1.28,pow(vTip,0.7))*(0.83+vSeed*0.34);
  colour *= fibre+vResponse;
  gl_FragColor = vec4(colour,1.0);
  #include <colorspace_fragment>
}
`;

export const groundVertex = /* glsl */`
uniform sampler2D uField;
varying vec2 vRoot;
varying vec3 vNormal;
varying float vHeight;
void main() {
  vRoot = position.xy;
  vNormal = normal;
  vHeight = position.z;
  vec3 pos = position;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}
`;
export const groundFragment = /* glsl */`
uniform sampler2D uField;
uniform vec2 uSize;
varying vec2 vRoot;
varying vec3 vNormal;
varying float vHeight;
${palette}
void main() {
  vec3 colour = gardenColour()*0.99;
  // A feathered contact shadow makes the brushing readable between fibres.
  // Ignore the field's quantization floor and leave the resting palette intact.
  float pressed = texture2D(uField,vRoot/uSize+0.5).b;
  colour *= 1.0-smoothstep(0.035,0.85,pressed)*0.16;
  gl_FragColor = vec4(colour,1.0);
  #include <colorspace_fragment>
}
`;
