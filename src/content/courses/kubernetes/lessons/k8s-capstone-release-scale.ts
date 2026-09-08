/* ==================================================================
 * 课时：发布与伸缩演练（k8s-capstone-release-scale）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "在第 48 课部署好的 shop 上做三场演练：shop-web 滚动发布与回滚、rollout 暂停与卡探针的自动刹车、shop-api 的 HPA 伸缩，最后复盘发布纪律。",
  blocks: [
    {
      type: "paragraph",
      text: "第 48 课验证了 shop「能跑」，本课验证它「能安全地变」：滚动发布、回滚、暂停、探针刹车、按负载伸缩。全部操作基于磁盘上的 manifests/ 清单——发布就是修改清单再 apply，让控制器调谐（第 1 章《对象模型：声明式、spec 与调谐循环》）；回滚就是把模板改回上一个 revision（第 3 章《滚动更新、回滚与发布策略》）。演练目标对着第 47 课的成功标准 4：发布全程不中断。",
    },
    {
      type: "heading",
      text: "开始前：核对基线",
    },
    {
      type: "code",
      title: "基线检查",
      language: "bash",
      code: `kubectl -n shop get deploy,pdb,pods
# 预期：shop-web 与 shop-api 各 2 副本且 READY 1/1，两个 PDB 存在，
# shop-cache 与 shop-db 各 1 副本正常

kubectl -n shop get hpa
# 预期：为空（HPA 在本课才创建）
# 若第 7 章练习已留下同名 HPA，不必删除——本课的 09-hpa.yaml 会把
# min/max 与目标收敛为本章配置，apply 即声明式接管

kubectl top nodes
# 预期：能看到节点 CPU/内存用量——若报错，说明 metrics-server 未就绪`,
    },
    {
      type: "callout",
      variant: "note",
      title: "metrics-server 前提",
      body: "HPA 的指标来自 metrics-server。第 7 章《HPA：按负载水平伸缩》的实操如果已经按官方 components.yaml（metrics-server 官方部署文档）装好，直接继续；没装就先回去补装。kind 里的常见做法是给 metrics-server 的 Deployment 追加 --kubelet-insecure-tls 参数——那仅为本地实验关闭 TLS 校验，生产不得这样做。",
    },
    {
      type: "heading",
      text: "演练一：shop-web 滚动发布与新旧并存",
    },
    {
      type: "paragraph",
      text: "发布在 Kubernetes 里的本质是「模板 spec 发生变化 → Deployment 创建一个新 ReplicaSet（RS）→ 新 RS 渐进接管副本」。真实项目里触发它的大多是镜像 tag 变化，但本课程镜像白名单里 nginx 只有一个 tag，所以用「给模板加一个 ver: v2 标签」充当新版本标记——模板变了，机制与改镜像完全一致。关键纪律：只动 template.metadata.labels，绝不碰 spec.selector.matchLabels——selector 是 Deployment 认领 Pod 的凭证，改了它新旧 Pod 会同时失去归属。发布前另开一个终端起一个持续请求，作为「断流探测器」。",
    },
    {
      type: "code",
      title: "终端 A：持续请求 shop-web（不断流探测器）",
      language: "bash",
      code: `kubectl -n shop run watch-load --image=busybox:1.36 --restart=Never --rm -it \\
  -- sh -c 'while true; do wget -qO- http://shop-web/ > /dev/null && echo ok || echo FAIL; sleep 1; done'
# 预期：持续打印 ok；发布期间若出现 FAIL，说明发生了断流，演练即失败
# 结束时按 Ctrl+C 退出`,
    },
    {
      type: "code",
      title: "终端 B：发布 shop-web v2",
      language: "bash",
      code: `# 编辑 manifests/05-shop-web.yaml：在 spec.template.metadata.labels 下加一行  ver: v2
# （不要动 spec.selector.matchLabels）
kubectl apply -f manifests/05-shop-web.yaml

kubectl -n shop rollout status deployment/shop-web
# 预期：输出会分段推进——新副本创建、等待就绪（minReadySeconds=10 让它慢一拍）、
# 旧副本逐个退役，最后以成功收尾

kubectl -n shop get rs -l app=shop-web
# 预期：出现两个 RS（旧 revision 与新 revision），副本数完成交接

kubectl -n shop get pods -l app=shop-web --show-labels
# 预期：新 Pod 带 ver=v2 标签；由于 maxSurge 允许先超配再收缩，
# 过程中会短暂看到新旧 Pod 并存、总副本数瞬时超过 2 的时刻
# （2 副本 + 默认 25% 的取整细节以官方文档为准，这里观察现象即可）`,
    },
    {
      type: "paragraph",
      text: "对照终端 A：整个发布过程中应只有 ok。这依赖的是组合拳——readiness 探针决定新副本何时有资格接流量，minReadySeconds 防止「假就绪」，滚动策略保证任何时候都有足额可用副本。少了任何一件，发布都可能在某个瞬间把流量切断（第 3 章《滚动更新、回滚与发布策略》）。",
    },
    {
      type: "heading",
      text: "演练二：pause/resume 与自动刹车",
    },
    {
      type: "paragraph",
      text: "rollout pause 是「手动刹车」：把 Deployment 冻结在当前状态，期间你再怎么改清单，副本推进都不会发生，旧版本照常服务——常用于「发布到一半发现不对劲，先按住再说」。先暂停再发布 v3，观察冻结效果，然后 resume 让滚动继续。",
    },
    {
      type: "code",
      title: "暂停中发布，再恢复",
      language: "bash",
      code: `kubectl -n shop rollout pause deployment/shop-web
# 预期：deployment paused

# 编辑 manifests/05-shop-web.yaml：把 ver: v2 改成 ver: v3，apply
kubectl apply -f manifests/05-shop-web.yaml

kubectl -n shop rollout status deployment/shop-web
# 预期：命令停在等待状态或直接提示 paused——无论哪种，
# 下面 get pods 都能看到旧副本没有变化：控制器被冻结，新版本不被推进

kubectl -n shop get pods -l app=shop-web --show-labels
# 预期：跑着的还是 ver=v2 的旧副本（发布被按住）

kubectl -n shop rollout resume deployment/shop-web
kubectl -n shop rollout status deployment/shop-web
# 预期：resume 后滚动继续，最终 v3 全部就绪`,
    },
    {
      type: "paragraph",
      text: "探针则是「自动刹车」：如果新版本本身起不来，滚动更新会自己停住，而不是硬着头皮把好副本换掉。人为制造一次：把 shop-web 的 readiness 探针路径改成 nginx 必然返回 404 的 /health-check，然后 apply——新副本永远不就绪，旧副本一个都不会被摘。这正是第 2 章《生命周期、重启与三种探针》里「readiness 失败 ≠ 重启」的现场版：失败的新副本不会被杀（liveness 仍通过），只是没有资格接流量，而旧副本继续服务。",
    },
    {
      type: "code",
      title: "人为卡住探针，观察自动刹车，再回滚",
      language: "bash",
      code: `# 编辑 manifests/05-shop-web.yaml：把 readinessProbe.httpGet.path 从 / 改成 /health-check，apply
kubectl apply -f manifests/05-shop-web.yaml

kubectl -n shop rollout status deployment/shop-web
# 预期：命令一直等待——滚动被新副本的未就绪卡住（progressDeadlineSeconds 默认 600s，不必等它）

kubectl -n shop get pods -l app=shop-web --show-labels
# 预期：新副本 READY 0/1（就绪探针 404 打不通），旧副本仍 1/1 在服务
# 对照终端 A：仍是 ok——服务没有中断，这就是探针刹车的意义

# 修复：回滚到上一个 revision（模板回到 v3，探针路径也回到 /）
kubectl -n shop rollout undo deployment/shop-web
kubectl -n shop rollout status deployment/shop-web
# 预期：回滚即「把模板改回上一 revision」，新 RS 重新接管，最终全部就绪

kubectl -n shop rollout history deployment/shop-web
# 预期：能看到一串 REVISION；undo 之后 HEAD 回到 v3 对应的那一版
# 另一种修复是「前进式」：把探针路径改回 / 再 apply，效果等价`,
    },
    {
      type: "heading",
      text: "演练三：shop-api 的 HPA 伸缩",
    },
    {
      type: "paragraph",
      text: "滚动发布解决「版本怎么换」，HPA 解决「副本给多少」。第 47 课设计里给 shop-api 预留的 requests.cpu=100m 现在派上用场：HPA 的 CPU 平均利用率 = 各副本实际使用之和 ÷（requests × 副本数），没有 requests 就没有基准（第 7 章《HPA：按负载水平伸缩》）。min 取 2 是为了与 shop-api-pdb 的 minAvailable=1 相容：缩到 1 副本时，一次节点 drain 就会因 PDB 而卡住。先把 HPA 声明出来，再放一个负载发生器去够它。",
    },
    {
      type: "code",
      title: "manifests/09-hpa.yaml",
      language: "yaml",
      code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: shop-api
  namespace: shop
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: shop-api
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50`,
    },
    {
      type: "code",
      title: "manifests/10-load-gen.yaml（演练用，结束后删除）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: load-gen
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: load-gen
  template:
    metadata:
      labels:
        app: load-gen
    spec:
      containers:
        - name: loader
          image: busybox:1.36
          command: ["/bin/sh", "-c"]
          args:
            - "seq 8 | xargs -P 8 -I{} sh -c 'while true; do wget -q -O- http://shop-api:8080/ > /dev/null 2>&1; done'"
          resources:
            requests:
              cpu: 50m
              memory: 32Mi
            limits:
              cpu: 200m
              memory: 64Mi`,
    },
    {
      type: "code",
      title: "观察 scale up 与 scale down",
      language: "bash",
      code: `kubectl apply -f manifests/09-hpa.yaml
kubectl apply -f manifests/10-load-gen.yaml

kubectl -n shop get hpa shop-api
# 预期：第一次查看时 TARGETS 可能还是 <unknown>——metrics-server 首次采集需要一点时间

kubectl -n shop get hpa shop-api -w
# 预期：负载起来后 TARGETS 超过 50%，REPLICAS 从 2 逐步上升（最多到 5）；
# 评估周期默认在约 15s 的量级，具体节奏以观察为准

kubectl -n shop top pods -l app=shop-api
# 预期：能看到每个 api Pod 的 CPU 用量——把这几列和 HPA 的 TARGETS 对照着看，
# 就能读懂「指标 → 期望副本数」的决策链（第 7 章《HPA：按负载水平伸缩》）

# 压测结束：撤掉负载，观察回落
kubectl delete -f manifests/10-load-gen.yaml
kubectl -n shop get hpa shop-api -w
# 预期：TARGETS 回落后 REPLICAS 不会瞬间收缩——HPA 有稳定窗口防抖动，
# 需要观察一段时间才会从高位回到 minReplicas（具体时长以观察为准）`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "负载上不去怎么办",
      body: "echoserver 是 CPU 很轻的哑服务，如果几分钟后 REPLICAS 纹丝不动且 TARGETS 远低于 50%，问题几乎总在压力端：把 load-gen 的 args 里并发数 8 改成 16，或把它的 replicas 扩到 2 再观察。不要一上来就怀疑 HPA——先看 kubectl top 与 TARGETS 两个证据，这正是第 11 章《集群可观测：指标、事件与日志》教的「指标定位趋势」。想更可控地压测，可用 hey/ab/wrk 之类的压测工具在集群内发压，本课用 busybox 循环只是为了不引入镜像白名单之外的东西。",
    },
    {
      type: "heading",
      text: "发布纪律复盘",
    },
    {
      type: "list",
      items: [
        "探针是自动刹车：新版本不就绪就不接流量，旧版本不被误摘——readiness 决定资格，liveness 决定生死（第 2 章《生命周期、重启与三种探针》）。",
        "minReadySeconds 防「假就绪」：新副本要稳定就绪 N 秒才算可用，避免刚起来又被立刻杀掉形成抖动（第 3 章《滚动更新、回滚与发布策略》）。",
        "滚动策略控制牺牲与超配：maxUnavailable 允许的不可用数、maxSurge 允许的超配数一起约束节奏；发布全程可用副本数不跌破下限靠的是它，而不是 PDB。",
        "PDB 管的是另一件事——自愿中断：kubectl drain 逐出 Pod 时必须满足 minAvailable，滚动更新自身的缩容不经过 PDB（第 10 章《节点维护：cordon、drain 与故障自愈》）。",
        "HPA 与发布共用同一个 Deployment：滚动期间模板在换、副本数目标不变；发布与伸缩两条控制回路都由控制器调谐驱动，互不阻塞。",
      ],
    },
    {
      type: "exercise",
      title: "练习：发布与伸缩三连",
      description:
        "按本课三个演练顺序执行，并记录：1) v2 发布时用 kubectl get rs 与 kubectl get pods --show-labels 截下「新旧并存」的瞬间特征；2) pause 期间验证「模板已改但副本不推进」，resume 后验证滚动恢复；3) 卡探针演练中确认终端 A 全程只有 ok，undo 后确认版本回到 v3；4) HPA 演练中记录 REPLICAS 上升的峰值与回落到 2 的大致耗时；5) 结束后自查：shop-web 探针路径已还原、load-gen 已删除、shop-api HPA 仍在且 minReplicas=2。",
      hint: "新旧并存的窗口大约等于 minReadySeconds（10 秒），手慢错过就再来一轮：ver 递增一次、apply、立刻 get pods -w。HPA 演练的观察窗口是分钟级，别急着下结论；若 TARGETS 始终 <unknown，先查 metrics-server 而不是负载。",
    },
    {
      type: "keypoints",
      items: [
        "发布 = 模板变化驱动新 RS 渐进接管；pause/resume 是手动刹车，探针是自动刹车，undo 是回到上一个 revision。",
        "不断流靠组合拳：readiness + minReadySeconds + 滚动策略；PDB 保护的是 drain 一类的自愿中断，两者别混。",
        "HPA 只调副本数：先读 TARGETS 与 kubectl top 两个证据，再决定调负载还是调配置。",
      ],
    },
  ],
};
