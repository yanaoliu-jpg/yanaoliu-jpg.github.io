# 交接文档（HANDOFF）

> 写于 **2026-09-29**，给一个**完全不了解背景**的新会话。
>
> **新会话怎么用这份文件：** 他开口第一句会是「先读取HANDOFF.md」。读完这份，再把
> [CLAUDE.md](CLAUDE.md) 从头读一遍（新会话会自动加载它，但第五、七、八、十节必须真的读过），
> 然后用两三句话向他复述「现在是什么状态」，**再问他这次要做什么**。不要自己开工。
>
> 分工：**这份记「会话状态」**（刚做完什么、卡在哪、下一步）；**CLAUDE.md 记「长期规则」**
> （为什么这么做、哪里一改就出事）。两份冲突时以 CLAUDE.md 为准，并告诉他。

---

## 0. 一分钟版

- 这是**刘延奥（Yanao "Leo" Liu）的摄影作品集网站**，给美国大学招生官看。
  线上 <https://yanaoliu-jpg.github.io/>，仓库 `yanaoliu-jpg/yanaoliu-jpg.github.io`（**Public**）。
- **现在没有进行中的任务。** 上一个任务（「透过镜头」改版）已经做完、他已经推送、
  公网上跑完整验证 **802 项全过**。
- 仓库是干净的：本地 `HEAD` = `origin/main` = `b989272`。唯一没提交的是这份 `HANDOFF.md`。
- 下一步完全取决于他。常见的是：加新作品、改文字、看效果、查公网。

---

## 1. 项目是什么

| | |
|---|---|
| 内容 | 7 组照片 63 张 + 3 部影片 + 62 篇影评，中英双语，共 24 个页面 |
| 生成方式 | 自己写的静态生成器 `site/build.py`（Python 3.11 + Pillow + ImageMagick），**没有 npm、没有框架** |
| 发布 | GitHub Pages 从 `main` 分支的 `/docs` 目录发布。`docs/` 全是构建产物 |
| 源码 | `site/`：`build.py`、`content/*.toml`（所有文字）、`templates/`、`static/`（CSS/JS/字体/Three.js）、`tools/`（字体、海报、验证脚本） |
| 原图 | `素材/`，11 GB，**在 .gitignore 里，永远不进仓库** |
| 文档 | `CLAUDE.md`（规则，最重要）、`README.md`（给他看的操作手册）、`容量规划.md`、三份设计存档（`首页改版设计.md`、`影评栏目设计.md`、`透过镜头设计.md`） |

作品的线索（加新作品时拿它去比）：**「他总是站在外面，看别人的日常。」** 详见 CLAUDE.md 第一节。

---

## 2. 当前正在做什么

**没有。** 最后一个任务是「透过镜头」改版，状态：**已完成 → 已提交 → 已推送 → 公网已验证**。

- 提交：`bad1582 Through-the-lens redesign: …`、`b989272 Remove the executed lens plan`
- 2026-09-28 22:29（北京时间）上线；公网抽查 13 个页面和资源文件，跟本地构建**逐字节一致**；
  `verify.js` 对公网跑完 **802 项全过、0 失败**，对比度探针量了 832 段字，控制台零报错。

---

## 3. 已经完成了什么（这一长串会话里做的，按时间）

1. **2026-08 前后**：陆续加了作品——照片系列（其中有「我总是回到那几天」，素材文件夹叫
   `第一年/Xacademy的夏辑`；还有「留给日后」）和三部影片（停止滑动、感恩悄然发生、都值得被听见）；
   **中文全部重写**（他嫌原来像机翻）；做了容量规划（拿掉 3200px 图片档、JPEG 兜底降到 1600px），
   写成 `容量规划.md`。每一组的来龙去脉在 CLAUDE.md 第一节。
2. **2026-08-29 影评栏目**：网站分成「照片 / 影片 / 影评」三大类，首页顶部加导航；
   62 篇影评（中英）进网站，海报从 TMDB 取（`tools/fetch_posters.py`，人工核对过对照表）。
3. **2026-09-21 首页改版**：首页换成亮色渐变底（内页仍是深色），封面圆角 + 柔影、定高 300px、
   影片跟照片并排；全站字体换成 DM Sans + 思源黑体（Noto Sans SC）；间距收 25%。
4. **首页改版推送之后解释过一次缓存问题**：他打开看到的还是旧版本——GitHub Pages 的
   `cache-control: max-age=600`，浏览器缓存 10 分钟，**⌘⇧R 强制刷新**就好。
5. **2026-09-28「透过镜头」改版**（他的要求：现代、有创意、动态交互、3D、平滑交互、丰富配色，
   **不动任何素材和文字**；技术栈和做法全交给我定，他只拍板了「3D 用光圈镜头」和「可以下载 Three.js」）：
   - 首页第一屏：Three.js 做的 3D 光圈镜头，光圈里轮流映出七组封面，跟鼠标转、滚动开光圈、点击按快门
   - 每件作品从封面取色（`build.py` 的 `palette_for`），亮度约束在构建时钳住
   - 首页环境光（跟镜头 / 悬停的作品变色）、区标题渐变大字、封面倾斜反光、跟随光标（View/Play/Read，看/播放/阅读）
   - 影评海报墙在宽屏上变成可拖动的三层走马盘（zoetrope）
   - 换页：九边形光圈张开；点封面进内页时封面长成光晕、小标题长成大标题（View Transitions）
   - 内页：顶部光晕（本组颜色）、阅读进度条、「下一组」悬停带下一组颜色、全屏看照片从原位放大/缩回
   - **像素级对比度探针**（verify.js 第 21 节）第一次跑就查出一个**改版前就有**的问题：
     首页封面下面那行「Series 01 · 2023」压在封面柔影上只有 3.96–4.27:1，已改深一档（4.97:1）
   - 所有规则和坑都写进了 **CLAUDE.md 第十节**；设计理由和「实现时改掉的地方」在 `透过镜头设计.md`

---

## 4. 目前遇到的问题 / 还没解决的

**没有卡住的问题。** 下面是已知但没处理的，按重要程度：

1. **只在 Chrome 里测过。** 验证用 playwright-core 驱动本机 Chrome，Safari、Firefox、真 iPhone 都没测。
   已知：Firefox 不支持跨页面 View Transitions（就是普通跳转，没问题）；Safari 18.2 以上应当有光圈换页；
   **走马盘的 3D（`mask-image` + `preserve-3d`）在 Safari 上没验证过**，最坏情况是圆筒被压平。
   如果他用 Safari / iPhone，可以请他打开看一眼、截图发来。
2. **缓存 10 分钟。** 每次推送后，他自己的浏览器可能拿到「新 HTML + 旧 CSS」，看起来会乱——
   提醒他 ⌘⇧R。第一次来的访客没有这个问题。
3. **一个遗留文件**：根目录的 `影评栏目实现计划.md` 是 2026-08 就执行完的计划，文件里自己写着「做完可以删」，
   但一直没删（另外两份执行完的计划都删了）。要不要删，**问他**，别自己删。
4. **这份 `HANDOFF.md` 没提交。** 要不要进仓库由他定（仓库是 Public 的，这份里没有任何敏感信息；
   GitHub Pages 只发布 `docs/`，放在根目录不会出现在网站上）。
5. 换页动画中途封面有点糊：快照是卡片大小的图放大，落地后就清楚了。这是 View Transitions 的原理限制，不是 bug。

---

## 5. 下一步怎么推进

**先问他要做什么。** 他没有留下待办。可能的方向（**只在他提出时做**）：

- **加新作品**：流程在 CLAUDE.md 第六节。颜色、编号、「下一组」都是自动的；
  要手动改的只有 `site/tools/verify.js` 顶部的 `SLUGS`（**必须按 order 排**）和影片的 `FILMS`。
  挑作品先拿「他总是站在外面，看别人的日常」去比；**别超过 10–12 组**（第九节算过账）。
- **在 Safari / iPhone 上看一遍**（见上面第 4 节第 1 条）。
- **给纯中文影片加英文字幕**：必须他提供逐句原文，**不能靠听写编**（CLAUDE.md 第九节）。
- **容量**：真正的墙是 GitHub **单文件 100 MiB**（现在 `make-a-wish.webm` 84%），不是总量。见 `容量规划.md`。

**做完任何改动之后的固定流程：**

1. `python3 site/build.py`（改了中文还要走字体流程，见第 6 节 C）
2. 本地验证：`verify.js` 全过（第 7 节的命令）
3. **把提交命令给他，他自己跑**（`git add -A && git commit … && git push`），我不 push
4. 他说「推完了」之后查公网：先比对 `git rev-parse HEAD` 和 `git ls-remote origin main`，
   再用带重试的 curl 看新内容上没上线，最后 `verify.js` 对公网跑一遍

---

## 6. 踩过的坑（必须避免）

### A. 跟他合作（CLAUDE.md 第五节，最重要）

- **命令他自己跑，我从不替他 push。** 提交命令写好给他；他说「推完了 / 提交了」再继续。
- **先说问题，再让他定。** 他决定跟我建议不一样时，照他的做，**不再劝第二次**。
- **中文他写，英文我转**；中文版**直接用中文写，不从英文回译**，不然一股翻译腔。
- **不猜他的个人信息**（名字、日期、地点）。曾经把中文名猜错成「刘彦骜」，实际是**刘延奥**。
- 给方案时**先给数据再给判断**（比如渲染几个版本截图比出来，不是拍脑袋）。
- 他用中文交流，回答用中文。

### B. 安全

- 他在聊天里给过一个 **TMDB 读取令牌**。**绝不能写进仓库里的任何文件**（仓库是 Public 的），
  只能在 shell 里 `export TMDB_API_KEY=…` 临时用。新会话里没有它，要拉海报时问他要。
- `素材/` 永远不进仓库。**别往 `docs/` 里放笔记、规格、计划**——`docs/` 就是发布出去的网站。

### C. 构建、图片、字体

- **绝对不要同时跑两个 `build.py`**（会把好照片误判成「AVIF 比 WebP 大」、删掉 AVIF）。
- **`verify.js` 跑着的时候别重新构建**：`build.py` 会先删掉 `docs/static/` 再复制，正在跑的测试会炸。
- 改了中文文字必须：`python3 site/build.py && python3 site/tools/subset_font.py && python3 site/build.py`，
  然后 `python3 site/tools/check_font.py` 要显示「✓ 全部覆盖」。字体脚本从 2026-09-28 起**跳过 HTML 注释**，
  但 `data-cursor` 这类属性里的字照算。
- `sizes` 写在两处必须同步（CLAUDE.md 第三节第 2 条）：`--cover-h` ↔ `INDEX_COVER_H`；
  海报 `--poster-w` ↔ `POSTER_WALL_PX`（96）；走马盘 `--zw` ↔ `motion.js` 的 `ZOE_W` ↔ 改写后的 sizes（120）。
- **`brew install ffmpeg` 会悄悄弄坏 AVIF**（x265 和 libheif 对不上）→ `brew reinstall libheif`。
- 网址（slug）一旦发出去**永远不改**。

### D. 前端（「透过镜头」改版的规矩，细节在 CLAUDE.md 第十节）

- **关掉 JS 要跟改版前一样**：任何会藏起内容的 CSS 都挂在 JS 加上的类下面
  （`.js-reveal`、`.fx`、`.fx-tilt`、`.lens--on`、`.is-zoetrope`），不能反过来写。
- `--w`（环境光）亮度 ≥ 0.745、`--d`（渐变字）≤ 0.175 是构建时钳住的；**别拿 `--c` 当字的颜色**（深底上只有 2.9:1）。
- `background-clip: text` 的渐变字：下划线也会被算进裁切，写 `transparent` 也照样露出渐变——平时必须 `text-decoration: none`。
- 换页形变的名字**只由 `base.html` 头部脚本临时起**，两页用 sessionStorage 对暗号；别在 `build.py` 里写死。
- 首页整页高度（1440×900、关掉 JS）必须 **≤ 6.1 屏**，现在 6.07——再加东西先量。
- 渲染 3D 要用真 GPU：playwright 启动参数 `--use-angle=metal --enable-gpu --ignore-gpu-blocklist`。

### E. 验证

- **浏览器面板的截图会骗人**（视口比面板大、标签不在前台时截出空白）。要给他看的图用 playwright 截。
- 写判据先想清楚，误报过很多次：大写是 CSS `text-transform` 转的（HTML 里不是大写）；
  首页封面等高只在 >900px 成立；相对链接要 `new URL(href, location.href).pathname` 算到底。
- 冻结动画看帧时：进度条是**滚动驱动**的动画，给它设毫秒 `currentTime` 会抛错，只动 `document.timeline` 上的；
  逐帧看换页时**只冻结要看的那一次**，冻住前一次它永远不结束，会把下一次的名字撤掉（像是网站 bug，其实是测试脚本的问题）。
- 像素探针要排除：被 `clip-path` 裁掉的字（「跳到作品」）、跟随光标的圆片。
- `verify.js` 本地跑一遍约 10 分钟，公网更久——**放后台跑**，别让它把对话卡住。

### F. 网络和发布

- 他的网络到 GitHub / Google 经常抖：`SSL_ERROR_SYSCALL`、`curl` 返回 `000`、**`curl -s` 静静返回 0 字节**。
  判断标准：先看字节数不为 0，再看内容；多试几次。**以带重试的 playwright / curl 结果为准**。
- **GitHub Actions 报 `deploy: failure` 不一定是失败**（后端会在它放弃之后做完），以公网 curl 为准。
- push 报 SSL 错也可能已经推上去了：看有没有 `xxxx..xxxx main -> main`，或者比对 `rev-parse` 和 `ls-remote`。
- 部署一般 1–3 分钟。检查新版本上没上线时 URL 加 `?nocache=时间戳` 绕开 CDN 缓存，上线后再用不带参数的地址确认。

---

## 7. 常用命令

```bash
cd ~/Desktop/website
python3 site/build.py                       # 增量构建（很快；图片和视频没变就跳过）
python3 site/tools/check_font.py            # 中文字体缺不缺字（不联网）
```

**本地预览**：`.claude/launch.json` 里有一个叫 `portfolio` 的配置，
在 8412 端口服务 `docs/`（桌面版用 preview_start 起它；他自己可以打开 <http://localhost:8412>）。

**验证**（playwright-core 不进仓库，装在临时目录；上一个会话装在 scratchpad 里，已经没了，要重装）：

```bash
mkdir -p /tmp/pw && cd /tmp/pw && npm install playwright-core
cd ~/Desktop/website && NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js http://localhost:8412
cd ~/Desktop/website && NODE_PATH=/tmp/pw/node_modules node site/tools/verify.js https://yanaoliu-jpg.github.io
```

第二个参数后面再给一个 png 路径，会存一张首页整页截图。期望结果：**802 项通过，0 项失败**
（加了作品之后数字会变，只要 0 失败）。

**查推送和公网**：

```bash
git rev-parse HEAD | cut -c1-8; git ls-remote origin main | cut -c1-8
curl -s --compressed -o /dev/null -w "%{http_code}\n" https://yanaoliu-jpg.github.io/
```

---

## 8. 文件地图（改东西之前先找对地方）

| 要改的 | 在哪 |
|---|---|
| 任何文字 | `site/content/*.toml`（一个作品一个文件；`_site.toml` 是首页；`film-notes.toml` 是 62 篇影评） |
| 界面上的固定词（中英） | `site/build.py` 顶部的 `LANGS` |
| 版面、颜色、动效 | `site/static/style.css`（注释里写着每个数字是怎么来的，改之前先读） |
| 3D 镜头 | `site/static/lens.js`（Three.js 在 `site/static/vendor/three/`，原样不改） |
| 环境光、倾斜、光标、走马盘、进度条兜底 | `site/static/motion.js` |
| 进场动画、全屏看照片 | `site/static/gallery.js`（普通脚本，要在最老的浏览器上也能跑） |
| 换页动画的配对脚本 | `site/templates/base.html` 的 `<head>` |
| 取色 | `site/build.py` 的 `palette_for` / `section_palette` / `mosaic_palette` |
| 验证 | `site/tools/verify.js`（第 13–21 节是这次改版加的） |
