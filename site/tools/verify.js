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

// ⚠️ 必须按 order 排 —— 「下一组」链路检查靠它算下一个是谁
const SLUGS = ['stop-scrolling', 'good-night', 'goodbye-renfen', 'the-old-days',
  'night-wind', 'keep-going-back', 'looking-forward', 'sea-and-light',
  'gratitude', 'make-a-wish'];
const FILMS = new Set(['stop-scrolling', 'gratitude', 'make-a-wish']);
const NOTES = 'film-notes';
const WIDTHS = [375, 414, 768, 1024, 1440, 1920];

// 首页改版（2026-09）定下的数
const HOME_THEME = '#f3e4dc';          // ↔ build.py HOME_THEME_COLOR
const DARK_THEME = '#0d0e11';          // ↔ build.py DARK_THEME_COLOR
const DARKEST_STOP = '#dde3ee';        // 渐变里最深的一站——深色字在它上面对比度最低
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
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

  /* ── 1. 每个页面：200、无占位符、无 3200 档、无溢出、主题类和 meta 对、字体加载 ── */
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
        // Three.js：只在首页，而且要等页面 load 之后才开始取
        three: performance.getEntriesByType('resource').filter(r => /vendor\/three\//.test(r.name))
          .map(r => r.startTime >= performance.getEntriesByType('navigation')[0].loadEventStart),
        // 换页的名字是点的时候临时起的，平时一个都不该挂着（:root 自带的 root 除外）
        // <video> 里面的 <source> 这些不渲染的元素算出来是空串，不是 none——别当成名字
        vtNames: [...document.querySelectorAll('*')].map(e => getComputedStyle(e).viewTransitionName)
          .filter(n => n && n !== 'none' && n !== 'root'),
        glow: !!document.querySelector('.masthead__card > .glow:first-child'),
      };
    });
    ok(isHome(p) ? d.three.length === 2 && d.three.every(Boolean) : d.three.length === 0,
       `${p} Three.js 取了 ${d.three.length} 个文件${isHome(p) ? '（首页应当 2 个、都在 load 之后）' : '（内页一个都不该取）'}`);
    ok(d.vtNames.length === 0, `${p} 平时就挂着 view-transition-name：${d.vtNames.join(',')}`);
    ok(d.glow === !isHome(p), `${p} 光晕${d.glow ? '不该有' : '缺了（应是标题卡的第一个元素）'}`);
    ok(d.placeholders === 0, `${p} 有 ${d.placeholders} 个占位符`);
    ok(d.tier3200 === 0, `${p} 还在引用 3200px 档（${d.tier3200} 处）`);
    ok(d.overflow === 0, `${p} 横向溢出 ${d.overflow}px`);
    ok(d.themeHome === isHome(p), `${p} theme-home 类${d.themeHome ? '不该有' : '缺了'}`);
    ok(d.themeColor === (isHome(p) ? HOME_THEME : DARK_THEME), `${p} theme-color 是 ${d.themeColor}`);
    ok(d.colorScheme === (isHome(p) ? 'light' : 'dark'), `${p} color-scheme 是 ${d.colorScheme}`);
    ok(d.dmLoaded, `${p} DM Sans 没加载`);
    ok(!d.anyNewsreader, `${p} 还声明着旧字体`);
    ok(/DM Sans/.test(d.h1Face), `${p} h1 用的不是 DM Sans：${d.h1Face}`);
  }

  /* ── 2. 语言切换落在对方语言的同一页 ── */
  for (const p of pages) {
    await go(pg, BASE + p);
    const to = await pg.evaluate(() => new URL(
      document.querySelector('.langswitch').getAttribute('href'), location.href).pathname);
    const want = p.startsWith('/zh') ? p.replace('/zh', '') : '/zh' + p;
    ok(to === want, `${p} 语言切换落在 ${to}，应该是 ${want}`);
  }

  /* ── 3. 分类导航留在本语言 ── */
  for (const p of ['/', '/zh/', `/${NOTES}/`, `/zh/${NOTES}/`]) {
    await go(pg, BASE + p);
    const items = await pg.evaluate(() => [...document.querySelectorAll('.catnav__item')]
      .map(a => a.tagName === 'A' ? new URL(a.getAttribute('href'), location.href).pathname : 'CURRENT'));
    ok(items.length === 3, `${p} 分类导航有 ${items.length} 项`);
    for (const it of items) if (it !== 'CURRENT') ok(it.startsWith('/zh/') === p.startsWith('/zh'), `${p} 的导航链接 ${it} 跨了语言`);
  }

  /* ── 4. 「下一组」首尾相接、不跨语言 ── */
  for (const dir of ['', '/zh']) for (let i = 0; i < SLUGS.length; i++) {
    await go(pg, `${BASE}${dir}/${SLUGS[i]}/`);
    const to = await pg.evaluate(() => new URL(document.querySelector('.nextup__link').getAttribute('href'), location.href).pathname);
    const want = `${dir}/${SLUGS[(i + 1) % SLUGS.length]}/`;
    ok(to === want, `${dir}/${SLUGS[i]}/ 的下一组是 ${to}，应该是 ${want}`);
  }

  /* ── 5. 编号：影片不占系列号 ── */
  for (const dir of ['', '/zh']) for (let j = 0; j < SLUGS.length; j++) {
    if (FILMS.has(SLUGS[j])) continue;
    await go(pg, `${BASE}${dir}/${SLUGS[j]}/`);
    const eb = await pg.evaluate(() => document.querySelector('.masthead__eyebrow').textContent);
    const n = SLUGS.slice(0, j + 1).filter(s => !FILMS.has(s)).length;
    const want = dir ? `第${'〇一二三四五六七八九'[n]}组` : `Series ${String(n).padStart(2, '0')}`;
    ok(eb.includes(want), `${dir}/${SLUGS[j]}/ 编号是「${eb.trim()}」，应含「${want}」`);
  }

  /* ── 6. 首页三档灰对渐变最深那一站的对比度 ── */
  await go(pg, BASE + '/');
  const inks = await pg.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const toHex = v => { const m = v.trim().match(/\d+/g); return m && m.length >= 3
      ? '#' + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('') : v.trim(); };
    return Object.fromEntries(['--ink', '--ink-text', '--ink-dim', '--ink-mute', '--ink-faint'].map(k => [k, toHex(cs.getPropertyValue(k))]));
  });
  for (const [k, v] of Object.entries(inks)) {
    const c = contrast(v, DARKEST_STOP);
    ok(c >= 4.5, `首页 ${k} = ${v} 对最深站 ${DARKEST_STOP} 只有 ${c.toFixed(2)}:1`);
  }
  // 琥珀色在首页不能当字：找有没有元素的 color 是它
  const amberText = await pg.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => getComputedStyle(e).color === 'rgb(217, 160, 91)' && e.textContent.trim()).length);
  ok(amberText === 0, `首页有 ${amberText} 处用琥珀色当文字（1.9:1，过不了）`);

  /* ── 7. 首页封面：等高 300、影片并排、整页高度、sizes 同步 ── */
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

  /* ── 8. 影评页：62 条、锚点、海报、课堂笔记、署名 ── */
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

  /* ── 9. 首页海报墙：62 张、sizes 跟实际宽度对得上、不溢出、不跨语言 ──
     > 900px 有 JS 时是走马盘（第 16 节细查）：正面那张 120px，sizes 全部改成 120px；
     ≤ 900px 是网格：列宽恒等于 sizes（96px）。 */
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

  /* ── 10. 中文零缺字形（Noto Sans SC）── */
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

  /* ── 11. 关掉 JS：所有内容默认可见 ── */
  const noJs = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const np = await noJs.newPage();
  for (const p of ['/', '/zh/', `/${NOTES}/`, '/good-night/', '/stop-scrolling/']) {
    await go(np, BASE + p);
    const d = await np.evaluate(() => {
      const all = [...document.querySelectorAll('.plate, .work, .note, .posterwall__item, .film__video')];
      const shown = (s) => [...document.querySelectorAll(s)].some(e => getComputedStyle(e).display !== 'none');
      return { total: all.length, hidden: all.filter(e => getComputedStyle(e).opacity !== '1').length,
               hasReveal: document.documentElement.classList.contains('js-reveal'),
               hasFx: /\bfx\b/.test(document.documentElement.className),
               // 「透过镜头」加的几层：没有 JS 时一个都不能出现
               extras: ['#lens', '.ambient', '.progress', '.cursor', '.zoetrope'].filter(shown),
               wall: document.querySelector('.posterwall') && getComputedStyle(document.querySelector('.posterwall')).display,
               screens: document.documentElement.scrollHeight / innerHeight };
    });
    ok(d.total > 0 && d.hidden === 0, `${p} 关掉 JS 后有 ${d.hidden}/${d.total} 个内容块不可见`);
    ok(!d.hasReveal, `${p} 关掉 JS 却有 js-reveal 类`);
    ok(!d.hasFx && d.extras.length === 0, `${p} 关掉 JS 却出现了 ${d.extras.join(', ') || 'fx 类'}`);
    if (d.wall) ok(d.wall === 'grid', `${p} 关掉 JS 海报墙应是网格，现在是 ${d.wall}`);
    if (p === '/' || p === '/zh/') ok(d.screens <= MAX_SCREENS_1440, `${p} 关掉 JS 时整页 ${d.screens.toFixed(2)} 屏，超过 ${MAX_SCREENS_1440}`);
  }
  await noJs.close();

  /* ── 12. 影片播放器 ── */
  for (const s of FILMS) for (const dir of ['', '/zh']) {
    await go(pg, `${BASE}${dir}/${s}/`);
    const d = await pg.evaluate(() => { const v = document.querySelector('video'); return {
      ok: v.hasAttribute('controls') && !v.hasAttribute('autoplay') && !v.hasAttribute('loop') && v.getAttribute('preload') === 'metadata' && !!v.getAttribute('poster'),
      srcs: [...v.querySelectorAll('source')].map(x => x.src.split('.').pop()).join(',') }; });
    ok(d.ok, `${dir}/${s}/ 播放器属性不对`);
    ok(d.srcs === 'webm,mp4', `${dir}/${s}/ source 顺序是 ${d.srcs}`);
  }

  /* ════ 以下是 2026-09「透过镜头」改版加的 ════ */

  /* ── 13. 首页 3D 镜头建成；每件作品和每个区的颜色都守住亮度约束 ──
     --w（环境光）≥ 0.74：深色小字压在上面仍然 ≥ 4.5:1；--d（渐变大字）≤ 0.18：大字 ≥ 3:1 */
  await pg.setViewportSize({ width: 1440, height: 900 });
  for (const dir of ['', '/zh']) {
    await go(pg, `${BASE}${dir}/`);
    await pg.waitForSelector('#lens canvas[data-ready]', { timeout: 20000 }).catch(() => {});
    const d = await pg.evaluate(() => ({
      ready: document.querySelector('#lens canvas').dataset.ready === '1',
      on: document.getElementById('lens').classList.contains('lens--on'),
      mode: document.getElementById('lens').dataset.mode,
      pal: [...document.querySelectorAll('.work[data-slug], .cat[style]')].map(el => {
        const cs = getComputedStyle(el);
        const v = (k) => [1, 2, 3].map(i => cs.getPropertyValue(`--${k}${i}`).trim());
        return { id: el.dataset.slug || el.id, w: v('w'), d: v('d') };
      }),
    }));
    ok(d.ready && d.on, `${dir}/ 镜头没建成（data-ready=${d.ready}, lens--on=${d.on}）`);
    ok(d.mode === 'side', `${dir}/ @1440 镜头应停在文字右边（side），现在是 ${d.mode}`);
    ok(d.pal.length === SLUGS.length + 3, `${dir}/ 带颜色的作品 + 区是 ${d.pal.length} 个，应该 ${SLUGS.length + 3}`);
    for (const x of d.pal) {
      for (const c of x.w) ok(/^#[0-9a-f]{6}$/.test(c) && lum(c) >= 0.74, `${dir}/ ${x.id} 的 --w ${c} 亮度 ${lum(c).toFixed(3)} < 0.74`);
      for (const c of x.d) ok(/^#[0-9a-f]{6}$/.test(c) && lum(c) <= 0.18, `${dir}/ ${x.id} 的 --d ${c} 亮度 ${lum(c).toFixed(3)} > 0.18`);
    }
  }

  /* ── 14. 环境光：鼠标停在作品上换成它的 --w，离开回到所在区的默认色 ── */
  await go(pg, `${BASE}/`);
  await pg.evaluate(() => document.getElementById('photographs').scrollIntoView());
  await pg.waitForTimeout(800);
  const amb = async () => pg.evaluate(() => document.querySelector('.ambient').style.getPropertyValue('--a1').trim());
  const wOf = async (sel) => pg.evaluate((s) => getComputedStyle(document.querySelector(s)).getPropertyValue('--w1').trim(), sel);
  ok(await amb() === await wOf('#photographs'), `环境光在照片区应是区默认色 ${await wOf('#photographs')}，现在是 ${await amb()}`);
  await pg.hover('#photographs .work:nth-child(3) .work__frame');
  await pg.waitForTimeout(400);
  ok(await amb() === await wOf('#photographs .work:nth-child(3)'), `悬停第三组后环境光应是它的 --w1，现在是 ${await amb()}`);
  await pg.mouse.move(1430, 890);
  await pg.waitForTimeout(600);
  ok(await amb() === await wOf('#photographs'), `离开作品后环境光没回到区默认色，现在是 ${await amb()}`);

  /* ── 15. 封面倾斜 + 跟随光标（有鼠标的设备）── */
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

  /* ── 16. 走马盘：62 个真链接都能 Tab 到；Tab 到哪张就转到正面、宽 120；拖动不会误点开 ── */
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

  /* ── 17. 换页：点封面进内页时封面和标题两对都配上；后退也配上；点「全部作品」只走光圈 ── */
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
    await vp.click('.backlink');
    await vp.waitForLoadState('networkidle');
    s = await seen();
    ok(s.includes('::view-transition-new(root)') && pairs(s) === 0, `点「全部作品」应只走光圈、不配对：${s.join(' ')}`);
    await vctx.close();
  }

  /* ── 18. 全屏看照片：从原位放大、关掉缩回；方向键照旧；关掉后焦点回到原来的按钮 ── */
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

  /* ── 19. 内页进度条：有 JS 时出现，滚到底是满的 ── */
  for (const p of ['/good-night/', `/${NOTES}/`]) {
    await go(pg, BASE + p);
    const top = await pg.evaluate(() => ({ shown: getComputedStyle(document.querySelector('.progress')).display !== 'none',
      a: new DOMMatrix(getComputedStyle(document.querySelector('.progress')).transform).a }));
    await pg.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await pg.waitForTimeout(500);
    const end = await pg.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.progress')).transform).a);
    ok(top.shown && top.a < 0.02 && end > 0.98, `${p} 进度条不对：出现=${top.shown}，顶上 ${top.a.toFixed(2)}，到底 ${end.toFixed(2)}`);
  }

  /* ── 20. 降级：减少动态效果、触屏（关掉 JS 见第 11 节）── */
  {
    const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await rctx.addInitScript(() => addEventListener('pagereveal', (e) => { window.__vtAny = !!e.viewTransition; }));
    const rp = await rctx.newPage();
    await go(rp, `${BASE}/`);
    await rp.waitForSelector('#lens canvas[data-ready]', { timeout: 20000 }).catch(() => {});
    await rp.evaluate(() => document.getElementById('film-notes').scrollIntoView());
    await rp.waitForTimeout(500);
    const spin = () => rp.evaluate(() => document.querySelector('.posterwall').style.getPropertyValue('--spin'));
    const s0 = await spin(); await rp.waitForTimeout(1500); const s1 = await spin();
    const d = await rp.evaluate(() => ({ still: document.querySelector('#lens canvas').dataset.static === '1',
      cursor: !!document.querySelector('.cursor'), tilt: document.documentElement.classList.contains('fx-tilt'),
      zoe: !!document.querySelector('.is-zoetrope') }));
    ok(d.still, '减少动态效果：镜头应是静止的一帧（data-static）');
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
    await tp.waitForSelector('#lens canvas[data-ready]', { timeout: 20000 }).catch(() => {});
    const t = await tp.evaluate(() => ({ cursor: !!document.querySelector('.cursor'), tilt: document.documentElement.classList.contains('fx-tilt'),
      mode: document.getElementById('lens').dataset.mode, wall: getComputedStyle(document.querySelector('.posterwall')).display }));
    ok(!t.cursor && !t.tilt, '触屏：不该有跟随光标和封面倾斜');
    ok(t.mode === 'lift' && t.wall === 'grid', `触屏窄屏：镜头应在名字上方（lift）、海报墙是网格，现在 ${t.mode} / ${t.wall}`);
    await tctx.close();
  }

  /* ── 21. 像素级对比度探针 ──
     环境光和镜头会改变文字底下的颜色，光算 CSS 变量不够，要量**真正渲染出来的像素**：
     先记下每段字的位置和颜色 → 把所有字设成透明、截图 → 量每段字底下像素亮度的
     第 2 和第 98 百分位（去掉抗锯齿的零星边缘），分别跟字的颜色算对比度，取较差的那个。
     小字 ≥ 4.5；大字（≥ 24px，或 ≥ 18.66px 且粗体）≥ 3。
     渐变字（区标题）按最浅的那一站再加 0.01 算——oklch 插值的中间色比端点略亮一点。
     半透明的（淡入淡出途中的）不量，那是过渡状态。 */
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
          colors: grad ? [1, 2, 3].map(i => hex(cs.getPropertyValue('--d' + i))) : [m.slice(0, 3)],
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
        const tl = run.grad ? Math.max(...run.colors.map(hexL)) + 0.01 : L(...run.colors[0]);
        const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const got = Math.min(cr(tl, lo), cr(tl, hi));
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

  // 首页：五个滚动位置 + 三个区 + 悬停每一件作品（环境光换成它的颜色）
  for (const [w, h, dirs] of [[1440, 900, ['', '/zh']], [390, 844, ['']]]) {
    const pctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1,
      hasTouch: w < 900, isMobile: w < 900 });
    const pp = await pctx.newPage();
    for (const dir of dirs) {
      await go(pp, `${BASE}${dir}/`);
      await pp.waitForSelector('#lens canvas[data-ready]', { timeout: 20000 }).catch(() => {});
      await pp.waitForTimeout(1200);
      for (const f of [0, 0.3, 0.6, 0.9, 1.2]) {
        await pp.evaluate((y) => scrollTo(0, y * innerHeight), f);
        await pp.waitForTimeout(700);
        await probe(pp, `${dir}/ @${w} 滚 ${f} 屏`);
      }
      for (const id of ['photographs', 'films', 'film-notes']) {
        await pp.evaluate((s) => document.getElementById(s).scrollIntoView(), id);
        await pp.waitForTimeout(900);
        await probe(pp, `${dir}/ @${w} #${id}`);
      }
      if (w > 900) for (const slug of SLUGS) {
        await pp.evaluate((s) => document.querySelector(`.work[data-slug="${s}"]`).scrollIntoView({ block: 'center' }), slug);
        await pp.waitForTimeout(500);
        await pp.hover(`.work[data-slug="${slug}"] .work__frame`);
        await pp.waitForTimeout(500);
        await probe(pp, `${dir}/ @${w} 悬停 ${slug}`);
        await pp.mouse.move(w - 10, 10);
      }
    }
    await pctx.close();
  }
  // 内页：每页第一屏（光晕只在标题上方那段空白里）+ 矮一点的笔记本上两行标题 + 「下一组」悬停
  {
    const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const pp = await pctx.newPage();
    for (const p of pages.filter(x => !isHome(x))) {
      await go(pp, BASE + p);
      await probe(pp, `${p} 第一屏`);
    }
    await pp.setViewportSize({ width: 1280, height: 680 });
    for (const p of ['/night-wind/', '/keep-going-back/', '/zh/night-wind/']) {
      await go(pp, BASE + p);
      await probe(pp, `${p} @1280×680`);
    }
    await pp.setViewportSize({ width: 1440, height: 900 });
    for (const p of ['/good-night/', '/zh/stop-scrolling/']) {
      await go(pp, BASE + p);
      await pp.evaluate(() => document.querySelector('.nextup').scrollIntoView({ block: 'center' }));
      await pp.waitForTimeout(500);
      await pp.hover('.nextup__title');
      await pp.waitForTimeout(600);
      await probe(pp, `${p} 悬停「下一组」`);
    }
    await pctx.close();
  }
  console.log(`对比度探针量了 ${probeRuns} 段字`);

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
