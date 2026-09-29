/*
  整站验证。用本机 Chrome（playwright-core，不下载额外浏览器）。

  playwright-core 不进仓库（CLAUDE.md：仓库里没有 npm）。装在任何临时目录，
  用 NODE_PATH 指过去：

      mkdir -p /tmp/pw && cd /tmp/pw && npm install playwright-core
      NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js http://localhost:8412
      NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js https://yanaoliu-jpg.github.io

  这个脚本以前住在 scratchpad 里，丢过三次。2026-09 起进仓库。

  ⚠️ 判据写错过很多次，每次都误报成网站有问题。已知的坑：
     · 页面上的大写是 CSS text-transform 转的，HTML 里是原样 —— 别用大写去 grep
     · 首页封面等高只在 >900px 成立；≤900px 是竖向堆叠，本来就不等高
     · 竖屏设备上限制照片的是宽度，不是高度
     · loading="lazy" 的图要逐屏滚过去才会加载，直接 scrollTo(bottom) 中间那些永远是 0
     · 相对链接要算到底：new URL(href, location.href).pathname，看落点在哪一层
     · 深色字在浅底上，对比度卡脖子的是**最深**那一站，不是最浅的
     · 进度条是滚动驱动的动画，给它设毫秒的 currentTime 会抛错——只动 document.timeline 上的动画
     · 冻结换页动画时只冻要看的那一次；冻住前一次，它永远不结束，会把下一次的名字撤掉

  2026-09「透过镜头」改版加了第 13–21 节：镜头、配色约束、走马盘、换页配对、全屏放大、
  减少动态效果 / 触屏 / 关掉 JS 三种降级，以及**像素级对比度探针**（第 21 节）。
*/
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.argv[2] || 'http://localhost:8412').replace(/\/$/, '');
// 只跑某几节（改一处就全跑一遍要十来分钟）：ONLY=nav,theme,6 node site/tools/verify.js URL
// 名字就是每节注释开头的编号或英文词。不写 ONLY 就全跑。
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(String(k));

// ⚠️ 必须按 order 排 —— 「下一组」链路检查靠它算下一个是谁
const SLUGS = ['stop-scrolling', 'good-night', 'goodbye-renfen', 'the-old-days',
  'night-wind', 'keep-going-back', 'looking-forward', 'sea-and-light',
  'gratitude', 'make-a-wish'];
const FILMS = new Set(['stop-scrolling', 'gratitude', 'make-a-wish']);
const NOTES = 'film-notes';
const WIDTHS = [375, 414, 768, 1024, 1440, 1920];

// 颜色（2026-09-29「放映厅」改版起默认全站暗色；读者可以切到亮色）
const DARK_THEME = '#0d0e11';          // ↔ build.py DARK_THEME_COLOR：默认，全站
const HOME_THEME = '#f3e4dc';          // ↔ build.py HOME_THEME_COLOR：亮色时的首页
const PAPER_THEME = '#f2efe9';         // ↔ build.py PAPER_THEME_COLOR：亮色时的内页
const DARKEST_STOP = '#dde3ee';        // 亮色首页渐变里最深的一站——深色字在它上面对比度最低
const COVER_H_1440 = 300;              // ↔ --cover-h 在 1440 上的值
const FILM_W_1440 = Math.round(300 * 16 / 9);   // 533
// 整页高度的回归防线。规格里写的 5.5 是样稿阶段估的，没算区间距和说明文字；
// 实测 6.05（间距已按封面比例收过 25%）。再往下只能压开头那一屏，那是他选定保留的。
const MAX_SCREENS_1440 = 6.1;

let pass = 0; const fails = [];
const ok = (c, msg) => { if (c) pass++; else fails.push(msg); };

async function go(pg, u) {
  for (let i = 0; i < 5; i++) {
    try { return await pg.goto(u, { waitUntil: 'networkidle', timeout: 45000 }); }
    catch (e) { if (i === 4) throw e; await pg.waitForTimeout(4000); }
  }
}
async function scrollThrough(pg) {   // 逐屏滚，让 lazy 图和进场动效都触发
  await pg.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await pg.waitForTimeout(1500);
}
const lum = h => { const [r, g, b] = h.match(/\w\w/g).map(x => parseInt(x, 16) / 255)
  .map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const rgbHex = (s) => '#' + s.match(/[\d.]+/g).slice(0, 3).map((n) => Math.round(+n).toString(16).padStart(2, '0')).join('');

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  // 亮色模式的上下文：每一页的脚本跑之前先把 localStorage 的 theme 设成 light
  async function lightContext(opts = {}) {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
    await c.addInitScript(() => { try { localStorage.setItem('theme', 'light'); } catch (e) { /* 隐私模式 */ } });
    return c;
  }
  // 控制台报错一律记下来，最后统一算一项（镜头、走马盘、换页脚本都在这里出声）
  const consoleErrors = [];
  pg.on('pageerror', (e) => consoleErrors.push(`${pg.url()} ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${pg.url()} ${m.text()}`); });

  const pages = [];
  for (const dir of ['', '/zh']) {
    pages.push(`${dir}/`);
    for (const s of SLUGS) pages.push(`${dir}/${s}/`);
    pages.push(`${dir}/${NOTES}/`);
  }
  const isHome = p => p === '/' || p === '/zh/';

  /* 像素级对比度探针的工具（第 21 节，以及后面新加的几节都要用）——说明见第 21 节 */
  const PROBE_CSS = `
    html.probe *, html.probe *::before, html.probe *::after {
      color: transparent !important; -webkit-text-fill-color: transparent !important;
      text-shadow: none !important; text-decoration-color: transparent !important;
      transition: none !important; }
    html.probe .cat__label { background-image: none !important; }
    html.probe .cursor { display: none !important; }`;
  const probeFails = [];
  let probeRuns = 0;
  async function probe(page, label) {
    const runs = await page.evaluate(() => {
      const out = [];
      const range = document.createRange();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hex = (v) => v.trim();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        // 「跳到作品」那种平时被 clip-path 裁掉的字：Range 量出来仍是整段字的大小，不能算。
        // （别用盒子大小判断：border-box 加上内边距，width: 1px 的盒子实际有 40×24）
        if (getComputedStyle(el).clipPath !== 'none') continue;
        // 跟随光标的圆片：截图时它被藏起来了，量到的是它底下的照片。它自带实心底色（--ink 上 --bg，13.8:1）
        if (el.closest('.cursor')) continue;
        // 被别的东西挡住的字（2026-09-29 起有了固定导航）：比如第一屏滚到导航底下时的「正在放映」——
        // 读者看不见它，量它底下的颜色没有意义（量到的是磨砂导航）。看字框正中那一点最上面是谁
        {
          const r0 = (() => { range.selectNodeContents(n); return range.getBoundingClientRect(); })();
          const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
          if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
            const hit = document.elementFromPoint(cx, cy);
            if (hit && !el.contains(hit) && !hit.contains(el)) continue;
          }
        }
        let op = 1; for (let a = el; a; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
        if (op < 0.98) continue;
        const cs = getComputedStyle(el);
        const m = cs.color.match(/[\d.]+/g).map(Number);
        if (m.length > 3 && m[3] < 0.98 && !(cs.webkitBackgroundClip === 'text')) continue;
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()]
          .map(r => [Math.max(0, r.left), Math.max(0, r.top), Math.min(innerWidth, r.right), Math.min(innerHeight, r.bottom)])
          .filter(([l, t, r, b]) => r - l > 2 && b - t > 2);
        if (!rects.length) continue;
        const grad = cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
        out.push({
          text: n.textContent.trim().slice(0, 30),
          // 区标题的渐变字颜色按模式取（style.css 的 --g：暗色 = --w，亮色 = --d）
          colors: grad ? [1, 2, 3].map(i => hex(cs.getPropertyValue('--g' + i))) : [m.slice(0, 3)],
          grad, size: parseFloat(cs.fontSize), weight: parseFloat(cs.fontWeight), rects,
        });
      }
      return out;
    });
    await page.evaluate((css) => {
      if (!document.getElementById('probe-css')) {
        const s = document.createElement('style'); s.id = 'probe-css'; s.textContent = css; document.head.append(s);
      }
      document.documentElement.classList.add('probe');
    }, PROBE_CSS);
    await page.waitForTimeout(120);
    const png = await page.screenshot();
    await page.evaluate(() => document.documentElement.classList.remove('probe'));
    const res = await page.evaluate(async ({ b64, runs }) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      const k = bmp.width / innerWidth;
      const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
      const hexL = (h) => L(...h.match(/\w\w/g).map(x => parseInt(x, 16)));
      const fails = [];
      for (const run of runs) {
        const vals = [];
        for (const [l, t, r, b] of run.rects) {
          const x0 = Math.floor(l * k), y0 = Math.floor(t * k), w = Math.max(1, Math.floor((r - l) * k)), h = Math.max(1, Math.floor((b - t) * k));
          const px = g.getImageData(x0, y0, w, h).data;
          const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
          for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
            const i = (y * w + x) * 4; vals.push(L(px[i], px[i + 1], px[i + 2]));
          }
        }
        vals.sort((a, b) => a - b);
        const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)];
        // 渐变字：暗底上浅色字卡脖子的是最深那一站，亮底上深色字卡脖子的是最浅那一站——
        // 每一站往两个方向各让 0.01（oklch 插值的中间色跟端点差一点），取最差的
        const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const tls = run.grad ? run.colors.map(hexL).flatMap((l) => [Math.max(0, l - 0.01), l + 0.01]) : [L(...run.colors[0])];
        const got = Math.min(...tls.map((tl) => Math.min(cr(tl, lo), cr(tl, hi))));
        const large = run.size >= 24 || (run.size >= 18.66 && run.weight >= 700);
        const need = large ? 3 : 4.5;
        if (got < need) fails.push(`「${run.text}」${got.toFixed(2)}:1 < ${need}（底 ${lo.toFixed(3)}–${hi.toFixed(3)}）`);
      }
      return { fails, n: runs.length };
    }, { b64: png.toString('base64'), runs });
    probeRuns += res.n;
    for (const f of res.fails) probeFails.push(`${label} ${f}`);
    ok(res.fails.length === 0, `对比度探针 ${label}：${res.fails.length} 段字不够（明细见末尾）`);
  }

  /* ── 1. 每个页面：200、无占位符、无 3200 档、无溢出、主题类和 meta 对、字体加载 ── */
  if (want(1)) {
    for (const p of pages) {
      const r = await go(pg, BASE + p);
      ok(r && r.status() === 200, `${p} 状态 ${r && r.status()}`);
      const d = await pg.evaluate(async () => {
        await document.fonts.ready;
        return {
          placeholders: document.querySelectorAll('.placeholder').length,
          tier3200: [...document.querySelectorAll('img, source')]
            .filter(e => /-3200\.(avif|webp|jpg)/.test((e.getAttribute('srcset') || '') + (e.getAttribute('src') || ''))).length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          themeHome: document.documentElement.classList.contains('theme-home'),
          themeColor: document.querySelector('meta[name=theme-color]').content,
          colorScheme: document.querySelector('meta[name=color-scheme]').content,
          // fonts.check 在没有匹配的 @font-face 时也返回 true，所以要看真正加载了的
          dmLoaded: [...document.fonts].some(f => f.family === 'DM Sans' && f.status === 'loaded'),
          anyNewsreader: [...document.fonts].some(f => /Newsreader|Noto Serif/.test(f.family)),
          h1Face: getComputedStyle(document.querySelector('h1')).fontFamily,
          // 3D 镜头 2026-09-29 撤掉了：Three.js 和 lens.js 哪一页都不该再取
          legacy: performance.getEntriesByType('resource').filter((r) => /vendor\/three\/|\/lens\.js/.test(r.name)).length,
          // 换页的名字是点的时候临时起的，平时一个都不该挂着（:root 自带的 root 除外）
          // <video> 里面的 <source> 这些不渲染的元素算出来是空串，不是 none——别当成名字
          vtNames: [...document.querySelectorAll('*')].map(e => getComputedStyle(e).viewTransitionName)
            .filter(n => n && n !== 'none' && n !== 'root' && n !== 'sitenav'),   // 导航自己一组，常驻
          glow: !!document.querySelector('.masthead__card > .glow:first-child'),
        };
      });
      ok(d.legacy === 0, `${p} 还在取镜头的文件（${d.legacy} 个）`);
      ok(d.vtNames.length === 0, `${p} 平时就挂着 view-transition-name：${d.vtNames.join(',')}`);
      ok(d.glow === !isHome(p), `${p} 光晕${d.glow ? '不该有' : '缺了（应是标题卡的第一个元素）'}`);
      ok(d.placeholders === 0, `${p} 有 ${d.placeholders} 个占位符`);
      ok(d.tier3200 === 0, `${p} 还在引用 3200px 档（${d.tier3200} 处）`);
      ok(d.overflow === 0, `${p} 横向溢出 ${d.overflow}px`);
      ok(d.themeHome === isHome(p), `${p} theme-home 类${d.themeHome ? '不该有' : '缺了'}`);
      ok(d.themeColor === DARK_THEME, `${p} theme-color 是 ${d.themeColor}，默认应是 ${DARK_THEME}`);
      ok(d.colorScheme === 'dark', `${p} color-scheme 是 ${d.colorScheme}`);
      ok(d.dmLoaded, `${p} DM Sans 没加载`);
      ok(!d.anyNewsreader, `${p} 还声明着旧字体`);
      ok(/DM Sans/.test(d.h1Face), `${p} h1 用的不是 DM Sans：${d.h1Face}`);
    }
  }

  /* ── 2. 语言切换落在对方语言的同一页 ── */
  if (want(2)) {
    for (const p of pages) {
      await go(pg, BASE + p);
      const to = await pg.evaluate(() => new URL(
        document.querySelector('.langswitch').getAttribute('href'), location.href).pathname);
      const want = p.startsWith('/zh') ? p.replace('/zh', '') : '/zh' + p;
      ok(to === want, `${p} 语言切换落在 ${to}，应该是 ${want}`);
    }
  }

  /* 第 3 节（「分类导航留在本语言」）2026-09-29 删了：分类导航撤掉，由顶部导航接手，见下面 nav 节 */

  /* ── nav. 顶部导航：每页都有；名字和四项都落在**本语言**；内页所属那一类标 aria-current；
     往下滚收起、往上滑出来；手机上菜单能开、四项都在、点了能到（2026-09-29「放映厅」改版）── */
  if (want('nav')) {
    const ANCHORS = ['#photographs', '#films', '#film-notes', '#about'];
    const CURRENT = { series: '#photographs', film: '#films', notes: '#film-notes' };
    for (const p of pages) {
      await go(pg, BASE + p);
      const d = await pg.evaluate(() => {
        const bar = document.querySelector('.sitenav');
        const abs = (a) => { const u = new URL(a.getAttribute('href'), location.href); return u.pathname + u.hash; };
        return bar && {
          fixed: getComputedStyle(bar).position === 'fixed',
          name: abs(bar.querySelector('.sitenav__name')),
          links: [...bar.querySelectorAll('.sitenav__link')].map(abs),
          current: [...bar.querySelectorAll('.sitenav__link[aria-current]')].map(abs),
        };
      });
      ok(!!d, `${p} 没有顶部导航`);
      if (!d) continue;
      const home = p.startsWith('/zh') ? '/zh/' : '/';
      ok(d.fixed, `${p} 导航没有固定在顶上`);
      ok(d.name === (isHome(p) ? home + '#top' : home), `${p} 名字落在 ${d.name}，应该回本语言首页`);
      ok(JSON.stringify(d.links) === JSON.stringify(ANCHORS.map((a) => home + a)), `${p} 导航四项落在 ${d.links.join(' ')}`);
      const slug = p.split('/').filter(Boolean).pop();
      const kind = isHome(p) ? null : slug === NOTES ? 'notes' : FILMS.has(slug) ? 'film' : 'series';
      const cur = kind ? [home + CURRENT[kind]] : [];
      ok(JSON.stringify(d.current) === JSON.stringify(cur), `${p} aria-current 在 ${d.current.join(' ') || '（没有）'}，应在 ${cur.join(' ') || '（没有）'}`);
    }
    // 往下滚收起、往上滑出来（在内页查；首页第一屏上的透明状态在 hero 节查）
    await go(pg, `${BASE}/good-night/`);
    await pg.evaluate(() => scrollTo(0, 1200)); await pg.waitForTimeout(250);
    await pg.evaluate(() => scrollTo(0, 1800)); await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => document.querySelector('.sitenav').classList.contains('is-away')), '往下滚之后导航应收起');
    await pg.evaluate(() => scrollTo(0, 1500)); await pg.waitForTimeout(500);
    ok(!(await pg.evaluate(() => document.querySelector('.sitenav').classList.contains('is-away'))), '往上滑之后导航应出来');
    // 手机：菜单是原生 popover
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    for (const dir of ['', '/zh']) {
      await go(mp, `${BASE}${dir}/good-night/`);
      const closed = await mp.evaluate(() => getComputedStyle(document.querySelector('.sitenav__links')).display);
      await mp.tap('.sitenav__menu');
      await mp.waitForTimeout(300);
      const open = await mp.evaluate(() => ({ open: document.querySelector('.sitenav__links').matches(':popover-open'),
        n: [...document.querySelectorAll('.sitenav__link')].filter((a) => a.getBoundingClientRect().height > 0).length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      ok(closed === 'none' && open.open && open.n === 4 && open.overflow === 0,
         `${dir}/good-night/ 手机菜单：收起时 display=${closed}，打开后 ${JSON.stringify(open)}`);
      await mp.tap('.sitenav__link >> nth=1');
      await mp.waitForLoadState('networkidle');
      await mp.waitForTimeout(500);
      const at = await mp.evaluate(() => ({ path: location.pathname + location.hash,
        open: document.querySelector('.sitenav__links').matches(':popover-open') }));
      ok(at.path === `${dir}/#films` && !at.open, `${dir}/ 手机菜单点「影片」：${JSON.stringify(at)}`);
    }
    await mctx.close();
  }

  /* ── theme. 亮暗切换：默认暗；切到亮色换页还在、theme-color 跟着变；切回来；
     亮色模式下灯箱仍是暗底浅字（2026-09-29「放映厅」改版）── */
  if (want('theme')) {
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tp = await tctx.newPage();
    const state = () => tp.evaluate(() => ({
      theme: document.documentElement.dataset.theme || 'dark',
      color: document.querySelector('meta[name=theme-color]').content,
      scheme: document.querySelector('meta[name=color-scheme]').content,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      btn: !document.querySelector('.sitenav__theme').hidden,
      label: document.querySelector('.sitenav__theme').getAttribute('aria-label'),
    }));
    await go(tp, `${BASE}/`);
    let s = await state();
    ok(s.theme === 'dark' && s.color === DARK_THEME && s.scheme === 'dark' && s.btn && s.label === 'Switch to light mode',
       `默认应是暗色、按钮在：${JSON.stringify(s)}`);
    await tp.click('.sitenav__theme');
    await tp.waitForTimeout(900);
    s = await state();
    ok(s.theme === 'light' && s.color === HOME_THEME && s.scheme === 'light' && s.label === 'Switch to dark mode',
       `首页切到亮色后：${JSON.stringify(s)}`);
    await go(tp, `${BASE}/good-night/`);
    s = await state();
    ok(s.theme === 'light' && s.color === PAPER_THEME && rgbHex(s.bg) === PAPER_THEME, `换页之后应还是亮色（纸色）：${JSON.stringify(s)}`);
    await go(tp, `${BASE}/zh/film-notes/`);
    s = await state();
    ok(s.theme === 'light' && s.label === '切换到暗色', `中文页也应是亮色：${JSON.stringify(s)}`);
    await go(tp, `${BASE}/good-night/`);
    await tp.click('#plate-1 .plate__open');
    await tp.waitForTimeout(1300);
    const vw = await tp.evaluate(() => ({ bg: getComputedStyle(document.getElementById('viewer')).backgroundColor,
      ink: getComputedStyle(document.querySelector('.viewer__count')).color }));
    ok(vw.bg === 'rgb(8, 9, 11)' && lum(rgbHex(vw.ink)) > 0.15, `亮色模式下灯箱应仍是暗底浅字：${JSON.stringify(vw)}`);
    await tp.keyboard.press('Escape');
    await tp.waitForTimeout(800);
    // 关掉灯箱时页面会把那张照片滚回视野，往下滚导航就收起了——先回到顶上再点
    await tp.evaluate(() => scrollTo(0, 0));
    await tp.waitForTimeout(500);
    await tp.click('.sitenav__theme');
    await tp.waitForTimeout(900);
    await go(tp, `${BASE}/`);
    s = await state();
    ok(s.theme === 'dark' && s.color === DARK_THEME, `切回暗色后换页应是暗色：${JSON.stringify(s)}`);
    await tctx.close();
  }

  /* ── hero. 首页第一屏：第一张写在 HTML 里；其余轮到前 2 秒才取；每 7.6 秒换一张；
     暂停键有效；滚出第一屏自动停；减少动态效果静止；省流量静止、没有按钮；导航在上面是透明的
     （2026-09-29「放映厅」改版，撤掉 3D 镜头换成的）── */
  if (want('hero')) {
    const bigRe = /-2400\.(avif|webp)$/;     // @2x 的 1440 宽屏上只有第一屏要 2400 那档（封面卡片要 900）
    const hctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const hp = await hctx.newPage();
    const big = [];
    hp.on('request', (r) => { if (bigRe.test(r.url())) big.push(r.url()); });
    await go(hp, `${BASE}/`);
    const html = await hp.evaluate(() => ({
      slides: document.querySelectorAll('.hero__slide').length,
      high: document.querySelector('.hero__slide img').getAttribute('fetchpriority'),
      data: JSON.parse(document.getElementById('hero-data').textContent),
      live: document.querySelector('.hero').classList.contains('hero--live'),
      btn: !document.querySelector('.hero__pause').hidden,
      over: document.querySelector('.sitenav').classList.contains('is-over-hero'),
    }));
    ok(html.slides === 1 && html.high === 'high', `第一屏一开始应只有一张、fetchpriority=high：${html.slides} / ${html.high}`);
    ok(html.data.length === 7, `hero-data 应有 7 张，现在 ${html.data.length}`);
    ok(html.live && html.btn && html.over, `第一屏应在放、暂停键在、导航透明：${JSON.stringify({ ...html, data: undefined })}`);
    const want1 = html.data.map((s) => ({ label: s.label, href: s.href }));
    const at = () => hp.evaluate(() => ({ i: document.querySelector('.hero__slide.is-on')?.dataset.i,
      label: document.querySelector('.hero__work').textContent,
      href: document.querySelector('.hero__caption').getAttribute('href'),
      pressed: document.querySelector('.hero__pause').getAttribute('aria-pressed') }));
    await hp.waitForTimeout(800);
    ok(big.length === 1, `一开始只该取第一张的大图，现在 ${big.length} 张`);
    await hp.waitForTimeout(4200);
    ok(big.length === 2, `第 4 秒左右应开始取第二张，现在 ${big.length} 张`);
    await hp.waitForTimeout(3300);
    let a = await at();
    ok(a.i === '1' && a.label === want1[1].label && a.href === want1[1].href, `7.6 秒后应换到第二张：${JSON.stringify(a)}`);
    await hp.click('.hero__pause');
    await hp.waitForTimeout(9000);
    a = await at();
    const drift = await hp.evaluate(() => document.querySelector('.hero__slide.is-on img').getAnimations().map((x) => x.playState));
    ok(a.i === '1' && a.pressed === 'true' && drift.length > 0 && drift.every((s) => s === 'paused'),
       `暂停后应停在第二张、推近也停：${JSON.stringify({ ...a, drift })}`);
    await hp.click('.hero__pause');
    await hp.waitForTimeout(8500);
    a = await at();
    ok(a.i === '2' && a.pressed === 'false', `恢复后应换到第三张：${JSON.stringify(a)}`);
    await hp.evaluate(() => document.getElementById('photographs').scrollIntoView());
    await hp.waitForTimeout(600);
    ok(!(await hp.evaluate(() => document.querySelector('.sitenav').classList.contains('is-over-hero'))), '滚出第一屏后导航应变回磨砂');
    await hp.waitForTimeout(8500);
    ok((await at()).i === '2', '滚出第一屏后不该再换');
    await hctx.close();

    const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const rp = await rctx.newPage();
    await go(rp, `${BASE}/`);
    await rp.waitForTimeout(8500);
    const still = () => rp.evaluate(() => ({ i: document.querySelector('.hero__slide.is-on').dataset.i,
      pressed: document.querySelector('.hero__pause').getAttribute('aria-pressed'),
      anims: document.querySelector('.hero__slide.is-on img').getAnimations().length }));
    let r = await still();
    ok(r.i === '0' && r.pressed === 'true' && r.anims === 0, `减少动态效果：应静止在第一张、暂停键按下、不推近：${JSON.stringify(r)}`);
    await rp.click('.hero__pause');
    await rp.waitForTimeout(8500);
    r = await still();
    ok(r.i === '1' && r.anims === 0, `减少动态效果：按了播放应换张、但不推不移：${JSON.stringify(r)}`);
    await rctx.close();

    const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await sctx.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
    const sp = await sctx.newPage();
    const sbig = [];
    sp.on('request', (q) => { if (bigRe.test(q.url())) sbig.push(q.url()); });
    await go(sp, `${BASE}/`);
    await sp.waitForTimeout(8500);
    const sv = await sp.evaluate(() => ({ n: document.querySelectorAll('.hero__slide').length,
      live: document.querySelector('.hero').classList.contains('hero--live'),
      btn: !document.querySelector('.hero__pause').hidden }));
    ok(sv.n === 1 && !sv.live && !sv.btn && sbig.length === 1, `省流量：应只有第一张、静止、没有暂停键：${JSON.stringify({ ...sv, big: sbig.length })}`);
    await sctx.close();
  }

  /* ── about. 「关于」：两段开场白；几行事实都来自网站上已有的内容；邮箱空着时没有「联系」那行；页脚
     （2026-09-29「放映厅」改版）。他发来邮箱之后：FACTS 两边各加一行 ['Contact', 邮箱] / ['联系', 邮箱]，
     页脚的期望值改成「北京 · 邮箱」。── */
  if (want('about')) {
    const FACTS = {
      '': [['Based in', 'Beijing'], ['Camera', 'Sony α7 IV · Sigma 24-70mm F2.8 DG DN Art'],
           ['Work', '7 series 63 photographs 3 films 62 notes'], ['Years', '2023–2026'],
           ['Recognition', 'National Outstanding Honor · Public Service Announcement · HOSA 2026 — Stop Scrolling, Stay Alive']],
      '/zh': [['所在', '北京'], ['器材', '索尼 α7 IV · 适马 24-70mm F2.8 DG DN Art'], ['作品', '7 组 63 张 3 部影片 62 篇影评'],
              ['年份', '2023 至 2026'], ['获奖', '国家级卓越奖 · 公益广告 · 2026 HOSA 生物与健康未来领袖挑战——《停止滑动，面对生活》']],
    };
    for (const dir of ['', '/zh']) {
      await go(pg, `${BASE}${dir}/`);
      const d = await pg.evaluate(() => {
        const sec = document.getElementById('about');
        return sec && {
          paras: sec.querySelectorAll('.about__text p').length,
          rows: [...sec.querySelectorAll('.about__facts > div')].map((r) => [
            r.querySelector('dt').textContent.trim(), r.querySelector('dd').textContent.replace(/\s+/g, ' ').trim()]),
          footer: document.querySelector('.colophon__gear').textContent.replace(/\s+/g, ' ').trim(),
        };
      });
      ok(!!d && d.paras === 2, `${dir}/ 「关于」应有两段开场白：${d && d.paras}`);
      ok(!!d && JSON.stringify(d.rows) === JSON.stringify(FACTS[dir]), `${dir}/ 「关于」的事实：${d && JSON.stringify(d.rows)}`);
      ok(!!d && d.footer === FACTS[dir][0][1], `${dir}/ 页脚是「${d && d.footer}」`);
    }
  }

  /* ── 4. 「下一组」首尾相接、不跨语言 ── */
  if (want(4)) {
    for (const dir of ['', '/zh']) for (let i = 0; i < SLUGS.length; i++) {
      await go(pg, `${BASE}${dir}/${SLUGS[i]}/`);
      const to = await pg.evaluate(() => new URL(document.querySelector('.nextup__link').getAttribute('href'), location.href).pathname);
      const want = `${dir}/${SLUGS[(i + 1) % SLUGS.length]}/`;
      ok(to === want, `${dir}/${SLUGS[i]}/ 的下一组是 ${to}，应该是 ${want}`);
    }
  }

  /* ── 5. 编号：影片不占系列号 ── */
  if (want(5)) {
    for (const dir of ['', '/zh']) for (let j = 0; j < SLUGS.length; j++) {
      if (FILMS.has(SLUGS[j])) continue;
      await go(pg, `${BASE}${dir}/${SLUGS[j]}/`);
      const eb = await pg.evaluate(() => document.querySelector('.masthead__eyebrow').textContent);
      const n = SLUGS.slice(0, j + 1).filter(s => !FILMS.has(s)).length;
      const want = dir ? `第${'〇一二三四五六七八九'[n]}组` : `Series ${String(n).padStart(2, '0')}`;
      ok(eb.includes(want), `${dir}/${SLUGS[j]}/ 编号是「${eb.trim()}」，应含「${want}」`);
    }
  }

  /* ── 6. 首页灰阶的对比度：暗色对 #0d0e11；亮色对渐变最深那一站；亮色下琥珀色不能当字 ── */
  if (want(6)) {
    const inks = (page) => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      // 自定义属性读出来是写的原样：多半已经是 #rrggbb。#9a9ca4 里恰好有三段数字，
      // 当成 rgb() 去拆就错成 #090904（2026-09-29 换暗色后才踩到）——是 # 开头就原样返回
      const toHex = (v) => { v = v.trim(); if (v.startsWith('#')) return v; const m = v.match(/\d+/g); return m && m.length >= 3
        ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : v; };
      return Object.fromEntries(['--ink', '--ink-text', '--ink-dim', '--ink-mute', '--ink-faint'].map((k) => [k, toHex(cs.getPropertyValue(k))]));
    });
    await go(pg, BASE + '/');
    for (const [k, v] of Object.entries(await inks(pg))) {
      const c = contrast(v, DARK_THEME);
      ok(c >= 4.5, `首页（暗）${k} = ${v} 对 ${DARK_THEME} 只有 ${c.toFixed(2)}:1`);
    }
    const lctx = await lightContext();
    const lp = await lctx.newPage();
    await go(lp, BASE + '/');
    for (const [k, v] of Object.entries(await inks(lp))) {
      const c = contrast(v, DARKEST_STOP);
      ok(c >= 4.5, `首页（亮）${k} = ${v} 对最深站 ${DARKEST_STOP} 只有 ${c.toFixed(2)}:1`);
    }
    const amberText = await lp.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((e) => getComputedStyle(e).color === 'rgb(217, 160, 91)' && e.textContent.trim()).length);
    ok(amberText === 0, `亮色首页有 ${amberText} 处用琥珀色当文字（1.9:1，过不了）`);
    await lctx.close();
  }

  /* ── 7. 首页封面：等高 300、影片并排、整页高度、sizes 同步 ── */
  if (want(7)) {
    for (const w of WIDTHS.filter(x => x > 900)) {
      await pg.setViewportSize({ width: w, height: 900 });
      for (const dir of ['', '/zh']) {
        await go(pg, `${BASE}${dir}/`);
        const d = await pg.evaluate(() => ({
          hs: [...document.querySelectorAll('#photographs .work__frame')].map(e => Math.round(e.getBoundingClientRect().height)),
          filmW: Math.round(document.querySelector('.work--film .work__frame').getBoundingClientRect().width),
          filmH: Math.round(document.querySelector('.work--film .work__frame').getBoundingClientRect().height),
          screens: document.documentElement.scrollHeight / 900,
          sizes: document.querySelector('#photographs img').getAttribute('sizes'),
          radius: getComputedStyle(document.querySelector('.work__frame')).borderRadius,
        }));
        ok(d.hs.length === 7 && new Set(d.hs).size === 1, `${dir}/ @${w}px 照片封面不等高：${d.hs.join(',')}`);
        ok(d.filmH === d.hs[0], `${dir}/ @${w}px 影片封面高 ${d.filmH} ≠ 照片 ${d.hs[0]}`);
        ok(/15vw \+ 84px/.test(d.sizes), `${dir}/ @${w}px sizes 跟 --cover-h 对不上：${d.sizes}`);
        ok(d.radius === '10px', `${dir}/ @${w}px 封面圆角是 ${d.radius}`);
        if (w === 1440) {
          ok(d.hs[0] === COVER_H_1440, `${dir}/ @1440 封面高 ${d.hs[0]}，应该是 ${COVER_H_1440}`);
          ok(Math.abs(d.filmW - FILM_W_1440) <= 3, `${dir}/ @1440 影片封面宽 ${d.filmW}，应 ≈ ${FILM_W_1440}（不再撑满一行）`);
          ok(d.screens <= MAX_SCREENS_1440, `${dir}/ @1440×900 整页 ${d.screens.toFixed(2)} 屏，超过 ${MAX_SCREENS_1440}`);
        }
      }
    }
    await pg.setViewportSize({ width: 1440, height: 900 });
  }

  /* ── 8. 影评页：62 条、锚点、海报、课堂笔记、署名 ── */
  if (want(8)) {
    for (const dir of ['', '/zh']) {
      await go(pg, `${BASE}${dir}/${NOTES}/`);
      await scrollThrough(pg);
      const d = await pg.evaluate(() => {
        const n = [...document.querySelectorAll('.note')];
        return {
          count: n.length,
          anchored: n.filter(x => x.id && document.getElementById(x.id) === x).length,
          loaded: n.filter(x => { const i = x.querySelector('.note__poster'); return i && i.naturalWidth > 0; }).length,
          klass: document.querySelectorAll('.note--class').length,
          credit: document.querySelector('.colophon__gear').textContent,
        };
      });
      ok(d.count === 62, `${dir}/${NOTES}/ 有 ${d.count} 条`);
      ok(d.anchored === 62, `${dir}/${NOTES}/ 只有 ${d.anchored} 个锚点能解析`);
      ok(d.loaded === 62, `${dir}/${NOTES}/ 只有 ${d.loaded} 张海报真加载了`);
      ok(d.klass === 3, `${dir}/${NOTES}/ 课堂笔记 ${d.klass} 条，应该 3`);
      ok(/TMDB/.test(d.credit), `${dir}/${NOTES}/ 页脚缺 TMDB 署名`);
    }
  }

  /* ── 9. 首页海报墙：62 张、sizes 跟实际宽度对得上、不溢出、不跨语言 ──
     > 900px 有 JS 时是走马盘（第 16 节细查）：正面那张 120px，sizes 全部改成 120px；
     ≤ 900px 是网格：列宽恒等于 sizes（96px）。 */
  if (want(9)) {
    for (const w of WIDTHS) {
      await pg.setViewportSize({ width: w, height: 900 });
      for (const dir of ['', '/zh']) {
        await go(pg, `${BASE}${dir}/`);
        await pg.evaluate(() => document.getElementById('film-notes').scrollIntoView());
        await pg.waitForTimeout(1500);
        const d = await pg.evaluate(() => {
          const wall = document.querySelector('.posterwall'); const img = wall.querySelector('.posterwall__img');
          const sizes = [...wall.querySelectorAll('img[sizes], source[sizes]')].map(e => e.getAttribute('sizes'));
          return {
            items: wall.querySelectorAll('.posterwall__item').length,
            zoe: wall.classList.contains('is-zoetrope'),
            colW: getComputedStyle(wall).gridTemplateColumns.split(' ')[0], sizes: img.getAttribute('sizes'),
            sizesSame: new Set(sizes).size === 1,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            crossLang: [...wall.querySelectorAll('a')].filter(a =>
              new URL(a.getAttribute('href'), location.href).pathname.startsWith('/zh/') !== location.pathname.startsWith('/zh/')).length,
          };
        });
        ok(d.items === 62, `${dir}/ @${w}px 海报墙 ${d.items} 张`);
        ok(d.overflow === 0, `${dir}/ @${w}px 海报墙横向溢出 ${d.overflow}px`);
        ok(d.zoe === (w > 900), `${dir}/ @${w}px ${d.zoe ? '不该是走马盘' : '应该是走马盘'}`);
        ok(d.sizesSame, `${dir}/ @${w}px 海报的 sizes 不一致`);
        if (d.zoe) ok(d.sizes === '120px', `${dir}/ @${w}px 走马盘的 sizes 是 ${d.sizes}，应该 120px`);
        else ok(d.colW === d.sizes, `${dir}/ @${w}px 列宽 ${d.colW} 跟 sizes ${d.sizes} 对不上`);
        ok(d.crossLang === 0, `${dir}/ @${w}px 有 ${d.crossLang} 条海报链接跨了语言`);
      }
    }
    await pg.setViewportSize({ width: 1440, height: 900 });
  }

  /* ── 10. 中文零缺字形（Noto Sans SC）── */
  if (want(10)) {
    for (const p of ['/zh/', `/zh/${NOTES}/`, '/zh/good-night/']) {
      await go(pg, BASE + p);
      const d = await pg.evaluate(async () => {
        await document.fonts.ready;
        const uniq = [...new Set(document.body.innerText.match(/[一-鿿　-〿＀-￯]/g) || [])].join('');
        return { loaded: [...document.fonts].some(f => f.family === 'Noto Sans SC' && f.status === 'loaded'),
                 covered: document.fonts.check('16px "Noto Sans SC"', uniq), n: uniq.length };
      });
      ok(d.loaded, `${p} Noto Sans SC 没加载`);
      ok(d.covered, `${p} 中文缺字形（用到 ${d.n} 个字）`);
    }
  }

  /* ── 11. 关掉 JS：所有内容默认可见 ── */
  if (want(11)) {
    const noJs = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const np = await noJs.newPage();
    for (const p of ['/', '/zh/', `/${NOTES}/`, '/good-night/', '/stop-scrolling/']) {
      await go(np, BASE + p);
      const d = await np.evaluate(() => {
        const all = [...document.querySelectorAll('.plate, .work, .note, .posterwall__item, .film__video, .hero__slide')];
        const shown = (s) => [...document.querySelectorAll(s)].some(e => getComputedStyle(e).display !== 'none');
        return { total: all.length, hidden: all.filter(e => getComputedStyle(e).opacity !== '1').length,
                 hasReveal: document.documentElement.classList.contains('js-reveal'),
                 hasFx: /\bfx\b/.test(document.documentElement.className),
                 // 「透过镜头」加的几层：没有 JS 时一个都不能出现
                 extras: ['.ambient', '.progress', '.cursor', '.zoetrope', '.sitenav__theme'].filter(shown),
                 slides: document.querySelectorAll('.hero__slide').length,
                 heroBtn: shown('.hero__pause'),
                 nav: shown('.sitenav'),
                 wall: document.querySelector('.posterwall') && getComputedStyle(document.querySelector('.posterwall')).display,
                 screens: document.documentElement.scrollHeight / innerHeight };
      });
      ok(d.total > 0 && d.hidden === 0, `${p} 关掉 JS 后有 ${d.hidden}/${d.total} 个内容块不可见`);
      ok(!d.hasReveal, `${p} 关掉 JS 却有 js-reveal 类`);
      ok(!d.hasFx && d.extras.length === 0, `${p} 关掉 JS 却出现了 ${d.extras.join(', ') || 'fx 类'}`);
      if (d.wall) ok(d.wall === 'grid', `${p} 关掉 JS 海报墙应是网格，现在是 ${d.wall}`);
      ok(d.nav, `${p} 关掉 JS 时导航应照常显示`);
      if (p === '/' || p === '/zh/') ok(d.slides === 1 && !d.heroBtn, `${p} 关掉 JS 时第一屏应只有第一张、没有暂停键：${d.slides} / ${d.heroBtn}`);
      if (p === '/' || p === '/zh/') ok(d.screens <= MAX_SCREENS_1440, `${p} 关掉 JS 时整页 ${d.screens.toFixed(2)} 屏，超过 ${MAX_SCREENS_1440}`);
    }
    await noJs.close();
  }

  /* ── 12. 影片播放器 ── */
  if (want(12)) {
    for (const s of FILMS) for (const dir of ['', '/zh']) {
      await go(pg, `${BASE}${dir}/${s}/`);
      const d = await pg.evaluate(() => { const v = document.querySelector('video'); return {
        ok: v.hasAttribute('controls') && !v.hasAttribute('autoplay') && !v.hasAttribute('loop') && v.getAttribute('preload') === 'metadata' && !!v.getAttribute('poster'),
        srcs: [...v.querySelectorAll('source')].map(x => x.src.split('.').pop()).join(',') }; });
      ok(d.ok, `${dir}/${s}/ 播放器属性不对`);
      ok(d.srcs === 'webm,mp4', `${dir}/${s}/ source 顺序是 ${d.srcs}`);
    }
  }

  /* ════ 以下是 2026-09「透过镜头」改版加的 ════ */

  /* ── 13. 每件作品和每个区的颜色都守住亮度约束（3D 镜头那几项 2026-09-29 随镜头删了）──
     --w（环境光）≥ 0.74：深色小字压在上面仍然 ≥ 4.5:1；--d（渐变大字）≤ 0.18：大字 ≥ 3:1 */
  if (want(13)) {
    await pg.setViewportSize({ width: 1440, height: 900 });
    for (const dir of ['', '/zh']) {
      await go(pg, `${BASE}${dir}/`);
      const d = await pg.evaluate(() => ({
        cats: document.querySelectorAll('.cat[style]').length,
        pal: [...document.querySelectorAll('.work[data-slug], .cat[style]')].map(el => {
          const cs = getComputedStyle(el);
          const v = (k) => [1, 2, 3].map(i => cs.getPropertyValue(`--${k}${i}`).trim());
          return { id: el.dataset.slug || el.id, w: v('w'), d: v('d') };
        }),
      }));
      ok(d.cats >= 3 && d.pal.length === SLUGS.length + d.cats, `${dir}/ 带颜色的作品 + 区是 ${d.pal.length} 个，应该 ${SLUGS.length} + ${d.cats}`);
      for (const x of d.pal) {
        for (const c of x.w) ok(/^#[0-9a-f]{6}$/.test(c) && lum(c) >= 0.74, `${dir}/ ${x.id} 的 --w ${c} 亮度 ${lum(c).toFixed(3)} < 0.74`);
        for (const c of x.d) ok(/^#[0-9a-f]{6}$/.test(c) && lum(c) <= 0.18, `${dir}/ ${x.id} 的 --d ${c} 亮度 ${lum(c).toFixed(3)} > 0.18`);
      }
    }
  }

  /* ── 14. 环境光：鼠标停在作品上换成它的 --w，离开回到所在区的默认色 ── */
  if (want(14)) {
    await go(pg, `${BASE}/`);
    await pg.evaluate(() => document.getElementById('photographs').scrollIntoView());
    await pg.waitForTimeout(800);
    const amb = async () => pg.evaluate(() => document.querySelector('.ambient').style.getPropertyValue('--a1').trim());
    // 环境光按模式取色：CSS 把 --amb 映射到 --c（暗）或 --w（亮），motion.js 只读 --amb
    const wOf = async (sel) => pg.evaluate((s) => getComputedStyle(document.querySelector(s)).getPropertyValue('--amb1').trim(), sel);
    ok(await amb() === await wOf('#photographs'), `环境光在照片区应是区默认色 ${await wOf('#photographs')}，现在是 ${await amb()}`);
    await pg.hover('#photographs .work:nth-child(3) .work__frame');
    await pg.waitForTimeout(400);
    ok(await amb() === await wOf('#photographs .work:nth-child(3)'), `悬停第三组后环境光应是它的 --w1，现在是 ${await amb()}`);
    await pg.mouse.move(1430, 890);
    await pg.waitForTimeout(600);
    ok(await amb() === await wOf('#photographs'), `离开作品后环境光没回到区默认色，现在是 ${await amb()}`);
  }

  /* ── 15. 封面倾斜 + 跟随光标（有鼠标的设备）── */
  if (want(15)) {
    for (const [dir, word] of [['', 'View'], ['/zh', '看']]) {
      await go(pg, `${BASE}${dir}/`);
      await pg.evaluate(() => document.getElementById('photographs').scrollIntoView());
      await pg.waitForTimeout(600);
      const box = await pg.locator('#photographs .work:nth-child(1) .work__frame').boundingBox();
      await pg.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2, { steps: 6 });
      await pg.waitForTimeout(700);
      const d = await pg.evaluate(() => {
        const f = document.querySelector('#photographs .work__frame'); const c = document.querySelector('.cursor');
        return { rx: parseFloat(f.style.getPropertyValue('--rx')), ry: parseFloat(f.style.getPropertyValue('--ry')),
                 cursor: c && c.classList.contains('has-label') ? c.textContent : null };
      });
      // 鼠标在右上：右边和上边往里倒 → rotateY 正、rotateX 正
      ok(d.rx > 2 && d.ry > 2, `${dir}/ 封面没朝鼠标倒（rx=${d.rx}, ry=${d.ry}）`);
      ok(d.cursor === word, `${dir}/ 跟随光标停在封面上应显示「${word}」，现在是 ${d.cursor}`);
      await pg.mouse.move(1430, 20);
    }
  }

  /* ── 16. 走马盘：62 个真链接都能 Tab 到；Tab 到哪张就转到正面、宽 120；拖动不会误点开 ── */
  if (want(16)) {
    await go(pg, `${BASE}/`);
    await pg.evaluate(() => document.getElementById('film-notes').scrollIntoView());
    await pg.waitForTimeout(800);
    {
      const d = await pg.evaluate(() => {
        const links = [...document.querySelectorAll('.posterwall a')];
        return { n: links.length, real: links.filter(a => /\/film-notes\/#[\w-]+$/.test(new URL(a.href).pathname + new URL(a.href).hash) && a.tabIndex === 0).length };
      });
      ok(d.n === 62 && d.real === 62, `走马盘里 ${d.real}/${d.n} 个是能 Tab 到的影评链接`);
      for (const i of [0, 30, 61]) {
        await pg.evaluate((k) => document.querySelectorAll('.posterwall a')[k].focus(), i);
        await pg.waitForTimeout(1300);
        const f = await pg.evaluate((k) => {
          const li = document.querySelectorAll('.posterwall__item')[k].getBoundingClientRect();
          const st = document.querySelector('.zoetrope').getBoundingClientRect();
          return { dx: Math.abs(li.left + li.width / 2 - (st.left + st.width / 2)), w: li.width };
        }, i);
        ok(f.dx < 12 && Math.abs(f.w - 120) < 2, `走马盘 Tab 到第 ${i + 1} 张没转到正面（偏 ${f.dx.toFixed(1)}px、宽 ${f.w.toFixed(1)}）`);
      }
      await pg.evaluate(() => document.activeElement.blur());
      const st = await pg.locator('.zoetrope').boundingBox();
      const spin0 = await pg.evaluate(() => parseFloat(document.querySelector('.posterwall').style.getPropertyValue('--spin')));
      await pg.mouse.move(st.x + st.width / 2, st.y + st.height / 2);
      await pg.mouse.down();
      await pg.mouse.move(st.x + st.width / 2 - 220, st.y + st.height / 2, { steps: 12 });
      await pg.mouse.up();
      await pg.waitForTimeout(700);
      const after = await pg.evaluate(() => ({ spin: parseFloat(document.querySelector('.posterwall').style.getPropertyValue('--spin')), path: location.pathname }));
      ok(Math.abs(after.spin - spin0) > 15, `拖了 220px 走马盘只转了 ${(after.spin - spin0).toFixed(1)}°`);
      ok(after.path === '/', `拖完松手打开了链接：${after.path}`);
    }
  }

  /* ── 17. 换页：点封面进内页时封面和标题两对都配上；后退也配上；从内页点导航回首页只走光圈 ── */
  if (want(17)) {
    {
      const vctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await vctx.addInitScript(() => {
        addEventListener('pagereveal', (e) => {
          if (!e.viewTransition) { window.__vt = []; return; }
          e.viewTransition.ready.then(() => {
            window.__vt = [...new Set(document.getAnimations().map(a => a.effect && a.effect.pseudoElement).filter(Boolean))];
          }, () => { window.__vt = ['skipped']; });
        });
      });
      const vp = await vctx.newPage();
      const seen = async () => { await vp.waitForFunction(() => window.__vt !== undefined, null, { timeout: 8000 }).catch(() => {});
                                 return vp.evaluate(() => window.__vt || []); };
      const pairs = (list) => ['old(vt-cover)', 'new(vt-cover)', 'old(vt-title)', 'new(vt-title)']
        .filter(x => list.includes(`::view-transition-${x}`)).length;
      await go(vp, `${BASE}/`);
      await vp.evaluate(() => document.querySelector('#photographs .work:nth-child(2)').scrollIntoView({ block: 'center' }));
      await vp.waitForTimeout(900);
      await vp.click('#photographs .work:nth-child(2) .work__link');
      await vp.waitForLoadState('networkidle');
      let s = await seen();
      ok(s.includes('::view-transition-new(root)'), `点封面进内页没有光圈换页：${s.join(' ')}`);
      ok(pairs(s) === 4, `点封面进内页，封面和标题只配上 ${pairs(s)}/4 个：${s.join(' ')}`);
      await vp.waitForTimeout(1500);
      await vp.goBack();
      s = await seen();
      ok(pairs(s) === 4, `后退回首页，封面和标题只配上 ${pairs(s)}/4 个：${s.join(' ')}`);
      await go(vp, `${BASE}/good-night/`);
      await vp.waitForTimeout(800);
      await vp.click('.sitenav__link[href$="#photographs"]');
      await vp.waitForLoadState('networkidle');
      s = await seen();
      ok(s.includes('::view-transition-new(root)') && pairs(s) === 0, `从内页点导航回首页应只走光圈、不配对：${s.join(' ')}`);
      await vctx.close();
    }
  }

  /* ── 18. 全屏看照片：从原位放大、关掉缩回；方向键照旧；关掉后焦点回到原来的按钮 ── */
  if (want(18)) {
    await go(pg, `${BASE}/good-night/`);
    await pg.evaluate(() => document.getElementById('plate-3').scrollIntoView({ block: 'center' }));
    await pg.waitForTimeout(1500);
    await pg.click('#plate-3 .plate__open');
    const ghost = await pg.evaluate(() => !!document.querySelector('.viewer__ghost'));
    await pg.waitForTimeout(1500);
    let v = await pg.evaluate(() => ({ ghost: !!document.querySelector('.viewer__ghost'), open: document.getElementById('viewer').open,
      loaded: document.querySelector('.viewer__stage img').classList.contains('is-loaded') }));
    ok(ghost, '打开全屏时没有从原位飞出来的那张图');
    ok(v.open && v.loaded && !v.ghost, `全屏打开后状态不对：${JSON.stringify(v)}`);
    await pg.keyboard.press('ArrowRight');
    await pg.waitForTimeout(500);
    const count = await pg.evaluate(() => document.querySelector('.viewer__count').textContent);
    ok(/^04 \/ 09$/.test(count), `方向键翻页后是「${count}」，应该「04 / 09」`);
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(1300);
    v = await pg.evaluate(() => ({ open: document.getElementById('viewer').open, locked: document.body.classList.contains('is-locked'),
      focus: document.activeElement && document.activeElement.dataset.index }));
    ok(!v.open && !v.locked && v.focus === '2', `Esc 关掉后状态不对：${JSON.stringify(v)}（焦点应回到第三张的按钮）`);
  }

  /* ── 19. 内页进度条：有 JS 时出现，滚到底是满的 ── */
  if (want(19)) {
    for (const p of ['/good-night/', `/${NOTES}/`]) {
      await go(pg, BASE + p);
      const top = await pg.evaluate(() => ({ shown: getComputedStyle(document.querySelector('.progress')).display !== 'none',
        a: new DOMMatrix(getComputedStyle(document.querySelector('.progress')).transform).a }));
      await pg.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await pg.waitForTimeout(500);
      const end = await pg.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.progress')).transform).a);
      ok(top.shown && top.a < 0.02 && end > 0.98, `${p} 进度条不对：出现=${top.shown}，顶上 ${top.a.toFixed(2)}，到底 ${end.toFixed(2)}`);
    }
  }

  /* ── 20. 降级：减少动态效果、触屏（关掉 JS 见第 11 节）── */
  if (want(20)) {
    {
      const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await rctx.addInitScript(() => addEventListener('pagereveal', (e) => { window.__vtAny = !!e.viewTransition; }));
      const rp = await rctx.newPage();
      await go(rp, `${BASE}/`);
      await rp.evaluate(() => document.getElementById('film-notes').scrollIntoView());
      await rp.waitForTimeout(500);
      const spin = () => rp.evaluate(() => document.querySelector('.posterwall').style.getPropertyValue('--spin'));
      const s0 = await spin(); await rp.waitForTimeout(1500); const s1 = await spin();
      const d = await rp.evaluate(() => ({ still: document.querySelector('.hero').classList.contains('hero--paused'),
        cursor: !!document.querySelector('.cursor'), tilt: document.documentElement.classList.contains('fx-tilt'),
        zoe: !!document.querySelector('.is-zoetrope') }));
      ok(d.still, '减少动态效果：第一屏应是停着的');
      ok(!d.cursor && !d.tilt, '减少动态效果：不该有跟随光标和封面倾斜');
      ok(d.zoe && s0 === s1, `减少动态效果：走马盘应在但不转（${s0} → ${s1}）`);
      await rp.evaluate(() => document.getElementById('photographs').scrollIntoView());
      await rp.click('#photographs .work:nth-child(1) .work__link');
      await rp.waitForLoadState('networkidle');
      ok(await rp.evaluate(() => window.__vtAny) === false, '减少动态效果：换页不该有光圈动画');
      await rctx.close();

      const tctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
      const tp = await tctx.newPage();
      await go(tp, `${BASE}/`);
      const t = await tp.evaluate(() => ({ cursor: !!document.querySelector('.cursor'), tilt: document.documentElement.classList.contains('fx-tilt'),
        wall: getComputedStyle(document.querySelector('.posterwall')).display }));
      ok(!t.cursor && !t.tilt, '触屏：不该有跟随光标和封面倾斜');
      ok(t.wall === 'grid', `触屏窄屏：海报墙应是网格，现在 ${t.wall}`);
      await tctx.close();
    }
  }

  /* ── 21. 像素级对比度探针 ──
     环境光、第一屏的照片会改变文字底下的颜色，光算 CSS 变量不够，要量**真正渲染出来的像素**：
     先记下每段字的位置和颜色 → 把所有字设成透明、截图 → 量每段字底下像素亮度的
     第 2 和第 98 百分位（去掉抗锯齿的零星边缘），分别跟字的颜色算对比度，取较差的那个。
     小字 ≥ 4.5；大字（≥ 24px，或 ≥ 18.66px 且粗体）≥ 3。
     渐变字（区标题）每一站往两个方向各让 0.01、取最差的——oklch 插值的中间色跟端点差一点。
     2026-09-29 起两种模式（暗 / 亮）各量一遍；第一屏永远是暗的，只在暗色那一遍量。
     半透明的（淡入淡出途中的）不量，那是过渡状态。 */
  if (want(21)) {
    const ctxFor = (theme, opts) => (theme === 'light' ? lightContext(opts) : browser.newContext(opts));

    // 首页：五个滚动位置 + 四个区 + 悬停每一件作品（环境光换成它的颜色）+ 第一屏七张（只在暗色量）
    for (const theme of ['dark', 'light']) for (const [w, h, dirs] of [[1440, 900, ['', '/zh']], [390, 844, ['']]]) {
      const pctx = await ctxFor(theme, { viewport: { width: w, height: h }, deviceScaleFactor: 1,
        hasTouch: w < 900, isMobile: w < 900 });
      const pp = await pctx.newPage();
      for (const dir of dirs) {
        const tag = `${dir}/ @${w} ${theme}`;
        await go(pp, `${BASE}${dir}/`);
        await pp.waitForTimeout(1200);
        // 第一屏在轮播：先停在第一张，不然每次截图底下的照片都不一样
        await pp.evaluate(() => document.querySelector('.hero').dispatchEvent(new CustomEvent('hero:goto', { detail: 0 })));
        for (const f of [0, 0.3, 0.6, 0.9, 1.2]) {
          await pp.evaluate((y) => scrollTo(0, y * innerHeight), f);
          await pp.waitForTimeout(700);
          await probe(pp, `${tag} 滚 ${f} 屏`);
        }
        for (const id of ['photographs', 'films', 'film-notes', 'about']) {
          await pp.evaluate((s) => document.getElementById(s).scrollIntoView(), id);
          await pp.waitForTimeout(900);
          await probe(pp, `${tag} #${id}`);
        }
        if (w > 900) for (const slug of SLUGS) {
          await pp.evaluate((s) => document.querySelector(`.work[data-slug="${s}"]`).scrollIntoView({ block: 'center' }), slug);
          await pp.waitForTimeout(500);
          await pp.hover(`.work[data-slug="${slug}"] .work__frame`);
          await pp.waitForTimeout(500);
          await probe(pp, `${tag} 悬停 ${slug}`);
          await pp.mouse.move(w - 10, 10);
        }
        // 第一屏七张逐张量：推近的起点和终点各一次（字压在照片上，照片在动）。第一屏永远是暗的，只量一遍
        if (theme === 'dark') for (let i = 0; i < 7; i++) {
          await pp.evaluate(() => scrollTo(0, 0));
          await pp.evaluate((k) => document.querySelector('.hero').dispatchEvent(new CustomEvent('hero:goto', { detail: k })), i);
          await pp.waitForFunction((k) => document.querySelector('.hero').dataset.at === String(k), i, { timeout: 15000 });
          await pp.waitForTimeout(1900);                      // 淡入 1.6 秒
          for (const end of [false, true]) {
            await pp.evaluate((e) => {
              for (const an of document.querySelector('.hero__slide.is-on img').getAnimations()) {
                an.pause();
                an.currentTime = e ? an.effect.getComputedTiming().endTime - 1 : 0;
              }
            }, end);
            await pp.waitForTimeout(150);
            await probe(pp, `${tag} 第一屏第 ${i + 1} 张${end ? '（终点）' : '（起点）'}`);
          }
        }
      }
      await pctx.close();
    }
    // 内页：每页第一屏（光晕只在标题上方那段空白里）+ 矮一点的笔记本上两行标题 + 「下一组」悬停，两种模式
    for (const theme of ['dark', 'light']) {
      const pctx = await ctxFor(theme, { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const pp = await pctx.newPage();
      for (const p of pages.filter(x => !isHome(x))) {
        await go(pp, BASE + p);
        await probe(pp, `${p} ${theme} 第一屏`);
      }
      await pp.setViewportSize({ width: 1280, height: 680 });
      for (const p of ['/night-wind/', '/keep-going-back/', '/zh/night-wind/']) {
        await go(pp, BASE + p);
        await probe(pp, `${p} ${theme} @1280×680`);
      }
      await pp.setViewportSize({ width: 1440, height: 900 });
      for (const p of ['/good-night/', '/zh/stop-scrolling/']) {
        await go(pp, BASE + p);
        await pp.evaluate(() => document.querySelector('.nextup').scrollIntoView({ block: 'center' }));
        await pp.waitForTimeout(500);
        await pp.hover('.nextup__title');
        await pp.waitForTimeout(600);
        await probe(pp, `${p} ${theme} 悬停「下一组」`);
      }
      await pctx.close();
    }
    if (probeRuns) console.log(`对比度探针量了 ${probeRuns} 段字`);
  }

  // 控制台报错（前面所有页面加起来）
  ok(consoleErrors.length === 0, `控制台有 ${consoleErrors.length} 条报错：${consoleErrors.slice(0, 3).join(' | ')}`);

  /* ── 整页截图，给人看 ── */
  if (process.argv[3]) {
    await go(pg, BASE + '/'); await scrollThrough(pg);
    await pg.screenshot({ path: process.argv[3], fullPage: true });
    console.log(`整页截图 → ${process.argv[3]}`);
  }

  await browser.close();
  console.log(`\n${pass} 项通过，${fails.length} 项失败`);
  fails.forEach(f => console.log('  ✗ ' + f));
  if (probeFails.length) {
    console.log('\n对比度探针明细：');
    probeFails.forEach(f => console.log('  · ' + f));
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('脚本自己崩了：', e); process.exit(2); });
