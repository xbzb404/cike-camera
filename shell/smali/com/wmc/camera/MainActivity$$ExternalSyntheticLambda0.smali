.class public final synthetic Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda0;
.super Ljava/lang/Object;
.source "D8$$SyntheticClass"

# interfaces
.implements Landroid/webkit/ValueCallback;


# instance fields
.field public final synthetic f$0:Lcom/wmc/camera/MainActivity;


# direct methods
.method public synthetic constructor <init>(Lcom/wmc/camera/MainActivity;)V
    .registers 2

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda0;->f$0:Lcom/wmc/camera/MainActivity;

    return-void
.end method


# virtual methods
.method public final onReceiveValue(Ljava/lang/Object;)V
    .registers 3

    iget-object v0, p0, Lcom/wmc/camera/MainActivity$$ExternalSyntheticLambda0;->f$0:Lcom/wmc/camera/MainActivity;

    check-cast p1, Ljava/lang/String;

    invoke-virtual {v0, p1}, Lcom/wmc/camera/MainActivity;->lambda$onBackPressed$1$com-wmc-camera-MainActivity(Ljava/lang/String;)V

    return-void
.end method
