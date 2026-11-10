# 变更记录

## v1.3.0 · 2026-11-10

首个开源版本。相对 v1.2.0（源码基线）的主要改动：

### 新增模块
- `www/js/wm-core.js` — 水印渲染引擎。纯函数，不依赖 DOM 之外的任何东西；样式从 6 种扩到 8 种（新增「标签」「印章」），并把尺寸体系改为「以 1080px 宽为基准等比缩放」，1080p / 12MP / 缩略图共用一套代码。
- `www/js/exif-write.js` — 标准 EXIF 写入器。生成 APP1/Exif 段，含 IFD0 / Exif IFD / GPS IFD 三层结构。
- `tests/` — 三套自动化测试（EXIF 往返 11 项、排版自检 216 组、端到端拍摄 14 项）。
- `tools/preview.html` — 水印样式预览台，8 种样式 × 亮/暗底图一次看完。
- `build/build_apk.py` + `build/SignApk.java` — 不依赖 Android SDK 的重打包与签名工具。

### 拍摄算法
- 取图优先 `ImageCapture.takePhoto()` 拿原生满幅照片，失败才退预览帧。
- 预览帧路径改为「连取 3 帧 + 拉普拉斯方差择优」，抵消手抖和虚焦导致的糊片。
- 新增 `composeCanvas()`：把「预览所见」与「成片所得」统一到同一个 source rect 计算，修掉前置镜像、变焦裁切、比例裁切三者叠加时的错位。
- 高画质模式预览请求 2560×1920，成片宽上限 4096px。

### 水印
- 自动取色：采样水印区域亮度，浅色画面用深色墨水、深色画面用白字（原来固定白字，拍雪地/白墙看不见）。
- 位置支持左下 / 右下 / 顶部；字号三档。
- 自定义字段：最多 8 条，`标签：内容` 格式。
- 内容高于画布时自动等比收缩，不再溢出画面。

### 信息与凭证
- 成片写入标准 EXIF：`DateTimeOriginal`、`GPSLatitude/Longitude`（度分秒）、`GPSAltitude`、`GPSTimeStamp`（UTC）、`Make`、`Model`、`Software`、`ImageDescription`。
- 中文走 `UserComment`（UNICODE 前缀 + UTF-16LE）与 `XPTitle`/`XPComment`，系统相册与资源管理器可读。
- 签名段追加 `dev.ver`；验签逻辑不变，向后兼容 v1.2 生成的照片。

### 相机
- 触控对焦（`pointsOfInterest` + `single-shot` 回退）、双指缩放（优先传感器变焦，退裁切）、补光灯、曝光补偿。
- 九宫格、水平仪、定时拍摄（3s / 10s）。

### 交互
- 新增图库面板：本次拍摄历史、批量保存、从相册导入。
- 预览页支持「改水印」：直接用上一张的原图重出水印，不必重拍。
- 设置项分组重排，持久化键升级到 `wmc.settings.v3`（兼容读取 v1/v2）。

### 修复
- **启动图标不再是方图**：原来 `ic_launcher.png` 是 192×192 的不透明方图（无 alpha、四角实色），
  Android 12+ 的系统启动画面把它居中一放，就成了深色屏幕上的一块方块。改为 432×432、
  圆角透明四角，启动画面与桌面图标都干净了。
- `js/exif.js`：`PixelXDimension`/`PixelYDimension` 属 Exif 子 IFD，原实现只在 IFD0 查找，导致读不到图片尺寸。现在两处都看。
- 预览层「重试」按钮被 `.btn-primary{flex:1}` 拉成整列竖条。
- `.tool` 的 `display:inline-flex` 覆盖了 `hidden` 属性，导致不支持的补光灯/曝光控件仍然显示。
- 「改水印」会在已带水印的画布上重复叠加，连点两次就是两层水印。

### 体积
- APK 从基线 337 KB 降到 **108 KB**（图标从 150 KB 优化到 15 KB，其余为前端资源）。

## v1.2.0 · 基线

来自原始 APK（`versionCode 3`）的资源导出，含 6 种水印样式、物理镜头识别、GCJ-02 坐标转换、签名与验真页。作为 git 的第一个提交（`chore: 导入 baseline`）。
