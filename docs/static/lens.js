/* ════════════════════════════════════════════════════════════════
   透过镜头 —— 首页第一屏的 3D 光圈镜头

   「他总是站在外面，看别人的日常。」这个镜头就是那句话：
   光圈里轮流映出他七组照片的封面，往下滚，光圈打开、镜头从右上角掠过。

   只在首页加载（build.py 的 shell(home=True)）。纯装饰，对读屏软件隐藏。
   见 透过镜头设计.md 第七节。

   ── 什么时候不出现（页面保持改版前的样子）──────────────────────
     · 没有 #lens（不是首页）
     · 开了省流量（Save-Data）
     · 拿不到 WebGL2
     · 任何一步出错 —— 整个 main() 包在 try 里，出错就当没来过
   ── 减少动态效果（prefers-reduced-motion）──────────────────────
     只渲染静止的一帧：光圈半开、不随滚动和鼠标动、跟着页面一起滚走。

   ⚠️ 镜头和名字不能叠在一起：深色镜头压在深色大字后面，字就看不清了。
      place() 每次都量名字的位置，把镜头放在名字上方；滚动时镜头的下沿
      往上走得比页面快（见 LIFT），所以间距只会越拉越大，永远不会压上去。
   ════════════════════════════════════════════════════════════════ */

const LIFT = 1.2;          // 滚动时镜头下沿上移的速度，相对页面（必须 > 1）
const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const CYCLE_MS = 3800;     // 光圈里换一张封面的间隔
const FADE_MS = 1300;      // 换封面的交叉淡入时长

main().catch((err) => {
  // 3D 是锦上添花：出了任何错都不能影响页面本身
  console.warn('[lens] 已关闭：', err);
  document.getElementById('lens')?.classList.remove('lens--on');
});

async function main() {
  const mount = document.getElementById('lens');
  if (!mount) return;
  if (navigator.connection && navigator.connection.saveData) return;
  if (!hasWebGL2()) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const data = JSON.parse(document.getElementById('lens-data').textContent);
  if (!data.covers || !data.covers.length) return;

  // 页面先出来，3D 后到：等 load 之后才去取 800 KB 的 Three.js
  if (document.readyState !== 'complete') {
    await new Promise((r) => addEventListener('load', r, { once: true }));
  }
  const THREE = await import('./vendor/three/three.module.js');

  const canvas = mount.querySelector('canvas');
  const readout = mount.querySelector('.lens__f');
  const title = document.querySelector('.masthead__title');

  /* ── 渲染器 ──────────────────────────────────────────────────── */

  const coarse = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, stencil: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);
  const HALF_H = 12 * Math.tan((30 / 2) * Math.PI / 180);   // z = 0 平面上可见的半高

  /* ── 环境：用他作品的颜色做几块柔光箱，金属叶片上映出来的就是这些颜色 ── */

  const colors = data.colors.length ? data.colors : ['#c9455d', '#1e836c', '#486ed9'];
  const pick = (i) => colors[i % colors.length];
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(
      new THREE.BoxGeometry(12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x07070a, side: THREE.BackSide }),
    ));
    const panel = (color, power, [x, y, z], [w, h]) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide,
        }),
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel('#ffffff', 5, [0, 5, 2.5], [7, 1.4]);        // 顶上一条白光：金属的主高光
    panel(pick(0), 6, [-5, 1, 1.5], [1.6, 6]);         // 左：第一件作品的颜色
    panel(pick(3), 6, [5, -0.5, 2], [1.6, 6]);         // 右
    panel(pick(6), 4, [0, -5, 1], [7, 1.2]);           // 下
    panel(pick(9), 4, [2.5, 2, -5], [5, 3]);           // 背后
    panel('#ffffff', 2, [-2, -1, 5.5], [2, 2]);        // 前面一块小白光：叶片边缘的锐利高光
    // 镜头背后（看的人这一侧）两块大的彩色柔光。
    // ⚠️ 正对着人的金属叶片，反射的正是「人背后」的环境。原来这里只有上面那一小块白光，
    //    于是镜头一转正，九片叶片全变成黑的（第二版截图 0.35 屏那一帧）。
    //    两块颜色不同，每片叶片歪的角度又不一样，映出来的颜色也就一片一个样。
    panel(pick(2), 1.4, [-2.2, 0.5, 5.8], [4.2, 5]);
    panel(pick(5), 1.4, [2.2, -0.5, 5.8], [4.2, 5]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
  }

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const glowA = new THREE.PointLight(pick(1), 38, 14, 2);
  const glowB = new THREE.PointLight(pick(4), 32, 14, 2);
  scene.add(glowA, glowB);

  /* ── 镜头模型 ─────────────────────────────────────────────────
     单位：光圈开口的最大半径 = 1。镜头的轴是 +z（朝向镜头外的人）。 */

  const lens = new THREE.Group();
  scene.add(lens);

  // 1. 镜筒：一条轮廓线绕轴转一圈（LatheGeometry 绕的是 Y 轴，所以最后把它转到 Z 上）
  const barrel = (() => {
    const P = (r, z) => new THREE.Vector2(r, z);
    const pts = [
      P(0.975, -0.46), P(0.975, 0.16),            // 内壁：斜着看时能看到镜筒的深度
      P(0.985, 0.165), P(1.215, 0.165),           // 前端面：挡住叶片伸出开口的部分
      P(1.262, 0.13), P(1.262, 0.02),             // 倒角
      P(1.30, 0.005), P(1.30, -0.07),             // 色环那一级台阶
      P(1.345, -0.085),
    ];
    for (let z = -0.1; z > -0.6; z -= 0.025) {    // 对焦环的滚花
      pts.push(P(1.345, z), P(1.325, z - 0.0125));
    }
    pts.push(P(1.345, -0.61), P(1.292, -0.65), P(1.272, -0.94), P(1.2, -1.0), P(0.99, -1.0));
    const geo = new THREE.LatheGeometry(pts, 160);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: '#15151a', metalness: 0.82, roughness: 0.36,
      clearcoat: 0.5, clearcoatRoughness: 0.22, side: THREE.DoubleSide,
    }));
  })();
  barrel.renderOrder = 2;
  lens.add(barrel);

  // 2. 色环：镜筒上一圈细细的彩色环，颜色跟着光圈里那一组照片走
  const ringMat = new THREE.MeshStandardMaterial({
    color: data.accents[0], emissive: data.accents[0], emissiveIntensity: 0.9,
    metalness: 0.3, roughness: 0.35,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3025, 0.014, 12, 180), ringMat);
  ring.position.z = -0.035;
  lens.add(ring);

  // 3. 光圈叶片的遮罩：只在开口的圆里写模板值，叶片只画在模板值 = 1 的地方。
  //    叶片本身比开口大得多（伸到镜筒外面去），靠这个圆把它们裁掉。
  const mask = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 128),
    new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, depthTest: false,
      stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }),
  );
  mask.renderOrder = 0;
  lens.add(mask);

  // 4. 九片叶片。每片是一块大叶子，内缘是一段微凸的弧——九片的内缘围出开口。
  //    开口大小 r = 各片内缘到中心的距离；r 变小时叶片同时绕中心拧一点（像真的光圈那样旋进去）。
  //    每片再绕自己的径向轴歪一点（LOUVER），前一片的前端就总压在后一片的后端上面，
  //    九片首尾相接地叠成一圈，不会在某一处出现"最后一片压在第一片下面"的接缝。
  const BLADES = 9, HALF_L = 1.35, BULGE = 0.28, WIDTH = 1.7, LOUVER = 0.1;
  // ⚠️ 金属的反射率 = 它的底色。底色 #34343f 换成线性值只有约 3%，正对着看时几乎不反光——
  //    侧着看有菲涅尔效应还亮一点，一转正九片叶片就全黑了（第二、三版截图都是这样）。
  //    所以底色要提到中灰，再给镀膜一张厚度贴图：厚度沿着叶片渐变，
  //    干涉出来的颜色就是一条一条的，像真镜头叶片上那种油膜一样的彩纹。
  const filmTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 4;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, '#202020');
    grad.addColorStop(0.5, '#f0f0f0');
    grad.addColorStop(1, '#202020');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 4);
    const t = new THREE.CanvasTexture(c);
    // ExtrudeGeometry 的 UV 就是形状坐标（叶片宽约 2.7 个单位）。repeat 0.32 让一道渐变
    // 横跨整片叶片——第一次试的时候按 1 铺，每片重复三次，厚度范围又宽，干涉出好几轮颜色，
    // 整个光圈像彩虹斑马线。真的镀膜只是随角度变一点颜色。
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.32, 0.32);
    return t;
  })();
  const bladeMat = new THREE.MeshPhysicalMaterial({
    color: '#4c4c5a', metalness: 0.9, roughness: 0.26, envMapIntensity: 1.5,
    iridescence: 0.85, iridescenceIOR: 1.45, iridescenceThicknessRange: [240, 520],
    iridescenceThicknessMap: filmTex,
    clearcoat: 0.35, clearcoatRoughness: 0.2,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });
  const bladeGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(-HALF_L, -BULGE);
    s.quadraticCurveTo(0, BULGE, HALF_L, -BULGE);   // 内缘：中点正好在 y = 0
    s.lineTo(HALF_L * 0.92, WIDTH);
    s.lineTo(-HALF_L * 0.92, WIDTH);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004,
      bevelSegments: 2, curveSegments: 48,
    });
    g.translate(0, 0, -0.008);
    return g;
  })();
  const pivots = [];
  for (let i = 0; i < BLADES; i++) {
    const pivot = new THREE.Group();
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.y = LOUVER;
    blade.renderOrder = 1;
    pivot.add(blade);
    lens.add(pivot);
    pivots.push(pivot);
  }
  const R_OPEN = 0.94, R_SHUT = 0.07;
  const radiusFor = (f) => Math.min(R_OPEN, Math.max(R_SHUT, R_OPEN * Math.pow(1.4 / f, 0.85)));
  function setAperture(r) {
    const twist = (1 - r / R_OPEN) * 0.55;
    for (let i = 0; i < BLADES; i++) {
      const theta = (i / BLADES) * Math.PI * 2 + twist;
      pivots[i].rotation.z = theta - Math.PI / 2;
      pivots[i].position.set(r * Math.cos(theta), r * Math.sin(theta), 0);
    }
  }

  // 5. 光圈后面的照片：一块圆，着色器里做交叉淡入和等比裁切（相当于 object-fit: cover）
  const photoMat = new THREE.ShaderMaterial({
    uniforms: {
      tA: { value: null }, tB: { value: null },
      arA: { value: 1 }, arB: { value: 1 },
      mixT: { value: 0 }, shift: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tA; uniform sampler2D tB;
      uniform float arA; uniform float arB; uniform float mixT; uniform vec2 shift;
      varying vec2 vUv;
      vec2 cover(vec2 uv, float ar) {
        vec2 s = ar > 1.0 ? vec2(1.0 / ar, 1.0) : vec2(1.0, ar);
        return (uv - 0.5) * s * 0.92 + 0.5 + shift;       // 0.92：比开口略放大一点，跟着鼠标有视差
      }
      void main() {
        vec3 a = texture2D(tA, cover(vUv, arA)).rgb;
        vec3 b = texture2D(tB, cover(vUv, arB)).rgb;
        vec3 c = mix(a, b, mixT);
        float d = length(vUv - 0.5) * 2.0;
        c *= mix(1.0, 0.5, smoothstep(0.45, 1.0, d));      // 往边上暗下去：照片是在镜筒深处
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const photo = new THREE.Mesh(new THREE.CircleGeometry(0.995, 128), photoMat);
  photo.position.z = -0.4;
  lens.add(photo);

  // 6. 前镜片上的反光：左上一道细长的弧形高光，叠加混合。
  //    第一版是一团大的径向渐变，第二版右下还有个小亮点——两个看着都像镜片上的灰色污渍。
  //    反光要细、要锐才像玻璃，而且只要一道。
  const glint = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.lineCap = 'round';
    for (const [w, a] of [[26, 0.05], [12, 0.12], [4, 0.5]]) {   // 由宽到细叠三层，边缘自然虚掉
      g.strokeStyle = `rgba(255,255,255,${a})`;
      g.lineWidth = w;
      g.beginPath();
      g.arc(256, 256, 214, Math.PI * 1.08, Math.PI * 1.42);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.985, 96),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.8,
      }),
    );
    m.position.z = 0.17;
    m.renderOrder = 3;
    return m;
  })();
  lens.add(glint);

  const OUTER = 1.345;      // 镜头最外圈的半径（对焦环），排版按它算

  /* ── 照片：一张一张按需取，不一次下完 ─────────────────────────── */

  const loader = new THREE.TextureLoader();
  const textures = [];
  async function texture(i) {
    if (!textures[i]) {
      textures[i] = loader.loadAsync(data.covers[i]).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        t.userData.ar = t.image.width / t.image.height;
        return t;
      });
    }
    return textures[i];
  }
  let current = 0;
  const first = await texture(0);
  photoMat.uniforms.tA.value = photoMat.uniforms.tB.value = first;
  photoMat.uniforms.arA.value = photoMat.uniforms.arB.value = first.userData.ar;

  let fading = null;           // { start, to }
  async function advance() {
    if (fading) return;
    const to = (current + 1) % data.covers.length;
    const t = await texture(to);
    photoMat.uniforms.tB.value = t;
    photoMat.uniforms.arB.value = t.userData.ar;
    fading = { start: performance.now(), to };
    ringFrom.set(ringMat.color);
    ringTo.set(data.accents[to] || data.accents[0]);
    announce(to);
  }
  const ringFrom = new THREE.Color(), ringTo = new THREE.Color();
  // 光圈里换到哪一组，告诉 motion.js：第一屏的环境光跟着变成那一组的颜色
  const announce = (i) => dispatchEvent(new CustomEvent('lens:cover', {
    detail: { slug: data.slugs && data.slugs[i] },
  }));

  /* ── 排版：镜头放在哪、多大 ─────────────────────────────────────
     两种模式，每次 place() 按实际量到的文字位置选：

     side（宽屏、右边有地方）：名字、统计行、导航、开场白全在左边一栏。
       镜头停在这一栏的右边，文字从它左边滚过去，它在原地转过来、开光圈、变大一点，
       照片墙快上来之前淡出。横向上永远不跟文字重叠，所以竖直方向怎么放都安全。
     lift（窄屏、竖屏、或者名字太宽右边放不下）：镜头放在名字上方，
       滚动时下沿往上走得比页面快（LIFT > 1），间距只会越拉越大。

     ⚠️ 文字的右沿要用 Range 量「字」的边，不能量元素的盒子——
        h1 和 p 是块级元素，盒子横跨整个容器，量出来永远是满宽。 */

  let vw = 0, vh = 0, pxPerUnit = 1;
  const home = { cx: 0, cy: 0, r: 0 };          // 滚动为 0 时的屏幕圆心和半径（px）
  let mode = 'lift', fadeFrom = 0.55, fadeTo = 1, stopAt = 1.12;
  const DRIFT = 0.15;                           // side 模式下镜头随滚动缓慢上移的速度（相对页面）

  function textEdges() {
    const range = document.createRange();
    let right = 0;
    for (const el of document.querySelectorAll(
      '.masthead__eyebrow, .masthead__title, .masthead__meta, .catnav, .statement p, .masthead__scroll')) {
      range.selectNodeContents(el);
      for (const r of range.getClientRects()) if (r.width) right = Math.max(right, r.right);
    }
    let nameTop = vh * 0.6;
    if (title) { range.selectNodeContents(title); nameTop = range.getBoundingClientRect().top + scrollY; }
    const works = document.getElementById('photographs');
    const worksTop = works ? works.getBoundingClientRect().top + scrollY : vh * 1.6;
    return { right: right + scrollX, nameTop, worksTop };
  }

  function place() {
    vw = innerWidth; vh = innerHeight;
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    pxPerUnit = vh / (2 * HALF_H);

    const t = textEdges();
    const wide = vw >= 900 && vw / vh >= 1.05;
    let d = wide ? Math.min(vh * 0.52, vw * 0.4) : Math.min(vw * 0.64, vh * 0.36);
    const topGap = wide ? 76 : 64;               // 右上角还有语言切换按钮

    // side：左沿贴着文字右沿再留 44px；允许镜头右边被屏幕裁掉最多 28%
    const left = t.right + 44;
    const fits = (dd) => (vw - 20 - left) / dd >= 0.72;
    if (wide && !fits(d)) d = Math.max(vh * 0.34, (vw - 20 - left) / 0.72);
    if (wide && fits(d)) {
      mode = 'side';
      home.r = d / 2;
      home.cx = Math.max(left + home.r, Math.min(vw * 0.72, vw - 24 - home.r));
      home.cy = Math.max(topGap + home.r, vh * 0.4);
      // 照片墙从下面上来：镜头下沿在屏幕上的位置 = cy + r − DRIFT·scrollY，
      // 照片区上沿 = worksTop − scrollY。算出两者相遇的滚动量，在那之前 60px 淡完。
      const meet = (t.worksTop - (home.cy + home.r) - 60) / (1 - DRIFT);
      fadeTo = Math.min(1.15, Math.max(0.5, meet / vh));
      fadeFrom = Math.max(0.2, fadeTo - 0.3);
      stopAt = fadeTo + 0.04;
    } else {
      mode = 'lift';
      const maxBottom = t.nameTop - 28;
      d = wide ? Math.min(vh * 0.52, vw * 0.4) : Math.min(vw * 0.78, (maxBottom - topGap) * 0.86);
      if (topGap + d > maxBottom) d = Math.max(maxBottom - topGap, vh * 0.2);
      home.r = d / 2;
      home.cx = wide ? vw * 0.71 : vw / 2;
      // 宽屏：偏上；窄屏：放在语言按钮和名字之间那段空当的正中（原来贴着顶，下面空出一大截）
      home.cy = wide ? Math.min(vh * 0.38, maxBottom - home.r) : (topGap + maxBottom) / 2;
      home.cy = Math.max(home.cy, topGap + home.r);
      fadeFrom = 0.55; fadeTo = 1; stopAt = 1.12;
    }
    mount.dataset.mode = mode;
  }

  /* ── 状态：鼠标、滚动、快门 ───────────────────────────────────── */

  const pointer = { x: 0, y: 0 };                 // -1..1，屏幕中心为 0
  const rot = { x: 0, y: 0 };
  let shutter = null;                             // { start } 快门合开动画
  let scrollP = reduce ? 0 : scrollY / Math.max(1, innerHeight);
  let lastStop = '';
  let lastScreen = { cx: 0, cy: 0, r: 0, alpha: 1 };

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp01 = (t) => Math.min(1, Math.max(0, t));

  function fAt(p) {                               // 滚动 0 → 0.6 屏：ƒ/16 → ƒ/1.4（按对数走，跟真光圈一样）
    const t = ease(clamp01(p / 0.6));
    return Math.exp(Math.log(16) + (Math.log(1.4) - Math.log(16)) * t);
  }

  function frame(now) {
    const p = scrollP;
    const e = ease(clamp01((p - 0.12) / 0.88));

    let r, cx, cy;
    if (mode === 'side') {
      // 停在文字右边：以左下角为锚点放大一点（左沿不动 → 永远不会压到文字），
      // 同时随滚动缓慢上移，给下面上来的照片墙让路
      const grow = 1 + 0.24 * ease(clamp01(p / Math.max(0.3, fadeFrom)));
      r = home.r * grow;
      const left = home.cx - home.r;
      const bottom = home.cy + home.r - scrollY * DRIFT;
      cx = left + r;
      cy = bottom - r;
    } else {
      // 放在名字上方：放大、往右上掠过。下沿上移速度 = LIFT × 页面，永远不压到名字上
      r = home.r * (1 + 1.5 * e);
      cy = home.cy + home.r - scrollY * LIFT - r;
      cx = home.cx + vw * 0.09 * e;
    }
    const alpha = 1 - clamp01((p - fadeFrom) / Math.max(0.05, fadeTo - fadeFrom));

    lens.scale.setScalar((r / OUTER) / pxPerUnit);
    lens.position.set((cx - vw / 2) / pxPerUnit, -(cy - vh / 2) / pxPerUnit, 0);

    // 朝向：一开始是四分之三侧面（看得出这是个有厚度的镜头），滚着滚着转过来正对你；鼠标再叠一层
    const k = 1 - Math.exp(-(reduce ? 1 : 0.075) * 60 / 60);
    const face = clamp01(p / 0.5);
    // 初始只侧转 0.28：看得出镜筒的厚度，叶片又还接得住灯光。
    // 第一版转了 0.46，叶片整片背着光，只剩一团黑。
    const tx = (0.12 * (1 - face)) - pointer.y * 0.22;
    const ty = (-0.28 * (1 - face)) + pointer.x * 0.34;
    rot.x += (tx - rot.x) * k;
    rot.y += (ty - rot.y) * k;
    const t = now / 1000;
    lens.rotation.set(rot.x, rot.y, reduce ? 0 : Math.sin(t * 0.35) * 0.04);
    if (!reduce) lens.position.y += Math.sin(t * 0.8) * 0.02;

    // 光圈：滚动决定的 ƒ 值，再叠快门
    let f = reduce ? 4 : fAt(p);
    if (shutter) {
      const u = (now - shutter.start) / 520;
      if (u >= 1) shutter = null;
      else {
        const closeAmt = u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
        f = Math.exp(Math.log(f) + (Math.log(32) - Math.log(f)) * ease(closeAmt));
        if (u >= 0.35 && !shutter.swapped) { shutter.swapped = true; swapNow(); }
      }
    }
    setAperture(radiusFor(f));
    const stop = F_STOPS.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));
    const label = 'ƒ/' + stop;
    if (label !== lastStop) { readout.textContent = label; lastStop = label; }

    // 照片交叉淡入 + 色环跟着变色
    if (fading) {
      const u = clamp01((now - fading.start) / FADE_MS);
      photoMat.uniforms.mixT.value = ease(u);
      ringMat.color.copy(ringFrom).lerp(ringTo, u);
      ringMat.emissive.copy(ringMat.color);
      if (u >= 1) {
        photoMat.uniforms.tA.value = photoMat.uniforms.tB.value;
        photoMat.uniforms.arA.value = photoMat.uniforms.arB.value;
        photoMat.uniforms.mixT.value = 0;
        current = fading.to;
        fading = null;
      }
    }
    photoMat.uniforms.shift.value.set(-rot.y * 0.05, rot.x * 0.05);
    glint.rotation.z = -rot.y * 0.9 + rot.x * 0.4;

    // 两盏彩灯绕着镜头慢慢转，叶片上的彩色高光跟着走
    const a = t * 0.3;
    glowA.position.set(Math.cos(a) * 2.6, Math.sin(a) * 1.9, 3.4);
    glowB.position.set(Math.cos(a + 2.6) * 2.8, Math.sin(a + 2.6) * 2.0, 3.0);

    // ƒ 值读数挂在镜头右下，跟着镜头走
    readout.style.transform =
      `translate(${cx + r * 0.78}px, ${cy + r * 0.98}px) translate(-50%, 0)`;
    mount.style.opacity = alpha.toFixed(3);
    lastScreen = { cx, cy, r, alpha };

    renderer.render(scene, camera);
  }

  function swapNow() {                            // 快门合上的那一瞬间换照片，不做交叉淡入
    const to = (current + 1) % data.covers.length;
    texture(to).then((t) => {
      photoMat.uniforms.tA.value = photoMat.uniforms.tB.value = t;
      photoMat.uniforms.arA.value = photoMat.uniforms.arB.value = t.userData.ar;
      photoMat.uniforms.mixT.value = 0;
      ringMat.color.set(data.accents[to] || data.accents[0]);
      ringMat.emissive.copy(ringMat.color);
      current = to;
      fading = null;
      lastCycle = performance.now();
      announce(to);
    });
  }

  /* ── 起动 ───────────────────────────────────────────────────── */

  place();
  mount.classList.add('lens--on');
  if (reduce) {
    // 静止的一帧，跟着页面一起滚走
    mount.classList.add('lens--static');
    canvas.dataset.static = '1';
    frame(performance.now());
    canvas.dataset.ready = '1';
    requestAnimationFrame(() => mount.classList.add('is-visible'));
    addEventListener('resize', () => { place(); frame(performance.now()); });
    return;
  }

  let running = false, lastCycle = performance.now();
  function loop(now) {
    if (!running) return;
    scrollP = scrollY / Math.max(1, vh);
    if (scrollP > stopAt || document.hidden) {    // 滚过去了或者切到别的标签：停下来，不耗电
      running = false;
      mount.style.opacity = '0';
      return;
    }
    if (!fading && !shutter && now - lastCycle > CYCLE_MS) {
      lastCycle = now;
      advance();
    }
    frame(now);
    requestAnimationFrame(loop);
  }
  function wake() {
    if (running || document.hidden) return;
    if (scrollY / Math.max(1, vh) > stopAt) return;
    running = true;
    requestAnimationFrame(loop);
  }

  addEventListener('scroll', wake, { passive: true });
  document.addEventListener('visibilitychange', wake);
  addEventListener('resize', () => { place(); wake(); });

  if (!coarse) {
    addEventListener('pointermove', (ev) => {
      pointer.x = (ev.clientX / vw) * 2 - 1;
      pointer.y = (ev.clientY / vh) * 2 - 1;
      const over = insideLens(ev.clientX, ev.clientY) && !overContent(ev.clientX, ev.clientY);
      document.documentElement.classList.toggle('lens-hover', over);
    }, { passive: true });
  }
  addEventListener('click', (ev) => {
    if (ev.target.closest('a, button, input, label, summary, [tabindex]')) return;
    if (!insideLens(ev.clientX, ev.clientY)) return;
    if (!shutter) shutter = { start: performance.now(), swapped: false };
    wake();
  });

  function insideLens(x, y) {
    const s = lastScreen;
    return s.alpha > 0.3 && Math.hypot(x - s.cx, y - s.cy) < s.r * 0.95;
  }
  function overContent(x, y) {                    // 指针下面是文字/链接就不抢光标
    const el = document.elementFromPoint(x, y);
    return !!(el && el.closest('h1, h2, p, a, nav, li, button'));
  }

  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    running = false;
    mount.classList.remove('lens--on');
  });

  frame(performance.now());
  canvas.dataset.ready = '1';
  requestAnimationFrame(() => mount.classList.add('is-visible'));
  wake();
  texture(1);                                      // 趁空闲先把第二张取回来
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}
