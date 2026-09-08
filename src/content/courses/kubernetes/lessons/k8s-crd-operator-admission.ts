/* ==================================================================
 * 课时：扩展：CRD、Operator 与准入 Webhook（k8s-crd-operator-admission）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "三种扩展集群的方式：CRD 造出新的数据模型、控制器与 Operator 赋予行为、准入 Webhook 施加请求策略——以及判断什么时候值得自研 Operator。",
  blocks: [
    {
      type: "paragraph",
      text: "前三课回答的是「内建对象如何被实现」：请求怎么穿过 apiserver、控制器怎么调谐、etcd 怎么保持一致。本课换一个方向：当内建对象装不下你的领域时，怎么让集群长出新的能力。shop-db 可以用 StatefulSet 表达「一个数据库」，但它表达不了「备份计划」「版本升级策略」「主从切换」这类领域意图。Kubernetes 把扩展拆成三块积木：CRD 造数据模型、控制器（及 Operator）造行为、准入 Webhook 造请求策略。三块可以独立使用，也常常组合——本课逐个讲清，最后给你一把「值不值得自研」的尺子。",
    },
    {
      type: "heading",
      text: "CRD：给集群增加一种对象",
    },
    {
      type: "paragraph",
      text: "CRD（CustomResourceDefinition，自定义资源）让 apiserver 认识你的 kind。定义完成后，这个 kind 就像内建对象一样可以 apply、get、watch，拥有自己的 REST 路径，可以用 apiGroups 里你的组名做 RBAC 授权，甚至能进入 kubectl explain。一个 CRD 清单的骨架长这样（group 用了示例域名 shop.example.com，仅作示意，正式使用必须换成你控制的域名）：",
    },
    {
      type: "code",
      title: "一个 CRD 骨架：书店促销活动 Bookstore",
      language: "yaml",
      code: `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: bookstores.shop.example.com
spec:
  group: shop.example.com
  scope: Namespaced
  names:
    plural: bookstores
    singular: bookstore
    kind: Bookstore
    shortNames:
      - bs
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                title:
                  type: string
                replicas:
                  type: integer
                  minimum: 1`,
    },
    {
      type: "paragraph",
      text: "逐个看关键字段：metadata.name 必须是「复数 + 点 + group」的形式；names 里的 plural 决定 REST 路径，比如上例的访问路径是 /apis/shop.example.com/v1/namespaces/shop/bookstores；scope 决定对象是命名空间级（Namespaced）还是集群级（Cluster）；versions 数组里每个版本声明 served（是否对外提供）与 storage（etcd 里以哪个版本存储）——多个版本可以并存，但同一时刻只有一个 storage: true，跨版本转换需要额外的转换逻辑；最后的 openAPIV3Schema 定义字段结构与校验规则，类型不对、replicas 小于 1 的请求在 apiserver 就会被拒。CRD 一律使用 GA 版本 apiextensions.k8s.io/v1。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "只有 CRD = 只有存储",
      body: "apply 一个 Bookstore 对象后什么都不会发生——不会有人为它创建 Deployment，也不会有人检查它是否健康。CRD 只让 apiserver「能存、能查、能校验」这份数据，行为必须由控制器提供。这是扩展中最常见的误解：把 CRD 当成了功能本身。",
    },
    {
      type: "heading",
      text: "Operator：把运维知识写成控制器",
    },
    {
      type: "paragraph",
      text: "上一课讲过，控制器把现实拉向期望状态。Operator 就是「CRD + 控制器」的组合，只是它调谐的期望状态来自某个领域的专业对象：把「如何正确运维某类软件」的 runbook 编码成代码——用户声明「我要一个高可用、每周备份的 PostgreSQL」，Operator 控制器负责对比现实（实例在不在、主从是否正常、备份是否过期）并执行动作（创建 StatefulSet、触发备份、故障时切换主从），之后持续纠正任何漂移。",
    },
    {
      type: "table",
      caption: "几个成熟 Operator 各在调谐什么（一句话定位）",
      headers: ["生态组件", "它定义的 CRD", "它在调谐什么"],
      rows: [
        ["cert-manager", "Certificate", "证书从申请到到期续期，并把新证书写进对应 Secret（第 5 章《Secret：敏感数据与信任边界》）"],
        ["Prometheus Operator", "ServiceMonitor 等", "把监控目标与告警规则翻译成 Prometheus 配置并持续同步"],
        ["数据库 Operator（多家）", "数据库实例类 CRD", "实例生命周期、备份恢复、高可用切换"],
      ],
    },
    {
      type: "paragraph",
      text: "这与前面的课是闭环：第 6 章《CSI 与有状态应用的生产注意》说过数据库的高可用 k8s 不内置、常由 Operator 负责——现在你明白它的工作方式了：一个把「数据库期望状态」调谐成现实的控制器。",
    },
    {
      type: "paragraph",
      text: "自研之前先搜生态：数据库、消息队列、证书、Ingress 控制器这些领域都有成熟的 Operator，第 8 章提过的 Gatekeeper 也是现成实现。什么情况才值得自研：你的领域有清晰的状态机、有可重复的运维闭环（健康检查 + 修复动作），且生态里没有对应物；同时你要养得起控制器代码——实现通常借助 controller-runtime 这类框架，具体编写不在本课范围。一把简单的检验尺：如果运维动作能写成「检查 → 修复」的清单，它就适合变成 Operator；如果只是「部署一次」，用 Deployment 就够了。",
    },
    {
      type: "heading",
      text: "准入 Webhook：在对象落库前修改或拒绝",
    },
    {
      type: "paragraph",
      text: "回到本章《一次 API 请求的旅程》的请求链：认证之后、鉴权之后、写库之前是准入阶段。除内建准入插件外，Kubernetes 允许你把自己的策略挂上这条链，形式是两类 Webhook：",
    },
    {
      type: "list",
      items: [
        "MutatingAdmissionWebhook（变更类）：收到请求后可以修改对象再放行——经典用途是注入：给 Pod 自动加 sidecar（服务网格的注入就是这样做的）、补默认值、打标签；修改后的对象会继续走完后续环节",
        "ValidatingAdmissionWebhook（校验类）：只能看、不能改，决定放行或拒绝——策略类需求都在这：禁止拉取某仓库的镜像、强制所有 Pod 声明资源限额；第 8 章提过的 Gatekeeper 就是把 OPA 策略引擎以 Validating Webhook 的形式接入，而 Pod Security Admission 则是内建在准入链上的校验器（第 8 章《工作负载加固：securityContext 与 Pod Security》）",
      ],
    },
    {
      type: "definition",
      term: "failurePolicy",
      definition: "Webhook 服务不可用（网络中断、超时、返回错误）时 apiserver 怎么办：Fail 表示拒绝这次请求——策略宁可错杀不可放过，安全优先；Ignore 表示跳过该 Webhook 放行——可用性优先。变更类与校验类都只作用于写请求（create/update/delete），读请求不经过 Webhook。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "failurePolicy: Fail 的双刃",
      body: "把 failurePolicy 设为 Fail 意味着：一旦 Webhook 服务本身宕机或升级出错，所有匹配的写请求都会被拒绝——发布直接卡死，而问题根源是「门卫自己倒了」。上线前必须给 Webhook 服务配好副本与超时，并用 dry-run（第 5 章《配置发布实践》课讲过）在真实流量前验证规则。",
    },
    {
      type: "heading",
      text: "三块积木如何拼成平台能力",
    },
    {
      type: "paragraph",
      text: "把三块拼起来，就是「平台工程」的常见形态：CRD 定义领域词汇（数据），控制器或 Operator 执行领域逻辑（行为），准入 Webhook 施加组织策略（约束）。例如给团队提供「数据库即服务」：数据库 CRD + Operator 负责实例生命周期，Validating Webhook 限制只能申请几种规格、Mutating Webhook 自动补上团队标签与配额归属。到这里，本章就与前面串成了完整回路：控制器机制（上一课）给了 Operator 的骨架，准入链（本章第一课）给了 Webhook 的位置，而第 8 章的安全策略（PSA、Gatekeeper）正是挂在这条链上的第一批乘客。",
    },
    {
      type: "quiz",
      question: "只创建了一个 CRD、没有配套控制器，下面哪句描述正确？",
      options: [
        "该 kind 的对象无法创建，apiserver 会拒绝",
        "对象能正常存取与校验，但不会有任何自动化行为发生",
        "对象会自动创建配套的 Deployment 等资源",
        "需要为每个命名空间单独安装一次该 CRD",
      ],
      answer: 1,
      explanation: "CRD 让 apiserver 具备存储与 schema 校验能力，但行为必须由控制器提供——没有控制器，对象只是「能存能查」的数据。选项 A 错误，创建请求只要通过 schema 校验就会被接受；选项 C 是控制器（Operator）的职责，不会自动发生；选项 D 混淆了命名空间级对象与集群级的 CRD 本身——CRD 是集群级资源，安装一次全局生效。",
    },
    {
      type: "quiz",
      question: "一个 Validating Webhook 配置了 failurePolicy: Fail，随后它的服务进程宕机。此时匹配该 Webhook 规则的写请求会怎样？",
      options: [
        "照常执行，Webhook 的规则暂时失效",
        "被 apiserver 拒绝，直到 Webhook 服务恢复",
        "只影响读请求，写请求不受影响",
        "apiserver 会自动重启 Webhook 服务并重放请求",
      ],
      answer: 1,
      explanation: "Fail 的语义是「门卫联系不上就拒绝」，保证策略不会被静默绕过——代价是 Webhook 服务自身成为可用性单点，这正是上一段 callout 提醒要配副本与超时的原因。选项 A 是 Ignore 的语义；选项 C 错误，准入 Webhook 只作用于写请求，读请求本来就不经过它；选项 D 不存在这样的机制，apiserver 不负责托管你的 Webhook。",
    },
    {
      type: "keypoints",
      items: [
        "CRD 用 apiextensions.k8s.io/v1 定义新对象：group/names/scope/versions/schema；只有 CRD 等于只有存储",
        "Operator = CRD + 控制器，把「检查→修复」的运维清单变成持续调谐的代码；先搜生态再决定自研",
        "准入 Webhook 挂在写请求的准入阶段：Mutating 能改请求，Validating 只能放行或拒绝",
        "failurePolicy 决定门卫失联时怎么办：Fail 拒绝（安全优先）、Ignore 跳过（可用性优先）",
      ],
    },
  ],
};
