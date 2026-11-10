# 同类项目调研与设计取舍

调研时间：2026-11。Star 数取 GitHub Search API 当时的返回值，仅用于说明量级，不作排名。

## 一、看过哪些

| 项目 | Star | 语言 | 它是什么 | 值得借鉴的 | 我们没照搬的 |
|---|---|---|---|---|---|
| [natario1/CameraView](https://github.com/natario1/CameraView) | 5.1k | Java | 高质量 CameraX / Camera2 封装库 | 相机能力探测分三档、手势缩放、对焦与曝光控制的分层设计 | 需要的是一套能直接装的应用，不是一个库；本项目用 WebView 的 `MediaStream` 能力等价实现 |
| [aserbao/AndroidCamera](https://github.com/aserbao/AndroidCamera) | 3.3k | Java | 仿抖音的自定义相机（贴纸、分段录制、裁帧） | 预览与成片的坐标系映射思路 | 体量太大，且核心是录像与特效，与本项目目标不同 |
| [rosuH/EasyWatermark](https://github.com/rosuH/EasyWatermark) | 1.9k | Kotlin | 给敏感照片批量加水印、做隐私处理 | 批量处理、导出后的隐私意识（水印/马赛克） | 它是「事后加水印」，本项目是「拍的时候就把信息固化」 |
| [copicseal/copicseal](https://github.com/copicseal/copicseal) | 325 | TypeScript | 基于 EXIF 的摄影水印工具，模板化 | 模板化的水印引擎、EXIF 优先取信息 | 它是桌面端批处理，本项目要在手机取景器里实时预览水印 |
| [dearDreamWeb/camera-watermark](https://github.com/dearDreamWeb/camera-watermark) | 173 | TypeScript | 「无忧相机水印」网页版 | 网页端拍照加水印的整体链路 | 本项目额外做了签名验真与 EXIF 写入 |
| [toydream525/SiteCam](https://github.com/toydream525/SiteCam) | 15 | Kotlin | 工程现场水印相机（项目 / 巡检 / 导出） | 自定义字段（项目名、标段、工序）这一实用性设计 | 没有采用它的资料归档体系，本项目只做「拍 + 证」 |

另外参考了 `geotagcamera`（Kotlin，GPS 打点相机）、`KA-Camera`（小程序，天气+打卡水印）这类小而完整的产品形态。

## 二、结论：四类能力，我们必须补齐

1. **相机控制**（来自 CameraView / AndroidCamera）
   → 触控对焦、曝光补偿、补光灯、双指变焦、物理多摄识别。只调用 `getUserMedia` 默认参数是拍不出好照片的。

2. **水印引擎要独立、可扩展**（来自 copicseal 的模板思路）
   → 渲染逻辑从业务里抽成纯函数模块 `wm-core.js`，新增样式不动拍摄代码。

3. **EXIF 必须写**（来自 EasyWatermark / copicseal 的共同点）
   → 只把字画在像素上，信息就死在这张图里了；写进 EXIF 才能被别的系统读走。

4. **工程/巡检场景需要自定义字段**（来自 SiteCam）
   → 「项目：XX 标段」「工序：混凝土浇筑」这类字段，比任何花哨样式都重要。

## 三、差异化的部分

多数同类项目止步于「把字画上去」。本项目多做了两层：

- **标准 EXIF**：时间、GPS（度分秒 + 海拔 + UTC）、机型、软件、中文备注，全部按 TIFF/EXIF 规范写入 APP1。
- **数字签名**：图像哈希 + 拍摄信息用 ECDSA P-256 签名，落在 JPEG `APP15` 段；配套离线验真页，能区分「有效 / 被改动 / 伪造 / 签名者未受信」。

## 四、架构取舍：为什么是 WebView 壳

这类应用的界面本质是「一个取景器 + 一层浮层 + 几个设置项」，用原生写要维护两套（Android/iOS），用 WebView 一套就够：

| 方案 | 包体 | 迭代成本 | 相机能力 | 我们的选择 |
|---|---|---|---|---|
| 纯原生 + CameraX | 8–20 MB | 改一行要重新编译 | 最全 | 放弃：太重 |
| 纯网页 PWA | 0 | 改完即生效 | 受限（后台、存储权限） | 部分采用：`www/` 可直接跑 |
| **WebView 壳 + 前端资源** | **~350 KB** | 只改 `assets/www` | `getUserMedia` 覆盖本项目全部需求 | **采用** |

代价也要写清楚：

- `ImageCapture` 在部分定制 WebView 里不可用 → 已做预览帧兜底 + 多帧择优；
- 大尺寸 canvas 在低端机上内存吃紧 → 输出宽上限 4096px；
- WebView 的 `getUserMedia` 拿不到厂商私有相机 API（如某些机型的 RAW / 长曝光）→ 属于能力边界，不做。

## 五、已知不足 / 后续可做

- [ ] 水印位置支持四角自由拖拽
- [ ] 连拍与 HDR 合成（多帧加权）
- [ ] 拍摄历史持久化（IndexedDB）与按项目归档
- [ ] 视频水印（当前只有静态照片）
- [ ] 可信时间戳（TSA）对接，把「设备自签」升级为「第三方背书」
