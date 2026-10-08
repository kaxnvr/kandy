/**
 * 纸张材质 — MeshStandardMaterial + 半透注入
 *
 * 为什么不用 MeshPhysicalMaterial 的 transmission：
 * 它需要额外一遍场景渲染（transmissionRenderTarget），对这个每帧重建顶点的
 * 长条网格来说太贵。这里用 onBeforeCompile 往标准材质里塞三样东西：
 *
 *   1. wrap lighting —— diffuse = (N·L + wrap) / (1 + wrap)
 *      让明暗交界线软下来，纸不再"死"。
 *   2. 背透（back transmission）—— pow(saturate(-N·L), p) * strength
 *      光从纸背面打过来时，正面透出一点光。
 *   3. 背面印刷透印 —— 从纸背面看过去，能看到镜像的、很淡的印刷内容。
 *      参考视频里卷筒外圈那个反过来的 logo 就是这个。
 *
 * 光方向用视空间（three 的 fragment shader 里 normal 是视空间的），
 * 每帧由渲染循环调用 updatePaperLight() 更新。
 */
import * as THREE from 'three';

export function createPaperMaterial(map, cfg) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    side: THREE.DoubleSide,
    roughness: cfg.roughness,
    metalness: 0,
    envMapIntensity: 1.0
  });

  const u = {
    uWrapLightDir:  { value: new THREE.Vector3(0, 0, 1) },
    uTransLightDir: { value: new THREE.Vector3(0, 0, -1) },
    uTransColor:    { value: new THREE.Color(cfg.transColor) },
    uTransStrength: { value: cfg.transStrength },
    uTransPower:    { value: cfg.transPower },
    uWrap:          { value: cfg.wrap },
    uWrapStrength:  { value: cfg.wrapStrength },
    uBackInk:       { value: cfg.backInk },
    uPaperTint:     { value: new THREE.Color(cfg.paperTint) },
    uTranslucent:   { value: cfg.translucent ? 1 : 0 },
    uInkDensity:    { value: cfg.inkDensity ?? 1 },
    uInkGamma:      { value: cfg.inkGamma ?? 1 }
  };
  mat.userData.uniforms = u;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    /* aOcc = 每顶点的遮蔽量 (正面, 背面)，由 CPU 每帧随几何一起算 */
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute vec2 aOcc;
        varying vec2 vRuOcc;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vRuOcc = aOcc;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform vec3  uWrapLightDir;
        uniform vec3  uTransLightDir;
        uniform vec3  uTransColor;
        uniform float uTransStrength;
        uniform float uTransPower;
        uniform float uWrap;
        uniform float uWrapStrength;
        uniform float uBackInk;
        uniform vec3  uPaperTint;
        uniform float uTranslucent;
        uniform float uInkDensity;
        uniform float uInkGamma;
        varying vec2  vRuOcc;

        // 以纸白为基准重映射墨的浓度：
        //   density > 1 整体加深，gamma < 1 把淡的笔画提上来（字更「实」）
        vec3 ruInk( vec3 c ) {
          vec3 paper = max( uPaperTint, vec3( 1e-4 ) );
          vec3 ink = clamp( ( paper - c ) / paper, 0.0, 1.0 );
          ink = pow( ink, vec3( uInkGamma ) ) * uInkDensity;
          return paper * ( 1.0 - clamp( ink, 0.0, 1.0 ) );
        }
      `)

      /* ---- 背面：镜像的淡印刷 ---- */
      .replace('#include <map_fragment>', /* glsl */`
        #ifdef USE_MAP
          vec4 ruFront = texture2D( map, vMapUv );
          vec4 ruBack  = texture2D( map, vec2( 1.0 - vMapUv.x, vMapUv.y ) );
          vec4 ruShow  = mix( vec4( uPaperTint, 1.0 ), ruBack, uBackInk * uTranslucent );
          vec4 ruTex   = gl_FrontFacing ? ruFront : ruShow;
          ruTex.rgb    = ruInk( ruTex.rgb );
          diffuseColor *= ruTex;
        #endif
      `)

      /* ---- 遮蔽 + wrap 补光 + 背透 ---- */
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        float ruOcc = clamp( gl_FrontFacing ? vRuOcc.x : vRuOcc.y, 0.0, 1.0 );
        float ruLit = 1.0 - ruOcc;
        reflectedLight.indirectDiffuse  *= ruLit;
        reflectedLight.indirectSpecular *= 1.0 - ruOcc * 0.75;
        reflectedLight.directDiffuse    *= ruLit;
        reflectedLight.directSpecular   *= ruLit;
        {
          // wrap：软化关键光的明暗交界
          float ruNdK = dot( normal, normalize( uWrapLightDir ) );
          float ruLam = max( ruNdK, 0.0 );
          float ruWrp = clamp( ( ruNdK + uWrap ) / ( 1.0 + uWrap ), 0.0, 1.0 );
          float ruFil = max( ruWrp - ruLam, 0.0 ) * uWrapStrength;
          // 背透：光从纸背后打过来，正面透出一点
          float ruNdT = dot( normal, normalize( uTransLightDir ) );
          float ruBck = pow( clamp( -ruNdT, 0.0, 1.0 ), uTransPower ) * uTransStrength;
          reflectedLight.indirectDiffuse +=
            ( ruFil + ruBck ) * ruLit * uTranslucent * uTransColor * diffuseColor.rgb;
        }
      `);
  };

  /* 同一份注入代码，程序缓存键固定，避免每次改 uniform 重编译 */
  mat.customProgramCacheKey = () => 'receipt-paper-v2';

  return mat;
}

/**
 * 每帧把两个光方向转到视空间喂给 shader。
 * key   —— 关键光，负责 wrap
 * trans —— 透光方向（世界坐标，通常在纸的斜后上方），负责背透
 */
const _dir = new THREE.Vector3();
export function updatePaperLight(mat, key, transDir, camera) {
  const u = mat.userData.uniforms;
  if (!u) return;
  _dir.copy(key.position).sub(key.target.position).normalize()
      .transformDirection(camera.matrixWorldInverse);
  u.uWrapLightDir.value.copy(_dir);
  _dir.copy(transDir).normalize().transformDirection(camera.matrixWorldInverse);
  u.uTransLightDir.value.copy(_dir);
}

/** 运行时改半透参数（预览页的开关用） */
export function setPaperTranslucency(mat, cfg) {
  const u = mat.userData.uniforms;
  if (!u) return;
  u.uTranslucent.value  = cfg.translucent ? 1 : 0;
  u.uWrap.value         = cfg.wrap;
  u.uWrapStrength.value = cfg.wrapStrength;
  u.uTransStrength.value= cfg.transStrength;
  u.uTransPower.value   = cfg.transPower;
  u.uBackInk.value      = cfg.backInk;
  u.uTransColor.value.set(cfg.transColor);
  u.uPaperTint.value.set(cfg.paperTint);
  if ('inkDensity' in cfg) u.uInkDensity.value = cfg.inkDensity;
  if ('inkGamma'   in cfg) u.uInkGamma.value   = cfg.inkGamma;
}
