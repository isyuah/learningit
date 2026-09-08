/* ==================================================================
 * 课时：Service：稳定的访问入口与 DNS（k8s-service-basics）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Service 用 ClusterIP、selector 与端口三元组把一组会变化的 Pod 收敛成稳定入口，由 EndpointSlice 维护后端、kube-proxy 做 DNAT、CoreDNS 提供名字。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课留下的问题很具体：Pod 重建后 IP 会变；就算 IP 不变，请求方也不该自己维护「哪个 Pod 还活着」的清单。集群需要一层抽象：一个名字和地址永远不变，背后却自动跟着一组 Pod 走——Pod 挂掉由 Deployment 补新的，新 Pod 的 IP 自动进入这组后端。这就是 Service。本课先讲清它的三个构成（入口、selector、端口映射），再回答两个机制问题：后端列表从哪来（EndpointSlice）、虚拟 IP 怎么生效（kube-proxy 的 DNAT），最后用 shop-api 完整验证一遍 DNS 与连通。",
    },
    {
      type: "heading",
      text: "Service 的三件事：入口、选后端、端口映射",
    },
    {
      type: "paragraph",
      text: "一个 Service 对象描述三件事：给集群内的访问者一个固定的入口地址；用 selector 选出「哪些 Pod 属于这个服务」；定义端口映射——访问者连入口的哪个端口，转发到后端 Pod 的哪个端口。先看 shop-api 的完整清单。",
    },
    {
      type: "code",
      title: "svc-shop-api.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: shop
spec:
  selector:
    app: shop-api
  ports:
    - name: http
      protocol: TCP
      port: 80
      targetPort: 8080`,
    },
    {
      type: "paragraph",
      text: "这份清单没有写 type，默认值就是 ClusterIP。逐字段看：port 80 是访问者使用的端口——集群内访问 shop-api:80 即可，不需要知道后端细节；targetPort 8080 是转发目的地，echoserver 容器真正监听的端口；protocol 默认 TCP；name 在单端口时可写可不写，一旦一个 Service 暴露多个端口，每个端口必须有唯一且 DNS 兼容的名字（如 http、metrics），端口名也可以被 targetPort 按名字引用。selector 只认 label：它不看 Deployment 的边界，凡是带 app: shop-api 标签且就绪的 Pod 都会被选中——如果两个 Deployment 用了同一个标签，它们的所有副本都会进同一个后端池，这既是能力的来源也是误配的温床（第 11 章《Service 与网络排障》会把 selector 拼错列为最常见根因）。",
    },
    {
      type: "heading",
      text: "后端列表从哪来：EndpointSlice",
    },
    {
      type: "paragraph",
      text: "「selector 选中的 Pod 集合」本身也要落成 API 对象，否则 kube-proxy 和调试者都无从查看。控制面里的 EndpointSlice 控制器 watch Service 与就绪的 Pod，维护一组 discovery.k8s.io/v1 的 EndpointSlice 对象：每个 slice 是一批后端地址（IP + 端口），并按 Service 打上标签。就绪探针失败的 Pod 不会出现在 slice 里——这正是第 2 章《生命周期、重启与三种探针》预告过的「readiness 失败 ≠ 重启，而是被从 Service 摘除」。查看命令与预期如下。",
    },
    {
      type: "code",
      title: "查看后端列表",
      language: "bash",
      code: `kubectl -n shop get svc shop-api
kubectl -n shop get endpointslices -l kubernetes.io/service-name=shop-api
# 预期：svc 的 CLUSTER-IP 列有地址、PORT(S) 列为 80/TCP；
# endpointslices 里能看到后端 Pod 的 IP 与端口 8080`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "没有 selector 的 Service",
      body: "Service 也可以不写 selector——此时控制器不会自动生成后端。你可以手动创建与 Service 同名的 EndpointSlice（或旧式 Endpoints 对象），把地址指向集群外的 IP。这是「云上数据库迁移期先接外部实例、服务名保持不变」的经典用法：应用只改配置不改代码。日常调试看到 Endpoints 为空，先怀疑 selector 写错，而不是怀疑网络。",
    },
    {
      type: "heading",
      text: "ClusterIP 如何生效：kube-proxy 的 DNAT 直觉",
    },
    {
      type: "paragraph",
      text: "ClusterIP 是虚拟的：它不属于任何节点的网卡，也没有任何进程在监听它。它之所以能用，是因为每台节点上的 kube-proxy 都根据 Service 与 EndpointSlice，把规则写进了本机的 iptables。数据路径一句话直觉：一个从 Pod A 发往 <ClusterIP>:80 的包，先经过本机 netfilter 的 KUBE-SERVICES 链命中规则，随即被 DNAT（目的地址改写）成某个后端 Pod 的 IP:8080，再按普通路由送出去；后端返回的应答包到达本机时，conntrack（连接跟踪）依据记录的连接把源地址还原成 ClusterIP——对客户端而言，全程只看见 Service 的地址，它甚至不知道流量被转发过。规则随机挑后端，天然完成了负载均衡。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "集群内互访请走 Service，不要直连 Pod IP",
      body: "直连 Pod IP 会绕过 Service 带来的全部能力：负载均衡、就绪摘除、稳定地址。一旦那个 Pod 因发布或故障被重建，硬编码的 IP 立即失效。这也是「为什么集群内访问 Service 用 ClusterIP 而不是 Pod IP」的答案：ClusterIP 是声明出来的稳定契约，Pod IP 是实现细节。",
    },
    {
      type: "heading",
      text: "服务发现：CoreDNS 与 FQDN",
    },
    {
      type: "paragraph",
      text: "有了稳定入口，还要回答「名字从哪来」。集群里跑着一组 CoreDNS（在 kube-system 命名空间，以 Deployment 形式提供集群 DNS），它 watch Service 的变化并生成记录：每个普通 Service 有一条 A 记录，完整域名（FQDN）是 <服务名>.<命名空间>.svc.cluster.local，解析到它的 ClusterIP；域名后缀 cluster.local 是集群默认 DNS 域名。每个 Pod 的 /etc/resolv.conf 都指向 CoreDNS，并且配置了搜索域：在 shop 命名空间里查短名 shop-api，解析器会依次尝试 shop-api.shop.svc.cluster.local 等后缀——所以同命名空间内可以直接用短名，跨命名空间则必须写全名，比如 shop-api.shop.svc.cluster.local。",
    },
    {
      type: "paragraph",
      text: "几个需要精确区分的变体：headless Service（spec.clusterIP: None）不生成虚拟 IP，DNS 直接返回全部后端 Pod 的 IP——它牺牲负载均衡换取「知道所有后端」的能力，主要用途是给 StatefulSet 提供稳定网络身份（第 3 章《StatefulSet：有状态应用的秩序》讲过它的必要性），普通无状态服务不要用它。sessionAffinity 默认 None（每个连接随机选后端）；少数需要会话保持的场景可设为 ClientIP，让同一来源的请求固定落在同一后端，多数无状态服务保持默认即可。",
    },
    {
      type: "heading",
      text: "动手验证：从 busybox 里探测 DNS 与连通",
    },
    {
      type: "paragraph",
      text: "前提是 shop 命名空间里已有 shop-api 的副本在跑（沿用第 3 章《滚动更新、回滚与发布策略》中带探针部署的清单，它给 Pod 打的标签正是 app: shop-api）。先应用上面的 Service，再起一个一次性的 busybox Pod 进到里面验证。",
    },
    {
      type: "code",
      title: "应用 Service 并进入调试 Pod",
      language: "bash",
      code: `kubectl apply -f svc-shop-api.yaml
kubectl -n shop get deploy shop-api   # 确认副本 READY
kubectl -n shop run net-debug --image=busybox:1.36 --restart=Never -it --rm -- sh`,
    },
    {
      type: "code",
      title: "在调试 Pod 里验证 DNS 与连通",
      language: "bash",
      code: `nslookup shop-api
# 预期：能看到 Server（集群 DNS 地址）以及
# shop-api.shop.svc.cluster.local 解析出的 ClusterIP

nslookup shop-api.shop.svc.cluster.local   # 全名与短名结果一致

wget -qO- http://shop-api/
# 预期：返回 echoserver 的回显（以 Host、Path 等开头的键值行），
# 说明「短名解析 + 经 ClusterIP 转发到 8080」整条链路已通`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "排查时的三层拆解",
      body: "从调试 Pod 里按顺序试：ping 后端 Pod IP（通不通是网络层问题）、nslookup（解析对不对）、wget Service 名（Service 层通不通）。每层独立验证，能快速定位问题在 CNI、DNS 还是 Service 配置——第 11 章《Service 与网络排障》会把这套方法系统化。",
    },
    {
      type: "quiz",
      question: "在 shop 命名空间里部署了 shop-api 后，你新建的 Service 把 selector 写成了 app: shop-apis（多打了一个 s），此时从 busybox 里访问该 Service 名会怎样？",
      options: [
        "解析正常，但请求超时或连接被拒——因为后端 EndpointSlice 为空，ClusterIP 上没有可转发的目标",
        "DNS 解析直接失败，nslookup 报域名不存在",
        "请求会随机转发到 shop 命名空间里的任意 Pod",
        "kube-proxy 会报错并把 Service 删除",
      ],
      answer: 0,
      explanation:
        "Service 对象本身创建成功，CoreDNS 照样为它生成 A 记录（DNS 只关心 Service 是否存在，与 selector 无关），所以解析正常；但没有任何 Pod 匹配错误的 selector，EndpointSlice 为空，kube-proxy 无后端可转发，连接自然超时或被拒。这正对应「Endpoints 为空先查 selector」的排查顺序。",
    },
    {
      type: "keypoints",
      items: [
        "Service = 稳定入口（ClusterIP）+ selector 选后端 + port/targetPort/protocol 端口三元组。",
        "后端列表由 EndpointSlice 控制器维护，就绪 Pod 才会入选；无 selector 的 Service 可手动指到集群外。",
        "ClusterIP 是虚拟 IP：每节点 kube-proxy 写 iptables DNAT 规则 + conntrack 还原，实现负载均衡。",
        "CoreDNS 提供 <服务名>.<命名空间>.svc.cluster.local 记录，同命名空间可用短名；headless 返回 Pod IP 列表。",
      ],
    },
  ],
};
