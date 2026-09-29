/* ════════════════════════════════════════════════════════════════
   首页第一屏（2026-09-29「放映厅」改版）：七组照片的封面轮流全屏，
   缓慢推近、顺着被裁掉的方向平移、淡入淡出。见 放映厅改版设计.md 第五节。
   它替掉了「透过镜头」的 3D 镜头（lens.js + Three.js）。

   type="module"，只在首页加载（build.py 的 shell）。第一张写在 HTML 里，关掉 JS 时就是它；
   其余六张的地址在 #hero-data，**轮到它之前 2 秒**才建、才下载。
   · 减少动态效果：一开始是停着的（暂停键按下状态），想看可以按——按了只淡入淡出，不推不移
   · 省流量（Save-Data）：整个不接管，连暂停键也不出
   · 滚出第一屏（露出来的不到四分之一）、切到后台标签：暂停
   自动轮播超过 5 秒必须能停（WCAG 2.2.2，A 级），所以有暂停键。
   ⚠️ 这里只管「加」效果：会藏东西的样式都挂在这里加的 .hero--live 下面（CLAUDE.md 第三节第 3 条）。
   ════════════════════════════════════════════════════════════════ */

const HOLD = 6000;      // 每张停多久（毫秒）
const FADE = 1600;      // 淡入淡出 ↔ style.css 的 .hero__slide transition；推近一共 FADE + HOLD + FADE = 9.2 秒
const AHEAD = 2000;     // 提前多久开始下载下一张
const TRAVEL = 0.3;     // 平移封顶：视口那个方向的 30%。不封顶的话竖片在宽屏上 7.6 秒要走 1260px，那是扫

const hero = document.querySelector('.hero');
const dataEl = document.getElementById('hero-data');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);

if (hero && dataEl && !saveData) {
  try { reel(JSON.parse(dataEl.textContent)); }
  catch (err) { console.warn('[hero] 已关闭：', err); }
}

function reel(slides) {
  if (slides.length < 2) return;
  const box = hero.querySelector('.hero__reel');
  const link = hero.querySelector('.hero__caption');
  const work = hero.querySelector('.hero__work');
  const btn = hero.querySelector('.hero__pause');
  const els = new Map([[0, box.querySelector('.hero__slide')]]);
  const failed = new Set();
  let cur = 0;
  let userPaused = reduce;          // 减少动态效果：一开始就是停着的
  let visible = true;
  let timer = 0, preTimer = 0, dueAt = 0, left = HOLD;

  // 推近和平移：轮到这一张时按第一屏此刻的大小算一次。
  // 图按 cover 铺满（宽 max(W, H×ar)、高 max(H, W/ar)），比屏幕多出来的 ox / oy 就是每边能挪的量。
  // 竖着多出来的从上往下看（图往上走），横着多出来的从左往右看（图往左走）。
  // first：第一张一开始就在屏幕上（静止时摆在重心），从那个位置起步，才不会跳一下。
  function drift(el, s, first = false) {
    const W = hero.clientWidth, H = hero.clientHeight;
    const iw = Math.max(W, H * s.ar), ih = Math.max(H, W / s.ar);
    const ox = (iw - W) / 2, oy = (ih - H) / 2;
    const cl = (v, m) => Math.max(-m, Math.min(m, v));
    const cx = cl((0.5 - s.fx / 100) * iw, ox), cy = cl((0.5 - s.fy / 100) * ih, oy);
    const tx = Math.min(2 * ox, TRAVEL * W), ty = Math.min(2 * oy, TRAVEL * H);
    const px = (k, v) => el.style.setProperty(k, `${v.toFixed(1)}px`);
    px('--x0', first ? cx : cl(cx + tx / 2, ox));
    px('--y0', first ? cy : cl(cy + ty / 2, oy));
    px('--x1', cl(cx - tx / 2, ox));
    px('--y1', cl(cy - ty / 2, oy));
  }

  function build(i) {
    if (els.has(i)) return els.get(i);
    const s = slides[i];
    const fig = document.createElement('figure');
    fig.className = 'hero__slide';
    fig.dataset.i = String(i);
    fig.setAttribute('aria-hidden', 'true');
    fig.style.setProperty('--ar', s.ar);
    fig.style.setProperty('--fx', s.fx);
    fig.style.setProperty('--fy', s.fy);
    const pic = document.createElement('picture');
    for (const [ext, type] of [['avif', 'image/avif'], ['webp', 'image/webp']]) {
      if (!s[ext]) continue;
      const src = document.createElement('source');
      src.type = type;
      src.sizes = s.sizes;
      src.srcset = s[ext];
      pic.append(src);
    }
    const img = document.createElement('img');
    img.alt = s.alt;
    img.decoding = 'async';
    img.sizes = s.sizes;
    img.srcset = s.jpg;
    img.src = s.src;
    pic.append(img);
    fig.append(pic);
    box.append(fig);
    els.set(i, fig);
    return fig;
  }

  const ready = (fig) => new Promise((done) => {
    const img = fig.querySelector('img');
    if (img.complete) { done(img.naturalWidth > 0); return; }
    img.addEventListener('load', () => done(true), { once: true });
    img.addEventListener('error', () => done(false), { once: true });
  });

  const nextOf = (i) => {
    for (let k = 1; k < slides.length; k++) {
      const j = (i + k) % slides.length;
      if (!failed.has(j)) return j;
    }
    return i;
  };

  function show(i) {
    const prev = els.get(cur), next = els.get(i);
    if (!next || next === prev) return;
    next.classList.remove('is-run');
    if (!reduce) {
      drift(next, slides[i]);
      void next.offsetWidth;          // 同一张转回来时，让推近从头开始
      next.classList.add('is-run');
    }
    next.classList.add('is-on');
    next.removeAttribute('aria-hidden');
    prev.classList.remove('is-on');
    prev.setAttribute('aria-hidden', 'true');
    // 淡出的那张推近到淡完再停，不然最后 1.6 秒突然不动了
    setTimeout(() => { if (!prev.classList.contains('is-on')) prev.classList.remove('is-run'); }, FADE + 50);
    cur = i;
    link.setAttribute('href', slides[i].href);
    work.textContent = slides[i].label;
  }

  const playing = () => !userPaused && visible && !document.hidden;

  function schedule(ms) {
    clearTimeout(timer);
    clearTimeout(preTimer);
    dueAt = performance.now() + ms;
    const n = nextOf(cur);
    if (n !== cur) preTimer = setTimeout(() => build(n), Math.max(0, ms - AHEAD));
    timer = setTimeout(advance, ms);
  }

  async function advance() {
    const n = nextOf(cur);
    if (n === cur) return;
    const fig = build(n);
    const loaded = await ready(fig);
    if (!loaded) {                    // 这一张下不来：跳过它，以后也不再试
      failed.add(n);
      fig.remove();
      els.delete(n);
      if (playing()) advance();
      return;
    }
    try { await fig.querySelector('img').decode(); } catch (e) { /* 解码失败也照样显示 */ }
    if (!playing()) { left = 0; return; }   // 等图的时候被暂停了：恢复时马上换
    show(n);
    schedule(HOLD + FADE);
  }

  function sync() {
    const paused = hero.classList.contains('hero--paused');
    if (playing() && paused) {
      hero.classList.remove('hero--paused');
      schedule(left);
    } else if (!playing() && !paused) {
      hero.classList.add('hero--paused');
      left = Math.max(0, dueAt - performance.now());
      clearTimeout(timer);
      clearTimeout(preTimer);
    }
    btn.setAttribute('aria-pressed', String(userPaused));
  }

  els.get(0).dataset.i = '0';
  if (!reduce) {
    drift(els.get(0), slides[0], true);
    els.get(0).classList.add('is-run');
  }
  hero.classList.add('hero--live', 'hero--paused');   // 先按「停着」建好，sync() 按实际状态解开
  left = HOLD;
  sync();

  btn.hidden = false;
  btn.addEventListener('click', () => { userPaused = !userPaused; sync(); });
  new IntersectionObserver(([e]) => { visible = e.intersectionRatio >= 0.25; sync(); },
    { threshold: [0, 0.25, 0.5] }).observe(hero);
  document.addEventListener('visibilitychange', sync);

  // 给 verify.js 用：跳到第 i 张并停住（像素探针要逐张量字的对比度）。到了之后写 data-at。
  hero.addEventListener('hero:goto', async (e) => {
    const i = Number(e.detail);
    delete hero.dataset.at;
    userPaused = true;
    sync();
    const fig = build(i);
    if (await ready(fig)) show(i);
    hero.dataset.at = String(i);
  });
}
