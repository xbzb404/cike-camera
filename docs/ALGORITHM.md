# 算法依据

这份文档回答一个问题：**为什么这么改，而不是拍脑袋调参数。**

每条都对应实测数据或代码位置，便于复查。所有论文均在文末列出出处。

---

## 一、先量化问题

同一台设备（HONOR PPG-AN00），同一时刻，软件出片与原生相机的差距：

| 指标 | 原生相机 | 软件出片 | 说明 |
|---|---|---|---|
| 分辨率 | 3072×4096（12.6MP）| 1920×2558（4.9MP）| 走了预览流，不是原生成像 |
| 亮度均值 | 133.1 | 105.2 | 偏暗 |
| 亮度标准差 | 67.6 | 41.9 | **对比度只有原生的 62%** |
| P1 / P98 | 23 / 223 | 29 / 144 | 高光顶不上去 |
| 通道均值 R/G/B | 133/134/130 | 98/108/111 | 蓝偏高，整幅发灰 |

**结论：所谓「发白」，实测是「动态范围被压缩 + 直方图挤在中间」。**

P75 到 P95 全都落在 144 附近 —— 20% 的像素堆在同一个亮度上。这不是颜色问题，是对比度问题。

更关键的是上一版的补救思路错了：用 `brightness(0.8)` 全局压暗，P99 从 218 掉到 174，
**动态范围反而从 203 缩到 162**。乘法只会等比压扁，不会拉开层次。

---

## 二、18 篇文献，以及它们各自解决了什么

### A. 手机成像管线（决定「从哪拿图」）

**1. Hasinoff et al., 2016 — HDR+**
*Burst photography for HDR and low-light imaging on mobile cameras*, ACM TOG 35(6):192

最早系统说明手机该怎么成像的工作。三个结论直接指导了本次改动：

- 手机传感器小、像素小，单帧信噪比和动态范围都不够，必须**多帧合并**；
- 合并要在 **ISP 处理之前的 RAW 域**做，绕开厂商那套不想要的色调映射和降噪；
- 合并完再套标准 tone mapping，而 tone mapping 的关键是**黑场白场各自归位**，不是整体乘系数。

> 对应实现：`www/js/tone.js` 的 `buildLut()` 拆成三段——黑场归位、中位锚定、高光软膝。
> 这正是「各自归位而不是整体乘系数」的直接落地。

**2. Wronski et al., 2019 — Handheld MFSR**
*Handheld Multi-Frame Super-Resolution*, ACM TOG 38(4):28

利用手持抖动造成的亚像素位移做多帧超分，同时提升分辨率和信噪比，
12MP 一帧只要 100ms。它证明了「手持抖不是纯坏事，是信息源」。

> 对应实现：`www/js/imgproc.js` 的 `selectBest()` 用多帧择优，但只做到了「挑最好的一帧」，
> 没有做像素级对齐合并。这是当前与 HDR+ 差距最大的一环，见文末「未做」。

**3. Mildenhall et al., 2018 — Burst Denoising with KPN**
*Burst Denoising with Kernel Prediction Networks*, CVPR 2018

指出**简单平均在运动场景会糊**（图 a 清晰但噪，图 b 平均后噪少但糊），
要用空间变化的核同时完成对齐和降噪。

> 对应实现：无。我们只有 3 帧、且不保证静止，贸然平均会出鬼影。
> 这条直接否决了「多帧平均降噪」的偷懒方案。

**4. Delbracio et al., 2021 — Mobile Computational Photography: A Tour**
*Annu Rev Vis Sci* 7:571–604

综述。核心提示：现代手机画质提升的绝大部分来自**计算摄影管线**而非光学。
换句话说，WebView 拿到的预览流天生就缺了这一整层，靠后处理补是有上限的。

> 对应实现：这是给「不要过度承诺」的判断依据。后处理能修色调，修不出没有的细节。

### B. 影调映射（决定「画面通透不通透」）

**5. Mertens et al., 2009 — Exposure Fusion**
*Computer Graphics Forum* 28(1):161–171

不用先做 HDR 再 tone map，而是直接按「饱和度 + 对比度」的质量权重融合多曝光。
关键概念：**局部对比度本身就是画质的一部分**，不是主观偏好。

> 对应实现：`buildLut()` 里 `contrast` 参数（默认 0.32）的 S 曲线，
> 以及 `analyze()` 输出的分位数，都是从「对比度作为质量指标」这个立场来的。

**6. Debevec & Malik, 1997 — 恢复 HDR 辐照度**
*SIGGRAPH '97*

相机响应曲线标定的经典工作。它说明**非线性响应会吃掉动态范围**，
任何色调操作都应该在已知响应曲线上做，而不是盲乘。

> 对应实现：我们没有响应曲线（WebView 不给），所以退而求其次——
> 用实测分位数（P1/P50/P98/P99.5）反推当前画面的实际可用区间。这是「不用标定也能归位」的工程折中。

**7. Pizer et al., 1987 — AHE 及其变体**
*Adaptive Histogram Equalization and its Variations*, CVGIP 39:355–368

自适应直方图均衡的源头。结论是**全局均衡不够，局部才有用**，
但局部会放大噪声 —— 于是有了下面的 CLAHE。

**8. Zuiderveld, 1994 — CLAHE**
*Graphics Gems IV*, Chapter VIII.5

给 AHE 加对比度上限（clip limit），避免平坦区域噪声被拉爆。
这是医学影像和相机 ISP 里最常用的对比增强。

**9. Reza, 2004 — CLAHE 的实时实现**
*J VLSI Signal Processing* 38(1):35–44

给出了 CLAHE 可行的工程结构（分块 + 双线性插值 + 限幅），
证明它在实时管线里跑得动。

> 对应实现：**没有直接上 CLAHE**，原因有二。
> 一是 12MP 画布上做分块直方图，JS 里约 400–700ms，用户已经在抱怨卡；
> 二是视频流噪声本来就大，局部增强会放大噪点（这正是 Zuiderveld 的 clip limit 要压制的东西）。
> 所以先用全局 LUT 解决 90% 的问题，CLAHE 留作可选档，见文末。

### C. 白平衡（决定「会不会越修越灰」）

**10. Buchsbaum, 1980 — 灰世界**
*A spatial processor model for object colour perception*, J Franklin Inst 310(1):1–26

假设场景颜色足够丰富、全图 RGB 均值应为中性。**这个假设在单色场景必然失效。**

> 这一条是本轮最重要的教训。
> 上一版用灰世界做白平衡，结果把青色笔记本的机身当成了「蓝色偏」，强行拉回中性，
> 通道偏差从 13 降到 4 —— 数字好看，画面却更灰了。
> 实测新方案（白点法）在同类场景下增益保持 1.00/1.00/1.00，青色机身得以保留。

**11. Land, 1977 — Retinex 理论**
*The Retinex Theory of Color Vision*, Scientific American 237:108–129

人眼色彩恒常性的经典模型。它的意义在于说明**「白」不是由全图平均定义的**，
而是由场景中最亮的反射面定义的。

> 对应实现：`grayGains()` 改用**高光区（≥P95）的通道均值**作为白点参考。
> 全图均值会被大面积同色物体带偏，高光区最接近光源本色。

**12. Jobson, Rahman & Woodell, 1997 — MSRCR**
*Multi-Scale Retinex with Color Restoration*, IEEE TIP 6(7):965–976

多尺度 Retinex + 色彩恢复因子，解决 SSR 的色偏和光晕。

> 对应实现：未采用。Retinex 会显著提升暗部，而我们的问题恰恰是**暗部已经不暗、整体被抬平**。
> 用错方向的算法比不用更糟。

**13. Guo, Li & Ling, 2017 — LIME**
*Low-Light Image Enhancement via Illumination Map Estimation*, IEEE TIP 26(2):982–993

只估计光照图、用最大值通道作为初值，比完整 Retinex 分解便宜得多。

> 对应实现：未采用，理由同上。但它「只估一个分量、降低求解空间」的思路，
> 影响了我们只做**一维亮度 LUT + 三通道独立增益**的轻量结构。

### D. 滤波与锐化（决定「清晰度能不能再要一点」）

**14. He, Sun & Tang, 2013 — Guided Filter**
*Guided Image Filtering*, TPAMI 35(6):1397–1409

O(N) 边缘保持滤波，不随核大小增长，且没有双边滤波的梯度反转伪影。
是 HDR 压缩、去雾、detail enhancement 的通用底座。

**15. Tomasi & Manduchi, 1998 — 双边滤波**
*Bilateral Filtering for Gray and Color Images*, ICCV

边缘保持平滑的经典。缺点是慢，且近边缘会有梯度反转。

**16. Durand & Dorsey, 2002 — 快速双边滤波做 HDR 显示**
*Fast Bilateral Filtering for the Display of HDR Images*, ACM TOG 21(3):257–266

把图像分解成 base + detail，只压 base 的动态范围，detail 原样保留 ——
**这就是「压高光不压细节」的正确姿势**，也是我们高光软膝那段的理论来源。

> 对应实现：`buildLut()` 的 knee 段用指数软膝而非硬截断，避免高光断层。
> 完整的 base/detail 分离版本见文末「未做」，主要卡在性能。

**17. Pertuz, Puig & Garcia, 2013 — 对焦评价算子对比**
*Analysis of focus measure operators for shape-from-focus*, Pattern Recognition 46(5):1415–1432

横评了 Laplacian、Tenengrad、Brenner 等算子在不同噪声、对比度、饱和下的表现。
重要结论：**Laplacian 类算子对亮度敏感**，亮场景方差天然更高。

> 对应实现：这解释了为什么上一版「选最清晰的那帧」总是选到过曝帧 ——
> 过曝帧的高光边缘梯度大，方差反而更高。
> 现在 `selectBest()` 用 `score × (1 - 3×blown)` 把高光溢出折算进总分。

**18. Kheradmand & Milanfar, 2015 — 结构感知锐化**
*Non-Linear Structure-Aware Image Sharpening with Difference of Smoothing Operators*, Frontiers ICT

传统 USM 会同时放大噪声并产生光晕，应改用内容自适应的增益，
并在 YCbCr 的亮度通道上做以避免伪色。

> 对应实现：未启用锐化。视频流噪声本来就重，锐化会把噪点一起放大。
> 这是「不做」而不是「没想到」。

---

## 三、最终落地的算法链

```
取图        takePhoto（原生满幅）
             └ 失败/严重过曝才降级到视频帧
构图        coverRect：按取景比例裁切，不做数字变焦
影调        analyze   → P1/P50/P95/P98/P99.5 + 高光区 RGB 均值 + 通道均值
            buildLut  → 黑场归位 → 伽马锚定中位到 0.46 → S 曲线 → 高光软膝
            applyLut  → 三通道 8bit 查表，无浮点
白平衡      白点法：以 ≥P95 的高光区均值估计光源色，限幅 ±10%，3% 内不动
水印        wm-core：8 样式，字号随画布宽度等比缩放
签名        sha256 → ECDSA P-256 → APP15 段
```

实测（同一张照片，同一套代码）：

| 指标 | 原生 | 处理前 | 处理后 |
|---|---|---|---|
| 标准差 | 67.6 | 41.9（62%）| **69.7（103%）** |
| 动态范围 | 214 | 219 | **250** |
| P98 | 223 | 144 | **184** |
| 通道偏差 | 4 | 13 | 13（不再误校正）|

对比度越过原生，是因为原生那台机器自己的降噪把细节抹平了一些；
通道偏差保持不变，是因为青色机身本来就是青色，不该被当色偏修掉。

---

## 四、明确没做的，以及为什么

诚实比完整重要。

| 方案 | 为什么暂不做 |
|---|---|
| **多帧对齐合并（HDR+ / MFSR）** | 需要像素级配准。JS 里对 12MP 做金字塔配准 + 合并约 1–2s，且手抖大会出鬼影。收益最大，但要做就得上 WASM/WebGL，是一整个工程。 |
| **CLAHE 局部对比** | 400–700ms 且放大噪声。当前全局 LUT 已把对比度拉到原生水平，边际收益低。 |
| **base/detail 分离（Durand）** | Guided filter 在 12MP 上约 600ms。可以做，但要等性能预算。 |
| **USM 锐化** | 视频流噪声重，锐化 = 放大噪点。宁可不做。 |
| **Retinex / LIME** | 方向不对：它们解决「太暗」，我们的问题是「太平」。 |

---

## 五、参考文献

1. Hasinoff, S. W., Sharlet, D., Geiss, R., Adams, A., Barron, J. T., Kainz, F., Chen, J., & Levoy, M. (2016). Burst photography for high dynamic range and low-light imaging on mobile cameras. *ACM Transactions on Graphics*, 35(6), 192. https://doi.org/10.1145/2980179.2980254
2. Wronski, B., Garcia-Dorado, I., Ernst, M., Kelly, D., Krainin, M., Liang, C.-K., Levoy, M., & Milanfar, P. (2019). Handheld multi-frame super-resolution. *ACM Transactions on Graphics*, 38(4), 28. https://doi.org/10.1145/3306346.3323024
3. Mildenhall, B., Barron, J. T., Chen, J., Sharlet, D., Ng, R., & Carroll, R. (2018). Burst denoising with kernel prediction networks. *CVPR 2018*.
4. Delbracio, M., Kelly, D., Brown, M. S., & Milanfar, P. (2021). Mobile computational photography: A tour. *Annual Review of Vision Science*, 7, 571–604. https://doi.org/10.1146/annurev-vision-093019-115521
5. Mertens, T., Kautz, J., & Van Reeth, F. (2009). Exposure fusion: A simple and practical alternative to high dynamic range photography. *Computer Graphics Forum*, 28(1), 161–171. https://doi.org/10.1111/j.1467-8659.2008.01171.x
6. Debevec, P. E., & Malik, J. (1997). Recovering high dynamic range radiance maps from photographs. *SIGGRAPH '97*, 369–378.
7. Pizer, S. M., Amburn, E. P., Austin, J. D., Cromartie, R., Geselowitz, A., Greer, T., ter Haar Romeny, B. M., Zimmerman, J. B., & Zuiderveld, K. (1987). Adaptive histogram equalization and its variations. *Computer Vision, Graphics, and Image Processing*, 39(3), 355–368.
8. Zuiderveld, K. (1994). Contrast limited adaptive histogram equalization. In P. S. Heckbert (Ed.), *Graphics Gems IV* (pp. 474–485). Academic Press.
9. Reza, A. M. (2004). Realization of the contrast limited adaptive histogram equalization (CLAHE) for real-time image enhancement. *Journal of VLSI Signal Processing Systems*, 38(1), 35–44. https://doi.org/10.1023/B:VLSI.0000028532.53893.82
10. Buchsbaum, G. (1980). A spatial processor model for object colour perception. *Journal of the Franklin Institute*, 310(1), 1–26.
11. Land, E. H. (1977). The Retinex theory of color vision. *Scientific American*, 237(6), 108–129.
12. Jobson, D. J., Rahman, Z., & Woodell, G. A. (1997). A multiscale retinex for bridging the gap between color images and the human observation of scenes. *IEEE Transactions on Image Processing*, 6(7), 965–976.
13. Guo, X., Li, Y., & Ling, H. (2017). LIME: Low-light image enhancement via illumination map estimation. *IEEE Transactions on Image Processing*, 26(2), 982–993.
14. He, K., Sun, J., & Tang, X. (2013). Guided image filtering. *IEEE Transactions on Pattern Analysis and Machine Intelligence*, 35(6), 1397–1409. https://doi.org/10.1109/TPAMI.2012.213
15. Tomasi, C., & Manduchi, R. (1998). Bilateral filtering for gray and color images. *ICCV 1998*, 839–846.
16. Durand, F., & Dorsey, J. (2002). Fast bilateral filtering for the display of high-dynamic-range images. *ACM Transactions on Graphics*, 21(3), 257–266.
17. Pertuz, S., Puig, D., & Garcia, M. A. (2013). Analysis of focus measure operators for shape-from-focus. *Pattern Recognition*, 46(5), 1415–1432. https://doi.org/10.1016/j.patcog.2012.11.011
18. Kheradmand, A., & Milanfar, P. (2015). Non-linear structure-aware image sharpening with difference of smoothing operators. *Frontiers in ICT*, 2, 22.
