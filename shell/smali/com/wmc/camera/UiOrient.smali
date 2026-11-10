.class public final Lcom/wmc/camera/UiOrient;
.super Ljava/lang/Object;
.implements Ljava/lang/Runnable;

.source "UiOrient.java"


# 把 setRequestedOrientation 挪到主线程执行的小任务。
# 网页桥（WMCAndroid.xxx）跑在 JavaBridge 线程上，方向这类窗口操作
# 一律回主线程发，避免个别 ROM 在子线程上抛
# "Only the original thread that can touch its views" 之类的错。


# instance fields
.field private final activity:Lcom/wmc/camera/MainActivity;

.field private final orientation:I


# direct methods
.method public constructor <init>(Lcom/wmc/camera/MainActivity;I)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/wmc/camera/UiOrient;->activity:Lcom/wmc/camera/MainActivity;

    iput p2, p0, Lcom/wmc/camera/UiOrient;->orientation:I

    return-void
.end method


# virtual methods
.method public run()V
    .locals 2

    iget-object v0, p0, Lcom/wmc/camera/UiOrient;->activity:Lcom/wmc/camera/MainActivity;

    iget v1, p0, Lcom/wmc/camera/UiOrient;->orientation:I

    invoke-virtual {v0, v1}, Lcom/wmc/camera/MainActivity;->setRequestedOrientation(I)V

    return-void
.end method
