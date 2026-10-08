import * as THREE from 'three';
import {Pass,FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// A broad daylight glow at low resolution. Filter BEFORE decimation, then use
// a contiguous Gaussian: multiplying a sparse five-fetch kernel's spacing
// makes separated copies of highlights, not a wider blur.
export class MeadowBloomPass extends Pass {
  constructor(strength=.32,threshold=.86){
    super();
    this.strength=strength; this.threshold=threshold;
    const options={type:THREE.HalfFloatType,depthBuffer:false,
      minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
    this.prefiltered=new THREE.WebGLRenderTarget(1,1,options);
    this.horizontal=new THREE.WebGLRenderTarget(1,1,options);
    this.vertical=new THREE.WebGLRenderTarget(1,1,options);
    const vertexShader='varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.,1.);}';
    this.prefilterMaterial=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{tSource:{value:null},uFootprint:{value:new THREE.Vector2()},uThreshold:{value:threshold}},
      vertexShader,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tSource;
        uniform vec2 uFootprint;
        uniform float uThreshold;
        void main(){
          vec3 sum=vec3(0.);
          for(int y=0;y<4;y++)for(int x=0;x<4;x++){
            vec2 offset=(vec2(float(x),float(y))+.5)/4.-.5;
            vec3 c=texture2D(tSource,clamp(vUv+offset*uFootprint,vec2(0.),vec2(1.))).rgb;
            float luminance=dot(c,vec3(.299,.587,.114));
            sum+=c*smoothstep(uThreshold,uThreshold+.01,luminance);
          }
          gl_FragColor=vec4(sum/16.,1.);
        }`
    });
    // Adjacent texels are paired into bilinear fetches. Sigma stays broad in
    // low-res pixels, but every texel in its support contributes (no holes).
    const weights=Array.from({length:25},(_,i)=>Math.exp(-i*i/(2*8*8)));
    const total=weights[0]+2*weights.slice(1).reduce((sum,w)=>sum+w,0);
    let kernel=`vec3 c=sampleGlow(0.)*${(weights[0]/total).toFixed(10)};`;
    for(let i=1;i<weights.length;i+=2){
      const pair=weights[i]+weights[i+1];
      const offset=(i*weights[i]+(i+1)*weights[i+1])/pair;
      kernel+=`c+=(sampleGlow(${offset.toFixed(10)})+sampleGlow(-${offset.toFixed(10)}))*${(pair/total).toFixed(10)};`;
    }
    this.blurMaterial=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{tSource:{value:null},uStep:{value:new THREE.Vector2()}},
      vertexShader,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tSource;
        uniform vec2 uStep;
        vec3 sampleGlow(float offset){
          return texture2D(tSource,clamp(vUv+uStep*offset,vec2(0.),vec2(1.))).rgb;
        }
        void main(){${kernel} gl_FragColor=vec4(c,1.);}`
    });
    this.combineMaterial=new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      uniforms:{tScene:{value:null},tGlow:{value:this.vertical.texture},uStrength:{value:strength*3}},
      vertexShader,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tScene,tGlow;
        uniform float uStrength;
        void main(){
          vec4 scene=texture2D(tScene,vUv);
          gl_FragColor=vec4(scene.rgb+texture2D(tGlow,vUv).rgb*uStrength,scene.a);
        }`
    });
    this.quad=new FullScreenQuad(this.blurMaterial);
  }
  setSize(w,h){
    this.horizontal.setSize(Math.max(1,Math.round(w*.18)),Math.max(1,Math.round(h*.18)));
    this.vertical.setSize(this.horizontal.width,this.horizontal.height);
    this.prefiltered.setSize(this.horizontal.width,this.horizontal.height);
    this.prefilterMaterial.uniforms.uFootprint.value.set(1/this.horizontal.width,1/this.horizontal.height);
  }
  render(renderer,writeBuffer,readBuffer){
    this.quad.material=this.prefilterMaterial;
    this.prefilterMaterial.uniforms.tSource.value=readBuffer.texture;
    this.prefilterMaterial.uniforms.uThreshold.value=this.threshold;
    renderer.setRenderTarget(this.prefiltered); this.quad.render(renderer);
    const u=this.blurMaterial.uniforms;
    this.quad.material=this.blurMaterial;
    u.tSource.value=this.prefiltered.texture;
    u.uStep.value.set(1/this.horizontal.width,0);
    renderer.setRenderTarget(this.horizontal); this.quad.render(renderer);
    u.tSource.value=this.horizontal.texture;
    u.uStep.value.set(0,1/this.horizontal.height);
    renderer.setRenderTarget(this.vertical); this.quad.render(renderer);
    this.quad.material=this.combineMaterial;
    this.combineMaterial.uniforms.tScene.value=readBuffer.texture;
    // The original five bloom weights sum to three; preserve that exposure.
    this.combineMaterial.uniforms.uStrength.value=this.strength*3;
    renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);
    this.quad.render(renderer);
  }
  dispose(){
    this.prefiltered.dispose(); this.horizontal.dispose(); this.vertical.dispose();
    this.prefilterMaterial.dispose(); this.blurMaterial.dispose(); this.combineMaterial.dispose(); this.quad.dispose();
  }
}
