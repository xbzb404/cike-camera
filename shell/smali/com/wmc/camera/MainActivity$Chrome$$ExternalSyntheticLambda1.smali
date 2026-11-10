.class public final synthetic Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;
.super Ljava/lang/Object;
.source "D8$$SyntheticClass"

# interfaces
.implements Ljava/lang/Runnable;


# instance fields
.field public final synthetic f$0:Lcom/wmc/camera/MainActivity$Chrome;

.field public final synthetic f$1:Landroid/webkit/PermissionRequest;


# direct methods
.method public synthetic constructor <init>(Lcom/wmc/camera/MainActivity$Chrome;Landroid/webkit/PermissionRequest;)V
    .registers 3

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;->f$0:Lcom/wmc/camera/MainActivity$Chrome;

    iput-object p2, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;->f$1:Landroid/webkit/PermissionRequest;

    return-void
.end method


# virtual methods
.method public final run()V
    .registers 3

    iget-object v0, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;->f$0:Lcom/wmc/camera/MainActivity$Chrome;

    iget-object v1, p0, Lcom/wmc/camera/MainActivity$Chrome$$ExternalSyntheticLambda1;->f$1:Landroid/webkit/PermissionRequest;

    invoke-virtual {v0, v1}, Lcom/wmc/camera/MainActivity$Chrome;->lambda$onPermissionRequest$1$com-wmc-camera-MainActivity$Chrome(Landroid/webkit/PermissionRequest;)V

    return-void
.end method
