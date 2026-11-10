.class public Lcom/wmc/camera/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/MemberClasses;
    value = {
        Lcom/wmc/camera/MainActivity$Bridge;,
        Lcom/wmc/camera/MainActivity$LocalClient;,
        Lcom/wmc/camera/MainActivity$Chrome;
    }
.end annotation


# static fields
.field private static final BASE:Ljava/lang/String; = "https://appassets.androidplatform.net/"

.field private static final HOST:Ljava/lang/String; = "appassets.androidplatform.net"

.field private static final REQ_FILE:I = 0x3e9

.field private static final REQ_PERM:I = 0x3ea


# instance fields
.field private pageLoaded:Z

.field private pendingFileCallback:Landroid/webkit/ValueCallback;
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "Landroid/webkit/ValueCallback<",
            "[",
            "Landroid/net/Uri;",
            ">;"
        }
    .end annotation
.end field

.field private web:Landroid/webkit/WebView;


# direct methods
.method public static synthetic $r8$lambda$tROrIVOOLM3VGUN_fyVtCa3jtFA(Lcom/wmc/camera/MainActivity;)V
    .registers 1

    invoke-direct {p0}, Lcom/wmc/camera/MainActivity;->loadPage()V

    return-void
.end method

.method static bridge synthetic -$$Nest$fgetpendingFileCallback(Lcom/wmc/camera/MainActivity;)Landroid/webkit/ValueCallback;
    .registers 1

    iget-object p0, p0, Lcom/wmc/camera/MainActivity;->pendingFileCallback:Landroid/webkit/ValueCallback;

    return-object p0
.end method

.method static bridge synthetic -$$Nest$fputpendingFileCallback(Lcom/wmc/camera/MainActivity;Landroid/webkit/ValueCallback;)V
    .registers 2

    iput-object p1, p0, Lcom/wmc/camera/MainActivity;->pendingFileCallback:Landroid/webkit/ValueCallback;

    return-void
.end method

.method static bridge synthetic -$$Nest$smmime(Ljava/lang/String;)Ljava/lang/String;
    .registers 1

    invoke-static {p0}, Lcom/wmc/camera/MainActivity;->mime(Ljava/lang/String;)Ljava/lang/String;

    move-result-object p0

    return-object p0
.end method

.method public constructor <init>()V
    .registers 2

    .line 46
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    .line 55
    const/4 v0, 0x0

    iput-boolean v0, p0, Lcom/wmc/camera/MainActivity;->pageLoaded:Z

    return-void
.end method

.method static synthetic lambda$onCreate$0(Landroid/view/View;)Z
    .registers 1

    .line 95
    const/4 p0, 0x1

    return p0
.end method

.method private loadPage()V
    .registers 3

    .line 135
    iget-boolean v0, p0, Lcom/wmc/camera/MainActivity;->pageLoaded:Z

    if-eqz v0, :cond_5

    return-void

    .line 136
    :cond_5
    const/4 v0, 0x1

    iput-boolean v0, p0, Lcom/wmc/camera/MainActivity;->pageLoaded:Z

    .line 137
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    const-string v1, "https://appassets.androidplatform.net/index.html"

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    .line 138
    return-void
.end method

.method private static mime(Ljava/lang/String;)Ljava/lang/String;
    .registers 2

    .line 181
    invoke-virtual {p0}, Ljava/lang/String;->toLowerCase()Ljava/lang/String;

    move-result-object p0

    .line 182
    const-string v0, ".html"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-nez v0, :cond_97

    const-string v0, ".htm"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_16

    goto/16 :goto_97

    .line 183
    :cond_16
    const-string v0, ".css"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_21

    const-string p0, "text/css"

    return-object p0

    .line 184
    :cond_21
    const-string v0, ".js"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-nez v0, :cond_94

    const-string v0, ".mjs"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_32

    goto :goto_94

    .line 185
    :cond_32
    const-string v0, ".json"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-nez v0, :cond_91

    const-string v0, ".webmanifest"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_43

    goto :goto_91

    .line 186
    :cond_43
    const-string v0, ".svg"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_4e

    const-string p0, "image/svg+xml"

    return-object p0

    .line 187
    :cond_4e
    const-string v0, ".png"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_59

    const-string p0, "image/png"

    return-object p0

    .line 188
    :cond_59
    const-string v0, ".jpg"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-nez v0, :cond_8e

    const-string v0, ".jpeg"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_6a

    goto :goto_8e

    .line 189
    :cond_6a
    const-string v0, ".webp"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_75

    const-string p0, "image/webp"

    return-object p0

    .line 190
    :cond_75
    const-string v0, ".ico"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result v0

    if-eqz v0, :cond_80

    const-string p0, "image/x-icon"

    return-object p0

    .line 191
    :cond_80
    const-string v0, ".woff2"

    invoke-virtual {p0, v0}, Ljava/lang/String;->endsWith(Ljava/lang/String;)Z

    move-result p0

    if-eqz p0, :cond_8b

    const-string p0, "font/woff2"

    return-object p0

    .line 192
    :cond_8b
    const-string p0, "application/octet-stream"

    return-object p0

    .line 188
    :cond_8e
    :goto_8e
    const-string p0, "image/jpeg"

    return-object p0

    .line 185
    :cond_91
    :goto_91
    const-string p0, "application/json"

    return-object p0

    .line 184
    :cond_94
    :goto_94
    const-string p0, "application/javascript"

    return-object p0

    .line 182
    :cond_97
    :goto_97
    const-string p0, "text/html"

    return-object p0
.end method

.method private requestPermsThenLoad()V
    .registers 5

    .line 105
    new-instance v0, Ljava/util/ArrayList;

    invoke-direct {v0}, Ljava/util/ArrayList;-><init>()V

    .line 106
    const-string v1, "android.permission.CAMERA"

    invoke-virtual {p0, v1}, Lcom/wmc/camera/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v2

    if-eqz v2, :cond_10

    .line 107
    invoke-interface {v0, v1}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    .line 109
    :cond_10
    const-string v1, "android.permission.ACCESS_FINE_LOCATION"

    invoke-virtual {p0, v1}, Lcom/wmc/camera/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v2

    if-eqz v2, :cond_1b

    .line 110
    invoke-interface {v0, v1}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    .line 112
    :cond_1b
    const-string v1, "android.permission.ACCESS_COARSE_LOCATION"

    invoke-virtual {p0, v1}, Lcom/wmc/camera/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v2

    if-eqz v2, :cond_26

    .line 113
    invoke-interface {v0, v1}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    .line 115
    :cond_26
    sget v1, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v2, 0x1c

    if-gt v1, v2, :cond_37

    .line 116
    const-string v1, "android.permission.WRITE_EXTERNAL_STORAGE"

    invoke-virtual {p0, v1}, Lcom/wmc/camera/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v2

    if-eqz v2, :cond_37

    .line 117
    invoke-interface {v0, v1}, Ljava/util/List;->add(Ljava/lang/Object;)Z

    .line 119
    :cond_37
    invoke-interface {v0}, Ljava/util/List;->isEmpty()Z

    move-result v1

    if-eqz v1, :cond_41

    .line 120
    invoke-direct {p0}, Lcom/wmc/camera/MainActivity;->loadPage()V

    .line 121
    return-void

    .line 123
    :cond_41
    const/4 v1, 0x0

    new-array v1, v1, [Ljava/lang/String;

    invoke-interface {v0, v1}, Ljava/util/List;->toArray([Ljava/lang/Object;)[Ljava/lang/Object;

    move-result-object v0

    check-cast v0, [Ljava/lang/String;

    const/16 v1, 0x3ea

    invoke-virtual {p0, v0, v1}, Lcom/wmc/camera/MainActivity;->requestPermissions([Ljava/lang/String;I)V

    .line 125
    new-instance v0, Landroid/os/Handler;

    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;

    move-result-object v1

    invoke-direct {v0, v1}, Landroid/os/Handler;-><init>(Landroid/os/Looper;)V

    new-instance v1, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda1;

    invoke-direct {v1, p0}, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda1;-><init>(Lcom/wmc/camera/MainActivity;)V

    const-wide/16 v2, 0xbb8

    invoke-virtual {v0, v1, v2, v3}, Landroid/os/Handler;->postDelayed(Ljava/lang/Runnable;J)Z

    .line 126
    return-void
.end method


# virtual methods
.method synthetic lambda$onBackPressed$1$com-wmc-camera-MainActivity(Ljava/lang/String;)V
    .registers 3

    .line 320
    if-eqz p1, :cond_b

    const-string v0, "closed"

    invoke-virtual {p1, v0}, Ljava/lang/String;->contains(Ljava/lang/CharSequence;)Z

    move-result p1

    if-eqz p1, :cond_b

    return-void

    .line 321
    :cond_b
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    if-eqz p1, :cond_1b

    invoke-virtual {p1}, Landroid/webkit/WebView;->canGoBack()Z

    move-result p1

    if-eqz p1, :cond_1b

    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {p1}, Landroid/webkit/WebView;->goBack()V

    goto :goto_1e

    .line 322
    :cond_1b
    invoke-virtual {p0}, Lcom/wmc/camera/MainActivity;->finish()V

    .line 323
    :goto_1e
    return-void
.end method

.method protected onActivityResult(IILandroid/content/Intent;)V
    .registers 7

    .line 241
    const/16 v0, 0x3e9

    if-ne p1, v0, :cond_4a

    .line 242
    nop

    .line 243
    const/4 p1, -0x1

    const/4 v0, 0x0

    if-ne p2, p1, :cond_3f

    if-eqz p3, :cond_3f

    .line 244
    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object p1

    if-eqz p1, :cond_30

    .line 245
    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object p1

    invoke-virtual {p1}, Landroid/content/ClipData;->getItemCount()I

    move-result p1

    .line 246
    new-array p2, p1, [Landroid/net/Uri;

    .line 247
    const/4 v1, 0x0

    :goto_1c
    if-ge v1, p1, :cond_2f

    invoke-virtual {p3}, Landroid/content/Intent;->getClipData()Landroid/content/ClipData;

    move-result-object v2

    invoke-virtual {v2, v1}, Landroid/content/ClipData;->getItemAt(I)Landroid/content/ClipData$Item;

    move-result-object v2

    invoke-virtual {v2}, Landroid/content/ClipData$Item;->getUri()Landroid/net/Uri;

    move-result-object v2

    aput-object v2, p2, v1

    add-int/lit8 v1, v1, 0x1

    goto :goto_1c

    .line 248
    :cond_2f
    goto :goto_40

    :cond_30
    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object p1

    if-eqz p1, :cond_3f

    .line 249
    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;

    move-result-object p1

    filled-new-array {p1}, [Landroid/net/Uri;

    move-result-object p2

    goto :goto_40

    .line 252
    :cond_3f
    move-object p2, v0

    :goto_40
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->pendingFileCallback:Landroid/webkit/ValueCallback;

    if-eqz p1, :cond_49

    .line 253
    invoke-interface {p1, p2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 254
    iput-object v0, p0, Lcom/wmc/camera/MainActivity;->pendingFileCallback:Landroid/webkit/ValueCallback;

    .line 256
    :cond_49
    return-void

    .line 258
    :cond_4a
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V

    .line 259
    return-void
.end method

.method public onBackPressed()V
    .registers 4

    .line 308
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v1, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda0;

    invoke-direct {v1, p0}, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda0;-><init>(Lcom/wmc/camera/MainActivity;)V

    const-string v2, "(function(){try{var p=document.getElementById(\'preview\');if(p&&p.classList.contains(\'show\')){var b=document.getElementById(\'btnRetake\');if(b){b.click();return \'closed\';}}var sh=document.getElementById(\'sheet\');if(sh&&sh.classList.contains(\'show\')){var d=document.getElementById(\'btnDone\');if(d){d.click();return \'closed\';}}var st=document.getElementById(\'styleSheet\');if(st&&st.classList.contains(\'show\')){var sd=document.getElementById(\'btnStyleDone\');if(sd){sd.click();return \'closed\';}}}catch(e){}return \'exit\';})()"

    invoke-virtual {v0, v2, v1}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    .line 324
    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 7

    .line 60
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    .line 61
    # 沉浸式：把系统状态栏（顶部那条时间 / 通知图标）收起来。
    # FLAG_FULLSCREEN = 0x400。相机类应用不该让状态栏常驻，
    # 横屏时它还要占掉一条高度；这里在 setContentView 之前就挂上，
    # WebView 从一开始就拿到整屏，不会先排一遍再被挤一下。
    invoke-virtual {p0}, Lcom/wmc/camera/MainActivity;->getWindow()Landroid/view/Window;

    move-result-object p1

    const/16 v0, 0x400

    invoke-virtual {p1, v0}, Landroid/view/Window;->addFlags(I)V

    .line 62
    new-instance p1, Landroid/widget/FrameLayout;

    invoke-direct {p1, p0}, Landroid/widget/FrameLayout;-><init>(Landroid/content/Context;)V

    .line 63
    const v0, -0xf4f2f0

    invoke-virtual {p1, v0}, Landroid/widget/FrameLayout;->setBackgroundColor(I)V

    .line 64
    new-instance v1, Landroid/webkit/WebView;

    invoke-direct {v1, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    iput-object v1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    .line 65
    invoke-virtual {v1, v0}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    .line 66
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v1, Landroid/widget/FrameLayout$LayoutParams;

    const/4 v2, -0x1

    invoke-direct {v1, v2, v2}, Landroid/widget/FrameLayout$LayoutParams;-><init>(II)V

    invoke-virtual {p1, v0, v1}, Landroid/widget/FrameLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    .line 68
    invoke-virtual {p0, p1}, Lcom/wmc/camera/MainActivity;->setContentView(Landroid/view/View;)V

    .line 70
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {p1}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;

    move-result-object p1

    .line 71
    const/4 v0, 0x1

    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    .line 72
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    .line 73
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V

    .line 74
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setGeolocationEnabled(Z)V

    .line 75
    const/4 v1, 0x0

    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V

    .line 76
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    .line 77
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setAllowContentAccess(Z)V

    .line 78
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setSupportZoom(Z)V

    .line 79
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setBuiltInZoomControls(Z)V

    .line 80
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setDisplayZoomControls(Z)V

    .line 81
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setUseWideViewPort(Z)V

    .line 82
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setLoadWithOverviewMode(Z)V

    .line 83
    const/4 v2, 0x2

    invoke-virtual {p1, v2}, Landroid/webkit/WebSettings;->setCacheMode(I)V

    .line 84
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setJavaScriptCanOpenWindowsAutomatically(Z)V

    .line 85
    nop

    .line 86
    invoke-virtual {p1, v2}, Landroid/webkit/WebSettings;->setMixedContentMode(I)V

    .line 88
    sget v2, Landroid/os/Build$VERSION;->SDK_INT:I

    const/16 v3, 0x1a

    if-lt v2, v3, :cond_66

    .line 89
    invoke-virtual {p1, v1}, Landroid/webkit/WebSettings;->setSafeBrowsingEnabled(Z)V

    .line 92
    :cond_66
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v2, Lcom/wmc/camera/MainActivity$Bridge;

    const/4 v3, 0x0

    invoke-direct {v2, p0, v3}, Lcom/wmc/camera/MainActivity$Bridge;-><init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$Bridge-IA;)V

    const-string v4, "WMCAndroid"

    invoke-virtual {p1, v2, v4}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    .line 93
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v2, Lcom/wmc/camera/MainActivity$LocalClient;

    invoke-direct {v2, p0, v3}, Lcom/wmc/camera/MainActivity$LocalClient;-><init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$LocalClient-IA;)V

    invoke-virtual {p1, v2}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    .line 94
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v2, Lcom/wmc/camera/MainActivity$Chrome;

    invoke-direct {v2, p0, v3}, Lcom/wmc/camera/MainActivity$Chrome;-><init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$Chrome-IA;)V

    invoke-virtual {p1, v2}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    .line 95
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v2, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda2;

    invoke-direct {v2}, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda2;-><init>()V

    invoke-virtual {p1, v2}, Landroid/webkit/WebView;->setOnLongClickListener(Landroid/view/View$OnLongClickListener;)V

    .line 96
    iget-object p1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {p1, v1}, Landroid/webkit/WebView;->setLongClickable(Z)V

    .line 97
    invoke-static {v0}, Landroid/webkit/WebView;->setWebContentsDebuggingEnabled(Z)V

    .line 99
    invoke-direct {p0}, Lcom/wmc/camera/MainActivity;->requestPermsThenLoad()V

    .line 100
    return-void
.end method

.method protected onDestroy()V
    .registers 3

    .line 340
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    if-eqz v0, :cond_19

    .line 341
    invoke-virtual {v0}, Landroid/webkit/WebView;->getParent()Landroid/view/ViewParent;

    move-result-object v0

    check-cast v0, Landroid/view/ViewGroup;

    .line 342
    if-eqz v0, :cond_11

    iget-object v1, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0, v1}, Landroid/view/ViewGroup;->removeView(Landroid/view/View;)V

    .line 343
    :cond_11
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0}, Landroid/webkit/WebView;->destroy()V

    .line 344
    const/4 v0, 0x0

    iput-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    .line 346
    :cond_19
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V

    .line 347
    return-void
.end method

.method protected onPause()V
    .registers 2

    .line 328
    invoke-super {p0}, Landroid/app/Activity;->onPause()V

    .line 329
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    if-eqz v0, :cond_a

    invoke-virtual {v0}, Landroid/webkit/WebView;->onPause()V

    .line 330
    :cond_a
    return-void
.end method

.method public onRequestPermissionsResult(I[Ljava/lang/String;[I)V
    .registers 4

    .line 130
    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onRequestPermissionsResult(I[Ljava/lang/String;[I)V

    .line 131
    const/16 p2, 0x3ea

    if-ne p1, p2, :cond_a

    invoke-direct {p0}, Lcom/wmc/camera/MainActivity;->loadPage()V

    .line 132
    :cond_a
    return-void
.end method

.method protected onResume()V
    .registers 2

    .line 334
    invoke-super {p0}, Landroid/app/Activity;->onResume()V

    .line 335
    iget-object v0, p0, Lcom/wmc/camera/MainActivity;->web:Landroid/webkit/WebView;

    if-eqz v0, :cond_a

    invoke-virtual {v0}, Landroid/webkit/WebView;->onResume()V

    .line 336
    :cond_a
    return-void
.end method
