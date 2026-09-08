/* ==================================================================
 * 课时：HPA：按负载水平伸缩（k8s-hpa）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "HPA 让 Deployment 的副本数跟随负载自动变化：metrics-server 提供指标、HPA 控制器按 CPU 平均利用率算期望副本、再交给 Deployment 调谐；动手安装 metrics-server 并给 shop-api 配置 autoscaling/v2 观察扩缩容。",
  blocks: [
    {
      type: "paragraph",
      text: "第 3 章我们用 kubectl scale 和改 replicas 的方式手动伸缩副本，第 12 章的发布与伸缩演练还会再见到它。但手动伸缩有两个天花板：人没法 7×24 盯着流量，而且人反应再快也滞后于突发。期望的行为是：负载上来副本自动加，负载下去副本自动减。这一课的主角 HPA（HorizontalPodAutoscaler，水平 Pod 自动伸缩）就是内置答案。horizontal 的意思是水平——加副本，把「宽度」撑大；与之相对的 vertical 是加大单个 Pod 的资源，那是下一课的全景内容。",
    },
    {
      type: "heading",
      text: "先看清伸缩的落点：scale 子资源",
    },
    {
      type: "paragraph",
      text: "Deployment、ReplicaSet 这类对象都带一个 scale 子资源：一个专门读写副本数的 API 视图。kubectl scale 改的是它，HPA 改的也是它——「把副本数改成 N」这件事因此有了统一入口，谁来改都一样：人、脚本、自动伸缩器。副本数一变，Deployment 控制器照常调谐：多了就删、少了就建。所以 HPA 并不是什么黑魔法，它只是把「决定目标副本数」这一步从人手里接过来，下游的调谐机制和第 3 章《Deployment 与 ReplicaSet：副本从哪来》讲的完全一样。",
    },
    {
      type: "heading",
      text: "指标从哪来：metrics-server 与 metrics API",
    },
    {
      type: "paragraph",
      text: "要按负载伸缩，先得有负载数据。集群内默认的指标源是 metrics-server：一个独立部署的组件，周期性地从各节点的节点代理（kubelet）汇总容器 CPU 与内存，通过 metrics.k8s.io 这套 API 对外提供，kubectl top 读的也是它。两个边界要记牢：metrics-server 不存历史（想要长期曲线要靠 Prometheus 那套生态，见第 11 章《集群可观测》），只反映当下；它也不是集群内置组件，kind 里默认没有——所以本课要先装它，否则 HPA 和 kubectl top 都无米下锅。",
    },
    {
      type: "heading",
      text: "autoscaling/v2：声明目标与边界",
    },
    {
      type: "code",
      title: "hpa-shop-api.yaml",
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
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60`,
    },
    {
      type: "paragraph",
      text: "清单里三件套各司其职。scaleTargetRef 指向要伸缩的对象（必须是带 scale 子资源的类型）；minReplicas 与 maxReplicas 给弹性装上护栏——自动伸缩永远是有界的，下限保护服务可用性，上限保护集群与成本；metrics 数组声明伸缩依据，我们只用一个：Resource 型 CPU 指标，target 是 Utilization 平均利用率 60%。",
    },
    {
      type: "paragraph",
      text: "平均利用率（averageUtilization）的精确语义是：所有副本的实际 CPU 使用量之和，除以所有副本的 requests 之和，再化成百分比。假设每个副本请求 200m 核、当前 3 个副本，那么「额度」是 600m；若实际一共用了 360m，利用率就是 60%，恰好贴着目标。控制器据此算期望副本数，思路近似于：期望副本数 ≈ 当前副本数 × 当前利用率 ÷ 目标利用率，再向上取整。",
    },
    {
      type: "paragraph",
      text: "分母为什么是 requests 而不是 limits、更不是节点容量？因为利用率刻画的是「相对申领额的饱合度」，而 HPA 的模型假设每个副本能力恒定（requests 恒定），加副本就是线性扩容。于是 requests 的取值再次成为关键：设得小，分母小、利用率虚高，集群会过早扩容；设得大，利用率永远上不去，等于没配 HPA。这与上一课调度器的记账是同一种资源语言——调度、伸缩共用同一本账，requests 是锚点。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "内存不适合做水平伸缩指标",
      body: "扩副本解决不了「单个 Pod 内存不断上涨」的问题：新副本带着同样的问题启动，照样被 OOMKilled（第 2 章讲过，退出码 137）。内存型问题要靠修应用或调大单副本资源（下一课的 VPA 思路），所以常见实践只用 CPU 做 HPA 指标。",
    },
    {
      type: "paragraph",
      text: "最后是节奏：HPA 控制器默认大约每 15 秒评估一次指标，但并不是每次评估都改副本数——期望值与当前值差异太小时不动，而且扩大与缩小都带防抖窗口，缩小尤其保守，避免负载小波动让副本反复横跳。这些精确的默认数值随版本演进，以官方文档为准，本课记住「有评估周期、有防抖窗口」即可。",
    },
    {
      type: "heading",
      text: "前提：先装 metrics-server",
    },
    {
      type: "paragraph",
      text: "kind 集群默认没有 metrics-server，直接配 HPA 会看到 kubectl top 报「指标暂不可用」一类的错误。安装按 metrics-server 官方部署文档进行：获取官方最新的 components.yaml 并应用即可，不要用网上来路不明的副本。kind 环境还有一个常见坑：metrics-server 用 HTTPS 访问 kubelet 的指标接口，而 kind 的自签证书无法通过校验，常见做法是给 metrics-server 的 Deployment 追加启动参数 --kubelet-insecure-tls。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "--kubelet-insecure-tls 仅限本地实验",
      body: "跳过 kubelet 证书校验等于放弃对指标来源身份的验证，生产集群绝不能这样配。本地 kind 学习环境为了跑通演示可以加，正式环境请按官方文档配置证书校验。",
    },
    {
      type: "code",
      title: "安装 metrics-server（kind 本地实验版）",
      language: "bash",
      code: `# 1. 从 metrics-server 官方部署文档获取最新 components.yaml 并应用
kubectl apply -f components.yaml

# 2. 给 metrics-server Deployment 追加 --kubelet-insecure-tls（仅本地实验）
kubectl edit deployment metrics-server -n kube-system

# 3. 等它就绪后验证指标可用
kubectl rollout status deployment metrics-server -n kube-system
kubectl top nodes
kubectl top pods -n shop`,
    },
    {
      type: "paragraph",
      text: "第 2 步是在编辑器里给容器的 args 列表追加一行 --kubelet-insecure-tls。第 3 步验证时，预期 kubectl top 输出带 CPU 与内存两列的真实数字——之前它会报错，现在有数据了，说明指标管道通了。",
    },
    {
      type: "heading",
      text: "实操：给 shop-api 配 HPA 并压出扩缩容",
    },
    {
      type: "callout",
      variant: "warning",
      title: "没有 requests，HPA 无从算起",
      body: "平均利用率的分母是 requests，容器没写 resources 时这个数不存在，HPA 拿不到利用率，会在事件里报错、不会伸缩。如果前几章的 shop-api 清单没写 requests，先按下面这份补上（顺带复习第 2 章：CPU 请求 200m，上限 500m）。",
    },
    {
      type: "code",
      title: "shop-api.yaml：带 requests 的 Deployment 与 Service",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 200m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: shop
spec:
  selector:
    app: shop-api
  ports:
    - port: 8080
      targetPort: 8080`,
    },
    {
      type: "code",
      title: "应用 HPA 并观察基线",
      language: "bash",
      code: `kubectl apply -f shop-api.yaml -f hpa-shop-api.yaml
kubectl get hpa -n shop
kubectl get hpa -n shop -w`,
    },
    {
      type: "paragraph",
      text: "kubectl get hpa 输出的列（NAME、REFERENCE、TARGETS、MINPODS、MAXPODS、REPLICAS 等）里，TARGETS 是核心：格式是「当前利用率/目标利用率」，例如 5%/60%。刚配好时指标还没采集，会显示 <unknown> 一类的占位，等一两轮评估就变成真实数字。REFERENCE 一列确认它管的是 Deployment/shop-api，REPLICAS 显示当前副本数。",
    },
    {
      type: "paragraph",
      text: "现在制造压力。起一个 load-gen Pod 循环请求 shop-api 的 Service（同命名空间内可以直接用短名 shop-api，第 4 章《Service：稳定的访问入口与 DNS》讲过）：",
    },
    {
      type: "code",
      title: "压测客户端",
      language: "bash",
      code: `kubectl -n shop run load-gen --image=busybox:1.36 --restart=Never -- \
  /bin/sh -c "while true; do wget -q -O- http://shop-api:8080 > /dev/null 2>&1; sleep 0.2; done"`,
    },
    {
      type: "paragraph",
      text: "观察 kubectl get hpa -n shop -w：预期 TARGETS 的当前值爬过 60% 之后，REPLICAS 开始从 1 往上加，新副本陆续变成 Running；kubectl get pods -n shop -o wide 会看到 shop-api 的副本在变多。echoserver 处理请求很轻，单个 load-gen 未必能把 CPU 顶上去——不够就多开两个 load-gen（换名字即可），或者用带并发的压测工具（如 hey、wrk 一类）压测——kind 的宿主机没有到 ClusterIP 的路由，从宿主机压要先 `kubectl -n shop port-forward svc/shop-api 8080:8080` 再打本地地址，或给 Service 开 NodePort 用节点地址。真实业务里用什么压，第 12 章《发布与伸缩演练》会再提。",
    },
    {
      type: "paragraph",
      text: "压完删掉 load-gen：",
    },
    {
      type: "code",
      title: "停止压力并观察缩容",
      language: "bash",
      code: `kubectl -n shop delete pod load-gen
kubectl get hpa -n shop -w`,
    },
    {
      type: "paragraph",
      text: "预期 TARGETS 回落到目标以下后，副本数并不会立刻掉——缩容有更保守的防抖窗口，等一会儿才会逐级回落，最终回到 minReplicas。刻意等一等再下结论，别以为 HPA 坏了。全部观察完，把 HPA 留着或删掉都行：kubectl delete hpa shop-api -n shop。",
    },
    {
      type: "heading",
      text: "HPA 与就绪探针、PDB 的配合",
    },
    {
      type: "paragraph",
      text: "扩容出去的新副本要 readiness 探针通过才接流量。探针慢或失败的话，副本数涨了、可用容量却没涨——第 3 章《滚动更新、回滚与发布策略》说探针是发布的刹车，对 HPA 同理：快速就绪的副本才是有效的扩容。而 PodDisruptionBudget（PDB）为自愿中断（发布、节点维护）设最少可用副本下限，机制在第 10 章《节点维护：cordon、drain 与故障自愈》展开；当伸缩与维护共用同一批副本时，HPA 的 minReplicas/maxReplicas 要与 PDB 的下限一起规划，才不会互相打架。",
    },
    {
      type: "quiz",
      question:
        "shop-api 有 3 个副本，每个副本 requests.cpu=500m；HPA 目标 averageUtilization=50。实测三个副本 CPU 合计 900m，HPA 控制器会怎么处理？",
      options: [
        "利用率 60%，高于目标，期望副本约 4 个（按比例向上取整），执行扩容",
        "利用率 60%，没超过 100%，保持 3 个副本不动",
        "利用率 180%（900 除以 500），会扩到 6 个副本",
        "分母应取 limits，利用率无法计算",
      ],
      answer: 0,
      explanation:
        "平均利用率 = 实际用量之和 ÷ requests 之和 = 900m ÷ (3×500m) = 60%；高于目标 50%，期望副本数按比例取整：3 × 60% ÷ 50% = 3.6，向上取整为 4，所以扩容到 4。选项 2 把目标和 100% 混为一谈；选项 3 的分母错拿成单个副本的 requests；选项 4 说反了——分母是 requests 之和，与 limits 无关。",
    },
    {
      type: "quiz",
      question: "一个 Deployment 的容器没有写任何 resources，给它配 CPU 平均利用率型 HPA 会发生什么？",
      options: [
        "HPA 改用节点总 CPU 作为指标，正常工作",
        "HPA 无法计算平均利用率（缺少 requests 分母），拿不到目标指标，不会自动伸缩并会报错",
        "kubelet 自动补一个默认 requests，HPA 照常工作",
        "HPA 自动切换到内存指标继续伸缩",
      ],
      answer: 1,
      explanation:
        "平均利用率 = 实际用量 ÷ requests，容器没声明 requests 时这个分母不存在，metrics API 里就没有可用的利用率数据，HPA 会在事件中报错且不伸缩。kubelet 不会补默认 requests；只有管理员在命名空间配置了 LimitRange 之类机制才会补默认值（那是第 10 章《命名空间治理》的内容，默认不开启）。",
    },
    {
      type: "keypoints",
      items: [
        "伸缩闭环：metrics-server 采指标 → HPA 控制器按目标算期望副本 → 写 scale 子资源 → Deployment/ReplicaSet 照常调谐。",
        "averageUtilization = 实际 CPU 合计 ÷（副本数 × 单副本 requests）；分母是 requests，所以伸缩与调度共享同一本账。",
        "autoscaling/v2 三件套：scaleTargetRef + min/maxReplicas + metrics；自动伸缩必须有界。",
        "节奏：默认约 15 秒评估一次、扩大与缩小都有防抖窗口且缩小更保守——精确数值以官方文档为准。",
        "kind 本地实验装 metrics-server 需追加 --kubelet-insecure-tls，生产禁止这样做。",
      ],
    },
  ],
};
