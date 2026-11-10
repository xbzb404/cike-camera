.class Lcom/wmc/camera/MainActivity$Bridge;
.super Ljava/lang/Object;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lcom/wmc/camera/MainActivity;
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x2
    name = "Bridge"
.end annotation


# instance fields
.field final synthetic this$0:Lcom/wmc/camera/MainActivity;


# direct methods
.method private constructor <init>(Lcom/wmc/camera/MainActivity;)V
    .registers 2

    .line 263
    iput-object p1, p0, Lcom/wmc/camera/MainActivity$Bridge;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method

.method synthetic constructor <init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$Bridge-IA;)V
    .registers 3

    invoke-direct {p0, p1}, Lcom/wmc/camera/MainActivity$Bridge;-><init>(Lcom/wmc/camera/MainActivity;)V

    return-void
.end method


# virtual methods
.method public platform()Ljava/lang/String;
    .registers 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 300
    sget v0, Landroid/os/Build$VERSION;->SDK_INT:I

    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v2, "android-sdk"

    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v1

    invoke-virtual {v1, v0}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    move-result-object v0

    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v0

    return-object v0
.end method

.method public saveImage(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    .registers 9
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 267
    nop

    .line 268
    const/16 v0, 0x2c

    :try_start_3
    invoke-virtual {p1, v0}, Ljava/lang/String;->indexOf(I)I

    move-result v0

    .line 269
    const/4 v1, 0x1

    if-ltz v0, :cond_f

    add-int/2addr v0, v1

    invoke-virtual {p1, v0}, Ljava/lang/String;->substring(I)Ljava/lang/String;

    move-result-object p1

    .line 270
    :cond_f
    const/4 v0, 0x0

    invoke-static {p1, v0}, Landroid/util/Base64;->decode(Ljava/lang/String;I)[B

    move-result-object p1

    .line 272
    new-instance v2, Landroid/content/ContentValues;

    invoke-direct {v2}, Landroid/content/ContentValues;-><init>()V

    .line 273
    const-string v3, "_display_name"

    invoke-virtual {v2, v3, p2}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 274
    const-string p2, "mime_type"

    const-string v3, "image/jpeg"

    invoke-virtual {v2, p2, v3}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 275
    sget p2, Landroid/os/Build$VERSION;->SDK_INT:I
    :try_end_27
    .catch Ljava/lang/Exception; {:try_start_3 .. :try_end_27} :catch_75

    const-string v3, "is_pending"

    const/16 v4, 0x1d

    if-lt p2, v4, :cond_3b

    .line 276
    :try_start_2d
    const-string p2, "relative_path"

    const-string v5, "Pictures/\u6b64\u523b\u76f8\u673a"

    invoke-virtual {v2, p2, v5}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/String;)V

    .line 277
    invoke-static {v1}, Ljava/lang/Integer;->valueOf(I)Ljava/lang/Integer;

    move-result-object p2

    invoke-virtual {v2, v3, p2}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/Integer;)V

    .line 279
    :cond_3b
    iget-object p2, p0, Lcom/wmc/camera/MainActivity$Bridge;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-virtual {p2}, Lcom/wmc/camera/MainActivity;->getContentResolver()Landroid/content/ContentResolver;

    move-result-object p2

    .line 280
    sget-object v1, Landroid/provider/MediaStore$Images$Media;->EXTERNAL_CONTENT_URI:Landroid/net/Uri;

    invoke-virtual {p2, v1, v2}, Landroid/content/ContentResolver;->insert(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;

    move-result-object v1

    .line 281
    if-nez v1, :cond_4c

    const-string p1, "ERR:insert-failed"

    return-object p1

    .line 282
    :cond_4c
    invoke-virtual {p2, v1}, Landroid/content/ContentResolver;->openOutputStream(Landroid/net/Uri;)Ljava/io/OutputStream;

    move-result-object v2

    .line 283
    if-nez v2, :cond_55

    const-string p1, "ERR:open-failed"

    return-object p1

    .line 284
    :cond_55
    invoke-virtual {v2, p1}, Ljava/io/OutputStream;->write([B)V

    .line 285
    invoke-virtual {v2}, Ljava/io/OutputStream;->flush()V

    .line 286
    invoke-virtual {v2}, Ljava/io/OutputStream;->close()V

    .line 287
    sget p1, Landroid/os/Build$VERSION;->SDK_INT:I

    if-lt p1, v4, :cond_72

    .line 288
    new-instance p1, Landroid/content/ContentValues;

    invoke-direct {p1}, Landroid/content/ContentValues;-><init>()V

    .line 289
    invoke-static {v0}, Ljava/lang/Integer;->valueOf(I)Ljava/lang/Integer;

    move-result-object v0

    invoke-virtual {p1, v3, v0}, Landroid/content/ContentValues;->put(Ljava/lang/String;Ljava/lang/Integer;)V

    .line 290
    const/4 v0, 0x0

    invoke-virtual {p2, v1, p1, v0, v0}, Landroid/content/ContentResolver;->update(Landroid/net/Uri;Landroid/content/ContentValues;Ljava/lang/String;[Ljava/lang/String;)I

    .line 292
    :cond_72
    const-string p1, "OK"
    :try_end_74
    .catch Ljava/lang/Exception; {:try_start_2d .. :try_end_74} :catch_75

    return-object p1

    .line 293
    :catch_75
    move-exception p1

    .line 294
    invoke-virtual {p1}, Ljava/lang/Object;->getClass()Ljava/lang/Class;

    move-result-object p2

    invoke-virtual {p2}, Ljava/lang/Class;->getSimpleName()Ljava/lang/String;

    move-result-object p2

    invoke-virtual {p1}, Ljava/lang/Exception;->getMessage()Ljava/lang/String;

    move-result-object p1

    new-instance v0, Ljava/lang/StringBuilder;

    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V

    const-string v1, "ERR:"

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object v0

    invoke-virtual {v0, p2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object p2

    const-string v0, " "

    invoke-virtual {p2, v0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object p2

    invoke-virtual {p2, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object p1

    invoke-virtual {p1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p1

    return-object p1
.end method

# 方向锁定（给网页用）
# ------------------------------------------------------------
# WebView 里 screen.orientation.lock() 永远抛异常（Chromium 明确不支持），
# 想真正把窗口钉死只能回到原生：Activity.setRequestedOrientation()。
#   JS 传 14 = SCREEN_ORIENTATION_LOCKED  锁在「当前这个方向」
#   JS 传  4 = SCREEN_ORIENTATION_SENSOR  恢复跟随重力（清单里的默认值）
# setRequestedOrientation 是 binder 调用，但仍在主线程发更稳。
.method public setOrientation(I)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Bridge;->this$0:Lcom/wmc/camera/MainActivity;

    new-instance v1, Lcom/wmc/camera/UiOrient;

    invoke-direct {v1, v0, p1}, Lcom/wmc/camera/UiOrient;-><init>(Lcom/wmc/camera/MainActivity;I)V

    invoke-virtual {v0, v1}, Lcom/wmc/camera/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method
