import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

// Keep Three.js's tone mapping/colour conversion, then dither immediately
// before the final 8-bit framebuffer. Dithering sky materials earlier would
// be averaged away by DOF and bloom and leave the same contour bands.
export class MeadowOutputPass extends OutputPass {
  constructor(){
    super();
    // Slightly wider than one quantisation step so interpolation when the
    // bounded canvas is scaled up on Retina screens does not erase it.
    this.uniforms.uDitherStrength={value:1.5};
    this.material.fragmentShader=this.material.fragmentShader
      .replace('uniform sampler2D tDiffuse;',`uniform sampler2D tDiffuse;
        uniform float uDitherStrength;`)
      .replace(/\}\s*$/,`
        // Static, zero-mean quantisation noise: no animated film grain,
        // extra texture, extra render pass or change in exposure/palette.
        float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
        gl_FragColor.rgb=clamp(gl_FragColor.rgb+vec3(noise*uDitherStrength/255.),0.,1.);
      }`);
  }
}
