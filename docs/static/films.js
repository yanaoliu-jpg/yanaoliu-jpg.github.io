/* ════════════════════════════════════════════════════════════════
   首页影片区（2026-09-29「放映厅」改版第二步）：悬停预览 + 页内播放器。
   见 放映厅改版设计.md 第六节「影片」。

   type="module"，只在首页加载（build.py 的 shell）。关掉 JS 时每张卡片就是去影片页的普通链接——
   这里只「加」效果：预览的 <video> 是这里建的；播放器 <dialog id="screen"> 平时关着。
   · 悬停预览：鼠标停上去（或键盘 Tab 到卡片）淡入一段 3–4 秒的无声循环（build.py 的 encode_preview 切的），
     移开就停。同时只放一段。触屏、减少动态效果、省流量：不预览
   · 点卡片：画面从卡片的位置放大进播放器、有声播放（用户刚点过，浏览器允许）；
     Esc / 点空白 / 关闭按钮关掉：视频停下、拆掉 source 不再下载、缩回卡片、焦点回到卡片。
     按住 ⌘ / Ctrl / Shift / Alt 点、中键点：照常打开影片页
   ════════════════════════════════════════════════════════════════ */

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);
const FLIP_MS = 460;                                     // ↔ gallery.js：灯箱和播放器放大的节奏一样
const FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const cards = [...document.querySelectorAll('.film-card')];
for (const [wanted, feature] of [
  [fine && !reduce && !saveData, previews],
  [true, player],
]) {
  if (!wanted || !cards.length) continue;
  try { feature(); } catch (err) { console.warn(`[films] ${feature.name} 已关闭：`, err); }
}

function makeVideo(sources) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  for (const [src, type] of sources) {
    if (!src) continue;
    const s = document.createElement('source');
    s.src = src;
    s.type = type;
    v.append(s);
  }
  return v;
}

/* ── 悬停预览 ──────────────────────────────────────────────────────
   第一次停上去才建 <video>、才开始下载（每段一两百 KB 到半 MB）。真的放起来（playing）才淡入，
   免得还没缓冲好就先盖住封面、露出一块黑。 */
function previews() {
  let live = null;
  function stop(card) {
    card.classList.remove('is-previewing');
    card.querySelector('.film-card__preview')?.pause();
    if (live === card) live = null;
  }
  function start(card) {
    if (live && live !== card) stop(live);
    live = card;
    let v = card.querySelector('.film-card__preview');
    if (!v) {
      v = makeVideo([[card.dataset.previewWebm, 'video/webm'], [card.dataset.previewMp4, 'video/mp4']]);
      v.className = 'film-card__preview';
      v.muted = true;                 // 必须在 play() 之前：浏览器只让静音的视频自己放
      v.defaultMuted = true;
      v.loop = true;
      v.setAttribute('aria-hidden', 'true');
      v.tabIndex = -1;
      v.addEventListener('playing', () => { if (live === card) card.classList.add('is-previewing'); });
      card.querySelector('.film-card__frame').append(v);
    }
    v.play()?.catch(() => {});
  }
  for (const card of cards) {
    if (!card.dataset.previewWebm && !card.dataset.previewMp4) continue;
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') start(card); });
    card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') stop(card); });
    // 键盘：Tab 到卡片也放（:focus-visible 才算——鼠标点完、程序把焦点还回来时不放）
    card.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) start(card); });
    card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget)) stop(card); });
  }
}

/* ── 页内播放器 ────────────────────────────────────────────────── */
function player() {
  const dialog = document.getElementById('screen');
  if (!dialog || typeof dialog.showModal !== 'function') return;    // 没有 <dialog>：卡片就是链接
  const box = dialog.querySelector('.screen__video');
  const title = dialog.querySelector('.screen__title');
  const meta = dialog.querySelector('.screen__meta');
  const more = dialog.querySelector('.screen__more');
  const canFlip = !reduce && typeof box.animate === 'function';
  let card = null, video = null, closing = false;

  for (const c of cards) {
    const link = c.querySelector('.film-card__link');
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', (e) => {
      // ⌘ / Ctrl / Shift / Alt 点、中键点：照常打开影片页（新标签、新窗口）
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open(c);
    });
  }

  function open(c) {
    card = c;
    const d = c.dataset;
    box.style.setProperty('--ar', d.ar);
    title.textContent = c.querySelector('.film-card__title').textContent.trim();
    meta.textContent = [c.querySelector('.film-card__credits'), c.querySelector('.film-card__award')]
      .filter(Boolean).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' · ');
    more.setAttribute('href', c.querySelector('.film-card__link').getAttribute('href'));
    video = makeVideo([[d.webm, 'video/webm'], [d.mp4, 'video/mp4']]);
    video.className = 'screen__player';
    video.controls = true;
    if (d.poster) video.poster = d.poster;
    box.replaceChildren(video);
    c.querySelector('.film-card__preview')?.pause();
    c.classList.remove('is-previewing');
    // 先锁滚动再量：锁上之后滚动条消失，页面会横向挪一点，量早了起点就偏了
    document.body.classList.add('is-locked');
    const frame = c.querySelector('.film-card__frame');
    const from = frame.getBoundingClientRect();
    dialog.showModal();
    // 用户刚点过，浏览器允许有声播放；万一被拦了，就停在封面帧，控制条在，读者自己点
    video.play()?.catch(() => {});
    if (canFlip && from.width) fly(frame, from, true);
  }

  // 放大 / 缩回：飞的是卡片上那张已经加载好的画面（ghost），不用等视频。跟 gallery.js 的 flipIn 一个做法
  function fly(frame, cardRect, opening) {
    const img = frame.querySelector('img');
    const to = box.getBoundingClientRect();
    if (!img || !to.width) return Promise.resolve();
    const g = new Image();
    g.className = 'screen__ghost';
    g.alt = '';
    g.src = img.currentSrc || img.src;
    Object.assign(g.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    dialog.append(g);
    dialog.classList.add('is-flipping');
    box.style.opacity = '0';
    const at = `translate(${cardRect.left - to.left}px, ${cardRect.top - to.top}px) `
             + `scale(${cardRect.width / to.width}, ${cardRect.height / to.height})`;
    const dur = opening ? FLIP_MS : FLIP_MS * 0.85;
    const dark = 'rgba(8, 9, 11, 1)', clear = 'rgba(8, 9, 11, 0)';
    const flight = g.animate(opening ? [{ transform: at }, { transform: 'none' }] : [{ transform: 'none' }, { transform: at }],
      { duration: dur, easing: FLIP_EASE, fill: 'forwards' });
    dialog.animate([{ backgroundColor: opening ? clear : dark }, { backgroundColor: opening ? dark : clear }],
      { duration: dur, easing: 'ease', fill: 'forwards' });
    return flight.finished.then(() => {
      if (!opening) return;
      box.style.opacity = '';
      dialog.classList.remove('is-flipping');
      dialog.getAnimations().forEach((a) => a.cancel());
      g.remove();
    }, () => {});
  }

  // 拆掉视频：暂停、去掉 source、load()——没有 source 了，浏览器就把还在下的正片掐掉
  function unload() {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.querySelectorAll('source').forEach((s) => s.remove());
    video.load();
    video.remove();
    video = null;
  }

  function close() {
    if (!dialog.open || closing) return;
    closing = true;
    video?.pause();
    const done = () => {
      dialog.close();
      dialog.getAnimations().forEach((a) => a.cancel());
      dialog.querySelectorAll('.screen__ghost').forEach((g) => g.remove());
      dialog.classList.remove('is-flipping');
      box.style.opacity = '';
      closing = false;
    };
    const frame = card && card.querySelector('.film-card__frame');
    const r = frame && frame.getBoundingClientRect();
    if (!canFlip || !r || !r.width || r.bottom < 0 || r.top > innerHeight) { done(); return; }
    fly(frame, r, false).then(done, done);
  }

  // Esc：拦下来走同一个带动画的关闭
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="close"]')) { close(); return; }
    // 点空白处关掉；点视频（控制条）、片名那几行不关
    if (!e.target.closest('.screen__video, .screen__caption')) close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    unload();
    card?.querySelector('.film-card__link')?.focus({ preventScroll: true });
  });
  // 从播放器里点「关于这部片子」去了影片页、再后退回来（往返缓存）：别让播放器还开着
  addEventListener('pagehide', () => { if (dialog.open) dialog.close(); });
}
