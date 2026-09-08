/* ==================================================================
 * 课时：生命周期、重启与三种探针（k8s-pod-lifecycle-probes）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Pod 提交之后会经历什么：两层状态模型、restartPolicy 的重启语义、liveness/readiness/startup 三种探针的分工，以及删除时 SIGTERM→宽限期→SIGKILL 的终止流程。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课解剖了 Pod 的静态字段：镜像、命令、环境变量、init 容器。这一课把镜头转向时间轴：一个 Pod 从提交到被删除，会经历哪些状态？容器崩溃退出后谁来决定要不要重启？怎么判断一个容器「活得好不好」「能不能接流量」？最后，Kubernetes 删除 Pod 时到底发生了什么？这些机制是后面理解 Deployment 滚动发布（第 3 章）、探针排障（第 11 章）的地基。",
    },
    {
      type: "heading",
      text: "两层状态：Pod 阶段与容器状态",
    },
    {
      type: "paragraph",
      text: "kubectl get pod 的 STATUS 列只是「一句话摘要」，背后其实是两层状态：Pod 层有 phase（阶段），容器层有各自的状态。初学者最容易混淆的就是把这两层混为一谈——比如看到 STATUS 是 Running 就以为万事大吉，其实 Running 的 Pod 里某个容器可能正在崩溃重启的循环里。先看 Pod 阶段：",
    },
    {
      type: "table",
      caption: "Pod 阶段（status.phase）",
      headers: ["阶段", "含义"],
      rows: [
        ["Pending", "Pod 已被 apiserver 接受，但还没就绪：可能在等调度、等镜像拉取、等容器创建"],
        ["Running", "Pod 已绑定到节点，至少有一个容器在运行（或正在启动/重启过程中）"],
        ["Succeeded", "所有容器都正常退出（退出码 0），且不会重启——多见于一次性任务"],
        ["Failed", "至少一个容器以非零退出码结束"],
        ["Unknown", "apiserver 联系不上 kubelet，拿不到 Pod 的真实状态——通常是节点出问题了"],
      ],
    },
    {
      type: "paragraph",
      text: "再看容器这一层的三种状态：Waiting（还没进入运行，常见原因如 ContainerCreating、ImagePullBackOff、CrashLoopBackOff）、Running（进程活着）、Terminated（已退出，会记录退出码与原因，如 Completed、Error、OOMKilled）。阶段与容器状态是「整体与零件」的关系：阶段是 Pod 的整体判定，零件状态是细节。第 11 章排障时会靠「Running 但 READY 0/1」这类组合快速缩小问题范围，现在只要记住别把两层混为一谈。",
    },
    {
      type: "heading",
      text: "restartPolicy：容器退出之后怎么办",
    },
    {
      type: "paragraph",
      text: "容器里的进程退出后，谁来处理？答案是节点上的 kubelet——它按 Pod 的 spec.restartPolicy 决定是否重启容器。三个取值覆盖三种产品意图：Always（任何退出都重启）、OnFailure（只有非零退出码才重启）、Never（永不重启）。注意一个容易忽略的细节：Always 是默认值，而且退出码为 0 的「正常结束」也会被重启——所以想跑「跑完即走」的一次性任务不能裸用默认值，这正是第 3 章 Job 存在的理由之一。",
    },
    {
      type: "table",
      caption: "restartPolicy 三值 × 退出结果",
      headers: ["restartPolicy", "退出码 0", "退出码非 0"],
      rows: [
        ["Always（默认）", "重启", "重启"],
        ["OnFailure", "不重启", "重启"],
        ["Never", "不重启", "不重启"],
      ],
    },
    {
      type: "paragraph",
      text: "还有两条限制值得记住：工作负载控制器（Deployment、StatefulSet、DaemonSet）的 Pod 模板里只允许 Always——因为这些控制器的自愈模型就是「副本死了补副本」，第 3 章会看到；Job 则允许 OnFailure/Never，因为批处理需要「失败即停、交给上层重试」。另外，容器在短时间内反复崩溃时，kubelet 不会无脑重启，而是按指数退避（backoff）拉长间隔，Pod 进入 CrashLoopBackOff 状态；kubectl get pod 的 RESTARTS 列能看到累计重启次数——排障时 RESTARTS 一直涨，就是「容器活着跑起来又死掉」的铁证。",
    },
    {
      type: "heading",
      text: "探针：向容器提出三个问题",
    },
    {
      type: "paragraph",
      text: "restartPolicy 回答的是「退出后怎么办」，但很多故障根本不会让进程退出：进程活着却死锁、端口在监听却返回 500、启动要两分钟却被当成假死。kubelet 需要主动检查容器内部，这就是探针（probe）。探针本质是三个不同的问题——还活着吗、能用了吗、启动完了吗——分别对应 livenessProbe、readinessProbe、startupProbe：",
    },
    {
      type: "table",
      caption: "三种探针的语义差异",
      headers: ["探针", "回答的问题", "失败后果", "典型场景"],
      rows: [
        ["livenessProbe（存活探针）", "进程还活着吗？", "重启容器", "死锁、内存泄漏导致的假死"],
        ["readinessProbe（就绪探针）", "现在能接收流量吗？", "从 Service 后端摘除（不重启）", "依赖未就绪、过载时主动退出服务"],
        ["startupProbe（启动探针）", "启动流程完成了吗？", "重启容器（保护启动期）", "启动很慢的应用，防止被误杀"],
      ],
    },
    {
      type: "paragraph",
      text: "最关键的分工是「就绪失败 ≠ 重启」：readiness 探针失败时 kubelet 只把 Pod 标记为未就绪，由 Service 把它从后端列表摘掉，流量不再打过来——但容器照常运行，探针恢复后流量自动回来。真正触发重启的是 liveness 失败。这套「摘流量而不杀进程」的机制是滚动发布能不停机的根基，Service 如何摘流量在第 4 章展开。",
    },
    {
      type: "paragraph",
      text: "每个探针还有一组公共参数控制检查节奏，默认值如下（探针字段不写时的取值）：",
    },
    {
      type: "table",
      caption: "探针默认参数（不写时的取值）",
      headers: ["参数", "默认值", "含义"],
      rows: [
        ["initialDelaySeconds", "0", "容器启动后等多久才开始第一次探测，给应用留出最早的启动时间"],
        ["periodSeconds", "10", "每隔多少秒探测一次"],
        ["timeoutSeconds", "1", "单次探测的超时时间，超时算一次失败"],
        ["successThreshold", "1", "连续成功几次才把容器标记为就绪/健康"],
        ["failureThreshold", "3", "连续失败几次才判定探针失败并触发后果"],
      ],
    },
    {
      type: "heading",
      text: "startupProbe：给慢启动应用一条活路",
    },
    {
      type: "paragraph",
      text: "把默认参数代进 liveness 算一笔账：无 initialDelay，每 10 秒探一次，连续 3 次失败就重启——一个启动需要两分钟的应用，在它真正就绪之前 liveness 已经失败 3 次，容器被反复重启，永远启动不起来。startupProbe 就是为这种应用设计的：它成功之前，liveness 与 readiness 探针一律不执行；只有 startup 成功后，另两个探针才开始工作。于是慢启动应用可以这样配：startup 探针用宽松的 failureThreshold 乘以 periodSeconds 给自己争取启动窗口（比如 30 × 10 秒 ≈ 300 秒），同时保留一个严格的 liveness 用于运行期检查。",
    },
    {
      type: "code",
      title: "shop-api-probes.yaml：三种探针齐配的裸 Pod",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-api-probes
  namespace: shop
  labels:
    app: shop-api
spec:
  containers:
    - name: api
      image: registry.k8s.io/echoserver:1.10   # 模拟接口服务
      startupProbe:
        httpGet:
          path: /
          port: 8080
        periodSeconds: 10      # 默认值，写明便于阅读
        failureThreshold: 30   # 启动窗口约 300 秒，期间不会被 liveness 误杀
      livenessProbe:
        httpGet:
          path: /
          port: 8080
      readinessProbe:
        httpGet:
          path: /
          port: 8080
      ports:
        - containerPort: 8080`,
    },
    {
      type: "paragraph",
      text: "提醒一句：echoserver 是回显型演示镜像，对收到的请求都返回成功响应，所以这里用它来演示探针的配置形态；真实的 shop-api 应该实现一个 /healthz 之类的专用健康端点，并且健康检查不要牵连重业务逻辑——否则数据库抖动会让健康检查失败，触发重启风暴。",
    },
    {
      type: "heading",
      text: "三种探测方式：httpGet、tcpSocket 与 exec",
    },
    {
      type: "table",
      caption: "探针的探测方式怎么选",
      headers: ["方式", "判定成功的标准", "适合 / 注意"],
      rows: [
        ["httpGet", "HTTP 请求返回 2xx–3xx 状态码", "应用有 HTTP 健康端点时首选；最贴近业务。4xx/5xx 都算失败"],
        ["tcpSocket", "与指定端口能建立 TCP 连接", "只有监听、没有 HTTP 接口的进程；但「端口能连」不代表「业务正常」"],
        ["exec", "容器内执行命令，退出码为 0", "需要脚本化检查（如查内部状态文件）；容器镜像里必须带该命令"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "httpGet 的常见误配",
      body: "探测请求会真实打到你的应用上：路径写错（比如首页路径被网关重写）、端口写错（写成了 Service 端口而不是容器端口）都会导致探针永远失败。另一个坑是探针端点上挂了鉴权——返回 401/403 会被判为失败。健康的做法是让 /healthz 这类端点不鉴权、不依赖外部系统，只回答「本进程是否健康」。",
    },
    {
      type: "heading",
      text: "优雅终止：SIGTERM → 宽限期 → SIGKILL",
    },
    {
      type: "paragraph",
      text: "删除 Pod 不是「拔电源」。kubectl delete 之后，kubelet 按这个顺序执行：先运行 preStop 钩子（如果配置了）→ 向容器主进程发送 SIGTERM → 等待宽限期（terminationGracePeriodSeconds，默认 30 秒）→ 宽限期结束仍未退出，发送 SIGKILL 强杀。宽限期是给应用的「收拾时间」：停止接收新请求、把手头的在途请求处理完、把缓冲区落盘。为什么应用必须自己处理 SIGTERM？因为信号的默认动作就是立即终止进程——不处理 SIGTERM 的应用等于没有优雅停机，请求会被掐断、数据可能没写完。观察退出码可以验证终止方式：被 SIGTERM 终止常见退出码 143，宽限期后遭 SIGKILL 强杀则是 137。",
    },
    {
      type: "code",
      title: "观察一次优雅终止",
      language: "bash",
      code: `# 正常删除：nginx 会处理 SIGTERM 快速退出
kubectl -n shop delete pod shop-api-probes

# 想看宽限期强杀：先起一个「无视 SIGTERM」的 Pod
kubectl -n shop run stubborn --image=busybox:1.36 --restart=Never --command -- sh -c 'trap "" TERM; sleep 3600'

kubectl -n shop delete pod stubborn --wait=false
kubectl -n shop get pod stubborn -w   # 会看到 Terminating 一直持续约 30 秒后被强杀`,
    },
    {
      type: "paragraph",
      text: "preStop 钩子夹在删除请求与 SIGTERM 之间，用来做「SIGTERM 之前最后能做的事」——比如向注册中心反注册、通知上游摘除本实例。它的局限同样要清楚：钩子与宽限期共享同一个时钟，钩子里 sleep 10 秒，宽限期就少了 10 秒；钩子无限阻塞最终也会被 SIGKILL 兜底。第 3 章讲滚动发布时会看到，优雅终止配合 readiness 探针，才是「发布期间请求不中断」的完整拼图。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "优雅停机的最小实现",
      body: "应用处理 SIGTERM 的通用套路是：收到信号 → 停止接收新连接/新任务 → 等待在途任务完成（设一个自己的超时）→ 退出。主流的 Web 框架与运行时几乎都有现成的优雅停机配置（如 drain timeout），部署到 Kubernetes 前值得专门验证一次：delete 一个 Pod，确认请求没有 5xx、日志显示进程是自己优雅退出的。",
    },
    {
      type: "quiz",
      question: "一个 Java 应用启动需要 90 秒，之后一切正常。如果只给它配置默认参数的 livenessProbe（httpGet），会发生什么？",
      options: [
        "启动慢没关系，liveness 探针会等应用就绪后再开始探测",
        "容器会在启动完成前就被反复重启，永远起不来",
        "容器会正常启动，只是就绪时间变长",
        "liveness 失败会把 Pod 从 Service 摘除，直到启动完成",
      ],
      answer: 1,
      explanation:
        "liveness 默认每 10 秒探一次、连续 3 次失败就重启容器：约 30 秒内探测不到成功就会重启，90 秒的启动期必然被杀，形成死循环。解法是加 startupProbe 并放宽 failureThreshold，让 startup 成功前 liveness 不执行。就绪时间、摘流量都是 readiness 的职责，与启动被杀无关。",
    },
    {
      type: "quiz",
      question: "readinessProbe 连续失败时，kubelet 会做什么？",
      options: [
        "重启容器，直到 readiness 恢复",
        "直接把 Pod 删除",
        "把 Pod 标记为未就绪并从 Service 后端摘除，容器继续运行",
        "向容器发送 SIGTERM，等待优雅退出",
      ],
      answer: 2,
      explanation:
        "readiness 失败只影响「是否接收流量」：Pod 被标记未就绪，Service 不再把流量转发给它，容器本身继续运行，探针恢复后自动重新接流量。触发重启的是 liveness 失败；删除 Pod 是控制器的职责或用户动作。",
    },
    {
      type: "keypoints",
      items: [
        "两层状态：Pod 阶段（Pending/Running/Succeeded/Failed/Unknown）是整体判定，容器状态（Waiting/Running/Terminated）是内部细节，两者别混为一谈",
        "restartPolicy 三值决定容器退出后的行为，默认 Always；控制器模板只允许 Always（Job 例外）",
        "三种探针回答三个问题：liveness 还活着吗（失败→重启）、readiness 能用了吗（失败→摘流量，不重启）、startup 启动完了吗（成功前屏蔽前两者）",
        "探针默认参数：initialDelaySeconds=0、periodSeconds=10、timeoutSeconds=1、successThreshold=1、failureThreshold=3",
        "终止流程：preStop（如有）→ SIGTERM → 宽限期（默认 30s）→ SIGKILL；应用必须处理 SIGTERM 才有优雅停机",
      ],
    },
  ],
};
