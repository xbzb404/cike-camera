.class Lcom/wmc/camera/MainActivity$Chrome;
.super Landroid/webkit/WebChromeClient;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lcom/wmc/camera/MainActivity;
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x2
    name = "Chrome"
.end annotation


# instance fields
.field final synthetic this$0:Lcom/wmc/camera/MainActivity;


# direct methods
.method private constructor <init>(Lcom/wmc/camera/MainActivity;)V
    .registers 2

    .line 197
    iput-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V

    return-void
.end method

.method synthetic constructor <init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$Chrome-IA;)V
    .registers 3

    invoke-direct {p0, p1}, Lcom/wmc/camera/MainActivity$Chrome;-><init>(Lcom/wmc/camera/MainActivity;)V

    return-void
.end method


# virtual methods
.method synthetic lambda$onPermissionRequest$0$com-wmc-camera-MainActivity$Chrome()V
    .registers 4

    .line 209
    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    const-string v1, "\u76f8\u673a\u88ab\u62d2\u7edd\uff1a\u8bf7\u5728\u7cfb\u7edf\u8bbe\u7f6e\u91cc\u5141\u8bb8\u672c\u5e94\u7528\u4f7f\u7528\u76f8\u673a"

    const/4 v2, 0x1

    invoke-static {v0, v1, v2}, Landroid/widget/Toast;->makeText(Landroid/content/Context;Ljava/lang/CharSequence;I)Landroid/widget/Toast;

    move-result-object v0

    .line 210
    invoke-virtual {v0}, Landroid/widget/Toast;->show()V

    .line 209
    return-void
.end method

.method synthetic lambda$onPermissionRequest$1$com-wmc-camera-MainActivity$Chrome(Landroid/webkit/PermissionRequest;)V
    .registers 8

    .line 201
    nop

    .line 202
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->getResources()[Ljava/lang/String;

    move-result-object v0

    array-length v1, v0

    const/4 v2, 0x0

    move v3, v2

    :goto_8
    if-ge v2, v1, :cond_18

    aget-object v4, v0, v2

    .line 203
    const-string v5, "android.webkit.resource.VIDEO_CAPTURE"

    invoke-virtual {v5, v4}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v4

    if-eqz v4, :cond_15

    const/4 v3, 0x1

    .line 202
    :cond_15
    add-int/lit8 v2, v2, 0x1

    goto :goto_8

    .line 205
    :cond_18
    if-eqz v3, :cond_2c

    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    const-string v1, "android.permission.CAMERA"

    invoke-virtual {v0, v1}, Lcom/wmc/camera/MainActivity;->checkSelfPermission(Ljava/lang/String;)I

    move-result v0

    if-nez v0, :cond_2c

    .line 206
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->getResources()[Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p1, v0}, Landroid/webkit/PermissionRequest;->grant([Ljava/lang/String;)V

    goto :goto_39

    .line 208
    :cond_2c
    invoke-virtual {p1}, Landroid/webkit/PermissionRequest;->deny()V

    .line 209
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    new-instance v0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda0;

    invoke-direct {v0, p0}, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda0;-><init>(Lcom/wmc/camera/MainActivity$Chrome;)V

    invoke-virtual {p1, v0}, Lcom/wmc/camera/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    .line 212
    :goto_39
    return-void
.end method

.method public onGeolocationPermissionsShowPrompt(Ljava/lang/String;Landroid/webkit/GeolocationPermissions$Callback;)V
    .registers 5

    .line 217
    const/4 v0, 0x1

    const/4 v1, 0x0

    invoke-interface {p2, p1, v0, v1}, Landroid/webkit/GeolocationPermissions$Callback;->invoke(Ljava/lang/String;ZZ)V

    .line 218
    return-void
.end method

.method public onPermissionRequest(Landroid/webkit/PermissionRequest;)V
    .registers 4

    .line 200
    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    new-instance v1, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;

    invoke-direct {v1, p0, p1}, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;-><init>(Lcom/wmc/camera/MainActivity$Chrome;Landroid/webkit/PermissionRequest;)V

    invoke-virtual {v0, v1}, Lcom/wmc/camera/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    .line 213
    return-void
.end method

.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .registers 5
    .annotation system Ldalvik/annotation/Signature;
        value = {
            "(",
            "Landroid/webkit/WebView;",
            "Landroid/webkit/ValueCallback<",
            "[",
            "Landroid/net/Uri;",
            ">;",
            "Landroid/webkit/WebChromeClient$FileChooserParams;",
            ")Z"
        }
    .end annotation

    .line 222
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-static {p1}, Lcom/wmc/camera/MainActivity;->-$$Nest$fgetpendingFileCallback(Lcom/wmc/camera/MainActivity;)Landroid/webkit/ValueCallback;

    move-result-object p1

    const/4 v0, 0x0

    if-eqz p1, :cond_17

    .line 223
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-static {p1}, Lcom/wmc/camera/MainActivity;->-$$Nest$fgetpendingFileCallback(Lcom/wmc/camera/MainActivity;)Landroid/webkit/ValueCallback;

    move-result-object p1

    invoke-interface {p1, v0}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    .line 224
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-static {p1, v0}, Lcom/wmc/camera/MainActivity;->-$$Nest$fputpendingFileCallback(Lcom/wmc/camera/MainActivity;Landroid/webkit/ValueCallback;)V

    .line 226
    :cond_17
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-static {p1, p2}, Lcom/wmc/camera/MainActivity;->-$$Nest$fputpendingFileCallback(Lcom/wmc/camera/MainActivity;Landroid/webkit/ValueCallback;)V

    .line 228
    :try_start_1c
    invoke-virtual {p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->createIntent()Landroid/content/Intent;

    move-result-object p1

    .line 229
    const-string p2, "android.intent.category.OPENABLE"

    invoke-virtual {p1, p2}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;

    .line 230
    iget-object p2, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    const/16 p3, 0x3e9

    invoke-virtual {p2, p1, p3}, Lcom/wmc/camera/MainActivity;->startActivityForResult(Landroid/content/Intent;I)V
    :try_end_2c
    .catch Ljava/lang/Exception; {:try_start_1c .. :try_end_2c} :catch_2e

    .line 231
    const/4 p1, 0x1

    return p1

    .line 232
    :catch_2e
    move-exception p1

    .line 233
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-static {p1, v0}, Lcom/wmc/camera/MainActivity;->-$$Nest$fputpendingFileCallback(Lcom/wmc/camera/MainActivity;Landroid/webkit/ValueCallback;)V

    .line 234
    const/4 p1, 0x0

    return p1
.end method
