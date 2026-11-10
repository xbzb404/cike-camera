.class Lcom/wmc/camera/MainActivity$LocalClient;
.super Landroid/webkit/WebViewClient;
.source "MainActivity.java"


# annotations
.annotation system Ldalvik/annotation/EnclosingClass;
    value = Lcom/wmc/camera/MainActivity;
.end annotation

.annotation system Ldalvik/annotation/InnerClass;
    accessFlags = 0x2
    name = "LocalClient"
.end annotation


# instance fields
.field final synthetic this$0:Lcom/wmc/camera/MainActivity;


# direct methods
.method private constructor <init>(Lcom/wmc/camera/MainActivity;)V
    .registers 2

    .line 142
    iput-object p1, p0, Lcom/wmc/camera/MainActivity$LocalClient;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-direct {p0}, Landroid/webkit/WebViewClient;-><init>()V

    return-void
.end method

.method synthetic constructor <init>(Lcom/wmc/camera/MainActivity;Lcom/wmc/camera/MainActivity$LocalClient-IA;)V
    .registers 3

    invoke-direct {p0, p1}, Lcom/wmc/camera/MainActivity$LocalClient;-><init>(Lcom/wmc/camera/MainActivity;)V

    return-void
.end method


# virtual methods
.method public shouldInterceptRequest(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Landroid/webkit/WebResourceResponse;
    .registers 11

    .line 145
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;

    move-result-object p1

    .line 146
    if-eqz p1, :cond_a5

    const-string p2, "appassets.androidplatform.net"

    invoke-virtual {p1}, Landroid/net/Uri;->getHost()Ljava/lang/String;

    move-result-object v0

    invoke-virtual {p2, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result p2

    if-nez p2, :cond_14

    goto/16 :goto_a5

    .line 147
    :cond_14
    invoke-virtual {p1}, Landroid/net/Uri;->getPath()Ljava/lang/String;

    move-result-object p1

    .line 148
    if-eqz p1, :cond_28

    invoke-virtual {p1}, Ljava/lang/String;->isEmpty()Z

    move-result p2

    if-nez p2, :cond_28

    const-string p2, "/"

    invoke-virtual {p2, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result p2

    if-eqz p2, :cond_2a

    :cond_28
    const-string p1, "/index.html"

    .line 149
    :cond_2a
    new-instance p2, Ljava/lang/StringBuilder;

    invoke-direct {p2}, Ljava/lang/StringBuilder;-><init>()V

    const-string v0, "www"

    invoke-virtual {p2, v0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object p2

    invoke-virtual {p2, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    move-result-object p2

    invoke-virtual {p2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object p2

    .line 150
    new-instance v7, Ljava/util/HashMap;

    invoke-direct {v7}, Ljava/util/HashMap;-><init>()V

    .line 151
    const-string v0, "Cache-Control"

    const-string v1, "no-store"

    invoke-interface {v7, v0, v1}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    .line 152
    const-string v0, "Access-Control-Allow-Origin"

    const-string v1, "*"

    invoke-interface {v7, v0, v1}, Ljava/util/Map;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    .line 154
    :try_start_50
    iget-object v0, p0, Lcom/wmc/camera/MainActivity$LocalClient;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-virtual {v0}, Lcom/wmc/camera/MainActivity;->getAssets()Landroid/content/res/AssetManager;

    move-result-object v0

    invoke-virtual {v0, p2}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;

    move-result-object v6

    .line 155
    new-instance p2, Landroid/webkit/WebResourceResponse;

    invoke-static {p1}, Lcom/wmc/camera/MainActivity;->-$$Nest$smmime(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v1

    const-string v2, "utf-8"

    const/16 v3, 0xc8

    const-string v4, "OK"

    move-object v0, p2

    move-object v5, v7

    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    :try_end_6b
    .catch Ljava/io/IOException; {:try_start_50 .. :try_end_6b} :catch_6c

    return-object p2

    .line 156
    :catch_6c
    move-exception p1

    .line 158
    :try_start_6d
    iget-object p1, p0, Lcom/wmc/camera/MainActivity$LocalClient;->this$0:Lcom/wmc/camera/MainActivity;

    invoke-virtual {p1}, Lcom/wmc/camera/MainActivity;->getAssets()Landroid/content/res/AssetManager;

    move-result-object p1

    const-string p2, "www/index.html"

    invoke-virtual {p1, p2}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;

    move-result-object v6

    .line 159
    new-instance p1, Landroid/webkit/WebResourceResponse;

    const-string v1, "text/html"

    const-string v2, "utf-8"

    const/16 v3, 0xc8

    const-string v4, "OK"

    move-object v0, p1

    move-object v5, v7

    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V
    :try_end_88
    .catch Ljava/io/IOException; {:try_start_6d .. :try_end_88} :catch_89

    return-object p1

    .line 160
    :catch_89
    move-exception p1

    .line 161
    new-instance p1, Landroid/webkit/WebResourceResponse;

    const-string v1, "text/plain"

    const-string v2, "utf-8"

    const/16 v3, 0x194

    const-string v4, "Not Found"

    new-instance v6, Ljava/io/ByteArrayInputStream;

    .line 162
    const-string p2, "not found"

    invoke-virtual {p2}, Ljava/lang/String;->getBytes()[B

    move-result-object p2

    invoke-direct {v6, p2}, Ljava/io/ByteArrayInputStream;-><init>([B)V

    move-object v0, p1

    move-object v5, v7

    invoke-direct/range {v0 .. v6}, Landroid/webkit/WebResourceResponse;-><init>(Ljava/lang/String;Ljava/lang/String;ILjava/lang/String;Ljava/util/Map;Ljava/io/InputStream;)V

    .line 161
    return-object p1

    .line 146
    :cond_a5
    :goto_a5
    const/4 p1, 0x0

    return-object p1
.end method

.method public shouldOverrideUrlLoading(Landroid/webkit/WebView;Landroid/webkit/WebResourceRequest;)Z
    .registers 5

    .line 169
    invoke-interface {p2}, Landroid/webkit/WebResourceRequest;->getUrl()Landroid/net/Uri;

    move-result-object p1

    .line 170
    const/4 p2, 0x0

    if-nez p1, :cond_8

    return p2

    .line 171
    :cond_8
    const-string v0, "appassets.androidplatform.net"

    invoke-virtual {p1}, Landroid/net/Uri;->getHost()Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v0

    if-eqz v0, :cond_15

    return p2

    .line 173
    :cond_15
    :try_start_15
    iget-object p2, p0, Lcom/wmc/camera/MainActivity$LocalClient;->this$0:Lcom/wmc/camera/MainActivity;

    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.VIEW"

    invoke-direct {v0, v1, p1}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V

    invoke-virtual {p2, v0}, Lcom/wmc/camera/MainActivity;->startActivity(Landroid/content/Intent;)V
    :try_end_21
    .catch Ljava/lang/Exception; {:try_start_15 .. :try_end_21} :catch_22

    .line 175
    goto :goto_23

    .line 174
    :catch_22
    move-exception p1

    .line 176
    :goto_23
    const/4 p1, 0x1

    return p1
.end method
