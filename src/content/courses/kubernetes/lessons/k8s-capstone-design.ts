/* ==================================================================
 * 课时：设计：把 shop 变成一份清单（k8s-capstone-design）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把 shop 书店系统拆成一张可落地的对象清单：为每个组件做架构决策、定下成功标准，为部署、发布与故障演练三课立好验收线。",
  blocks: [
    {
      type: "paragraph",
      text: "前面十一课把 Kubernetes 拆成一个个技能单独练：对象模型、工作负载、网络、配置、存储、伸缩、运维。真实系统恰恰相反——所有机制同时在场。综合实战的玩法是让 shop 书店系统在 kind 三节点集群里从零「长」出来，一共四节课：本课做设计，后面三课分别做分层部署、发布与伸缩、故障注入与恢复。本课不写一行完整 YAML（那是下一课的事），只回答一个问题：这套系统需要哪些对象、每个对象为什么存在。产出物是一张「将创建对象清单」和一套成功标准，后面每一课、每一步都对照它验收。",
    },
    {
      type: "heading",
      text: "需求复盘：shop 到底是什么",
    },
    {
      type: "paragraph",
      text: "shop 是一个最小但完整的书店业务骨架，四类组件、一种访问形态：shop-web 是静态店面（nginx:1.27-alpine，容器端口 80），对用户提供页面；shop-api 扮演书店接口服务，用的是 registry.k8s.io/echoserver:1.10——注意它只是「模拟接口」，镜像只会把收到的请求原样回显，没有任何书店业务逻辑，它的存在是为了练习接口服务的部署、服务发现与伸缩，真实项目这一格应换成你的业务镜像；shop-cache（redis:7.4-alpine，6379）与 shop-db（postgres:16-alpine，5432）在链路内部，分别演示缓存与数据库两类数据角色。全部对象放进一个 shop 命名空间，全课命令统一带 -n shop。端到端路径是：用户请求从 Ingress 进入，路径 / 落到 shop-web、/api 落到 shop-api，shop-api 与 shop-db、shop-cache 的访问都发生在集群内部。",
    },
    {
      type: "callout",
      variant: "example",
      title: "shop-api 为什么用 echoserver",
      body: "echoserver 零配置、监听 8080、对任何路径都返回 200 并回显请求信息，是理想的「可部署哑后端」——把注意力留给 Kubernetes 机制而不是业务代码。如果你在真实项目里替换它，镜像地址的形态就像 registry.example.com/team/shop-api:v1.2.3（这是示例地址，用于示意私有仓库写法，不是可拉取的镜像）。",
    },
    {
      type: "heading",
      text: "架构决策：应用形态决定对象",
    },
    {
      type: "paragraph",
      text: "决策的主线只有一句话：先问「这个组件有没有状态、要不要多副本」，再决定工作负载类型，其余对象围绕它展开。shop-web 无状态且要支持滚动发布，用 Deployment 两副本；shop-api 无状态且要演示水平伸缩，用 Deployment 两副本起步；shop-cache 是单点缓存，单副本 Deployment 就够——缓存数据丢了可以重灌，不需要 StatefulSet 的稳定身份与逐副本卷，这正是第 3 章《StatefulSet：有状态应用的秩序》里选型决策表的使用场景；shop-db 有状态，数据必须活过 Pod，用 StatefulSet 加逐副本 PVC。下面把每个决策点过一遍。",
    },
    {
      type: "subheading",
      text: "服务与入口",
    },
    {
      type: "paragraph",
      text: "shop-web、shop-api、shop-cache 各自配一个普通 ClusterIP Service，作为稳定的访问入口；shop-db 必须配 headless Service（clusterIP: None），否则 StatefulSet 的 Pod 拿不到稳定 DNS 身份——机制回指第 3 章《StatefulSet：有状态应用的秩序》与第 4 章《Service：稳定的访问入口与 DNS》。集群只有一个对外入口，却有两个要暴露的服务，所以入口用 Ingress 按路径分发：/ 给店面、/api 给接口（第 4 章《Ingress 与 Gateway API：七层入口》）。若集群里暂时没有 Ingress 控制器，退路是 NodePort 或 port-forward 验证，但正式验收以 Ingress 为准。",
    },
    {
      type: "subheading",
      text: "配置与口令的划分",
    },
    {
      type: "paragraph",
      text: "配置与口令沿用第 3、5 章建立的全课共享对象并做一次收敛：shop-web-html 存首页静态内容（整卷挂载进 nginx 的 html 目录，卷挂载会被 kubelet 同步更新——第 5 章《ConfigMap：配置与镜像分离》）；数据库凭据集中在 Secret shop-db-credentials（POSTGRES_USER/POSTGRES_DB/POSTGRES_PASSWORD 三键，postgres 容器 envFrom 一次注入——与第 3 章《StatefulSet：有状态应用的秩序》同构）。第 5 章练习里的 shop-web-nginx（immutable 的 server 配置）属专项演示对象，本清单不再使用，需要时按同一模式补一个即可。Secret 里的 base64 只是编码不是加密（第 5 章《Secret：敏感数据与信任边界》）；清单里写入口令是为了演练闭环，生产环境口令应走外部管理，不回填入镜像与 Git。",
    },
    {
      type: "subheading",
      text: "数据卷与探针、资源",
    },
    {
      type: "paragraph",
      text: "老版本 kind 没有默认 StorageClass，2026 年起的较新 kind 会自带 local-path 默认存储类。为了让演练与「集群里有没有默认类」解耦，shop-db 的数据卷按第 6 章《PV、PVC 与 StorageClass：存储的声明式抽象》演练过的形态做静态供给：一个 hostPath PV 加 StatefulSet 的 volumeClaimTemplate（claim 显式声明空 storageClassName，只绑定无类静态 PV，任何 kind 版本行为一致）。hostPath 目录只存在于一个节点上，因此用节点标签加 nodeSelector 把 shop-db 钉到那个节点（第 7 章《亲和、反亲和与污点容忍》）；这也意味着该节点不能被随意 drain，第 10 章《节点维护：cordon、drain 与故障自愈》和第 6 章的边界在这里交汇。每个容器都显式声明 requests/limits：有了配额之后，不写资源的裸 Pod 会被拒收（第 10 章《命名空间治理：配额与多团队》），同时 requests 是 HPA 计算利用率的基准（第 7 章《HPA：按负载水平伸缩》）。shop-web 与 shop-api 都要配探针与 PDB——探针是滚动发布的刹车，PDB 是自愿中断的地板（第 2 章《生命周期、重启与三种探针》、第 10 章《节点维护：cordon、drain 与故障自愈》）。",
    },
    {
      type: "subheading",
      text: "两条「先不做的决策」",
    },
    {
      type: "paragraph",
      text: "NetworkPolicy 默认不启用。两个理由：kind 默认的 CNI（kindnet）不执行 NetworkPolicy，写了只会给人「已经在防护」的错觉（第 4 章《NetworkPolicy：集群内的流量防线》明确过这个现实）；但第 50 课故障演练需要一条「写错策略」的对象，届时用它演示误伤如何发生、如何排查。HPA 不在部署阶段创建：shop-api 的 HPA 放到第 49 课发布与伸缩演练中（autoscaling/v2，CPU 平均利用率目标，min 2、max 5），min 取 2 是为了与 PDB 的 minAvailable=1 相容——缩到 1 副本时一次 drain 就会卡住，回指第 7 章《HPA：按负载水平伸缩》。",
    },
    {
      type: "heading",
      text: "将创建对象清单",
    },
    {
      type: "paragraph",
      text: "把上面的决策收敛成一张表。对象分三批落地：第 48 课创建全部部署对象（含 PDB），第 49 课追加 HPA，第 50 课临时创建故障演练用的对象（负载 Pod、故障策略等），演练完即删。「关键字段」只列决定身份与行为的字段，其余细节以第 48 课的 YAML 为准。",
    },
    {
      type: "table",
      caption: "将创建对象清单（第 12 章部署蓝图）",
      headers: ["对象类型", "名称", "关键字段", "理由"],
      rows: [
        ["Namespace", "shop", "名称即全部", "系统边界：配额、网络策略、RBAC 的作用域，先于一切对象创建"],
        ["ResourceQuota", "shop-quota", "requests.cpu=1、requests.memory=1.5Gi、limits.cpu=2、limits.memory=3Gi", "给 shop 一个可计算的资源预算；第 50 课「扩容被拒」演练靠它触发"],
        ["LimitRange", "shop-defaults", "defaultRequest/default：cpu 100m、memory 64Mi 起", "给临时调试 Pod 兜底资源声明，否则它们会被配额拒收"],
        ["ConfigMap", "shop-web-html", "data.index.html", "店面首页文案与镜像分离；卷挂载到 nginx html 目录"],
        ["Secret", "shop-db-credentials", "stringData：POSTGRES_USER / POSTGRES_DB / POSTGRES_PASSWORD", "数据库用户、库名与口令集中管理；Opaque，base64 只是编码不是加密，envFrom 注入（同第 3/5 章共享对象）"],
        ["PersistentVolume", "pv-shop-db", "hostPath /mnt/shop-db、2Gi、ReadWriteOnce、Retain", "静态供给 db 数据卷（PVC 显式空 storageClassName，只与无类 PV 绑定）"],
        ["StatefulSet", "shop-db", "1 副本、serviceName=shop-db、volumeClaimTemplate=data、nodeSelector shop-db=hosted、探针", "有状态：稳定标识 + 独立 PVC，删除 Pod 不丢数据"],
        ["Service（headless）", "shop-db", "clusterIP: None、5432", "给 StatefulSet Pod 稳定 DNS 身份"],
        ["Deployment", "shop-web", "2 副本、nginx:1.27-alpine、readiness httpGet /、minReadySeconds=10", "静态店面：可滚动发布、可回滚"],
        ["Service", "shop-web", "ClusterIP 80→80，selector app=shop-web", "店面稳定入口，Ingress / 的后端"],
        ["Deployment", "shop-api", "2 副本、registry.k8s.io/echoserver:1.10、requests.cpu=100m、探针", "模拟接口服务；requests 是 HPA 利用率基准"],
        ["Service", "shop-api", "ClusterIP 8080→8080，selector app=shop-api", "接口稳定入口，Ingress /api 的后端"],
        ["Deployment", "shop-cache", "1 副本、redis:7.4-alpine", "缓存可重建，故单副本 Deployment 而非 StatefulSet"],
        ["Service", "shop-cache", "ClusterIP 6379", "内部访问 redis 的稳定入口"],
        ["PodDisruptionBudget", "shop-web-pdb / shop-api-pdb", "minAvailable=1，selector 对应 app", "自愿中断的地板：drain 节点时至少留 1 个可用副本"],
        ["Ingress", "shop-ingress", "host shop.example.com（示例域名）、/→shop-web、/api→shop-api", "单入口按路径分发；生产应补 TLS 证书 Secret"],
        ["HorizontalPodAutoscaler", "shop-api（第 49 课创建）", "min 2、max 5、CPU 平均利用率 50%", "副本数跟随负载；min=2 与 PDB 相容"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "hostPath 只属于本地演练",
      body: "清单里的 PV 行是 hostPath，数据就在某个节点的目录里——节点没了数据就没了，这正是第 6 章反复强调的边界。生产环境把这一行换成 StorageClass 动态供给或云盘即可，其余清单不用动：这就是「存储的声明式抽象」带来的好处（回指第 6 章《PV、PVC 与 StorageClass：存储的声明式抽象》）。",
    },
    {
      type: "heading",
      text: "成功标准：后面三课的验收线",
    },
    {
      type: "paragraph",
      text: "一张清单只是图纸，能验收才算交付。给 shop 定五条成功标准，第 48–50 课结束时逐条对照打勾，任何一条不满足都算演练失败。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "全部就绪：kubectl -n shop get pods 中四类工作负载全部 Running 且 READY 满格（web 与 api 各 2、cache 1、db 1）——第 48 课逐层验证。",
        "服务与发现：集群内 busybox 用短名 shop-web、shop-api 能访问；shop-db 的 headless 解析返回 Pod IP 而非虚拟 IP——第 48 课验证。",
        "端到端入口：带 Host: shop.example.com 访问集群 80 端口，/ 返回店面首页、/api/… 返回 echoserver 的回显——第 48 课验证。",
        "发布不断流：第 49 课滚动发布与回滚全程，持续请求首页不出现失败；依赖 2 副本 + 探针 + minReadySeconds + PDB 的组合。",
        "坏了能回来：第 50 课杀 Pod 自动重建、误删配置可恢复、drain 尊重 PDB、数据库数据活过 Pod 重启。",
      ],
    },
    {
      type: "keypoints",
      items: [
        "应用形态决定对象：无状态多副本用 Deployment，有状态用 StatefulSet，入口用 Ingress，配置与口令分进 ConfigMap/Secret，数据进 PVC，预算与地板靠 ResourceQuota 与 PDB。",
        "对象清单的价值在「理由」栏：说不出为什么存在的对象，删掉也不可惜；能说清的，后面写 YAML 时每一步都有据可依。",
        "成功标准先于实现：五条标准把设计、部署、发布、故障恢复四节课串成同一条验收链。",
      ],
    },
    {
      type: "exercise",
      title: "练习：从失败模式反推设计决策",
      description:
        "对着上面的清单表做两件事。第一件：任选 4 行对象，为每一行写一句「如果删掉它，shop 会以什么方式坏掉」（例如：删掉 shop-web 的探针，发布时坏版本会怎样；删掉 shop-api 的 Service，集群里怎么访问它）。第二件：为 shop-db 写一个你打算在部署完成后亲自动手验证的行为，比如「把 shop-db-0 删掉，观察 StatefulSet 重建后数据是否还在」，并说明这个行为验证了哪条成功标准。",
      hint: "失败的三种典型来源：没有控制器（对象是裸的，死了没人管）、没有稳定入口（Pod IP 会变，DNS 没处解析）、没有预算与地板（资源失控、自愿中断无下限）。从这三个方向反推，理由栏会写得又快又准。",
    },
  ],
};
