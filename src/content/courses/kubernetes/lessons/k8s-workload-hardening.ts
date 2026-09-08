/* ==================================================================
 * 课时：工作负载加固：securityContext 与 Pod Security（k8s-workload-hardening）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "用 securityContext 逐项收紧容器的运行形态（非 root、裁剪 capabilities、只读根文件系统），再用 Pod Security Admission 把标准变成命名空间级的强制政策。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课用 RBAC 管住了「谁能操作集群」。但真正跑业务的容器，默认以什么身份、什么权限运行？答案可能让你意外：相当宽松——镜像声明 root 就以 root 运行，内核能力（capabilities）基本全量，根文件系统可写。本课把工作负载这一侧的默认值逐个收紧：先用 securityContext 在清单里声明「容器长什么样」，再用 Pod Security 标准把这些要求变成命名空间级的准入政策，让不合规的清单根本提交不进来。",
    },
    {
      type: "heading",
      text: "默认运行形态为什么太宽松",
    },
    {
      type: "paragraph",
      text: "如果清单没有写 runAsUser，容器就以镜像声明的用户启动，而很多镜像默认是 root。宽松的默认值叠加出三个风险：",
    },
    {
      type: "list",
      items: [
        "root 运行：进程权限上限高，一旦代码漏洞被利用，能做的破坏面大；",
        "capabilities 未裁剪：容器默认携带一组长于日常所需的内核能力，等于把不必要的攻击面留在原地；",
        "根文件系统可写：被攻破后可以落盘后门、改写配置，留下持久化痕迹。",
      ],
    },
    {
      type: "heading",
      text: "securityContext：声明容器的运行形态",
    },
    {
      type: "paragraph",
      text: "securityContext 就是把上述三点写进清单的地方。它出现在两个层级：Pod 级给出该 Pod 内所有容器的默认值；容器级可以覆盖 Pod 级。注意 capabilities、allowPrivilegeEscalation、readOnlyRootFilesystem 这些字段本身是容器级的：",
    },
    {
      type: "code",
      title: "Pod 级默认值 + 容器级收紧",
      language: "yaml",
      code: `spec:
  securityContext:              # Pod 级：作为默认值
    runAsNonRoot: true
    runAsUser: 1000
  containers:
    - name: api
      securityContext:          # 容器级：覆盖/补充
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        readOnlyRootFilesystem: true`,
    },
    {
      type: "paragraph",
      text: "逐个理解关键项：",
    },
    {
      type: "list",
      items: [
        "runAsNonRoot：强制容器内进程以非 0 用户运行，UID 为 0 时 kubelet 拒绝启动。前提是镜像真的能非 root 跑——这正是很多镜像需要改造的地方；",
        "runAsUser：显式指定 UID（如 1000）。与 runAsNonRoot 一起写最明确；",
        "capabilities：drop: [\"ALL\"] 把容器默认能力全部清空，再按需 add。典型例子：nginx 要绑定 80 端口时加 NET_BIND_SERVICE；",
        "allowPrivilegeEscalation: false：禁止进程通过 setuid 之类的机制提升权限，与「非 root 运行」配合才完整；",
        "readOnlyRootFilesystem: true：根文件系统只读，程序要写临时文件就显式挂 emptyDir（用法回指第 6 章卷的讲解）。",
      ],
    },
    {
      type: "paragraph",
      text: "为什么「root」值得单独强调：容器内的 root 并不是节点上的 root——容器有独立的命名空间隔离，第 2 章《Pod 与容器：解剖一个 YAML》讲过这一点。但容器与节点共享同一个内核，未裁剪能力、未关提权的 root 进程一旦配合漏洞实现逃逸，后果最严重；所以即便存在隔离，收敛 root 仍是工作负载加固的第一优先。",
    },
    {
      type: "heading",
      text: "Pod Security Admission：把要求变成政策",
    },
    {
      type: "paragraph",
      text: "securityContext 是「自觉填写」——忘了写没人拦。Pod Security Admission（PSA）是内置于 kube-apiserver 准入链的控制器，按命名空间的标签检查提交的 Pod，把加固从自觉变成强制。Pod Security Standards（Pod 安全标准）定义了由松到严的三档：",
    },
    {
      type: "table",
      caption: "PSA 三档定位",
      headers: ["档位", "定位", "典型拦截点"],
      rows: [
        ["privileged", "不施加限制（等同未启用 PSA）", "不拦截；给需要特权的系统级负载用"],
        ["baseline", "拦掉已知高危的提权面", "privileged 容器、共享主机 PID/IPC 命名空间、危险 capabilities、不安全卷类型"],
        ["restricted", "面向可无特权运行负载的最佳实践", "在 baseline 之上：非 root 运行、禁提权、capabilities 清空、seccomp 默认档、卷类型进一步收窄"],
      ],
    },
    {
      type: "paragraph",
      text: "准入标签有三个维度，值都是 privileged/baseline/restricted 之一：",
    },
    {
      type: "list",
      items: [
        "enforce：不达标直接拒绝，Pod 不会创建；",
        "warn：放行，但向客户端（kubectl）返回警告；",
        "audit：放行，把违规事件记入 apiserver 审计日志（审计机制的正式讲解在第 9 章《一次 API 请求的旅程》）。",
      ],
    },
    {
      type: "code",
      title: "命名空间标签：观察期配置",
      language: "yaml",
      code: `apiVersion: v1
kind: Namespace
metadata:
  name: shop
  labels:
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted`,
    },
    {
      type: "paragraph",
      text: "生产里推荐「分层启用」，而不是一步 enforce：先在目标命名空间开 warn/audit 观察一段时间，把业务清单逐个改到达标，最后再开 enforce。还要记住：enforce 只检查之后提交的新建与更新，已在运行的 Pod 不受影响，需要滚动重建才会按新档位重新校验。",
    },
    {
      type: "code",
      title: "观察 → 修复 → 强制",
      language: "bash",
      code: `kubectl label ns shop pod-security.kubernetes.io/warn=restricted
kubectl label ns shop pod-security.kubernetes.io/audit=restricted
# ……把 shop 的清单逐个改到达标并回归验证后……
kubectl label ns shop pod-security.kubernetes.io/enforce=restricted`,
    },
    {
      type: "heading",
      text: "restricted 会拒绝什么：一个被拒示例与修复",
    },
    {
      type: "paragraph",
      text: "restricted 在 baseline 之上还要求：非 root 运行、allowPrivilegeEscalation=false、capabilities 清空（最多只可加 NET_BIND_SERVICE）、seccompProfile 为默认档、卷类型进一步收窄（seccomp/AppArmor 是比 PSA 更底层的系统调用与强制访问控制限制，配置细节本课不展开，以官方文档为准）。拿一个「什么都没写」的 shop-api 试一次，用一个一次性命名空间演示，避免影响 shop 业务：",
    },
    {
      type: "code",
      title: "准备 enforce=restricted 的演示命名空间",
      language: "bash",
      code: `kubectl create ns psa-demo
kubectl label ns psa-demo pod-security.kubernetes.io/enforce=restricted`,
    },
    {
      type: "code",
      title: "一个没做任何加固的 shop-api",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: psa-demo
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
            - name: http
              containerPort: 8080`,
    },
    {
      type: "paragraph",
      text: "apply 时预期被准入拒绝，错误特征形如：Error from server (Forbidden): ... violates PodSecurity \"restricted:latest\"，并把缺失项逐一列出（runAsNonRoot/runAsUser、allowPrivilegeEscalation、capabilities.drop、seccompProfile 等）。修复就是把这些字段补齐：",
    },
    {
      type: "code",
      title: "补齐 securityContext 后的 shop-api",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: psa-demo
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
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - name: http
              containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true`,
    },
    {
      type: "paragraph",
      text: "补上字段后再次 apply 就能通过，Pod 预期进入 Running。readOnlyRootFilesystem 并不是 restricted 的硬性要求，属于主动加分项——示例里一并加上。验证完删掉演示命名空间即可：kubectl delete ns psa-demo。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "字段达标 ≠ 镜像一定起得来",
      body: "以 nginx 官方镜像为例：它默认以 root 启动主进程，即使 securityContext 字段齐全，在 restricted 下也可能启动失败——要么改用支持非 root 入口的镜像/变体，要么把 nginx 配置里需要写入的路径（pid、日志、缓存）指到 emptyDir 挂载点。这正是 restricted 的目的：逼你选择真正能非 root 运行的镜像与配置。本课示例聚焦安全上下文字段的形态，运行级细节以镜像与官方文档为准。",
    },
    {
      type: "heading",
      text: "shop-web/shop-api 加固后的清单形态",
    },
    {
      type: "code",
      title: "shop-web 加固形态（web 需要绑 80，故保留 NET_BIND_SERVICE）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-web
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop-web
  template:
    metadata:
      labels:
        app: shop-web
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 101
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - name: http
              containerPort: 80
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
              add: ["NET_BIND_SERVICE"]
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: cache
              mountPath: /var/cache/nginx
            - name: run
              mountPath: /var/run
      volumes:
        - name: tmp
          emptyDir: {}
        - name: cache
          emptyDir: {}
        - name: run
          emptyDir: {}`,
    },
    {
      type: "paragraph",
      text: "讲解这个形态：Pod 级 securityContext 给出默认（非 root、指定 UID、seccomp 默认档），容器级收紧提权与 capabilities。shop-web 因为要监听 80 端口，清空后补一个 NET_BIND_SERVICE（这正是 restricted 唯一允许额外添加的能力）；根文件系统只读后，nginx 的临时、缓存与 pid 目录（/var/run）显式挂到 emptyDir。注意：官方 nginx 镜像的入口脚本默认以 root 启动，只改 securityContext 未必能直接跑起来（见上方 callout），这份清单是「形态示意」——要真正运行需二选一：改用支持非 root 入口的 nginx 变体（如 nginxinc/nginx-unprivileged，监听 8080，Service 与探针端口随之调整），或覆盖入口脚本、直接以 101 用户启动 nginx 并把 pid/日志/模板目录全部指到 emptyDir。restricted 的价值正在于此：逼你在镜像层就把非 root 运行解决掉。shop-api 的加固形态与上一节的修复版一致。把 shop 的清单都按此形态加固并回归验证后，再打开 shop 命名空间的 enforce，让之后任何新的不合规 Pod 都被准入挡在门外。",
    },
    {
      type: "heading",
      text: "更细的策略：准入 Webhook",
    },
    {
      type: "paragraph",
      text: "PSA 只有三档通用标准。需要组织自定义规则（例如「镜像必须来自内部仓库」「必须声明资源限额」）时，可以用 ValidatingAdmissionWebhook 一类的策略引擎——OPA/Gatekeeper 是常见代表，一句话定位：以策略代码补 PSA 之不足。它的机制层（Webhook 如何介入 apiserver 请求）在第 9 章《扩展：CRD、Operator 与准入 Webhook》展开。至此运行形态已经收紧，但「这个镜像本身能不能信」还没有回答——下一课处理镜像供应链与凭据保护。",
    },
    {
      type: "quiz",
      question:
        "某命名空间只打了 pod-security.kubernetes.io/warn=restricted 标签，此时提交一个违反 restricted 的 Pod，会发生什么？",
      options: [
        "请求被准入层拒绝，Pod 不会创建",
        "Pod 会被创建，但 kubectl 会打印它违反 restricted 的警告",
        "Pod 正常创建，运行一段时间后被 kubelet 杀掉",
        "Pod 会被创建，但只在服务端审计日志里留记录，客户端看不到任何提示",
      ],
      answer: 1,
      explanation:
        "warn 的语义是「放行 + 警告」：请求通过准入，kubectl 客户端会收到违反 restricted 的警告提示，所以选项 0 错（那是 enforce 的行为）。准入检查发生在创建时，不会等 Pod 运行后再杀，选项 2 错。audit 才是只记录到审计日志的维度，且 warn 与 audit 是相互独立的标签，选项 3 混淆了二者。",
    },
    {
      type: "keypoints",
      items: [
        "默认运行形态宽松：root、全 capabilities、可写根文件系统——securityContext 把它们逐项收紧",
        "Pod 级 securityContext 提供默认值，容器级可覆盖；capabilities/allowPrivilegeEscalation/readOnlyRootFilesystem 属于容器级字段",
        "PSA 三档 privileged/baseline/restricted，用命名空间标签 enforce/warn/audit 决定拦截、警告还是记录",
        "分层启用：先 warn/audit 观察暴露面，清单全部达标后再 enforce；更细的组织策略交给 Gatekeeper/OPA 等准入 Webhook 生态",
      ],
    },
  ],
};
