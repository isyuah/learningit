/* ==================================================================
 * 课时：Pod 排障：从 Pending 到 CrashLoop（k8s-pod-troubleshooting）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "按 Pod 状态分层走查故障：Pending、ImagePullBackOff、ContainerCreating、CrashLoopBackOff 与 Running 不 Ready，每类给证据、修复与预防。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课配齐了工具，这一课把它们用在最高频的一类故障上：Pod 起不来或起来了却不健康。Pod 的状态列（STATUS）本质是故障的分层索引——Pending 说明还没被调度、ImagePullBackOff 说明镜像拉不下来、CrashLoopBackOff 说明容器反复退出。本课按状态逐层走查，每一类都按「证据特征 → 根因 → 修复 → 预防」组织，并回指前面章节讲过的机制：第 2 章的探针与退出码、第 7 章的调度、第 5 章的配置。",
    },
    {
      type: "heading",
      text: "先掌握总方法：逐层缩小法",
    },
    {
      type: "paragraph",
      text: "不要从头到尾读一遍 YAML 找问题。Pod 的故障是分层的，从外到内逐层缩小，每层只有一两条命令：",
    },
    {
      type: "list",
      items: [
        "事件（describe / get events）：判断是哪一层在报错——调度器写 FailedScheduling，kubelet 写镜像与卷相关事件，探针失败会体现在 Ready 条件里。组件写事件，说明它已经替你把问题定位到了某一层。",
        "容器日志（logs / logs --previous）：进入应用内部，看进程为什么退出、为什么拒绝请求。这是容器跑起来之后才有的证据。",
        "探针端点：Running 却不 Ready 时，亲自请求一次探针配置的路径，验证是探针配置错还是应用真不健康。",
        "资源用量：怀疑资源受限时，看内存/CPU 用量与 describe 中的 QoS、limits——内存超限被杀在日志里往往看不出原因。",
      ],
    },
    {
      type: "heading",
      text: "Pending：还没被调度",
    },
    {
      type: "paragraph",
      text: "Pod 长时间停在 Pending，说明调度器还没给它找到节点，或调度完成前被依赖卡住。最常见的场景是调度失败：候选节点都不满足条件。证据特征是 describe 里出现 FailedScheduling 事件，message 以 0/N nodes available 开头（N 是候选节点数），冒号后面列出每个节点的拒绝理由。",
    },
    {
      type: "list",
      items: [
        "资源不足：message 里出现 insufficient cpu / insufficient memory 之类字样。注意调度是按 requests 记账的，不是按实际用量——Pod 的 requests 声明过大就会失败，哪怕节点 CPU 其实很闲。回第 7 章《调度器：Pod 放到哪个节点》。",
        "污点未容忍：message 里出现 untolerated taint。用户 Pod 默认上不了带控制面污点的节点；自建污点需要显式加 toleration。回第 7 章《亲和、反亲和与污点容忍》。",
        "亲和与标签不匹配：nodeSelector / nodeAffinity / pod 反亲和找不到符合条件的节点，或 Pod 标签与 Service 无关但调度约束本身矛盾。",
        "节点不可用：节点 NotReady 或已被 cordon（标记不可调度），它们不会进入候选列表。回第 10 章《节点维护：cordon、drain 与故障自愈》。",
      ],
    },
    {
      type: "paragraph",
      text: "修复按根因走：资源不足就加节点或调小 requests（requests 是调度依据，别随口写大）；污点问题先评估污点是否合理，再决定加 toleration 还是去掉污点；亲和/标签问题修正清单；被 cordon 的节点 uncordon。预防只有一句：requests 贴近真实用量，并保持对集群容量余量的可见性——调度失败大多数是「声明过大」或「集群满了」，这两件事都是日常就该盯的。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Pending 阶段没有容器问题可查",
      body: "调度失败时容器从未启动，describe 里只有 FailedScheduling 事件、没有 kubelet 的容器事件。此时去查镜像、翻日志都是白费——先读 FailedScheduling 的拒绝理由，它已经把原因写在 message 里了。",
    },
    {
      type: "heading",
      text: "ImagePullBackOff / ErrImagePull：镜像拉不下来",
    },
    {
      type: "paragraph",
      text: "镜像拉取第一次失败时容器状态显示 ErrImagePull，kubelet 进入带退避的重试后，状态转为 ImagePullBackOff——两者都表示容器还没起来，问题在「把镜像弄到节点上」这一步。证据特征：STATUS 列停在 ImagePullBackOff；describe 里有与拉取镜像相关的 Warning 事件，消息会带上镜像名与失败原因的特征（找不到镜像或 tag、要求认证、网络不可达、超时）；容器状态 Waiting 的 reason 是 ErrImagePull 或 ImagePullBackOff。",
    },
    {
      type: "list",
      items: [
        "镜像名或 tag 拼写错误、tag 不存在——最常发生在「昨天还能跑，今天就不行」的 tag 漂移场景。",
        "私有仓库没有认证：镜像在私有仓库但 Pod 没配 imagePullSecrets。回第 8 章《镜像供应链与数据保护》。",
        "仓库网络不可达：节点拉不到镜像仓库（公网被墙、仓库在内网、DNS 不通）。",
        "平台不匹配：镜像平台与节点架构不一致（如 amd64 镜像推到 arm64 节点）。",
      ],
    },
    {
      type: "paragraph",
      text: "修复的第一步是本地复现：在能访问仓库的机器上 `docker pull` 同一个镜像名，能立刻区分「镜像/仓库问题」还是「节点网络问题」。之后按原因处理：修正 image 字段后重新 apply（Deployment 会触发滚动）、私有仓库补 imagePullSecrets、网络问题查节点到仓库的连通性。预防：tag 用明确的版本号并在关键场景用 digest 固定（回第 8 章），镜像推到集群节点可访问的仓库——把「拉不下来」变成 apply 之前就能发现的问题。",
    },
    {
      type: "heading",
      text: "ContainerCreating：卡在创建容器",
    },
    {
      type: "paragraph",
      text: "这个阶段 kubelet 正在执行「拉镜像、挂卷、起沙箱、起容器」，短暂停留是正常的；长时间卡住才是问题。证据特征是 describe 事件指向卷或配置：卷挂载失败（PVC 未 Bound、存储类有问题——回第 6 章《PV、PVC 与 StorageClass》）、引用的 ConfigMap 或 Secret 不存在（env 或卷来源缺失，Pod 起不来——回第 5 章《ConfigMap：配置与镜像分离》与《Secret：敏感数据与信任边界》两课），以及镜像仍在慢速拉取。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "探针不会让 Pod 卡在 ContainerCreating",
      body: "探针只在容器运行之后执行，ContainerCreating 阶段容器还没起来，探针不可能失败。卡在这一步先查镜像与卷，别去改探针配置——那是 Running 阶段的事。",
    },
    {
      type: "paragraph",
      text: "修复按事件定位：缺 ConfigMap/Secret 就补齐对象或修正引用名，PVC 未 Bound 就先把存储供给好（回第 6 章），镜像慢就等或查拉取链路。预防：apply 之前先确认依赖对象存在、引用名拼写一致——依赖缺失是这阶段最常见的人为错误，靠清单评审就能挡住大半。",
    },
    {
      type: "heading",
      text: "CrashLoopBackOff：起来就崩，循环往复",
    },
    {
      type: "paragraph",
      text: "容器能启动但反复退出，kubelet 每次重启之间的间隔逐次拉长（退避），状态列显示 CrashLoopBackOff，RESTARTS 计数不断增长。证据特征：describe 里容器状态是 Waiting、reason 为 CrashLoopBackOff，同时 lastState 里记录了上一轮的终止原因与退出码；而容器为什么退出，答案在日志里。",
    },
    {
      type: "table",
      caption: "退出码判读：先看 lastState 的 reason 与 exitCode",
      headers: ["退出码", "含义", "排查方向"],
      rows: [
        ["0", "正常退出。若控制器下仍反复重启，说明应用把常驻服务跑成了「跑完即退」的一次性脚本", "检查启动命令与入口逻辑"],
        ["1", "应用自身报错退出（初始化失败、连不上依赖、配置错误）", "看日志最后几行，通常有报错堆栈"],
        ["137", "被 SIGKILL。最常见是内存超过 limits 被 OOM 杀死，此时 lastState 的 reason 为 OOMKilled——内存是不可压缩资源", "回第 2 章《资源请求与限制：CPU 与内存的语义》，查内存画像与 limits"],
        ["143", "收到 SIGTERM 后直接退出（没做优雅终止）", "常发生在删除/滚动/驱逐瞬间，回第 2 章《生命周期、重启与三种探针》的终止流程"],
      ],
    },
    {
      type: "paragraph",
      text: "诊断顺序：先 `kubectl logs <pod> --previous` 看崩溃前最后一次输出（不带 --previous 只能看到当前这轮，往往为空）。有报错堆栈就是应用问题；日志为空或瞬间退出，多半是启动参数或依赖不对——连不上数据库、配置缺失，回第 5 章配置相关课；退出码 137 且 reason 是 OOMKilled，别改代码，去调内存 limits 并查内存泄漏；还有一种隐蔽场景：应用其实在正常启动但启动太慢，被 liveness 探针在默认参数下反复杀掉，需要 startup 探针，回第 2 章探针课。预防：把镜像先在本地跑通再上集群、把启动依赖与超时想清楚、进程正确处理 SIGTERM、给容器做内存画像后设合理的 requests/limits。",
    },
    {
      type: "heading",
      text: "Running 但不 Ready：容器活着，流量进不来",
    },
    {
      type: "paragraph",
      text: "这是最隐蔽的一类：进程没崩、状态是 Running，但 READY 是 0/1。关键心智：readiness 失败不等于重启——容器继续运行，只是被从 Service 的后端列表里摘掉，不再接收新流量。所以它往往不是从监控里发现的，而是「Service 在、Pod 在、请求却失败」时才被注意到。回第 2 章探针课与第 4 章《Service：稳定的访问入口与 DNS》。",
    },
    {
      type: "paragraph",
      text: "证据特征：READY 0/1 且 RESTARTS 不涨（readiness 不重启）；describe 里 Ready 条件为 False，reason 指向 readiness 探针失败，message 通常带失败原因；Service 的 Endpoints 里看不到这个 Pod。注意区分：如果 READY 是 0/1 且 RESTARTS 在涨，那是 liveness 在杀容器（存活失败会重启）——两种探针失败的现象截然不同，回第 2 章《生命周期、重启与三种探针》的探针三问。",
    },
    {
      type: "paragraph",
      text: "排查：用 describe 或 explain 确认探针配置（httpGet 的 path 与 port、exec 的命令、参数），然后自测探针端点——进入容器（镜像没有 shell 就用 kubectl debug 挂临时容器，回第 2 章《Pod 日常操作：日志、进入与调试》）请求该路径，看返回码是否符合 httpGet 的期望（2xx 或 3xx 算成功）。常见根因：路径 404（应用路由里没有这个页面）、启动慢导致初期连续失败、探针端口写错。修复后 READY 会在一两个周期内变 1/1，Endpoints 重新出现。预防：探针路径与真实健康检查保持一致，改动路由后同步更新探针，发布前先用 port-forward 或临时 Pod 自测一遍。",
    },
    {
      type: "table",
      caption: "Pod 状态速查：证据与首选命令",
      headers: ["STATUS", "核心证据", "首选命令"],
      rows: [
        ["Pending", "FailedScheduling 事件及其拒绝理由", "kubectl describe pod"],
        ["ImagePullBackOff / ErrImagePull", "拉取失败事件 + 镜像名", "describe 事件；本地 docker pull 复现"],
        ["ContainerCreating", "卷/配置/镜像相关事件", "describe 事件"],
        ["CrashLoopBackOff", "lastState 退出码与 reason + 崩溃日志", "kubectl logs --previous"],
        ["Running 但 READY 0/1", "Ready 条件 False、reason 指向探针", "describe 条件 + 自测探针端点"],
      ],
    },
    {
      type: "quiz",
      question: "某容器反复重启，describe 里 lastState 显示退出码 137、reason 为 OOMKilled。这说明？",
      options: [
        "容器内存超过 limits，被内核 OOM killer 杀死",
        "应用收到 SIGTERM 后优雅退出失败",
        "镜像拉取失败导致无法启动",
        "readiness 探针失败触发了重启",
      ],
      answer: 0,
      explanation: "137 = 被 SIGKILL，reason 为 OOMKilled 时基本可以断定是内存超限被杀——内存是不可压缩资源，超 limits 内核直接杀进程，这是第 2 章资源课讲过的机制。SIGTERM 对应 143；镜像拉取失败表现为 ImagePullBackOff 而不是退出码；readiness 失败不会重启容器。",
    },
    {
      type: "keypoints",
      items: [
        "逐层缩小法：事件定层 → 日志看进程 → 探针端点验证 → 资源用量收尾",
        "Pending 先读 FailedScheduling 的拒绝理由；调度按 requests 记账",
        "ImagePullBackOff：先在本地 docker pull 复现，再分镜像/认证/网络/平台去修",
        "ContainerCreating 卡住查卷与配置依赖，与探针无关",
        "CrashLoopBackOff 看 logs --previous 与退出码：1 业务错、137 OOM、143 终止",
        "Running 不 Ready 是探针摘流量不是重启；RESTARTS 是否增长区分 readiness 与 liveness",
      ],
    },
  ],
};
