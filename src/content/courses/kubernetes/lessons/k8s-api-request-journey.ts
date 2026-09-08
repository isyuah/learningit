/* ==================================================================
 * 课时：一次 API 请求的旅程（k8s-api-request-journey）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "跟随一次 API 请求穿过 apiserver 的认证、鉴权、准入与校验落到 etcd，再看读路径上的 list-watch 如何把变化持续推给所有客户端。",
  blocks: [
    {
      type: "paragraph",
      text: "在第 1 章《集群解剖：一次部署请求的旅程》里，我们跟着一次 kubectl apply 从组件外部看了一遍协作：apiserver 收下请求、控制器调谐、调度器选节点、kubelet 起容器。那时 apiserver 还是个黑盒。本课把它打开：一次请求从客户端出发，在 apiserver 内部穿过哪些环节才真正生效；客户端又如何持续感知集群变化。这是本章后续三课的地基——控制器靠本课的 list-watch 活，etcd 与准入 Webhook 都挂在同一条链上。",
    },
    {
      type: "heading",
      text: "apiserver 是唯一入口",
    },
    {
      type: "paragraph",
      text: "集群里几乎一切通信都以 apiserver（kube-apiserver）为终点或起点：它是唯一同时具备「认证、鉴权、准入、持久化」能力的组件。所有角色都以普通 API 客户端的身份访问它，没有谁拥有特权通道。",
    },
    {
      type: "list",
      items: [
        "人：kubectl、Dashboard 等客户端工具",
        "控制面：控制器管理器（kube-controller-manager）里的各个控制器、调度器（kube-scheduler）",
        "节点侧：节点代理（kubelet）上报节点状态与 Pod 状态、拉取分配给自己的 Pod 定义；网络代理（kube-proxy）watch Service 与 EndpointSlice",
        "扩展：HPA、自定义控制器（第 9 章《扩展：CRD、Operator 与准入 Webhook》一课会讲）以及各类 Operator",
        "自动化：CI/CD 工具、监控与备份脚本",
      ],
    },
    {
      type: "paragraph",
      text: "「唯一入口」的设计带来两个结果：一是安全策略只需在一处实施——第 8 章《RBAC：谁可以对什么做什么》里所有授权规则都作用于 apiserver 的请求；二是写操作只有一个闸门，杜绝了绕过校验的旁路写入。反过来也意味着：想绕过 API 直接动底层数据，等于破坏集群自己的约定。",
    },
    {
      type: "heading",
      text: "写请求的五道关卡",
    },
    {
      type: "paragraph",
      text: "一次写请求（create / update / delete）在 apiserver 内部按顺序过关，任何一关拒绝，请求到此为止，不会到达存储层：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "TLS 与认证（authentication）：确认「你是谁」，失败返回 401",
        "鉴权（authorization）：确认「你能做这件事吗」，失败返回 403",
        "准入（admission）：内建准入插件与准入 Webhook 可以修改或拒绝请求",
        "校验与默认值：字段合法性检查与缺省值填充",
        "写入 etcd：对象被序列化、分配 resourceVersion 后持久化",
      ],
    },
    {
      type: "paragraph",
      text: "第一关只回答身份。客户端通过 kubeconfig 里的客户端证书或 token 证明自己；运行在集群里的 Pod 则用自动挂载的 ServiceAccount token（第 8 章《RBAC》课讲过它的挂载与关闭方式）。认证只负责「认得你」，不负责「允许你」。",
    },
    {
      type: "paragraph",
      text: "第二关才是授权。apiserver 把请求的动词（verb：get/list/create/update/delete/watch…）与资源（apiGroups/resources）拿去和 RBAC 规则比对，得出放行或 403。控制器之所以能替你创建 Pod，不是因为它比你权限大，而是它的 ServiceAccount 恰好被绑定了相应 Role——你在第 8 章亲手验证过的最小权限原则，在这里就是字面意义的执行。",
    },
    {
      type: "paragraph",
      text: "第三关准入是请求链上唯一能「看请求内容本身并改写或拦下」的位置。内建例子你已见过：Pod Security Admission 在命名空间 enforce 标签下拒绝违反 restricted 档的 Pod（第 8 章《工作负载加固：securityContext 与 Pod Security》）；ResourceQuota 在创建时核算命名空间配额（第 10 章《命名空间治理：配额与多团队》一课会讲）。第 9 章《扩展：CRD、Operator 与准入 Webhook》一课要讲的 Mutating/Validating Webhook 也挂在这一关。",
    },
    {
      type: "paragraph",
      text: "第四关做两件事：填默认值、做校验。技术细节上，默认值在对象解码阶段就已被填入（例如 Pod 的 restartPolicy 默认 Always、Deployment 滚动参数默认 25%），因此准入环节看到的已经是完整对象；这里把它与校验放在一起讲，是因为对使用者而言它们是「落库前的最后把关」。校验按对象 schema 检查字段类型、必填项与约束，不合法直接拒绝。",
    },
    {
      type: "paragraph",
      text: "第五关落库。对象被序列化并以 /registry/… 为前缀的键写入 etcd；etcd 确认成功，apiserver 才向客户端返回成功。随后 apiserver 会把这次变化广播给所有正在监听的客户端——这正是下一节读路径的故事。",
    },
    {
      type: "heading",
      text: "读路径与 list-watch：变化如何被持续感知",
    },
    {
      type: "paragraph",
      text: "写是一次性问答，但控制器需要「一直知道」：副本被删了、Pod 变 Ready 了、Secret 被改了。如果所有客户端都靠轮询，apiserver 会被自己人压垮。Kubernetes 给读方提供的是 list-watch 两段式协议：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "LIST：先拉一次全量（例如 shop 命名空间下所有 Pod），响应附带 resourceVersion——集群状态此刻的版本号",
        "WATCH：带上该 resourceVersion 发起长连接监听，之后只收增量事件（ADDED / MODIFIED / DELETED）",
        "断线恢复：连接中断则从断点版本号重连，或重新 LIST，保证不丢变化",
      ],
    },
    {
      type: "paragraph",
      text: "resourceVersion 还有第二个用途：乐观并发。更新对象时可以带上读到的 resourceVersion 作为前提条件，若期间对象已被别人改过，apiserver 返回 409 Conflict 而不是悄悄覆盖——API 层遇到的「冲突」错误就是这个机制在保护你不丢更新。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "把读路径变成观察",
      body: "可以在集群里亲手感受这个协议：`kubectl api-versions` 看集群提供的 API 组与版本；另开一个终端跑 `kubectl get pods -n shop -w`，再在别处删除一个 shop 的 Pod——`-w` 就是 kubectl 对 WATCH 的封装，你会看到该 Pod 行消失、新 Pod 行出现（ReplicaSet 补的副本，机制见下一课）。",
    },
    {
      type: "heading",
      text: "discovery 与 API 版本：客户端如何知道有什么",
    },
    {
      type: "paragraph",
      text: "一个资源的完整身份是「组 + 版本 + 种类」（group/version/kind），例如 apps/v1 的 Deployment、networking.k8s.io/v1 的 Ingress。`kubectl api-versions` 列出的就是集群当前服务的全部组与版本，其底层是 /api/v1 与 /apis/<group>/<version> 的 discovery 端点——客户端（包括 kubectl 自己）通过它发现可用的 API，而不是把版本表硬编码进代码。",
    },
    {
      type: "paragraph",
      text: "为什么 API 要带版本：接口需要演进。beta 版本会调整字段甚至被移除（一个例子：v1.32 移除了 flowcontrol v1beta3，改用 flowcontrol.apiserver.k8s.io/v1），而 GA（v1）版本承诺长期兼容——这也是本课程所有示例只用 GA API 的原因。`kubectl explain` 能逐字段解释对象，靠的正是 apiserver 通过 OpenAPI 暴露的 schema：「对象有哪些合法字段」本身就是 API 的一部分。",
    },
    {
      type: "heading",
      text: "放大回放：一次 kubectl apply 内部发生了什么",
    },
    {
      type: "paragraph",
      text: "把第 1 章的故事升级到协议层，一次 `kubectl apply` 大致是：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "kubectl 读取清单，确定资源的 group/kind，必要时先走 discovery 确认存在",
        "先 GET 线上对象，与本地清单、上次应用记录三方比较，算出需要变更的字段",
        "以 create（对象不存在）或 update/patch（已存在）发出请求",
        "请求穿过前面五关：认证 → 鉴权 → 准入 → 默认值与校验 → 写入 etcd",
        "提交成功后 resourceVersion 递增，apiserver 向所有 watch 者广播事件——如果监听的正是 Deployment，控制器管理器里的 Deployment 控制器随即被唤醒，进入下一课《控制器模式：watch、调谐与 finalizer》的世界",
      ],
    },
    {
      type: "paragraph",
      text: "值得强调：kubectl、控制器、kubelet 的每一次写都走完全相同的五关，没有「内部快捷方式」。这正是 RBAC 与准入策略能约束一切客户端的原因——你在第 8 章做的加固实验，本质上都是在给这扇唯一的门加规则。",
    },
    {
      type: "heading",
      text: "为什么业务不能直连 etcd",
    },
    {
      type: "paragraph",
      text: "etcd 只是分布式键值存储：它不认识对象模型，不提供字段校验、版本化 watch 语义与鉴权分层，etcd 里的数据是 apiserver 的私有表示。直接写 etcd 会绕过认证、鉴权与准入——等于把第 8 章建的所有防线全部架空，还可能写入损坏状态。因此 etcd 只被 apiserver 访问，业务与控制器一律走 API。至于 etcd 自己如何在多成员间保持一致（多数派、选主），是本章《高可用控制面：etcd 与选举》一课的题目。",
    },
    {
      type: "quiz",
      question: "一个控制器要持续感知某类对象的变化，最合理的方式是？",
      options: [
        "每秒钟 GET 一次全量列表并自行比较差异",
        "先 LIST 全量拿到 resourceVersion，再用它发起 WATCH 收增量事件，断线后从断点恢复",
        "让 apiserver 定期把全量数据主动推给控制器",
        "绕过 API 直接读 etcd 的数据",
      ],
      answer: 1,
      explanation: "list-watch 正是为「持续感知」设计的：LIST 建立基线，WATCH 只收增量，断线可恢复，不会丢变化也不浪费轮询。选项 A 的轮询能工作但会放大 apiserver 负载；选项 C 的「主动推送」不是 API 提供的机制；选项 D 直连 etcd 会绕过本课讲的全部防线。",
    },
    {
      type: "keypoints",
      items: [
        "apiserver 是唯一入口：所有客户端（人、控制器、kubelet、扩展）都走同一道门，策略只实施一次",
        "写路径五关：认证 → 鉴权 → 准入 → 默认值与校验 → 写 etcd，任何一关拒绝即终止",
        "读路径靠 list-watch：LIST 拿基线 + resourceVersion，WATCH 收增量，断线可恢复；resourceVersion 同时是乐观并发的凭据",
        "discovery 让客户端发现 API 组与版本；etcd 只被 apiserver 访问，业务一律走 API",
      ],
    },
  ],
};
