# 项目交接说明

> 这个文件是给**下一次会话**看的（新开的 Claude Code 会自动读它）。
> 面向使用者的操作手册在 [README.md](README.md)，两者不重复。
> 这里记的是**为什么这么做**，以及**哪些地方一改就出事**。

---

## 一、这是什么

刘延奥（Yanao "Leo" Liu）的摄影作品集，**给美国大学招生官看的**。

- 线上：<https://yanaoliu-jpg.github.io/>
- 仓库：`yanaoliu-jpg/yanaoliu-jpg.github.io`（Public，GitHub Pages 从 `main` 分支 `/docs` 发布）
- 目前 **4 组 36 张，中英双语，共 10 个页面**

| # | 英文 | 中文 | 时间 | 地点 |
|---|---|---|---|---|
| 01 | Good Night | 晚安 | 2023.11–12 | 北京 |
| 02 | Goodbye, Renfen | 再见，人分 | 2024.05 | 北京 |
| 03 | The Old Days | 旧时光 | 2025.05 | 北京 |
| 04 | Drunk on the Night Wind | 夜风沉醉的旅程 | 2025.07 | 阿那亚 |

四组连成一条线：**冬夜的窗 → 空掉的教室 → 黄昏的操场 → 入夜的海边**。
加新作品时**优先挑跟这条线索有关系的**，不是凑数量。招生官记得住一条清晰的线索，记不住 68 个文件夹。

---

## 二、结构

```
website/                     ← git 仓库根
├─ CLAUDE.md                 ← 本文件
├─ README.md                 ← 使用手册（怎么加作品、怎么发布）
├─ site/                     ← 源码
│  ├─ build.py               ← 图片流水线 + 双语页面生成
│  ├─ content/*.toml         ← 所有文字都在这里，一个作品一个文件
│  │  └─ _site.toml          ← 下划线开头 = 站点级配置，不是作品
│  ├─ templates/             ← base / index / series 三个模板
│  ├─ static/                ← CSS、JS、字体、favicon
│  └─ tools/
│     ├─ subset_font.py      ← 重新裁中文字体（要联网）
│     └─ check_font.py       ← 检查字体缺不缺字（不联网）
├─ docs/                     ← 构建产物，GitHub Pages 发布这个目录
└─ 素材/                     ← 原图 11 GB，**不进仓库**
```

依赖只有 `imagemagick`、`webp`、Python 3.11+（用内置 `tomllib`）。
`fonttools` + `brotli` 仅裁字体时需要。**没有 npm、没有框架、没有 node_modules**——这是刻意的，他要自己维护三年。

---

## 三、绝对不要动的三件事

### 1. 网址一旦发出去就不能变

`/good-night/` 从第一次部署起没变过。招生官手里的链接、网申表格里填的地址都指向它。

- 加新作品用新 `slug`，**永远不要改已有的 slug**
- 首页在 `/`，中文在 `/zh/`，系列在 `/<slug>/` 和 `/zh/<slug>/`

### 2. 尺寸写在两个地方，必须同步

```
site/static/style.css   --plate-vh: 72        ← 决定实际显示大小
site/build.py           MAX_VH = 72           ← 写进 <img sizes>，决定下载哪档分辨率
                        MAX_PX = 1400  ↔  CSS 里 .plate 的 min(92vw, 1400px, …)
```

对不上**不会变形**（CSS 说了算），但会**下错档**：要么糊，要么白下载大图。改一个必须改另一个。

### 3. 进场动效必须"默认可见、JS 叠加"

CSS 里所有 `opacity: 0` 都挂在 `.js-reveal` 下面，而这个类由 `gallery.js` **亲手加上**。

最初写反了（默认 `opacity: 0`，靠 JS 点亮），结果 JS 任何一环出问题，招生官看到的就是一片空白。
现在实测关掉 JS 后渲染结果与开启时**逐像素完全一致**。
**不要为了少写几行把这个顺序改回去。**

---

## 四、几个决定背后的原因

**深色底 `#0d0e11`** —— 这批照片 91% 的像素亮度在 32 以下（满值 255）。白底会让眼睛适应白色，照片退化成黑方块。不用纯黑是因为纯黑会让画面最暗处和页面融成一片，照片失去边界。

**横竖片按高度对齐，不按宽度** —— 按宽度铺满的话竖构图会大得离谱、横构图显得小气。限制高度、宽度自然生长，视觉重量才相等。画廊挂不同画幅的照片就是这么对齐的。首页四张封面同理。

**AVIF q72 主力** —— 实测数据（不是猜的）：2400px 下 AVIF 268KB / WebP 303KB / JPEG 523KB，而 AVIF 的暗部误差优于 JPEG q90。跟原图做过 100% 像素裁切对比，分不出来。
高 ISO 噪点在这里帮了忙——它天然起到抖动作用，暗部不会出色块断层。

**3200px 那档不出 JPEG** —— JPEG 只给既不支持 AVIF 也不支持 WebP 的浏览器兜底，那是 2020 年以前的老家伙，不会跑在 4K 屏上。省掉近三分之一仓库体积。

**三档灰阶都过 WCAG AA** —— 最初调得更暗"更高级"，实测序号和参数那行只有 **1.95:1**（标准要求 4.5:1）。招生官在明亮办公室用笔记本看就是一片糊，而且美国大学对无障碍是认真的。
`--ink-faint: #7a7d85` 是 4.7:1，**底线，别再往下调**。

**EXIF 被抹掉时只标月份** —— 有些作品经微信/手机相册导出，拍摄时间丢了。这时在 toml 写 `date = "2024-05"`，页面只显示月份、逐张不标日期。
标一个来自文件系统的假日期比留空糟糕得多——而且很容易跟自述里写的时间对不上，被招生官看出破绽。

---

## 五、他的工作习惯（重要）

**命令他自己跑。** 我给命令、他在终端执行、截图回来给我核对。**我从不替他 push**——那要用他的账号，也是他该拍板的动作。

**先说问题，再让他定。** 他要的是"你告诉我哪里有问题"，不是替他做决定。
典型例子：第二组有 4 个文件其实是三张照片拼在一起的手机拼图，我说明了利弊并建议切开，他选择原样使用——**那就照做，不再劝第二次**。

**中文他写，英文我转。** 他发中文素材，我写成英文，然后逐句告诉他我怎么处理的、哪句对应他的哪句。内容必须是他的，英文表达是我的。
中文版**直接用中文写，不从英文回译**，否则一股翻译腔。

**不要猜他的个人信息。** 我曾经把中文名猜成"刘彦骜"（实际是**刘延奥**），已改。名字、日期这类事实一律问，不猜。

**他会自己发现问题。** "照片太大了""想一屏看全"这类反馈都很准。给方案时**先给数据再给判断**（比如尺寸调整是渲染了 84/74/66/58 四个版本比出来的，不是拍脑袋）。

---

## 六、加一组新作品的完整流程

```bash
cp site/content/night-wind.toml site/content/新作品.toml
```

改这几行：`slug` / `title` / `source` / `order` / `cover` / `eyebrow` / `year` / `place` / `description`，
重写 `[alt]`（对应新文件名）和 `[zh]` 那一整段。

然后：

```bash
python3 site/build.py && python3 site/tools/check_font.py
```

`check_font.py` 会告诉你中文字体缺不缺字。**缺字就必须重裁**：

```bash
python3 site/build.py && python3 site/tools/subset_font.py && python3 site/build.py
```

跑两次 build 是必须的：先生成网页 → 扫出用到的字 → 裁字体 → 再生成一次把新字体复制进 `docs/`。

最后：

```bash
git add -A && git commit -m "Add series NN: 标题" && git push
```

### 写 alt 文字时的坑

**一定要先确认文件名和画面的对应关系。** 第四组我踩过一次：生成预览时用文件名排序，写 alt 时却按拍摄时间对应，九张全错位，封面也选错了。
做法：生成预览时**用原文件名命名**，或者逐张 `Read` 确认。

---

## 七、故障判断

**他的网络到 GitHub / Google 不稳定。** 这一路遇到过至少五次，全是临时故障：

- `SSL_ERROR_SYSCALL in connection to fonts.googleapis.com` —— 裁字体时连不上 Google
- `SSL_ERROR_SYSCALL in connection to github.com:443` —— push 时
- `ERR_CONNECTION_CLOSED` / curl 返回 `000` —— 访问线上站时

**判断唯一标准是这条命令，不是终端有没有红字：**

```bash
curl -s --compressed -o /dev/null -w "%{http_code}\n" https://yanaoliu-jpg.github.io/
```

`200` 就是好的。多试几次。

### 两个"看起来失败其实成功"的经典情况

**GitHub Actions 报 `deploy: failure`** —— 至少发生过两次。真实情况是 `build` 8 秒就成功了，`deploy` 那步 Actions 只肯等 10 分钟就报超时放弃，**但 GitHub 后端在它放弃之后把发布做完了**。以 curl 结果为准。

**push 报 SSL 错但其实已经推上去了** —— 看 `git push` 输出里那行 `xxxxxxx..xxxxxxx  main -> main`，有它就是成了。或者直接比对：

```bash
git rev-parse HEAD | cut -c1-8; git ls-remote origin main | cut -c1-8
```

### 脚本是安全失败的

`subset_font.py` 下载失败时先退出，**不会覆盖已有字体文件**。报错了先跑 `check_font.py`，够用就照常推送。

---

## 八、验证的做法

用 `playwright-core` 驱动本机 Chrome（不下载额外浏览器）。装在临时目录，不进仓库：

```bash
npm install playwright-core
```

`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`

**验证公网时一定要加重试**，否则会把网络抖动误报成网站故障：

```js
async function go(pg,u){for(let i=0;i<5;i++){try{return await pg.goto(u,{waitUntil:'networkidle',timeout:45000});}catch(e){if(i===4)throw e;await pg.waitForTimeout(4000);}}}
```

**判据要写对。** 我写错过三次，每次都误报成网站有问题：

- 用小写去匹配被 `text-transform: uppercase` 转成大写的文字
- 竖屏设备上套用横屏的"照片占视口高 68–82%"规则（竖屏下限制照片的是宽度）
- `magick compare` 的数值写在 **stderr** 不是 stdout

**该查的项**：十个页面 200 且占位符为零、四组封面等高、标题和说明起点齐、底边齐、语言切换落在对方语言的同一页（不是跳首页）、中文零缺字形、各设备分辨率档位合适、横向溢出为 0、关掉 JS 渲染结果一致。

---

## 九、还没做的事

- **首页一行放 4 组已经偏挤**（最窄栏 227px）。到第五、六组要改成两行排列。
- 素材里【第一年】还有 60 多组没上。**不要建议全上**——他自己也认同精选比堆量有效。
- 仓库现在约 130 MB。GitHub 建议单仓库不超过 1 GB，也就是大约 25–30 组封顶。真到那天：去掉 `WIDTHS` 里的 3200 档能省一半。
