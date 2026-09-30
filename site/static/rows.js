/* ════════════════════════════════════════════════════════════════
   每行铺满（2026-09-30「放映厅」改版第三步）：首页照片墙、系列页的网格共用一套排法。
   见 放映厅改版设计.md 第十六节（首页）、第七节（系列页网格）。

   type="module"，首页和系列页加载（build.py 的 shell）。关掉 JS 时：首页是原来的定高换行，
   系列页只有逐张、没有切换按钮——这里只「加」：
   · 首页照片墙：原来定高 300px、放不下换行，七组排成 4 + 2 + 1，最后一行只剩一张。
     现在整体算好怎么分行，每一行缩放到正好铺满版心（同一行等高），行高尽量接近原来的 --cover-h。
   · CSS 仍是「宽 = 宽高比 × 行高」，这里只给每一张写行高（首页 --cover-h、网格 --row-h），
     再把它的 <img> / <source> 的 sizes 写成实际显示宽度——行高跟 build.py 写进 sizes 的定值最多差 ±25%，
     不改的话浏览器会下错档。窄屏、切回逐张时还原成 build.py 那份。
   ════════════════════════════════════════════════════════════════ */

const STACK = matchMedia('(max-width: 900px)');     // ↔ build.py 的 INDEX_STACK_PX：首页堆叠时不排
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// 系列页网格的目标行高 ↔ 放映厅改版设计.md 第七节的 clamp(150px, 22vw, 260px)：1440 上 260px，一组九张约一屏
const gridRow = () => Math.min(260, Math.max(150, 0.22 * innerWidth));

for (const [wanted, feature] of [
  [!!document.querySelector('#photographs .works'), wall],
  [!!document.querySelector('.viewmode') && !!document.getElementById('plates'), grid],
]) {
  if (!wanted) continue;
  try { feature(); } catch (err) { console.warn(`[rows] ${feature.name} 已关闭：`, err); }
}

/*
  整体最优分行：照片按顺序切成几行，每行缩放到正好铺满 width（同一行等高）；
  怎么切，让每一行的高度都尽量接近 target——代价是各行 (ln(行高 / target))² 的和，动态规划。
  七张算一次不到一毫秒。
  一行一行往下塞、塞满就换行的简单排法在 1920 上会排成 5 + 2、最后一行不满，所以要整体算。
  返回 [{ from, to, h }]：第 from 到第 to 张（含）一行，行高 h（已经留出 0.5px，免得舍入把最后一张挤到下一行）。
*/
export function partition(ars, width, gap, target) {
  const n = ars.length, cost = [0], cut = [];
  for (let j = 1; j <= n; j++) {
    cost[j] = Infinity;
    for (let i = j - 1, sum = 0; i >= 0; i--) {
      sum += ars[i];
      const c = cost[i] + Math.log((width - gap * (j - 1 - i)) / sum / target) ** 2;
      if (c < cost[j]) { cost[j] = c; cut[j] = i; }
    }
  }
  const rows = [];
  for (let j = n; j > 0; j = cut[j]) {
    const i = cut[j];
    const sum = ars.slice(i, j).reduce((a, b) => a + b, 0);
    rows.unshift({ from: i, to: j - 1, h: (width - gap * (j - 1 - i) - 0.5) / sum });
  }
  return rows;
}

/* 一张照片的所有 <img> / <source>：记下 build.py 写的 sizes，好还原 */
function sizeables(el) {
  const list = [...el.querySelectorAll('img, source')];
  for (const e of list) if (!e.dataset.sizes) e.dataset.sizes = e.getAttribute('sizes') || '';
  return list;
}
export function setSizes(el, px) {
  for (const e of sizeables(el)) e.setAttribute('sizes', `${Math.ceil(px)}px`);
}
export function resetSizes(el) {
  for (const e of sizeables(el)) e.setAttribute('sizes', e.dataset.sizes);
}

/* 版心宽（去掉左右内边距）和列距 */
export function measure(list) {
  const cs = getComputedStyle(list);
  return {
    width: list.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    gap: parseFloat(cs.columnGap) || 0,
  };
}

/* 宽度变了才重排（ResizeObserver 也会因为高度变了叫一次，排完高度就变——不能每次都排） */
export function onWidth(el, fn) {
  let last = el.clientWidth, raf = 0;
  new ResizeObserver(() => {
    if (el.clientWidth === last) return;
    last = el.clientWidth;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fn);
  }).observe(el);
}

/* ── 首页照片墙 ─────────────────────────────────────────────────── */
function wall() {
  const list = document.querySelector('#photographs .works');
  const items = [...list.querySelectorAll(':scope > .work')];
  if (items.length < 2) return;
  const ars = items.map((li) => parseFloat(li.style.getPropertyValue('--ar')));
  if (ars.some((a) => !(a > 0))) return;

  function layout() {
    // 先回到 CSS 自己的定高，量出这个宽度下的 --cover-h 当目标（用 offsetHeight：倾斜的 transform 不算进去）
    for (const li of items) { li.style.removeProperty('--cover-h'); resetSizes(li); }
    if (STACK.matches) return;
    const target = items[0].querySelector('.work__frame').offsetHeight;
    const { width, gap } = measure(list);
    if (!(target > 0) || !(width > 0)) return;
    for (const row of partition(ars, width, gap, target)) {
      for (let i = row.from; i <= row.to; i++) {
        items[i].style.setProperty('--cover-h', `${row.h}px`);
        setSizes(items[i], ars[i] * row.h);
      }
    }
  }
  layout();
  onWidth(list, layout);
}

/* ── 系列页：逐张 · 网格 ─────────────────────────────────────────────
   默认逐张（一屏一张，认真看作品的看法）；网格是九张一眼看全，每行铺满、同一行等高。
   切换时用同一页的 View Transition：视野里的几张从原来的位置滑到新位置，其余的跟整页一起淡入淡出。
   ⚠️ 先给 <html> 加 .vt-local——根节点上挂着换页的光圈，同一页的切换只淡入淡出（style.css 那段）。
   点网格里的任何一张，gallery.js 照旧打开灯箱、从它的位置放大，关掉缩回网格里。不记忆：每次打开都是逐张。 */
function grid() {
  const bar = document.querySelector('.viewmode');
  const list = document.getElementById('plates');
  const plates = [...list.querySelectorAll(':scope > .plate')];
  const ars = plates.map((p) => parseFloat(p.style.getPropertyValue('--ar')));
  if (!plates.length || ars.some((a) => !(a > 0))) return;
  const btns = [...bar.querySelectorAll('.viewmode__btn')];
  let mode = 'one';

  function layout() {
    if (mode !== 'grid') return;
    const { width, gap } = measure(list);
    for (const row of partition(ars, width, gap, gridRow())) {
      for (let i = row.from; i <= row.to; i++) {
        plates[i].style.setProperty('--row-h', `${row.h}px`);
        setSizes(plates[i], ars[i] * row.h);
      }
    }
  }
  function apply(next) {
    mode = next;
    list.classList.toggle('is-grid', mode === 'grid');
    for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (mode === 'grid') {
      for (const p of plates) p.classList.add('is-in');        // 网格一眼看全，别等进场动画
      layout();
    } else {
      for (const p of plates) { p.style.removeProperty('--row-h'); resetSizes(p); }
    }
  }
  function switchTo(next) {
    if (next === mode) return;
    const top = bar.getBoundingClientRect().top;
    // 切完把按钮留在原来的屏幕位置：逐张有九屏高、网格一屏，不这样的话读者会被甩到页面别处
    const update = () => { apply(next); scrollBy(0, bar.getBoundingClientRect().top - top); };
    if (reduce || typeof document.startViewTransition !== 'function') { update(); return; }
    const frames = plates.map((p) => p.querySelector('.plate__frame')).filter((f) => {
      const r = f.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    frames.forEach((f, i) => { f.style.viewTransitionName = `plate-${i}`; f.style.viewTransitionClass = 'plate'; });
    const root = document.documentElement;
    root.classList.add('vt-local');
    const done = () => {
      for (const f of frames) { f.style.viewTransitionName = ''; f.style.viewTransitionClass = ''; }
      root.classList.remove('vt-local');
    };
    document.startViewTransition(update).finished.then(done, done);
  }

  bar.hidden = false;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('.viewmode__btn');
    if (b) switchTo(b.dataset.mode);
  });
  onWidth(list, layout);
}
