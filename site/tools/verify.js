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
      };
    });
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

  /* ── 9. 首页海报墙：62 张、列宽恒等于 sizes、不溢出、不跨语言 ── */
  for (const w of WIDTHS) {
    await pg.setViewportSize({ width: w, height: 900 });
    for (const dir of ['', '/zh']) {
      await go(pg, `${BASE}${dir}/`);
      await pg.evaluate(() => document.getElementById('film-notes').scrollIntoView());
      await pg.waitForTimeout(1500);
      const d = await pg.evaluate(() => {
        const wall = document.querySelector('.posterwall'); const img = wall.querySelector('.posterwall__img');
        return {
          items: wall.querySelectorAll('.posterwall__item').length,
          colW: getComputedStyle(wall).gridTemplateColumns.split(' ')[0], sizes: img.getAttribute('sizes'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          crossLang: [...wall.querySelectorAll('a')].filter(a =>
            new URL(a.getAttribute('href'), location.href).pathname.startsWith('/zh/') !== location.pathname.startsWith('/zh/')).length,
        };
      });
      ok(d.items === 62, `${dir}/ @${w}px 海报墙 ${d.items} 张`);
      ok(d.overflow === 0, `${dir}/ @${w}px 海报墙横向溢出 ${d.overflow}px`);
      ok(d.colW === d.sizes, `${dir}/ @${w}px 列宽 ${d.colW} 跟 sizes ${d.sizes} 对不上`);
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
      return { total: all.length, hidden: all.filter(e => getComputedStyle(e).opacity !== '1').length,
               hasReveal: document.documentElement.classList.contains('js-reveal') };
    });
    ok(d.total > 0 && d.hidden === 0, `${p} 关掉 JS 后有 ${d.hidden}/${d.total} 个内容块不可见`);
    ok(!d.hasReveal, `${p} 关掉 JS 却有 js-reveal 类`);
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

  /* ── 整页截图，给人看 ── */
  if (process.argv[3]) {
    await go(pg, BASE + '/'); await scrollThrough(pg);
    await pg.screenshot({ path: process.argv[3], fullPage: true });
    console.log(`整页截图 → ${process.argv[3]}`);
  }

  await browser.close();
  console.log(`\n${pass} 项通过，${fails.length} 项失败`);
  fails.forEach(f => console.log('  ✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('脚本自己崩了：', e); process.exit(2); });
