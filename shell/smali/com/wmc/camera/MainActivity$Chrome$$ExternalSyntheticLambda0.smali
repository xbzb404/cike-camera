.class public final synthetic Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda0;
.super Ljava/lang/Object;
.source "D8$$SyntheticClass"

# interfaces
.implements Ljava/lang/Runnable;


# instance fields
.field public final synthetic f$0:Lcom/wmc/camera/MainActivity$Chrome;


# direct methods
.method public synthetic constructor <init>(Lcom/wmc/camera/MainActivity$Chrome;)V
    .registers 2

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda0;->f$0:Lcom/wmc/camera/MainActivity$Chrome;

    return-void
.end method


# virtual methods
.method public final run()V
    .registers 2

    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda0;->f$0:Lcom/wmc/camera/MainActivity$Chrome;

    invoke-virtual {v0}, Lcom/wmc/camera/MainActivity$Chrome;->lambda$onPermissionRequest$0$com-wmc-camera-MainActivity$Chrome()V

    return-void
.end method
