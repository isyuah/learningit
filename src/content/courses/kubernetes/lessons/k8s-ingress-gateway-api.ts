/* ==================================================================
 * 课时：Ingress 与 Gateway API：七层入口（k8s-ingress-gateway-api）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "NodePort/LoadBalancer 每个服务都要一个入口；Ingress 在七层用一个入口按域名与路径把流量分发给多个 Service，Gateway API 是它面向多角色的下一代演进。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课结尾留了个问题：shop 有 web、api 两个服务，如果按四层方案暴露，得申请两个公网入口、记两个地址，而且入口只认 IP:端口，无法按「哪个域名、哪个路径」路由。服务一多这条路就走不通。Ingress 把入口从「每服务一个」变成「全集群统一一个」：它是七层的反向代理抽象，一个入口按 host 与 path 把请求分发给不同的 Service。本课讲清 Ingress 的模型与常见坑，给出 kind 里的实操路线，最后介绍它的下一代 Gateway API 并给出选型判断。",
    },
    {
      type: "heading",
      text: "Ingress：按 host 与 path 分发",
    },
    {
      type: "code",
      title: "ingress-shop.yaml",
      language: "yaml",
      code: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop-ingress
  namespace: shop
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: shop-api
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: shop-web
                port:
                  number: 80`,
    },
    {
      type: "paragraph",
      text: "这份清单表达的是：host 为 shop.example.com 的请求，凡是以 /api 开头的交给 shop-api 这个 Service，其余交给 shop-web。backend 引用的就是上一课创建的 Service——Ingress 只做分发，真正的后端选择仍然由 Service 完成。注意它只声明「想要什么」，不包含任何代理程序：Ingress 规范与实现是分离的，这一点下一节展开。上面的示例地址 shop.example.com 是本地演练用的假域名，需要在 hosts 文件里手动解析。",
    },
    {
      type: "heading",
      text: "pathType：前缀匹配的边界",
    },
    {
      type: "table",
      caption: "pathType 语义",
      headers: ["pathType", "匹配规则", "示例"],
      rows: [
        ["Prefix", "按 / 切分路径段后做整段前缀匹配", "/api 匹配 /api、/api/、/api/v1/orders；不匹配 /apiv1、/apix"],
        ["Exact", "请求路径必须与声明完全一致", "/api 只匹配 /api，/api/ 或 /api/v1 都不行"],
        ["ImplementationSpecific", "语义由具体控制器实现决定（官方仅保证向后兼容）", "一般不用，特殊控制器行为才需要"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "前缀是按段切的，不是字符串前缀",
      body: "Prefix 的边界以 / 划分：/api 能匹配 /api/orders 是因为 orders 是独立的一段，而 /apiv1 的整段是 apiv1，不等于 api，所以不匹配——这是初学者最常踩的坑。另外同一条路径上多个规则重叠时，Ingress 控制器按「最长匹配优先」，host 的精确匹配优先于通配。排障时先确认你写的 path 与请求路径是否在同一个「段级前缀」关系里。",
    },
    {
      type: "heading",
      text: "TLS 终止：证书放在 Secret 里",
    },
    {
      type: "code",
      title: "带 TLS 的 Ingress（示意）",
      language: "yaml",
      code: `spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - shop.example.com
      secretName: shop-tls
  rules:
    - host: shop.example.com
      http:
        paths: []`,
    },
    {
      type: "paragraph",
      text: "想用 HTTPS 时，在 tls 段声明「哪些域名、用哪个证书」：证书本身由管理员提前以 Secret 形式放进同一命名空间（类型为 kubernetes.io/tls，内含 tls.crt 与 tls.key），Ingress 控制器读取该 Secret 并在自身终止 TLS——浏览器与控制器之间是 HTTPS，控制器与后端 Pod 之间通常是明文 HTTP。证书从哪来、如何申请与轮换属于证书管理范畴；Secret 的形态与安全边界在第 5 章《Secret：敏感数据与信任边界》展开。本地 kind 演练没有真实证书，通常跳过 TLS 段直接验证 HTTP。",
    },
    {
      type: "heading",
      text: "IngressClass 与控制器：声明与实现分离",
    },
    {
      type: "paragraph",
      text: "Ingress 只是声明，真正干活的是一类「Ingress 控制器」程序——常见如 ingress-nginx，它本身是跑在集群里的负载器，watch Ingress 对象并把规则翻译成自己的代理配置。spec.ingressClassName: nginx 引用一个 IngressClass 对象，后者指名由哪个控制器实现；集群里可以同时装多套控制器，用 ingressClassName 选择。集群没有安装任何控制器时，apply Ingress 不会报错，但也不会有任何效果——ingress 资源会一直停在没有 ADDRESS 的状态。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "没装控制器，Ingress 就是一份死文档",
      body: "创建 Ingress 后记得验证两件事：控制器 Pod 在运行（如 kubectl -n ingress-nginx get pods），以及 kubectl get ingress 能看到 ADDRESS。只 apply 清单却收不到流量时，先查控制器而不是查 Service。",
    },
    {
      type: "heading",
      text: "在 kind 里实操：extraPortMappings + ingress-nginx",
    },
    {
      type: "paragraph",
      text: "kind 的节点是容器，默认只暴露少量端口。要让宿主机的 80/443 能进集群，需要在创建集群时声明额外端口映射；同时 ingress-nginx 的官方 kind 部署要求节点带 ingress-ready=true 标签（在创建时通过 kubeadmConfigPatches 给控制面节点打上）。extraPortMappings 只在集群创建时生效，所以本课建议新建一个专用集群（或重建 k8s-course，注意会清空其中的对象）。",
    },
    {
      type: "code",
      title: "ingress-kind-config.yaml",
      language: "yaml",
      code: `kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-ingress
nodes:
  - role: control-plane
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 80
        protocol: TCP
      - containerPort: 443
        hostPort: 443
        protocol: TCP
  - role: worker
  - role: worker`,
    },
    {
      type: "code",
      title: "安装控制器并验证",
      language: "bash",
      code: `kind create cluster --config ingress-kind-config.yaml
# 安装 ingress-nginx：在 kind 中安装 ingress-nginx 的官方步骤见 kind 官方文档
# （kind.sigs.k8s.io/docs/user/ingress），控制器清单用官方提供的 kind 专用
# 部署文件，镜像版本需与集群版本匹配，以官方文档为准。
kubectl apply -f <官方 kind 部署清单>

# 等控制器就绪后检查
kubectl -n ingress-nginx get pods
kubectl get ingressclass
# 预期：控制器 Pod 状态 Running，能看到名为 nginx 的 IngressClass`,
    },
    {
      type: "paragraph",
      text: "控制器就绪后，把第 3 章部署的 shop-api、shop-web 工作负载连同它们各自的 Service（写法见《Service：稳定的访问入口与 DNS》）放进 shop 命名空间，再应用本课的 ingress-shop.yaml。然后在 hosts 文件里加一行「127.0.0.1 shop.example.com」（Windows 在 C:\\Windows\\System32\\drivers\\etc\\hosts，Linux/macOS 在 /etc/hosts），即可从宿主机验证：",
    },
    {
      type: "code",
      title: "端到端验证",
      language: "bash",
      code: `curl http://shop.example.com/api
# 预期：返回 echoserver 回显，说明 /api 前缀路由到了 shop-api
curl http://shop.example.com/
# 预期：返回 nginx 店面的页面，说明其余路径路由到了 shop-web`,
    },
    {
      type: "heading",
      text: "Gateway API：面向多角色的下一代入口",
    },
    {
      type: "paragraph",
      text: "Ingress 的局限在大型集群里逐渐明显：一个 Ingress 对象同时承担「我想要什么路由」与「全局域名/路径不能冲突」的协调，缺少角色划分。Gateway API 是社区（与 Ingress 同源的 SIG Network）推出的下一代入口规范，核心思路是把入口拆成三个角色各管一层的对象：",
    },
    {
      type: "list",
      items: [
        "GatewayClass：集群级对象，声明「用哪个实现」，地位相当于 IngressClass。",
        "Gateway：集群运维者创建，声明入口监听哪些端口与协议（相当于声明「这一个负载器实例」）。",
        "HTTPRoute：应用团队创建，声明某个 host/path 路由到哪个 Service——不再直接碰端口与负载器。",
      ],
    },
    {
      type: "paragraph",
      text: "角色分离带来的实际好处：应用团队只写路由规则，基础设施团队统一管理网关实例，域名与路径的冲突协调有了更清晰的归属。Gateway API 以 CRD 形式独立于 Kubernetes 核心发布（不随 kubectl 内置），按标准（standard）与实验（experimental）两个通道分发：标准通道的 API 承诺稳定向后兼容，实验通道先行容纳较新的路由类型与字段。截至本课程核实时间（2026-09）其最新版本为 v1.6.x；安装方式一句话：从 Gateway API 官方发布页下载对应版本的 CRD 清单（standard 与 experimental 二选一，不要同时装）后 kubectl apply，具体步骤以官方安装文档为准。和 Ingress 一样，Gateway API 只是规范，必须搭配一个控制器实现（如 ingress-nginx 网关版、Envoy 系网关等）才能真正转发流量。",
    },
    {
      type: "table",
      caption: "Ingress 与 Gateway API 的选择",
      headers: ["维度", "Ingress", "Gateway API"],
      rows: [
        ["成熟度", "GA 多年、生态与文档最广，仍是当前默认", "较新，但 v1.x 起已可用于生产、演进活跃"],
        ["角色模型", "单一对象，路由与入口由同一份清单表达", "GatewayClass/Gateway/HTTPRoute 三层分离"],
        ["表达能力", "host/path 路由为主", "协议路由、流量拆分等更丰富（实验通道更多）"],
        ["适合谁", "存量集群、团队习惯、求稳", "新项目、多团队分工、有多协议与灰度诉求时评估"],
      ],
    },
    {
      type: "paragraph",
      text: "结论一句话：存量 Ingress 成熟稳定、短期不会被废弃，本课程实操沿用 Ingress；团队新项目若有明确的多团队、多协议或流量治理诉求，可以评估 Gateway API，但两者的前置条件一致——都需要一个真正运行的控制器。",
    },
    {
      type: "quiz",
      question: "你 apply 了一份 Ingress 清单，集群里也部署了 shop 的 Service，但 curl 对应域名始终不通，且 kubectl get ingress 看不到 ADDRESS。最可能的原因是什么？",
      options: [
        "集群里没有安装任何 Ingress 控制器，Ingress 声明没有被任何程序实现",
        "pathType 写成了 Exact 导致路径不匹配",
        "Ingress 必须引用 LoadBalancer 型 Service 才能工作",
        "host 里的域名必须真实注册且能被公网 DNS 解析",
      ],
      answer: 0,
      explanation:
        "Ingress 是声明与实现分离的：没有控制器时它只是存起来的文档，不会有 ADDRESS、不会有流量。pathType 错误会造成「控制器在但路由不对」，表现不同；Ingress 引用普通 ClusterIP Service 即可；本地演练用 hosts 文件解析假域名即可，不需要真实 DNS 注册。",
    },
    {
      type: "keypoints",
      items: [
        "Ingress 在七层用一个入口按 host/path 分发到多个 Service，解决「每服务一个公网入口」的浪费。",
        "pathType 前缀按 / 切段匹配（/api 匹配 /api/orders 但不匹配 /apiv1）；TLS 证书以 Secret 存放、由控制器终止。",
        "IngressClass + 控制器 = 声明与实现分离，没装控制器 Ingress 只是死文档。",
        "kind 实操需要带 extraPortMappings 的集群 + 官方 ingress-nginx kind 部署；Gateway API 是角色分离的下一代，新项目可评估。",
      ],
    },
  ],
};
