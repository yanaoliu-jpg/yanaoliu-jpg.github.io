# 摄影作品集

给美国大学招生官看的网页版作品集。线上地址：**https://yanaoliu-jpg.github.io/**

目前七组照片 + 两部影片：

| | | |
|---|---|---|
| Good Night 晚安 | 2023 年 11–12 月 | 9 张 |
| Goodbye, Renfen 再见，人分 | 2024 年 5 月 | 9 张 |
| The Old Days 旧时光 | 2025 年 5 月 | 9 张 |
| Drunk on the Night Wind 夜风沉醉的旅程 | 2025 年 7 月 | 9 张 |
| I Keep Going Back 我总是回到那几天 | 2025 年 7–8 月 | 9 张 |
| Looking Forward 留给日后 | 2026 年 3 月 | 9 张 |
| Sea and Light 海与光的诗 | 2026 年 3 月 | 9 张 |
| **Stop Scrolling, Stay Alive** 停止滑动，面对生活 | 2026 年 3 月 | 影片 32 秒 |
| **Gratitude, Quietly** 感恩悄然发生 | 2025 年 11 月 | 影片 5 分 21 秒 |

- 源码在 `site/`
- 生成的网站在 `docs/`
- 原图在 `素材/`（**不进仓库**，11 GB，只在你自己电脑上）

---

## 需要装的东西

```bash
brew install imagemagick webp
```

放**影片**才需要这个（只放照片不用装）：

```bash
brew install ffmpeg
```

> ⚠️ 装完 ffmpeg 如果 `build.py` 开始刷屏「AVIF 比 WebP 还大」，
> 跑一次 `brew reinstall libheif` 就好——ffmpeg 带进来的 x265 会让 libheif 加载失败，
> ImageMagick 的 AVIF 就悄悄变得又大又糊。详见 CLAUDE.md 第七节。

生成中文字体子集还需要（只在你电脑上用，访客不需要）：

```bash
pip3 install fonttools brotli
```

Python 用系统自带的就行（要 3.11 以上，因为用到了内置的 `tomllib`）。
没有其他依赖——没有 npm，没有框架，没有 `node_modules`。

---

## 本地看效果

```bash
python3 site/build.py --serve
```

然后浏览器打开 http://localhost:8000

---

## 双语

网站有中英两版，图片只存一份，两边共用：

```
/                      英文（招生官默认看到这个）
├─ /good-night/
├─ /goodbye-renfen/
└─ /zh/                中文
   ├─ /zh/good-night/
   └─ /zh/goodbye-renfen/
```

右上角的 `EN / 中` 按钮会跳到**对方语言的同一个页面**，不是跳回首页。

每个 toml 文件底部的 `[zh]` 那一段就是中文版。**没写的项会自动用英文，不会开天窗**——
所以加新作品时可以先只写英文，中文之后补。

### 改完中文一定要重新生成字体

```bash
python3 site/build.py && python3 site/tools/subset_font.py && python3 site/build.py
```

看着啰嗦，但顺序是必须的：先生成网页 → 扫描网页里用到的字 → 裁字体 → 再生成一次把新字体复制过去。

原因：完整的思源宋体有 15MB，不可能整个塞进网页。脚本只打包你实际用到的字（目前 280 个，约 98KB）。
**如果加了新字却忘了跑，那几个字会悄悄掉回系统默认字体**，不报错但很难看。
脚本最后会自己检查覆盖率，缺字会直接报错。

### 如果字体脚本报网络错误

比如 `SSL_ERROR_SYSCALL in connection to fonts.googleapis.com` —— 那是连 Google 的临时故障，
**不用慌，也没弄坏任何东西**：脚本下载失败时会先退出，不会覆盖已有的字体文件。

先确认现有字体够不够用：

```bash
python3 site/tools/check_font.py
```

- `✓ 全部覆盖` → 现有字体够用，直接推送，字体那步不用管
- `✗ 缺 N 个字` → 等网络好了再跑一次 `subset_font.py`；在那之前先别推中文改动

---

## 改文字

网页上所有文字都在 `site/content/` 里，一个作品一个文件：

| 文件 | 管什么 |
|---|---|
| `_site.toml` | 首页：你的名字、开头那段 intro、页脚 |
| `good-night.toml` | Good Night / 晚安 |
| `goodbye-renfen.toml` | Goodbye, Renfen / 再见，人分 |
| `the-old-days.toml` | The Old Days / 旧时光 |
| `night-wind.toml` | Drunk on the Night Wind / 夜风沉醉的旅程 |
| `keep-going-back.toml` | I Keep Going Back / 我总是回到那几天 |
| `looking-forward.toml` | Looking Forward / 留给日后 |
| `sea-and-light.toml` | Sea and Light / 海与光的诗 |
| `stop-scrolling.toml` | Stop Scrolling, Stay Alive / 停止滑动，面对生活（影片） |
| `gratitude.toml` | Gratitude, Quietly / 感恩悄然发生（影片） |

下划线开头的文件不会被当成作品系列。改完存盘，重新跑 `python3 site/build.py` 就生效。

**没填完的地方写成【这样】，网页上会显示成橙色虚线框**——故意做得刺眼，
就是为了不可能在没写完的情况下不小心发出去。

---

## 加一期新作品

```bash
cp site/content/good-night.toml site/content/新系列名.toml
```

打开新文件，改这几行：

```toml
slug   = "new-series"        # 网址会是 .../new-series/，定了别再改
title  = "New Series"
source = "第一年/某个文件夹"    # 指向 素材/ 下面的文件夹
order  = 3                   # 目录页上排第几（**按拍摄时间**，不是按加入顺序）
cover  = "DSC01234"          # 目录页封面（文件名，不含扩展名）
```

把 `[alt]` 那一段整个删掉重写（对应新的文件名），然后：

> **两样东西不用写**：标题上方的「Series 06 / 第六组」由 `order` 自动生成；
> 系列页底部的「下一组」也按 `order` 自动首尾相接（最后一组绕回第一组）。
> 加一组进来，编号和链条都自己接上。

```bash
python3 site/build.py
```

照片会自动按拍摄时间排序，横竖构图自动处理。

### 如果照片的 EXIF 被抹掉了

经过微信或手机相册导出的照片，拍摄时间常常会丢。这时候在 toml 里加一行：

```toml
date = "2024-05"     # 只写到月份
```

写了之后，页面上只标月份，逐张不再标日期——我们只知道月份却标出"某月某日"，
那是在编造精确度，而且很容易跟你自述里写的时间对不上。

---

## 发布到网上

网站产物在 `docs/`。GitHub Pages 可以直接从这个目录发布：

1. 在 GitHub 上新建一个仓库（**Public**，不然招生官打不开）
2. 把本地仓库推上去
3. 仓库页面 → **Settings** → **Pages**
4. Source 选 **Deploy from a branch**，分支选 `main`，目录选 **`/docs`**
5. 等一两分钟，网址是 `https://<你的用户名>.github.io/<仓库名>/`

之后每次更新，重新构建再推一次就行：

```bash
python3 site/build.py && git add -A && git commit -m "更新作品集" && git push
```

---

## 几个已经替你想过的问题

**为什么整站是深色的？**
这组照片 91% 的像素亮度在 32 以下（满值 255）。白底会让读者的眼睛适应白色，
照片就退化成一块块黑方块。背景用 `#0d0e11` 而不是纯黑，是为了让画面最暗处
仍然和页面有边界。

**图片压到什么程度？**
每张出 4 个尺寸（900/1600/2400/3200px）× 最多 3 种格式（AVIF/WebP/JPEG），
浏览器按屏幕和网速自己挑。主力是 AVIF，实测暗部误差优于 JPEG q90，
体积只有它的四成。跟原图 100% 放大对比过，看不出差别。

**为什么每张照片按高度对齐，不按宽度？**
这组有横有竖。按宽度铺满的话竖构图会大得离谱、横构图显得小气。
限制高度让宽度自然生长，横竖片视觉重量才相等——画廊挂画就是这么对齐的。

**照片会不会泄露我家地址？**
不会。原图里本来就没有 GPS 信息，而且构建时会把所有 EXIF 元数据剥掉，
只保留网页显示需要的那几项（时间、光圈、快门、ISO），那几项是写进 HTML 的文字，
不是藏在图片文件里的。

**以后作品多了，仓库会不会太大？**
一期 9 张约 27 MB。GitHub 单个仓库建议不超过 1 GB，也就是大约 35 期。
真到那一天有两个办法：在 `site/build.py` 里把 `WIDTHS` 去掉 3200 那档（省一半），
或者干脆精选 10–15 期——招生官不会看 68 期，精选比全堆上去有效得多。
