/* ════════════════════════════════════════════════════════════════
   Good Night — 图片渐显、滚动进场、全屏查看（从原位放大 / 缩回原位）

   没有依赖，没有构建步骤。整个文件就是浏览器直接跑的。
   2026-09「透过镜头」改版的其余交互在 motion.js（模块），这个文件保持普通脚本——
   它管的是「照片能不能看到」，得在最老的浏览器上也跑。
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 系列页里是 .plate（照片），目录页里是 .work（照片的封面）和 .film-card（影片的海报卡，
  // 2026-09-29 起），影评页里是 .note（一条影评）—— 共用同一套进场逻辑。
  //
  // ⚠️ CSS 里凡是写了 .js-reveal X { opacity: 0 } 的 X，**必须**出现在这个
  //    选择器里，否则它永远等不到 .is-in，开着 JS 的人看到的就是一片空白。
  //    加新的区块时先改这一行。
  var plates = Array.prototype.slice.call(
    document.querySelectorAll('.plate, .work, .film-card, .note')
  );

  /* ── 图片加载完再淡入 ──────────────────────────────────────── */

  function watchLoading(img, stillCurrent, after) {
    function reveal() {
      if (!stillCurrent || stillCurrent()) {
        img.classList.add('is-loaded');
        if (after) after();
      }
    }
    if (img.complete && img.naturalWidth > 0) reveal();
    else {
      img.addEventListener('load', reveal, { once: true });
      // 加载失败也要显形，否则读者看到的是一片空白
      img.addEventListener('error', reveal, { once: true });
    }
  }

  /* ── 滚动进场 ──────────────────────────────────────────────── */

  function revealAll() {
    plates.forEach(function (p) { p.classList.add('is-in'); });
  }

  var canAnimate = !reduceMotion && 'IntersectionObserver' in window;

  if (canAnimate) {
    // 先让 CSS 里的动效规则生效，再立刻把首屏内的照片点亮。
    // 顺序很重要：类加上之后照片才会隐藏，所以下面必须马上把该显示的显示出来。
    root.classList.add('js-reveal');
    document.querySelectorAll('.plate__frame img, .work__frame img')
      .forEach(function (img) { watchLoading(img); });

    plates.forEach(function (p) {
      if (p.getBoundingClientRect().top < window.innerHeight * 1.1) {
        p.classList.add('is-in');
      }
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

    plates.forEach(function (p) {
      if (!p.classList.contains('is-in')) io.observe(p);
    });

    // 兜底：万一观察器因为任何原因没触发，5 秒后一律显示。
    // 宁可动效失效，也不能让照片消失。
    setTimeout(revealAll, 5000);
  }

  /* ── 全屏查看 ──────────────────────────────────────────────── */

  var dataEl = document.getElementById('photo-data');
  var dialog = document.getElementById('viewer');
  if (!dataEl || !dialog || typeof dialog.showModal !== 'function') return;

  var photos = JSON.parse(dataEl.textContent);
  if (!photos.length) return;
  if (photos.length === 1) dialog.setAttribute('data-single', '');

  var picture = dialog.querySelector('.viewer__picture');
  var sourceAvif = picture.querySelector('source[type="image/avif"]');
  var sourceWebp = picture.querySelector('source[type="image/webp"]');
  var img = picture.querySelector('img');
  var elCount = dialog.querySelector('.viewer__count');
  var elDate = dialog.querySelector('.viewer__date');
  var elExif = dialog.querySelector('.viewer__exif');
  var elBar = dialog.querySelector('.viewer__progress span');   // 底部的细进度条（2026-10-01「翻摄影集」）

  var current = 0;
  var showToken = 0;

  /* 放大 / 缩回（2026-09「透过镜头」改版）：打开时照片从它在页面上的位置飞到屏幕中间，
     关掉时飞回去。飞的是页面上那张已经加载好的图（ghost），不用等大图——
     大图加载好之后在它上面淡入，然后 ghost 拿掉。减少动态效果时不飞。 */
  var FLIP_MS = 460;
  var FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  var canFlip = !reduceMotion && typeof img.animate === 'function';
  var ghost = null;
  var closing = false;

  function sizesFor(photo) {
    // 跟 CSS 里 .viewer__stage img 的约束一致，浏览器才不会挑过大的图
    var vh = Math.round(90 * (photo.w / photo.h));
    return 'min(94vw, ' + vh + 'vh)';
  }

  function show(index) {
    current = (index + photos.length) % photos.length;
    var photo = photos[current];
    // 连按方向键翻得比图片加载还快时，别让上一张的 load 事件
    // 把已经换掉的图片点亮
    var token = ++showToken;

    img.classList.remove('is-loaded');
    dropGhost();                  // 翻到别的照片了，还在飞的那张缩图就不对了
    // 宽高比先写上：CSS 靠它在大图加载完之前就定好最终的位置和大小（见 style.css）
    img.style.setProperty('--ar', (photo.w / photo.h).toFixed(4));
    sourceAvif.setAttribute('srcset', photo.avif);
    sourceAvif.setAttribute('sizes', sizesFor(photo));
    sourceWebp.setAttribute('srcset', photo.webp);
    sourceWebp.setAttribute('sizes', sizesFor(photo));
    img.setAttribute('sizes', sizesFor(photo));
    img.setAttribute('srcset', photo.jpg);
    img.setAttribute('width', photo.w);
    img.setAttribute('height', photo.h);
    img.alt = photo.alt;
    img.src = photo.src;

    watchLoading(img, function () { return token === showToken; }, function () {
      if (ghost) { ghost.loaded = true; retireGhost(ghost); }
    });

    elCount.textContent = pad(current + 1) + ' / ' + pad(photos.length);
    elDate.textContent = photo.date + (photo.time ? ' · ' + photo.time : '');
    // 第二行：机身 · 镜头 · 焦距 · 光圈 · 快门 · ISO（机身镜头 2026-09-30 起，只有 EXIF 里有记录的照片才有）
    elExif.textContent = [photo.gear, photo.exif].filter(Boolean).join(' · ');
    // 进度条：第几张 ÷ 总数（读屏软件不念它，第几张已经在 .viewer__count 里）
    if (elBar) elBar.style.width = ((current + 1) / photos.length * 100) + '%';

    preload(current + 1);
    preload(current - 1);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 预取前后两张，翻页时几乎没有等待
  var preloaded = {};
  function preload(index) {
    var i = (index + photos.length) % photos.length;
    if (preloaded[i]) return;
    preloaded[i] = true;
    var p = new Image();
    p.sizes = sizesFor(photos[i]);
    p.srcset = photos[i].jpg;
    p.src = photos[i].src;
  }

  function thumbOf(index) {
    var plate = plates[index];
    var t = plate && plate.querySelector('.plate__frame img');
    return t && t.complete && t.naturalWidth > 0 ? t : null;
  }

  function open(index) {
    // 先锁滚动再量：锁上之后滚动条消失，页面会横向挪一点，量早了起点就偏了
    document.body.classList.add('is-locked');
    var thumb = canFlip && thumbOf(index);
    var from = thumb && thumb.getBoundingClientRect();
    show(index);
    dialog.showModal();
    if (from && from.width) flipIn(thumb, from);
  }

  function flipIn(thumb, from) {
    var to = img.getBoundingClientRect();     // 终点：CSS 按 --ar 已经定好了，不用等大图
    if (!to.width || !to.height) return;
    var g = new Image();
    g.className = 'viewer__ghost';
    g.alt = '';
    g.src = thumb.currentSrc || thumb.src;
    g.style.left = to.left + 'px';
    g.style.top = to.top + 'px';
    g.style.width = to.width + 'px';
    g.style.height = to.height + 'px';
    g.loaded = img.classList.contains('is-loaded');
    dialog.appendChild(g);
    ghost = g;
    dialog.classList.add('is-flipping');
    var fly = g.animate([
      { transform: 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px) ' +
                   'scale(' + from.width / to.width + ', ' + from.height / to.height + ')' },
      { transform: 'none' }
    ], { duration: FLIP_MS, easing: FLIP_EASE });
    dialog.animate([
      { backgroundColor: 'rgba(8, 9, 11, 0)' },
      { backgroundColor: 'rgba(8, 9, 11, 1)' }
    ], { duration: FLIP_MS, easing: 'ease' });
    fly.finished.then(function () {
      dialog.classList.remove('is-flipping');
      g.flown = true;
      retireGhost(g);
    }, function () {});
  }

  // 飞到了、大图也淡入完了，缩图才拿掉；早拿掉会闪一下空白
  function retireGhost(g) {
    if (!g.flown || !g.loaded) return;
    setTimeout(function () { if (ghost === g) dropGhost(); }, 400);
  }

  function dropGhost() {
    if (!ghost) return;
    ghost.remove();
    ghost = null;
    dialog.classList.remove('is-flipping');
  }

  function close() {
    if (closing) return;
    var thumb = canFlip && img.classList.contains('is-loaded') && thumbOf(current);
    if (!thumb) { dialog.close(); return; }
    // 对应的那张不在视野里（在查看器里翻过页）就先把它滚进来，再飞回去。
    // body 锁着滚动，但程序滚动照样生效。
    var box = thumb.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      plates[current].scrollIntoView({ block: 'center', behavior: 'auto' });
      box = thumb.getBoundingClientRect();
    }
    var from = img.getBoundingClientRect();
    if (!from.width || !box.width) { dialog.close(); return; }
    closing = true;
    dropGhost();
    dialog.classList.add('is-flipping');
    img.style.transformOrigin = '0 0';
    var fly = img.animate([
      { transform: 'none' },
      { transform: 'translate(' + (box.left - from.left) + 'px, ' + (box.top - from.top) + 'px) ' +
                   'scale(' + box.width / from.width + ', ' + box.height / from.height + ')' }
    ], { duration: FLIP_MS * 0.85, easing: FLIP_EASE, fill: 'forwards' });
    var fade = dialog.animate([
      { backgroundColor: 'rgba(8, 9, 11, 1)' },
      { backgroundColor: 'rgba(8, 9, 11, 0)' }
    ], { duration: FLIP_MS * 0.85, easing: 'ease', fill: 'forwards' });
    function done() {
      dialog.close();
      fly.cancel();
      fade.cancel();
      img.style.transformOrigin = '';
      dialog.classList.remove('is-flipping');
      closing = false;
    }
    fly.finished.then(done, done);
  }

  // Esc：拦下来走同一个带动画的关闭
  dialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    close();
  });

  dialog.addEventListener('close', function () {
    document.body.classList.remove('is-locked');
    dropGhost();
    // 关闭后把对应的照片滚回视野，免得读者不知道自己回到了哪里
    var plate = plates[current];
    if (plate) {
      var box = plate.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        plate.scrollIntoView({
          block: 'center',
          behavior: reduceMotion ? 'auto' : 'smooth'
        });
      }
    }
  });

  document.querySelectorAll('.plate__open').forEach(function (btn) {
    btn.addEventListener('click', function () {
      open(parseInt(btn.dataset.index, 10) || 0);
    });
  });

  dialog.addEventListener('click', function (event) {
    var act = event.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'close') close();
      if (act.dataset.act === 'prev') show(current - 1);
      if (act.dataset.act === 'next') show(current + 1);
      return;
    }
    // 点空白处关闭；点照片本身不关，免得想看细节时误触
    if (!event.target.closest('img')) close();
  });

  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
  });

  /* 手机上左右滑动翻页 */
  var touchX = null, touchY = null;
  dialog.addEventListener('touchstart', function (e) {
    touchX = e.changedTouches[0].clientX;
    touchY = e.changedTouches[0].clientY;
  }, { passive: true });

  dialog.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      show(current + (dx < 0 ? 1 : -1));
    }
    touchX = touchY = null;
  }, { passive: true });
})();
