/* ════════════════════════════════════════════════════════════════
   全站交互（「透过镜头」改版）：环境光、封面倾斜反光、跟随光标、走马盘、进度条兜底

   type="module"：老浏览器不认识，会整个跳过——它们拿到的就是静态版。
   所有效果都叠在现有 HTML 上；关掉 JS 时页面跟改版前一样。
   见 透过镜头设计.md 第七节。

   每个效果各自包在 try 里：一个出错不连累别的，更不影响页面本身。
   ⚠️ 这里只管「加」效果。任何会藏起内容的 CSS 都必须挂在这里加上的类下面
      （.fx / .fx-tilt / .is-zoetrope），不能反过来——CLAUDE.md 第三节第 3 条。
   ════════════════════════════════════════════════════════════════ */

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const home = root.classList.contains('theme-home');

// 所有「只在有 JS 时才出现」的样式都挂在 .fx 下面（环境光、进度条）
root.classList.add('fx');

for (const [wanted, feature] of [
  [home, ambient],
  [home && fine && !reduce, tilt],          // 减少动态效果：封面不倾斜
  [home && fine && !reduce, cursor],        // 减少动态效果：没有跟随光标
  [home, zoetrope],                         // 减少动态效果时也建，只是不自转
  [!home, progress],
]) {
  if (!wanted) continue;
  try { feature(); } catch (err) { console.warn(`[motion] ${feature.name} 已关闭：`, err); }
}

/* ── 环境光（首页）────────────────────────────────────────────────
   三团柔光的颜色 --a1..3 按优先级取：
     1. 鼠标 / 键盘焦点停在哪件作品上 → 那件作品的 --w1..3
     2. 视口正中那条线落在哪一区 → 那一区 <section> 上的 --w1..3
     3. 第一屏 → 镜头光圈里此刻那一组照片的颜色（lens.js 发 lens:cover 事件）
   颜色全是 build.py 取好、钳住亮度的，这里只负责挑一个、交给 CSS 过渡。 */
function ambient() {
  const layer = document.querySelector('.ambient');
  if (!layer) return;

  const colorsOf = (el) => {
    const cs = getComputedStyle(el);
    return [1, 2, 3].map((i) => cs.getPropertyValue(`--w${i}`).trim());
  };
  const cards = new Map([...document.querySelectorAll('.work[data-slug]')]
    .map((el) => [el.dataset.slug, el]));
  const first = document.querySelector('#photographs .work');
  let lensColors = first ? colorsOf(first) : null;   // 镜头的第一张就是照片区的第一组
  let zone = 'masthead';
  let hovered = null;

  const zones = new Map();
  const masthead = document.querySelector('.masthead');
  if (masthead) zones.set(masthead, 'masthead');
  for (const s of document.querySelectorAll('.cat')) zones.set(s, s.id);
  const zoneEl = (name) => [...zones].find(([, n]) => n === name)?.[0];

  let shown = '';
  function apply() {
    const colors = hovered ? colorsOf(hovered)
      : zone === 'masthead' ? lensColors
        : colorsOf(zoneEl(zone));
    if (!colors || !colors[0]) return;
    const key = colors.join();
    if (key === shown) return;
    shown = key;
    colors.forEach((c, i) => layer.style.setProperty(`--a${i + 1}`, c));
  }

  // 视口正中那条线（上下各缩进 50% 之后只剩一条线）落在哪一区。
  // 落在两区之间的空隙里时什么都不改，保持上一区的颜色。
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) zone = zones.get(e.target);
    apply();
  }, { rootMargin: '-50% 0px -50% 0px' });
  for (const el of zones.keys()) io.observe(el);

  // 扫过一排封面时不要每张都闪一下：进入要停 90ms 才算，离开给 260ms 的余地
  let enterTimer = 0, leaveTimer = 0;
  const enter = (card) => {
    clearTimeout(enterTimer); clearTimeout(leaveTimer);
    enterTimer = setTimeout(() => { hovered = card; apply(); }, 90);
  };
  const leave = () => {
    clearTimeout(enterTimer); clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { hovered = null; apply(); }, 260);
  };
  for (const card of cards.values()) {
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') enter(card); });
    card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') leave(); });
    card.addEventListener('focusin', () => enter(card));
    card.addEventListener('focusout', leave);
  }

  addEventListener('lens:cover', (e) => {
    const card = cards.get(e.detail?.slug);
    if (!card) return;
    lensColors = colorsOf(card);
    apply();
  });

  apply();
  // 先让「display: block + opacity: 0」落地一帧，再加 is-on，淡入才会真的发生
  getComputedStyle(layer).opacity;
  requestAnimationFrame(() => layer.classList.add('is-on'));
}

/* ── 封面倾斜 + 反光（首页，只在有鼠标的设备上）────────────────────
   鼠标在封面上时，封面朝鼠标那一侧往里倒（最多 8°），像拿在手里转向你的照片；
   一道柔光跟着鼠标。离开时弹簧回正：每帧 v = (v + (目标 − 现在)·K)·阻尼。
   量位置用链接的盒子，不用封面自己的——封面歪了之后它的外框会跟着变，拿来量会自己抖起来。 */
function tilt() {
  root.classList.add('fx-tilt');
  const MAX = 8, K = 0.12, DAMP = 0.74;
  const live = new Set();
  let raf = 0;

  for (const link of document.querySelectorAll('.work__link')) {
    const frame = link.querySelector('.work__frame');
    if (!frame) continue;
    const s = { frame, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, g: 0, tg: 0, gx: 50, gy: 50 };
    link.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = link.getBoundingClientRect();
      const u = (e.clientX - r.left) / frame.offsetWidth;
      const v = (e.clientY - r.top) / frame.offsetHeight;
      const on = u >= 0 && u <= 1 && v >= 0 && v <= 1;     // 在封面上，不是在下面的文字上
      s.tx = on ? (0.5 - v) * 2 * MAX : 0;
      s.ty = on ? (u - 0.5) * 2 * MAX : 0;
      s.tg = on ? 1 : 0;
      if (on) { s.gx = u * 100; s.gy = v * 100; }
      wake(s);
    });
    link.addEventListener('pointerleave', () => { s.tx = s.ty = s.tg = 0; wake(s); });
  }

  function wake(s) {
    live.add(s);
    s.frame.classList.add('is-tilting');
    if (!raf) raf = requestAnimationFrame(step);
  }
  function step() {
    raf = 0;
    for (const s of live) {
      s.vx = (s.vx + (s.tx - s.x) * K) * DAMP;
      s.vy = (s.vy + (s.ty - s.y) * K) * DAMP;
      s.x += s.vx;
      s.y += s.vy;
      s.g += (s.tg - s.g) * 0.14;
      const st = s.frame.style;
      st.setProperty('--rx', `${s.x.toFixed(2)}deg`);
      st.setProperty('--ry', `${s.y.toFixed(2)}deg`);
      st.setProperty('--gx', `${s.gx.toFixed(1)}%`);
      st.setProperty('--gy', `${s.gy.toFixed(1)}%`);
      st.setProperty('--go', s.g.toFixed(3));
      const settled = Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y)
        + Math.abs(s.vx) + Math.abs(s.vy) < 0.02 && Math.abs(s.tg - s.g) < 0.004;
      if (!settled) continue;
      live.delete(s);
      if (!s.tx && !s.ty && !s.tg) {          // 回正了：清掉变量，也不再占一个合成层
        for (const p of ['--rx', '--ry', '--gx', '--gy', '--go']) st.removeProperty(p);
        s.frame.classList.remove('is-tilting');
      }
    }
    if (live.size) raf = requestAnimationFrame(step);
  }
}

/* ── 跟随光标（首页，只在有鼠标的设备上）──────────────────────────
   系统光标照旧显示；这个圆环慢半拍跟在后面。停在带 data-cursor 的元素上时
   展开成实心圆片，写着那个属性里的字（build.py 按语言写的「看 / 播放 / 阅读」）。 */
function cursor() {
  const el = document.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);

  let x = 0, y = 0, tx = 0, ty = 0, raf = 0, label = '';
  const place = () => {
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  };
  function step() {
    raf = 0;
    x += (tx - x) * 0.24;
    y += (ty - y) * 0.24;
    place();
    if (Math.abs(tx - x) + Math.abs(ty - y) > 0.2) raf = requestAnimationFrame(step);
  }
  function retarget(target) {
    const hit = target instanceof Element ? target.closest('[data-cursor]') : null;
    const next = hit ? hit.dataset.cursor : '';
    if (next === label) return;
    label = next;
    if (label) el.textContent = label;     // 缩回圆环时字先留着，跟 color 的过渡一起淡掉
    el.classList.toggle('has-label', !!label);
  }

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX;
    ty = e.clientY;
    if (!el.classList.contains('is-on')) { x = tx; y = ty; place(); el.classList.add('is-on'); }
    retarget(e.target);
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });

  // 只滚轮、不动鼠标时，指针下面换了东西却没有 pointermove——自己看一眼
  let queued = false;
  addEventListener('scroll', () => {
    if (queued || !el.classList.contains('is-on')) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; retarget(document.elementFromPoint(tx, ty)); });
  }, { passive: true });

  root.addEventListener('mouseleave', () => el.classList.remove('is-on'));
  addEventListener('blur', () => el.classList.remove('is-on'));
  // 点封面换页时，它会被拍进旧页面的快照里，整个光圈动画期间停在屏幕上——换页前先藏起来。
  // 从往返缓存回到这页时再放出来。
  addEventListener('pageswap', () => { el.style.display = 'none'; });
  addEventListener('pageshow', () => { el.style.display = ''; });
}

/* ── 走马盘（首页影评区，宽屏）─────────────────────────────────────
   62 张海报卷成三层的圆筒。只改 .posterwall 一个元素的 --spin，每张海报的位置
   （--row、--theta）只在开启时写一次。DOM 顺序不动：Tab 顺序、读屏顺序都跟网格时一样。

   ⚠️ ZOE_W 跟 style.css 的 --zw 必须一致，它同时是改写后的 sizes——
      正面那张在 z = 0，显示宽度恰好是它（见 style.css .zoetrope 上面的注释）。
   ⚠️ GRID_W 跟 build.py 的 POSTER_WALL_PX、style.css 的 --poster-w 一致：
      窗口缩到 900 以下变回网格时，sizes 要改回去。 */
function zoetrope() {
  const wall = document.querySelector('.posterwall');
  if (!wall) return;
  const ZOE_W = 120, GRID_W = 96, ROWS = 3, GAP = 16;
  const AUTO = reduce ? 0 : 3.2;           // 自转，度/秒：将近两分钟一圈。减少动态效果时不转
  const wide = matchMedia('(min-width: 901px)');   // ↔ style.css 的 @media (max-width: 900px)
  const items = [...wall.querySelectorAll('.posterwall__item')];
  if (!items.length) return;

  const stage = document.createElement('div');
  stage.className = 'zoetrope';
  const thetas = new Map();
  let R = 460, degPerPx = 0.12;
  let on = false, visible = false, hovering = false, focused = false;
  let spin = 0, vel = 0, target = null, drag = null, swallowClick = false;
  let raf = 0, last = 0;

  const setSizes = (px) => {
    for (const el of wall.querySelectorAll('img[sizes], source[sizes]')) el.setAttribute('sizes', `${px}px`);
  };

  function enable() {
    if (on) return;
    on = true;
    wall.before(stage);
    stage.append(wall);
    // 分三层，每层各自等分一圈；中间那层错开半格，像砌砖
    const per = Math.ceil(items.length / ROWS);
    items.forEach((li, i) => {
      const row = Math.floor(i / per);
      const n = Math.min(per, items.length - row * per);
      const theta = (((i % per) + (row % 2) * 0.5) / n) * 360;
      thetas.set(li, theta);
      li.style.setProperty('--row', row);
      li.style.setProperty('--theta', `${theta.toFixed(3)}deg`);
    });
    // 半径：最挤的那层，相邻两张之间留 GAP
    R = Math.ceil((ZOE_W + GAP) / (2 * Math.sin(Math.PI / per)));
    degPerPx = 180 / (Math.PI * R);        // 拖 1px，正面的海报正好跟着手走 1px
    wall.style.setProperty('--R', `${R}px`);
    wall.classList.add('is-zoetrope');
    setSizes(ZOE_W);
    render();
    kick();
  }
  function disable() {
    if (!on) return;
    on = false;
    cancelAnimationFrame(raf);
    raf = 0;
    wall.classList.remove('is-zoetrope');
    for (const p of ['--R', '--spin']) wall.style.removeProperty(p);
    for (const li of items) { li.style.removeProperty('--row'); li.style.removeProperty('--theta'); }
    stage.replaceWith(wall);
    setSizes(GRID_W);
  }

  const render = () => wall.style.setProperty('--spin', `${spin.toFixed(3)}deg`);
  function kick() {
    if (raf || !on || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (drag) {
      // 拖动中：spin 由 pointermove 直接写
    } else if (target !== null) {
      const d = target - spin;
      spin += d * Math.min(1, dt * 7);
      if (Math.abs(d) < 0.05) { spin = target; target = null; }
      vel = 0;
    } else {
      // 放手后的惯性慢慢回到自转速度；鼠标停在上面、或者键盘焦点在里面时，目标速度是 0。
      // 往右读：新的一张从右边转进来，所以自转是负方向。
      const want = hovering || focused ? 0 : -AUTO;
      vel += (want - vel) * Math.min(1, dt * 1.8);
      spin += vel * dt;
    }
    render();
    const moving = drag || target !== null || Math.abs(vel) > 0.01 || (!hovering && !focused && AUTO);
    if (moving) raf = requestAnimationFrame(tick);
  }

  // 键盘 Tab 到哪一张，就把它转到正面（就近转，不绕远路）
  function faceFront(li) {
    let t = -(thetas.get(li) || 0);
    t += 360 * Math.round((spin - t) / 360);
    if (reduce) { spin = t; target = null; render(); return; }
    target = t;
    kick();
  }
  stage.addEventListener('focusin', (e) => {
    const li = e.target.closest?.('.posterwall__item');
    if (!on || !li) return;
    focused = true;
    faceFront(li);
  });
  stage.addEventListener('focusout', (e) => {
    if (!stage.contains(e.relatedTarget)) { focused = false; kick(); }
  });

  stage.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovering = true; kick(); } });
  stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hovering = false; kick(); } });

  // 拖：移动超过 4px 才算拖（之前的按下-抬起还是普通的点击，链接照常打开）
  stage.addEventListener('pointerdown', (e) => {
    if (!on || e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, spin0: spin, lastX: e.clientX, lastT: e.timeStamp,
             v: 0, captured: false };
    target = null;
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.captured) {
      if (Math.abs(dx) < 5) return;
      drag.captured = true;
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('is-dragging');
      kick();
    }
    spin = drag.spin0 + dx * degPerPx;
    const dt = (e.timeStamp - drag.lastT) / 1000;
    if (dt > 0) drag.v = drag.v * 0.5 + ((e.clientX - drag.lastX) * degPerPx / dt) * 0.5;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.captured) {
      // 停了一下再松手就没有惯性；减少动态效果时也不甩
      const idle = e.timeStamp - drag.lastT > 80;
      vel = reduce || idle ? 0 : Math.max(-240, Math.min(240, drag.v));
      swallowClick = true;
      stage.classList.remove('is-dragging');
    }
    drag = null;
    kick();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  // 拖完松手时那一下 click 不能打开链接
  stage.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
  }).observe(stage);

  const sync = () => (wide.matches ? enable() : disable());
  wide.addEventListener('change', sync);
  sync();
}

/* ── 内页顶部的进度条：不支持滚动驱动动画的浏览器才用 JS 写 --p ──────── */
function progress() {
  const bar = document.querySelector('.progress');
  if (!bar || CSS.supports('animation-timeline: scroll()')) return;   // 支持的浏览器纯 CSS 在跑
  let queued = false;
  const update = () => {
    queued = false;
    const max = root.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    bar.style.setProperty('--p', p.toFixed(4));
  };
  addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
  addEventListener('resize', update);
  update();
}
