# 交接文档（HANDOFF）

> 写于 **2026-09-29**（下午，「放映厅」第一步上线之后），给一个**完全不了解背景**的新会话。
>
> **新会话怎么用这份文件：** 他开口第一句会是「先读取HANDOFF.md」。读完这份，再把
> [CLAUDE.md](CLAUDE.md) 从头读一遍（新会话会自动加载它，但第五、七、八、十、十一节必须真的读过），
> 然后用两三句话向他复述「现在是什么状态」，**再问他这次要做什么**。不要自己开工。
>
> 分工：**这份记「会话状态」**（刚做完什么、卡在哪、下一步）；**CLAUDE.md 记「长期规则」**
> （为什么这么做、哪里一改就出事）。两份冲突时以 CLAUDE.md 为准，并告诉他。

---

## 0. 一分钟版

- 这是**刘延奥（Yanao "Leo" Liu）的摄影作品集网站**，给美国大学招生官看。
  线上 <https://yanaoliu-jpg.github.io/>，仓库 `yanaoliu-jpg/yanaoliu-jpg.github.io`（**Public**）。
- **进行中的任务：「放映厅」改版，分三步，第一步「地基」已上线**（`c2f0223`，2026-09-29 下午他推的）。
  第二步「影片」、第三步「照片」**还没开始**，要等他说开始。
- 本地验证 **1078 项全过**；公网 1077 / 1078，没过的那项是偶发、重跑两次都过（见第 2 节）。
- **他欠一样东西**：联系邮箱（「关于」里的「联系」那一行；`_site.toml` 的 `email` 现在空着，那一行就不显示）。

---

## 1. 项目是什么

| | |
|---|---|
| 内容 | 7 组照片 63 张 + 3 部影片 + 62 篇影评，中英双语，共 24 个页面 |
| 生成方式 | 自己写的静态生成器 `site/build.py`（Python 3.11 + Pillow + ImageMagick），**没有 npm、没有框架** |
| 发布 | GitHub Pages 从 `main` 分支的 `/docs` 目录发布。`docs/` 全是构建产物 |
| 源码 | `site/`：`build.py`、`content/*.toml`（所有文字）、`templates/`、`static/`（CSS / JS / 字体）、`tools/`（字体、海报、验证脚本） |
| 原图 | `素材/`，11 GB，**在 .gitignore 里，永远不进仓库** |
| 文档 | `CLAUDE.md`（规则，最重要）、`README.md`（给他看的操作手册）、`容量规划.md`、设计存档（`首页改版设计.md`、`影评栏目设计.md`、`透过镜头设计.md`、`放映厅改版设计.md`）、`放映厅实现计划.md`（**进行中，做完删**） |

作品的线索（加新作品时拿它去比）：**「他总是站在外面，看别人的日常。」** 详见 CLAUDE.md 第一节。

---

## 2. 当前正在做什么

**「放映厅」改版**（2026-09-29 开始）。他发来五条建议（暗色电影感、全屏主视觉、固定导航、关于 / 联系、
暗亮切换、影片海报卡和悬停预览、照片画廊和灯箱参数），说「根据自己想法决定是否采纳」。
设计在 `放映厅改版设计.md`（他逐段确认过），规则在 **CLAUDE.md 第十一节**。

| 步 | 内容 | 状态 |
|---|---|---|
| 1 地基 | 顶部固定导航、默认暗色 + 亮色切换、首页第一屏换成七组封面全屏轮播（**3D 镜头撤了**）、首页末尾「关于」 | **已上线** `c2f0223`；本地 1078 项全过；公网 1077 / 1078——唯一那项是第 17 节「后退回首页，标题那一对没配上」，`ONLY=17` 对公网重跑两次都过，是偶发（公网慢，后退那一刻标题还没进视野） |
| 2 影片 | 竖版海报卡、悬停播 3–4 秒无声片段（build.py 用 ffmpeg 切）、点了在本页弹出播放器、类型 | 没开始；计划还没写 |
| 3 照片 | 系列页「逐张 · 网格」切换（等高行，不是瀑布流）、灯箱里加机身和镜头（只读每张自己的 EXIF） | 没开始；计划还没写 |

第一步之后还有一次小提交没做：`CLAUDE.md` 第八节的验证数字（1078 项、35–40 分钟、首页 6.01 屏）
和这份 `HANDOFF.md`——**本地已改好，还没提交**（见第 5 节的命令）。

---

## 3. 已经完成了什么（按时间）

1. **2026-08 前后**：陆续加了作品（七组照片、三部影片）；中文全部重写；容量规划（拿掉 3200px 档）。
2. **2026-08-29 影评栏目**：照片 / 影片 / 影评三大类；62 篇影评进网站，海报从 TMDB 取。
3. **2026-09-21 首页改版**：首页亮色渐变底、圆角封面、DM Sans + 思源黑体。
4. **2026-09-28「透过镜头」改版**：3D 光圈镜头、封面取色、环境光、倾斜、跟随光标、走马盘、光圈换页、全屏放大、像素对比度探针。
5. **2026-09-29「放映厅」第一步**（这次）：
   - 他拍板的：**首页暗色电影感**（跟 09-21「不要是黑色底」反着，他自己改的主意）、**第一屏用照片**（片子几乎每帧压着字幕，干净的镜头只有《停止滑动》约 3 秒）、「关于」= 开场白 + 已有的事实、联系留邮箱、三部片子的类型（公益广告 / 纪录短片 / 纪录短片）
   - 不照做的（他没异议）：嵌 Vimeo/YouTube（国内打不开）、「导演阐述」这个叫法（三部他都是摄影 / 录制）、瀑布流（29/63 是竖片）、单张照片标题（没有，不编）
   - 顺手修了一个线上 bug：**中文内页「← 全部作品」一直链到英文首页**（`../../`）。新导航接手之后没了
   - `verify.js` 加了 `ONLY=` 开关和 `nav` / `theme` / `hero` / `about` 四节；探针两种模式各跑一遍、第一屏七张逐张量、跳过被导航挡住的字
   - 检查查出来并修掉的：暂停键停不住推近（`animation` 简写把 play-state 重置了）；导航透明时跟第一屏大名字叠字；第一屏顶上的渐黑太淡（「旧时光」上方）

---

## 4. 目前遇到的问题 / 还没解决的

1. **只在 Chrome 里测过。** Safari、Firefox、真 iPhone 都没测。这次新加的里面，Safari 要留意：
   `popover`（Safari 17+）、容器查询单位 `cqw/cqh`（16+）、滚动驱动动画（第一屏往下滚的视差，Safari 26 才有，没有就是普通滚走）。
   走马盘的 3D 在 Safari 上也一直没验证过。他用 Safari / iPhone 的话请他打开看一眼、截图发来。
2. **缓存 10 分钟。** 每次推送后他自己的浏览器可能拿到「新 HTML + 旧 CSS」——提醒他 ⌘⇧R。
3. **邮箱还没给**（见第 0 节）。给了之后：填 `site/content/_site.toml` 的 `email`，`build.py`，
   `verify.js` 的 `about` 节里 `FACTS` 两边各加一行 `['Contact', 邮箱]` / `['联系', 邮箱]`、页脚期望值改成「北京 · 邮箱」。
4. **一个遗留文件**：根目录的 `影评栏目实现计划.md` 是 2026-08 就执行完的计划，一直没删。要不要删，**问他**。
5. **这次会话中途遇到过工具故障**：自动模式的安全检查连着好几轮「没有结论」，所有命令和改文件都做不了。
   它自己恢复了。再遇到：别硬试（连着 10 次这一轮会被停），告诉他可以先提交已验证的部分，或者临时换成手动批准。

---

## 5. 下一步怎么推进

**先把那次小提交给他**（`CLAUDE.md` 验证数字 + 这份 HANDOFF，本地已改好）：

```bash
cd ~/Desktop/website && git add -A && git commit -m "Record part-1 verification numbers and update handoff notes" && git push
```

**然后问他要不要开始第二步「影片」。** 开始的话：

1. 先抽帧给他看、定三段预览片段（《停止滑动》约 6.6–9.8 秒那段没字的；另外两部挑一段、裁掉底部字幕带约 15%）
2. 按 `superpowers:writing-plans` 把第二步的计划接在 `放映厅实现计划.md` 后面写，再按计划做
3. 设计里已定的：竖版卡（上面完整 16:9 画面，下面 FILM · 年份 / 片名 / 时长 · 类型 / 一句话 = 自述第一段 / 署名 / 有奖的那部带月桂叶的 `award_short`）；
   链接只包片名（整卡可点用伪元素）；悬停或键盘聚焦播预览，触屏 / 减少动态效果 / 省流量不播；
   点了从卡片放大进 `<dialog>` 播放器（有声、webm → mp4），关掉卸 `src`、焦点回卡片；⌘ 点照常开影片页；
   播放器加进 style.css 顶部那个「永远暗」的选择器；预览参数变了要自动重切（写一个参数小文件）

**做完任何改动之后的固定流程：**

1. `python3 site/build.py`（改了中文还要走字体流程，见第 6 节 C）
2. 本地验证：相关的几节先用 `ONLY=` 跑，最后全跑一遍（**35–40 分钟，放后台**）
3. **把提交命令给他，他自己跑**（`git add -A && git commit … && git push`），我不 commit、不 push
4. 他说「推完了」之后查公网：先比对 `git rev-parse HEAD` 和 `git ls-remote origin main`，
   再用带重试的 curl 看新内容上没上线（**先看字节数不为 0**），最后 `verify.js` 对公网跑一遍

---

## 6. 踩过的坑（必须避免）

### A. 跟他合作（CLAUDE.md 第五节，最重要）

- **命令他自己跑，我从不替他 commit / push。** 提交命令写好给他；他说「推完了 / 提交了」再继续。
- **先说问题，再让他定。** 他决定跟我建议不一样时，照他的做，**不再劝第二次**。
- **跟他以前的决定冲突的，一定问**（这次：首页亮 / 暗、3D 镜头）；其余他说「你定」就我定。
- **中文他写，英文我转**；中文版**直接用中文写，不从英文回译**。
- **不猜他的个人信息**（名字、日期、地点、邮箱）。系统里能看到他账号的邮箱，**不要拿来当联系邮箱**，等他自己给。
- 给方案时**先给数据再给判断**。他用中文交流，回答用中文。

### B. 安全

- 他在聊天里给过一个 **TMDB 读取令牌**。**绝不能写进仓库里的任何文件**（仓库是 Public 的）。
- `素材/` 永远不进仓库。**别往 `docs/` 里放笔记、规格、计划**——`docs/` 就是发布出去的网站。

### C. 构建、图片、字体

- **绝对不要同时跑两个 `build.py`**；**`verify.js` 跑着的时候别重新构建**（`build.py` 会先删 `docs/static/`）。
- 改了中文（包括 `LANGS` 里的界面词）必须：`python3 site/build.py && python3 site/tools/subset_font.py && python3 site/build.py`，
  然后 `check_font.py` 要「✓ 全部覆盖」。`subset_font.py` 只读网页、只写 `site/static/fonts/`，验证跑着的时候也能跑；后一次 build 要等验证跑完。
- `sizes` 跟 CSS 两处同步（CLAUDE.md 第三节第 2 条）：封面、海报墙、走马盘，这次加了**第一屏**（`HERO_ZOOM` / `hero_sizes()` ↔ `.hero__slide img` ↔ `hero-drift`）。
- **`brew install ffmpeg` 会悄悄弄坏 AVIF** → `brew reinstall libheif`。网址（slug）一旦发出去**永远不改**。

### D. 前端（细节在 CLAUDE.md 第十、十一节）

- **关掉 JS 要一切可见**：会藏东西的 CSS 挂在 JS 加的类下面（`.js-reveal`、`.fx`、`.fx-tilt`、`.is-zoetrope`、`.hero--live`、`.is-away`、`.is-over-hero`）。
- 颜色按模式映射：`--amb`（环境光）、`--g`（区标题）、`--focus`；**永远暗的**块是 `:root, .viewer, .hero`（第二步的播放器也要加进去）。
- **CSS `animation` 简写会重置 `animation-play-state`**：暂停规则要比它更具体。
- 导航的相对链接**必须落在本语言**（内页一律 `../`）；verify 的 `nav` 节中英两边都查。
- 首页整页高度（1440×900、关掉 JS）必须 **≤ 6.1 屏**，现在 **6.01**——再加东西先量（第二步的竖版卡片会变高，要量）。
- 同一页的 View Transition（亮暗切换、以后的逐张 ↔ 网格）先给 `<html>` 加 `.vt-local`，不然会放换页的光圈。

### E. 验证

- **浏览器面板的截图会骗人**（视口比面板大、标签不在前台时截出空白）。给他看的图用 playwright 截（scratchpad 里写过一个 `snap.js`，会话结束就没了，照 CLAUDE.md 第八节重写就行）。
- 写判据先想清楚：大写是 CSS 转的；首页封面等高只在 >900px；相对链接算到 `pathname`；
  **CSS 变量读出来多半已经是 `#rrggbb`**，别当 `rgb()` 拆；关掉灯箱会把页面往下滚、导航就收起了，接着点导航要先滚回顶上。
- 像素探针会跳过：被 `clip-path` 裁掉的字、跟随光标、**被别的元素挡住的字**（第一屏滚到导航底下时）。
- `verify.js` 全跑本地 35–40 分钟、公网更久——**放后台跑**，用 Monitor 等结束（等「exit」行），别在前台 sleep。

### F. 网络和发布

- 他的网络到 GitHub 经常抖：`curl -s` 会**静静返回 0 字节**（这次又遇到了一次）。先看字节数不为 0，再看内容；多试几次。
- **GitHub Actions 报 `deploy: failure` 不一定是失败**；push 报 SSL 错也可能已经推上去了——比对 `rev-parse` 和 `ls-remote`。
- 检查新版本上没上线时 URL 加 `?nocache=时间戳` 绕开 CDN 缓存。

---

## 7. 常用命令

```bash
cd ~/Desktop/website
python3 site/build.py                       # 增量构建（很快；图片和视频没变就跳过）
python3 site/tools/check_font.py            # 中文字体缺不缺字（不联网）
```

**本地预览**：`.claude/launch.json` 里的 `portfolio` 配置，在 8412 端口服务 `docs/`
（桌面版用 preview_start 起它；他自己可以打开 <http://localhost:8412>）。

**验证**（playwright-core 不进仓库，装在临时目录；这次会话装在 scratchpad 里，会话结束就没了，要重装）：

```bash
mkdir -p /tmp/pw && cd /tmp/pw && npm install playwright-core
cd ~/Desktop/website && ONLY=nav,theme,hero,about NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js http://localhost:8412
cd ~/Desktop/website && NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js http://localhost:8412
cd ~/Desktop/website && NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js https://yanaoliu-jpg.github.io
```

期望结果：**1078 项通过，0 项失败**（改了东西数字会变，只要 0 失败）。末尾再给一个 png 路径会存首页整页截图。

**查推送和公网**：

```bash
git rev-parse HEAD | cut -c1-8; git ls-remote origin main | cut -c1-8
curl -s --compressed -o /dev/null -w "%{http_code}\n" https://yanaoliu-jpg.github.io/
```

---

## 8. 文件地图（改东西之前先找对地方）

| 要改的 | 在哪 |
|---|---|
| 任何文字 | `site/content/*.toml`（一个作品一个文件；`_site.toml` 是首页和「关于」：名字、开场白、所在、器材、邮箱；`film-notes.toml` 是 62 篇影评） |
| 界面上的固定词（中英） | `site/build.py` 顶部的 `LANGS` |
| 版面、颜色、动效 | `site/static/style.css`（注释里写着每个数字是怎么来的，改之前先读） |
| 顶部导航的 HTML | `site/build.py` 的 `sitenav()` |
| 导航收起 / 透明、亮暗切换、环境光、倾斜、光标、走马盘、进度条兜底 | `site/static/motion.js` |
| 首页第一屏轮播 | `site/static/hero.js`；数据在 `build.py` 的 `hero_slides()` / `hero_html()` |
| 「关于」 | `build.py` 的 `about_html()` / `work_counts()` |
| 进场动画、全屏看照片 | `site/static/gallery.js`（普通脚本，要在最老的浏览器上也能跑） |
| 亮暗模式的头部脚本、换页动画的配对脚本 | `site/templates/base.html` 的 `<head>` |
| 取色 | `site/build.py` 的 `palette_for` / `section_palette` / `mosaic_palette` |
| 验证 | `site/tools/verify.js`（`ONLY=` 开关；`nav` / `theme` / `hero` / `about` 是这次加的） |
