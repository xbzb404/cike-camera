# 上传到 GitHub 前的清单

本仓库已经完成 git 初始化与分提交，本地无遗留未提交改动（见 `git status`）。
下面只是把「推上去」这一步留给你，因为它需要你的账号授权。

## 一、先登录（只需一次）

```bash
gh auth login
```

按提示选 `GitHub.com` → `HTTPS` → `Login with a web browser`，浏览器里粘贴一次性验证码即可。

确认：

```bash
gh auth status
```

## 二、创建仓库并推送

推荐仓库名 `cike-camera`（包名 `com.wmc.camera`；如果想用中文名，GitHub 也支持，但 URL 会变成百分号编码）。

```bash
cd "E:/AI工程/此刻相机"

# 创建公开仓库并推上去
gh repo create cike-camera --public --source=. --remote=origin --push \
  --description "能自证清白的水印相机：标准 EXIF + ECDSA 签名 + 离线验真（WebView 壳，免 Android SDK 打包）"
```

已有仓库、只想关联的话：

```bash
git remote add origin https://github.com/<你的账号>/cike-camera.git
git branch -M main
git push -u origin main
```

## 三、建议顺手补的元信息

```bash
# 话题标签（提高被搜到的概率）
gh repo edit --add-topic android,camera,watermark,exif,digital-signature,ecdsa,webview,pwa,offline

# 主页
gh repo edit --homepage ""
```

## 四、推之前务必确认

| 检查项 | 说明 |
|---|---|
| `build/wmc.keystore` **没有**入库 | 已写进 `.gitignore`。**这个文件丢了你以后就无法覆盖升级已装的 App**，请单独备份。 |
| `build/.tools/` 没有入库 | 里面是下载的 `apksig.jar` 与编译产物，`git status` 应为空。 |
| `build/*.apk` 没有入库 | 同上；要发布二进制请用 Release 单独上传。 |
| 没有个人信息 | 设置面板里的名称、地点只存在用户设备 localStorage，仓库里没有硬编码。 |
| 没有 Key | 高德 Key 由用户在 App 内自行填写，仓库不含任何密钥。 |

## 五、发布 Release（可选）

```bash
gh release create v1.3.0 "build/此刻相机-1.3.0.apk" \
  --title "此刻相机 v1.3.0" \
  --notes-file docs/CHANGELOG.md
```

注意：Release 里的 APK 必须用你本地这把 `wmc.keystore` 签名，否则老用户无法覆盖安装。

## 六、后续开发流程

```bash
git switch -c feat/your-idea     # 开分支
# 改 www/ 下的代码
node tests/test-exif.js && node tests/test-layout.js
python build/build_apk.py --version N --name X.Y.Z   # 手机装包验收
git commit -m "feat: ..."
git switch main && git merge --no-ff feat/your-idea
```

版本号规则：`www/app.js` 里的 `APP_VERSION`、`build/build_apk.py` 的默认版本、`manifest.json` 的版本三处要一起改。
