/* ==================================================================
 * 课时：Service 与网络排障（k8s-network-troubleshooting）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "给「Service 不通」一条六步检查链：endpoints → Pod Ready → 直连 Pod IP → DNS → NetworkPolicy → externalTrafficPolicy，并配典型根因表。",
  blocks: [
    {
      type: "paragraph",
      text: "Pod 排障有个好处：出问题的大概率就是那个 Pod。网络排障则相反——「Service 不通」时，出问题的往往不是报错的那个对象，而可能是几跳之外的 selector、探针、DNS 或策略。这一课把第 4 章讲过的机制全部倒过来用：先给症状分类，再按一条固定检查链逐层排除，最后落到典型根因表。方法论还是上一课的骨架：症状 → 证据 → 假设 → 验证。",
    },
    {
      type: "heading",
      text: "先给症状分类",
    },
    {
      type: "table",
      caption: "网络症状 → 指向的层",
      headers: ["症状", "现象特征", "通常指向"],
      rows: [
        ["连接超时（timeout）", "请求发出后长时间无响应才失败", "丢包型：策略 drop、路由不通、后端负载过高"],
        ["连接拒绝（refused）", "立即失败，明确被告知没人监听", "端口层：targetPort 与容器监听不一致、后端没起、该节点无本地后端"],
        ["解析失败", "unknown host 一类错误，连 IP 都拿不到", "DNS 层：Service 名/命名空间写错、CoreDNS 异常"],
        ["间歇性失败", "时好时坏，重试偶尔成功", "多后端中部分不健康、探针抖动、流量倾斜"],
      ],
    },
    {
      type: "paragraph",
      text: "超时与拒绝是网络排障最重要的分水岭：超时说明「没有人回答」，链路某处把包丢了（防火墙式丢弃）；拒绝说明「有人明确回答不」，通常是端口没人监听。症状分类能帮你决定从检查链的哪一段开始，但拿不准时，永远从头走。",
    },
    {
      type: "heading",
      text: "标准检查链：六步逐层排除",
    },
    {
      type: "paragraph",
      text: "以 shop 命名空间里访问 shop-api 的 Service 为例。每一步都回答一个问题：这一步通过，问题在更深处；这一步失败，问题就在这一层。",
    },
    {
      type: "paragraph",
      text: "① Endpoints 有没有后端？`kubectl -n shop get endpoints shop-api`（或 describe svc 的 Endpoints 区）。Endpoints 由 Service 的 selector 自动维护（底层对象是 EndpointSlice，回第 4 章《Service：稳定的访问入口与 DNS》）。Endpoints 为空、只有 <none>，说明 selector 没配上任何 Pod——对照 `kubectl get pods -n shop -l app=shop-api` 检查标签拼写。这一步排掉一半的「Service 不通」。",
    },
    {
      type: "paragraph",
      text: "② 后端 Pod Ready 吗？`kubectl -n shop get pods -l app=shop-api` 看 READY 列。有 Pod 是 0/1，就是探针把它摘了——这是「Endpoints 有地址却仍然失败」之外最常见的情况：readiness 失败的 Pod 不会出现在 Endpoints 里。修探针而不是修网络，回《Pod 排障：从 Pending 到 CrashLoop》与第 2 章探针课。",
    },
    {
      type: "paragraph",
      text: "③ 直连后端 Pod IP 通吗？拿到 Pod IP（get pods -o wide），从集群内一个临时 busybox Pod 直接访问 Pod IP:端口。通 → CNI 与后端监听都正常，问题在 Service 层（端口映射、kube-proxy），继续往下走；不通 → 网络模型/CNI/节点层，回第 4 章《网络模型：每个 Pod 一个 IP》，生产环境要查节点上的 CNI 状态。这一步把「集群网络」和「Service 配置」切成两半，是整条链的分水岭。",
    },
    {
      type: "code",
      title: "起一个临时调试 Pod（用完即走）",
      language: "bash",
      code: `# 交互式进入 busybox（自带 wget 与 nslookup）
kubectl run -it --rm nettest -n shop --image=busybox:1.36 --restart=Never -- /bin/sh

# 进入后：直连后端 Pod IP（把 <POD_IP> 换成 -o wide 看到的 IP）
wget -qO- http://<POD_IP>:8080

# 解析 Service 的完整域名
nslookup shop-api.shop.svc.cluster.local`,
    },
    {
      type: "paragraph",
      text: "④ DNS 解析对吗？在调试 Pod 里 nslookup Service 的 FQDN：`shop-api.shop.svc.cluster.local`。能解析出 ClusterIP → DNS 正常；unknown host → 检查 Service 是否存在、命名空间是否写对（跨命名空间必须用 FQDN，同命名空间才能用短名），再查 CoreDNS 是否健康（回第 4 章《Service：稳定的访问入口与 DNS》；kube-dns 的 Pod 在 kube-system 里）。另外留意调试 Pod 自身的 /etc/resolv.conf——如果它连 kube-dns 都找不到，问题在 Pod 的 DNS 配置而不是 Service。",
    },
    {
      type: "paragraph",
      text: "⑤ 有没有 NetworkPolicy 拦截？`kubectl get networkpolicies -A` 看集群里有没有策略，以及目标 Pod 是否被规则命中。NetworkPolicy 默认是「无策略全放行、有匹配规则后该方向其余拒绝」，被策略丢弃的表现是超时而不是拒绝。注意现实差异：kind 默认的 kindnet 不执行 NetworkPolicy（回第 4 章《NetworkPolicy：集群内的流量防线》），所以 kind 里你不会因为策略不通——生产环境有策略时，这一步常常就是根因，而且 egress 策略会把 DNS 一起掐断。",
    },
    {
      type: "paragraph",
      text: "⑥ 对外路径（NodePort / LoadBalancer）？集群内直连都正常、只有从集群外访问有问题时，查 externalTrafficPolicy：默认 Cluster 会对包做源地址转换（SNAT），后端看到的源 IP 是节点 IP，且可能发生二次跳转；改成 Local 会保留源 IP，但只有本地有就绪后端的节点才转发——现象是 curl 某些节点 IP 通、另一些不通，或者流量倾斜。回第 4 章《NodePort、LoadBalancer 与 ExternalName》。用 describe svc 看 externalTrafficPolicy 字段，再对照后端 Pod 分布在哪些节点。",
    },
    {
      type: "heading",
      text: "工具与姿势",
    },
    {
      type: "paragraph",
      text: "临时调试 Pod 是网络排障的主力：busybox 镜像体积小、带 wget 与 nslookup，够覆盖第 ③④ 步。习惯用 `--rm`，退出即删，不留垃圾。另一个兜底工具是 port-forward：`kubectl port-forward svc/shop-api 8080:8080` 后本地 curl localhost:8080——它把流量直接送进后端、绕开 Service 的负载均衡数据路径，用来回答「问题到底在集群网络还是我这端」。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "别用 hostNetwork 当排查手段",
      body: "hostNetwork 的 Pod 直接占用节点网络栈，没有自己的 Pod IP，访问方式与普通 Pod 完全不同，还会引入端口冲突。用临时 Pod 排查时保持默认网络模式，否则测出来的结论在正常 Pod 上不成立。",
    },
    {
      type: "heading",
      text: "典型根因表",
    },
    {
      type: "table",
      caption: "Service 不通的典型根因（症状 → 证据 → 修复）",
      headers: ["现象", "根因", "关键证据", "修复方向"],
      rows: [
        ["Endpoints 为空，访问被拒绝", "Service selector 与 Pod 标签拼写不一致", "describe svc 的 Endpoints 为 <none>，对照 get pods -l 的标签", "修正 selector，回第 4 章《Service》"],
        ["请求被拒绝（refused）", "targetPort 与容器实际监听端口不一致", "直连 Pod IP 的通、走 Service 的不通，describe svc 的 targetPort 与容器监听对照", "改 targetPort，或让应用监听 targetPort"],
        ["间歇失败、时好时坏", "多副本中部分不健康/探针抖动，或流量倾斜", "READY 列不一致、各 Pod 日志差异、top 看资源", "修探针与应用健康，回《Pod 排障：从 Pending 到 CrashLoop》"],
        ["超时（丢包式）", "NetworkPolicy 该方向默认拒绝", "有策略且命中目标 Pod；直连通但被拦", "按需放行，回第 4 章《NetworkPolicy》"],
        ["NodePort 部分节点不通", "externalTrafficPolicy: Local 且该节点无就绪后端", "describe svc 看字段，对照后端 Pod 分布", "改回 Cluster，或确保每节点有本地后端"],
        ["解析失败", "Service 名/命名空间写错、CoreDNS 异常", "nslookup FQDN 结果", "用 FQDN、查 kube-dns，回第 4 章《Service》"],
      ],
    },
    {
      type: "heading",
      text: "定位练习：一个「Service 不通」的场景",
    },
    {
      type: "paragraph",
      text: "场景：你在 shop 命名空间给 shop-api 新建了 Service 想从 8080 改为对外 80。症状是：从 shop-web 的 Pod 里访问 shop-api:80 立即失败（连接被拒，不是超时）。你先收集到这些线索：Endpoints 有一个地址；后端 Pod 是 1/1 Running；从调试 Pod 直连该 Pod 的 IP:8080 成功，但直连 IP:80 被拒；nslookup 能解析出 ClusterIP。先不要往下读，用检查链判断：问题在哪一层？最可能是哪个根因？",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "复盘：推理过程",
    },
    {
      type: "paragraph",
      text: "按链走：① Endpoints 有地址 → selector 没问题，排除；② 后端 Ready → 排除探针摘流量；③ 直连 Pod IP:8080 通、IP:80 被拒 → 关键证据出现了——Pod 只监听了 8080，Service 却把流量导向 80；④ DNS 正常，排除。结论：问题在 Service 的端口映射层，最可能是 targetPort 写成了 80（或根本没写对），kube-proxy 把包 DNAT 到后端的 80 端口，而那里没有进程监听，于是立即拒绝。修复：把 Service 的 targetPort 改回 8080（或让后端监听 targetPort 指定的端口），然后重新验证。这条链的价值在于：第③步的「直连成功/失败」把集群网络与 Service 配置切成两半，配合症状分类（拒绝 = 端口层），几秒钟就能把范围从「整个网络」缩小到「一个字段」。抓包（如节点上 tcpdump）一般不需要走到那一步——先走完这条链再说。",
    },
    {
      type: "quiz",
      question: "Service 不通，且已确认：Endpoints 有地址、后端 Pod 全部 Ready、从 busybox 直连某后端 Pod 的 IP:8080 成功、nslookup 能解析出 ClusterIP。按检查链，问题最可能在哪一层？",
      options: [
        "Service selector 拼错",
        "Service 的 port/targetPort 与后端实际监听不一致（或 kube-proxy 数据路径异常）",
        "CoreDNS 故障",
        "CNI 网络不通",
      ],
      answer: 1,
      explanation: "Endpoints 有地址说明 selector 已经配上 Pod；直连 Pod IP 成功说明 CNI 与后端监听正常；DNS 能解析说明 CoreDNS 正常。链上剩余的是 Service 到后端的转发环节：端口映射（targetPort）与 kube-proxy 数据路径。selector 错会让 Endpoints 为空，DNS 故障会解析失败，CNI 不通会让直连也失败——这三个证据恰好把它们逐个排除。",
    },
  ],
};
