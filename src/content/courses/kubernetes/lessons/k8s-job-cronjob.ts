/* ==================================================================
 * 课时：Job 与 CronJob：跑完即走（k8s-job-cronjob）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Deployment 系的四个工作负载都假设「进程要一直跑」；Job 表达「跑完即止」的批处理语义，CronJob 则按 cron 定时创建 Job——本课讲它们的成功/失败/重试与清理规则。",
  blocks: [
    {
      type: "paragraph",
      text: "到目前为止的工作负载都有一个共同假设：里面的进程要一直跑——shop-web 的 nginx、shop-api 的回显服务、shop-db 的 PostgreSQL，退出就是事故。但运维里还有另一类任务：数据迁移、数据导出、定时报表、批量发信——它们跑完就该结束，「正常终点」是退出码 0，而不是「永远活着」。把这类任务塞进 Deployment 会得到荒谬的结果：控制器发现 Pod 退出了，立刻按期望状态把它重新拉起来，任务永远跑不完。Job 就是为这类「跑完即走」的工作负载设计的控制器。",
    },
    {
      type: "heading",
      text: "Job：一次任务的成功语义",
    },
    {
      type: "paragraph",
      text: "Job 创建一个或多个 Pod，任务成功与否由 Pod 的退出码定义：退出码 0 = 这个副本成功了；非 0 = 失败，需要重试或判负。spec 里两个字段定义「怎样算整个 Job 成功」：completions 是成功完成的总次数（默认 1），parallelism 是允许同时运行的 Pod 数（默认 1）。parallelism 小于 completions 时，任务会分批滚动执行；当一批 Pod 失败重试的逻辑变得复杂（如从队列取任务、谁先完成都算数），就进入了「并行 Job」的工程模式——工作队列模式，本课只点到为止。",
    },
    {
      type: "code",
      title: "shop-orders-export.yaml：一次性导出任务",
      language: "yaml",
      code: `apiVersion: batch/v1
kind: Job
metadata:
  name: shop-orders-export
  namespace: shop
spec:
  completions: 1
  parallelism: 1
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: export
          image: busybox:1.36
          command:
            - sh
            - -c
            - echo "export orders snapshot"; sleep 3; echo "export done"`,
    },
    {
      type: "paragraph",
      text: "注意 Pod 模板里的 restartPolicy 写的是 Never——这是 Job 与 Deployment 系最大的语法差异：Deployment/StatefulSet/DaemonSet 的模板只允许 Always，Job 则只允许 Never 或 OnFailure。原因在于两者的「成功」定义相反：长跑服务的容器退出是故障，所以 kubelet 要在原地重启；批处理任务的容器退出是终点，重启策略必须由 Job 控制器统一裁决，而不是让 kubelet 无限重启一个注定失败的容器。",
    },
    {
      type: "code",
      title: "观察一次 Job 的生命周期",
      language: "bash",
      code: `kubectl apply -f shop-orders-export.yaml
kubectl -n shop get jobs
kubectl -n shop get pods -l job-name=shop-orders-export
kubectl -n shop logs <上一步列出的 Pod 名>`,
    },
    {
      type: "paragraph",
      text: "预期特征：Pod 短暂进入 Running 后变为 Succeeded（退出码 0）；get jobs 显示完成数达到 completions、状态为完成。Job 创建的 Pod 都带 job-name 标签，方便按任务筛选。执行完的 Job 对象会一直保留在集群里（连同它的 Pod 记录），直到你删除它或它被自动清理——下面讲清理规则。",
    },
    {
      type: "heading",
      text: "失败、重试与超时：backoffLimit 与 activeDeadlineSeconds",
    },
    {
      type: "paragraph",
      text: "Pod 退出码非 0 时，Job 控制器按 backoffLimit（默认 6）决定重试：restartPolicy: Never 下，失败的 Pod 留在 Failed 状态，控制器新建 Pod 重试；restartPolicy: OnFailure 下，kubelet 在同一个 Pod 内重启容器，重试计数仍然记在 Job 头上。超过 backoffLimit 后 Job 被判为失败，不再重试——所以「重试几次」由 Job 说了算，而不是交给 kubelet 无限重启。除了按次重试，activeDeadlineSeconds 给整个 Job 设硬超时：任务运行超过该秒数，控制器终止所有 Pod 并把 Job 标记为失败（适用于「迁移脚本卡死但退出码正常」这类无声故障）。",
    },
    {
      type: "paragraph",
      text: "任务结束后的清理也有标准答案：ttlSecondsAfterFinished——Job 完成（成功或失败）后等待指定秒数，控制器自动删除 Job 对象，它的 Pod 随之被级联清理。不设这个字段时，历史 Job 会一直占着 API 对象列表，需要人工 kubectl delete job 清理。一个工程习惯：一次性 Job 配上合理的 backoffLimit、activeDeadlineSeconds 与 ttlSecondsAfterFinished，让「失败会重试、卡死会超时、结束会清理」全部自动化。",
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么不用裸 Pod 跑批处理",
      body: "裸 Pod 失败后没有任何对象负责重试与判定「整体成功」；而用 Deployment 跑批处理又会陷入「退出即重启」的循环。Job 是两者的中间答案：它把「成功 = 完成 N 次且退出码为 0」声明成期望状态，由控制器负责收敛。",
    },
    {
      type: "heading",
      text: "CronJob：到点创建 Job 的定时器",
    },
    {
      type: "paragraph",
      text: "CronJob 本身不跑任务，它的全部职责是：按 cron 表达式到点创建一个 Job，剩下的交给 Job 语义。schedule 是标准 5 字段 cron（分 时 日 月 周），比如 0 2 * * * 表示每天 02:00。时区默认按 kube-controller-manager 所在时区解释（容器环境里常是 UTC），需要固定时区时用 spec.timeZone 显式声明。批量任务大多「同一时刻只应有一个在跑」，CronJob 用 concurrencyPolicy 表达并发规则：Allow 允许并发（默认）；Forbid 禁止——上一次还没跑完时本次调度直接跳过，而不是排队；Replace 杀掉上一次的运行再启动新的。suspend 字段可临时停用调度而不删除对象。",
    },
    {
      type: "paragraph",
      text: "shop 的场景：每晚 2 点把当天的订单同步到报表库。下面的骨架用 busybox 占位命令代表同步动作（真实实现是业务镜像与脚本，本课不写业务代码），重点是 CronJob 的形态：jobTemplate 里嵌的是一份完整 Job 清单，restartPolicy 仍只允许 Never/OnFailure。",
    },
    {
      type: "code",
      title: "shop-daily-orders-sync.yaml",
      language: "yaml",
      code: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: shop-daily-orders-sync
  namespace: shop
spec:
  schedule: "0 2 * * *"
  timeZone: "Asia/Shanghai"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: sync
              image: busybox:1.36
              command:
                - sh
                - -c
                - echo "nightly orders sync started"; sleep 3; echo "sync finished"`,
    },
    {
      type: "code",
      title: "验证 CronJob",
      language: "bash",
      code: `kubectl apply -f shop-daily-orders-sync.yaml
kubectl -n shop get cronjobs
kubectl -n shop get jobs -l job-name=shop-daily-orders-sync
# 观察「到点自动创建 Job」的现场演示：
kubectl -n shop create job --from=cronjob/shop-daily-orders-sync sync-manual
kubectl -n shop get pods -l job-name=sync-manual`,
    },
    {
      type: "paragraph",
      text: "kubectl get cronjobs 能看到 SCHEDULE 列与上次/下次执行时间等特征。最后一条 create job --from 是 kubectl 提供的「手动触发一次」捷径——把 CronJob 的 Job 模板当场拉出来跑一次，非常适合验证定时任务本身有没有写对，不必真的等到凌晨两点。CronJob 每次触发都会创建独立命名的 Job，多次运行的 Job 历史会累积，可用 successfulJobsHistoryLimit / failedJobsHistoryLimit 字段控制保留数量（默认值以官方文档为准）。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "CronJob 不是精确到秒的调度器",
      body: "它是「尽力而为」的定时器：控制器可能错过调度（停机、负载等），Forbid 策略下「上一次还在跑」的那次触发也会被跳过而不是补跑。对账类批量任务要设计成可重入/幂等，必要时配监控在错过调度时告警——这属于任务设计问题，不在 Kubernetes 语义里。",
    },
    {
      type: "quiz",
      question:
        "某 CronJob 每分钟触发一次（schedule: \"* * * * *\"），concurrencyPolicy: Forbid，而每次任务实际要跑 90 秒。当第二次触发时刻到来、上一次运行尚未结束时，会发生什么？",
      options: [
        "本次触发被跳过：Forbid 禁止并发，新的 Job 不会创建，也不会在上一轮结束后补跑",
        "新的 Job 会排队，等上一次运行一结束就立即启动",
        "控制器会先终止上一次的运行，再启动新的 Job",
        "CronJob 会暂停调度并等待人工确认",
      ],
      answer: 0,
      explanation:
        "Forbid 的语义就是「上一次还没跑完，本次直接不启动」，且跳过就是跳过、不会排队补跑（选项 A 对、B 错）。C 描述的是 Replace 策略的行为——终止旧的再启动新的，与 Forbid 相反。D 中 CronJob 没有「暂停并等待人工」的状态，暂停要人工设置 suspend 字段。这个例子也说明：任务时长可能超过触发间隔时，要么把间隔调长，要么用 Allow/Replace，要么把任务设计成可跳过一轮也无妨。",
    },
    {
      type: "keypoints",
      items: [
        "Job 表达「跑完即止」：completions/parallelism 定义成功条件；Pod 模板只允许 restartPolicy: Never/OnFailure，重试次数由 backoffLimit（默认 6）裁决。",
        "activeDeadlineSeconds 给整个任务设硬超时，ttlSecondsAfterFinished 让结束的 Job 自动清理——配齐它们，失败会重试、卡死会超时、结束会清理。",
        "CronJob 是「到点创建 Job」的定时器：schedule 5 字段 + timeZone 定时刻，concurrencyPolicy 三值定并发，suspend 临时停用；它不是精确调度器，错过即错过。",
      ],
    },
  ],
};
