/* ════════════════════════════════════════════════════════════════
   Good Night — 图片渐显、滚动进场、全屏查看

   没有依赖，没有构建步骤。整个文件就是浏览器直接跑的。
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 系列页里是 .plate（照片），目录页里是 .work（作品条目），
  // 影评页里是 .note（一条影评）—— 三处共用同一套进场逻辑。
  //
  // ⚠️ CSS 里凡是写了 .js-reveal X { opacity: 0 } 的 X，**必须**出现在这个
  //    选择器里，否则它永远等不到 .is-in，开着 JS 的人看到的就是一片空白。
  //    加新的区块时先改这一行。
  var plates = Array.prototype.slice.call(
    document.querySelectorAll('.plate, .work, .note')
  );

  /* ── 图片加载完再淡入 ──────────────────────────────────────── */

  function watchLoading(img, stillCurrent) {
    function reveal() {
      if (!stillCurrent || stillCurrent()) img.classList.add('is-loaded');
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

  var current = 0;
  var showToken = 0;

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

    watchLoading(img, function () { return token === showToken; });

    elCount.textContent = pad(current + 1) + ' / ' + pad(photos.length);
    elDate.textContent = photo.date + (photo.time ? ' · ' + photo.time : '');
    elExif.textContent = photo.exif;

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

  function open(index) {
    show(index);
    document.body.classList.add('is-locked');
    dialog.showModal();
  }

  function close() {
    dialog.close();
  }

  dialog.addEventListener('close', function () {
    document.body.classList.remove('is-locked');
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
