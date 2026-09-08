/* ==================================================================
 * 课时：NodePort、LoadBalancer 与 ExternalName（k8s-service-types）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "ClusterIP 只在集群内可达，对外暴露有三层台阶：NodePort 开节点端口、LoadBalancer 借云负载器分配公网入口、ExternalName 做 DNS 别名接集群外服务。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的 Service 让集群内部有了稳定入口，但 ClusterIP 是虚拟地址，集群外的浏览器、第三方系统依然够不着它。把服务暴露到集群外，Kubernetes 提供了一条渐进的三级台阶：NodePort 在每个节点上开一个端口；LoadBalancer 在云上分配一个真正的公网负载器；它们都建立在 ClusterIP 之上。另有 ExternalName 不走流量路径，只在 DNS 层做一个别名。本课讲清每级的机制、代价与适用场景，最后在 kind 里用 NodePort 做一次真实验证。",
    },
    {
      type: "heading",
      text: "NodePort：每个节点都开一个端口",
    },
    {
      type: "paragraph",
      text: "NodePort 的本质是「ClusterIP + 节点端口」：kube-proxy 在每台节点的 iptables 里额外监听一个高端口（默认范围 30000–32767，集群初始化时可调整），凡是到达 <节点IP>:<nodePort> 的包，都被 DNAT 转发到后端 Pod。规则在每台节点上都有，所以无论请求打到哪个节点都能通——这是「每个节点都开一个端口」的含义。谁会用到它：自管集群里没有云负载器时给外部调试用；云上 LoadBalancer 的底层载体也是它；kind 这类本地环境验证外部访问最方便。",
    },
    {
      type: "code",
      title: "svc-shop-api-nodeport.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Service
metadata:
  name: shop-api-nodeport
  namespace: shop
spec:
  type: NodePort
  selector:
    app: shop-api
  ports:
    - port: 80
      targetPort: 8080
      nodePort: 30080`,
    },
    {
      type: "paragraph",
      text: "nodePort 字段可选：不写时集群会在默认范围内自动分配一个（用 kubectl get svc 查看）。显式指定便于记住端口与写脚本，但要先确认没有别的 Service 占用。注意 nodePort 一旦确定，集群内通过 ClusterIP:80 访问的路径依然有效——NodePort 不是替代 ClusterIP，而是在它外面加了一层入口。",
    },
    {
      type: "heading",
      text: "kind 实操：用节点 IP:NodePort 访问 shop-api",
    },
    {
      type: "code",
      title: "应用并找到节点 IP",
      language: "bash",
      code: `kubectl apply -f svc-shop-api-nodeport.yaml
kubectl -n shop get svc shop-api-nodeport
# 预期：TYPE 列为 NodePort，PORT(S) 列为 80:30080/TCP

kubectl get nodes -o wide
# 预期：INTERNAL-IP 列给出每个节点的 IP（kind 节点在 Docker 网络上）`,
    },
    {
      type: "code",
      title: "从宿主机访问（任意一个节点 IP 均可）",
      language: "bash",
      code: `curl http://<任一节点IP>:30080/
# 预期：返回 echoserver 的回显——说明请求从集群外到达节点端口，
# 被 DNAT 转发到了某个 shop-api 后端 Pod`,
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么 kind 里能直接 curl 节点 IP",
      body: "kind 的节点是跑在 Docker 里的容器，节点 IP 是 Docker 网络上的地址，宿主机可以直接路由到它，因此无需额外端口映射。若从集群外更远的机器访问，则要求该机器与节点网络可达——NodePort 的语义就是把端口暴露到「节点所在的网络」。",
    },
    {
      type: "heading",
      text: "LoadBalancer：云上的一键入口",
    },
    {
      type: "paragraph",
      text: "LoadBalancer 是云环境的标准姿势：它先像 NodePort 一样把端口暴露到每台节点，然后由云控制器（cloud-controller-manager）调用云厂商的 API，创建一个外部负载均衡器，把公网流量转发到各节点的 NodePort 上。清单只需要改 type，其余照旧。",
    },
    {
      type: "code",
      title: "svc-shop-api-lb.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Service
metadata:
  name: shop-api-lb
  namespace: shop
spec:
  type: LoadBalancer
  selector:
    app: shop-api
  ports:
    - port: 80
      targetPort: 8080`,
    },
    {
      type: "paragraph",
      text: "应用后 kubectl get svc 的 EXTERNAL-IP 列会先显示 <pending>，等云控制器把负载器建好后才变成云分配的地址——地址分配的快慢取决于云厂商，通常需要几十秒到几分钟。kind 没有云控制器，所以 LoadBalancer 型 Service 会一直停在 <pending>：本地想体验「真公网入口」需要额外安装 MetalLB 之类的负载器，本课不展开。把 LoadBalancer 想成「NodePort + 云厂商替你建的转发器」就足够理解它了。",
    },
    {
      type: "heading",
      text: "externalTrafficPolicy：Cluster 与 Local 的取舍",
    },
    {
      type: "paragraph",
      text: "外部流量经过云负载器到达某个节点后，kube-proxy 该把包转发到哪里？spec.externalTrafficPolicy 控制这个决策，默认值是 Cluster：任何节点的入口流量都可能被转发到其他节点上的 Pod——多一跳，且源 IP 通常被改写为节点 IP，后端看不到真实客户端地址。设为 Local 则只转发到本节点上的 Pod：源 IP 得以保留，但代价是如果某节点上没有本地后端，打到它的流量会被直接丢弃（云负载器的健康检查应当把这样的节点摘掉），且各节点负载天然不均。",
    },
    {
      type: "table",
      caption: "externalTrafficPolicy 两值对比",
      headers: ["取值", "转发范围", "源 IP", "代价"],
      rows: [
        ["Cluster（默认）", "可转发到任意节点的后端 Pod", "被改写为节点 IP", "多一跳、后端看不到真实客户端"],
        ["Local", "只转发到本节点的后端 Pod", "保留客户端源 IP", "无本地后端的节点会丢流量、各节点负载不均"],
      ],
    },
    {
      type: "paragraph",
      text: "一句话取舍：需要真实客户端 IP（访问日志、限流按 IP）且能接受负载倾斜时用 Local；大多数内部服务用默认的 Cluster 即可。NodePort 型 Service 同样适用这个字段。",
    },
    {
      type: "heading",
      text: "ExternalName：DNS 层的别名",
    },
    {
      type: "code",
      title: "svc-legacy-api.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Service
metadata:
  name: legacy-api
  namespace: shop
spec:
  type: ExternalName
  externalName: legacy.example.com   # 示例地址，替换为真实的集群外主机`,
    },
    {
      type: "paragraph",
      text: "ExternalName 与前三种完全不同：它没有 selector、没有 ClusterIP，也不产生任何转发规则。它的效果发生在 DNS 层——CoreDNS 对 legacy-api.shop.svc.cluster.local 直接返回一条 CNAME 记录指向 externalName，应用照常用短名访问，连接实际落在集群外的主机上（端口由客户端请求指定，Service 不参与连接）。典型场景是把集群外的旧系统、托管数据库「伪装」成集群内的服务名，迁移期应用零改动。要注意它只做名字重定向、不做流量代理，也谈不上负载均衡与健康检查。",
    },
    {
      type: "heading",
      text: "怎么选：一张判据表",
    },
    {
      type: "table",
      caption: "Service 类型选择判据",
      headers: ["类型", "可达范围", "典型场景"],
      rows: [
        ["ClusterIP（默认）", "仅集群内部", "服务间互访、内部调用，默认首选"],
        ["NodePort", "节点网络可达者", "自管集群外部调试、LoadBalancer 的底层载体"],
        ["LoadBalancer", "公网", "云上对外提供服务的标准入口"],
        ["ExternalName", "无（DNS 别名）", "把集群外服务接入集群命名空间"],
      ],
    },
    {
      type: "paragraph",
      text: "还有一个重要提醒：上面四种都是「一个服务一个入口」的四层方案。当服务多起来，每个都申请公网入口既不经济也无法按域名/路径做路由——那正是下一课 Ingress 与 Gateway API（入口）要解决的问题：在七层做一个统一入口。",
    },
    {
      type: "quiz",
      question: "在 kind 集群（未安装任何负载器）里创建 type: LoadBalancer 的 Service 后，EXTERNAL-IP 一直显示 <pending>，最可能的原因是什么？",
      options: [
        "kind 没有云控制器来调用云厂商 API 创建负载均衡器，因此地址永远不会被分配",
        "Service 的 selector 写错了，导致后端 Pod 不被选中",
        "LoadBalancer 必须在公有云上创建，本地环境会直接报错拒绝创建",
        "需要先把 externalTrafficPolicy 改成 Local 才能分配地址",
      ],
      answer: 0,
      explanation:
        "LoadBalancer 的地址分配依赖云控制器调用云厂商 API；kind 没有云环境与云控制器，所以 Service 能创建成功但 EXTERNAL-IP 一直 pending。selector 错误影响的是 Endpoints 而不是 EXTERNAL-IP；本地创建 LoadBalancer 不会报错，只是停在 pending；externalTrafficPolicy 只影响转发策略，与地址分配无关。",
    },
    {
      type: "keypoints",
      items: [
        "对外暴露的三级台阶都建立在 ClusterIP 之上：NodePort 开节点端口（默认 30000–32767），LoadBalancer = NodePort + 云负载器。",
        "externalTrafficPolicy 默认 Cluster（可能二次跳转、源 IP 被改写），Local 保留源 IP 但会丢无本地后端的流量。",
        "ExternalName 只在 DNS 层返回 CNAME，不代理流量，用于把集群外服务接进集群。",
        "四层 Service 每服务一个入口；多个服务统一入口是 Ingress/Gateway API 的职责。",
      ],
    },
  ],
};
