/* ==================================================================
 * 课时：Pod 日常操作：日志、进入与调试（k8s-pod-ops）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "动手掌握 Pod 的日常操作：logs（含 --previous）、exec、port-forward、cp、describe 信息地图、kubectl debug 临时容器，以及观察优雅终止。",
  blocks: [
    {
      type: "paragraph",
      text: "第 1 章的动手课已经用 kubectl run、port-forward、delete 把 Pod 摸了一遍；前三课又讲清了 Pod 的字段、生命周期与资源。这一课把这些命令系统化、补齐日志与调试手段——它们是你接下来每一课都要用的基本功：部署完要验证（logs、port-forward）、出问题要取证（describe、logs --previous）、镜像里没有工具要自救（exec、kubectl debug）。本课是练习课，请打开你的 kind 集群（集群名 k8s-course），跟着命令动手。",
    },
    {
      type: "heading",
      text: "读日志：kubectl logs",
    },
    {
      type: "paragraph",
      text: "容器把日志写到标准输出/标准错误（stdout/stderr），容器运行时捕获后交给 kubelet，kubectl logs 把这份日志取回来——这是排查容器内部的第一信息源。基础用法如下：",
    },
    {
      type: "code",
      title: "kubectl logs 常用形态",
      language: "bash",
      code: `kubectl -n shop logs shop-api-pod              # 看当前实例的日志
kubectl -n shop logs shop-api-pod -f           # 跟随输出（类似 tail -f）
kubectl -n shop logs shop-api-pod --tail=50    # 只看最近 50 行
kubectl -n shop logs shop-api-pod -c api       # 多容器 Pod 用 -c 指定容器
kubectl -n shop logs shop-api-pod --previous   # 看上一个实例（崩溃重启过）的日志`,
    },
    {
      type: "paragraph",
      text: "重点理解 --previous：容器崩溃后被 kubelet 重启，会产生「上一个实例」与「当前实例」两份日志。logs 不带参数时看的是当前实例——如果当前实例刚启动还没输出任何东西，你会以为「应用没日志」，其实崩溃原因都在上一个实例里。所以排查崩溃的固定动作是：先 kubectl get pod 确认 RESTARTS 是否大于 0，再对容器用 --previous 取上次实例的日志。前提是容器真的重启过；从未重启过的 Pod 用 --previous 只会得到「找不到已终止的上一个容器」之类的提示。多容器 Pod 里每个容器各有一份日志，记得用 -c 指定。",
    },
    {
      type: "callout",
      variant: "note",
      title: "日志打到哪里，kubectl 才看得到",
      body: "kubectl logs 只能取到容器写往 stdout/stderr 的内容。应用如果把日志写进文件而不是标准输出，kubectl logs 什么都看不到——部署到 Kubernetes 的应用应把日志打到 stdout，由采集层（第 3 章会讲 DaemonSet 采集器）统一收集，而不是让每个容器自己管日志文件。",
    },
    {
      type: "heading",
      text: "进入容器：kubectl exec",
    },
    {
      type: "code",
      title: "进入 shop-web 容器",
      language: "bash",
      code: `kubectl -n shop exec -it shop-web-pod -- /bin/sh
# 进入后可以：查看进程、检查文件、测网络连通性
ps
cat /etc/os-release
exit`,
    },
    {
      type: "paragraph",
      text: "exec 的本质是在目标容器的命名空间里新起一个进程——-i 保持标准输入打开、-t 分配终端，两个一起用才能交互（所以习惯写 -it）。约束有两个：容器镜像里得有 shell（nginx 的 alpine 系镜像有 /bin/sh，scratch/distroless 没有）；多容器 Pod 要用 -c 指定进哪个容器。注意 exec 不是「接管」正在跑的进程，而是另起一个，所以别指望它看到原进程的内存态。",
    },
    {
      type: "heading",
      text: "端口转发：kubectl port-forward",
    },
    {
      type: "code",
      title: "把 Pod 端口转发到本地",
      language: "bash",
      code: `# 语法：port-forward <pod> <本地端口>:<Pod 端口>（前台进程，另开终端执行 curl）
kubectl -n shop port-forward shop-api-pod 8080:8080
# 另开一个终端：
curl http://localhost:8080`,
    },
    {
      type: "paragraph",
      text: "port-forward 在本地与 Pod 之间建立一条临时通道，适合单副本调试：本地没有集群内网络也能访问 Pod、连数据库、看页面。它的局限要认清：转发进程在前台跑、关掉就断；只转发到你本机，别人访问不了；它直连 Pod，不经过 Service——所以它只适合开发调试，生产流量的正式入口是 Service 与 Ingress（第 4 章），别在服务器上用 port-forward 顶替。",
    },
    {
      type: "heading",
      text: "复制文件：kubectl cp",
    },
    {
      type: "code",
      title: "本地与容器之间双向复制",
      language: "bash",
      code: `# 本地 → 容器（把自定义首页传进 nginx 站点目录）
kubectl -n shop cp ./index.html shop-web-pod:/usr/share/nginx/html/index.html

# 容器 → 本地（把容器里的配置拉下来研究）
kubectl -n shop cp shop-web-pod:/etc/nginx/nginx.conf ./nginx.conf`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "cp 依赖容器里有 tar",
      body: "kubectl cp 在容器内借助 tar 打包/解包来传输文件，官方文档注明容器里需要存在 tar。busybox、alpine 这类基础镜像自带；精简镜像如果没有 tar，cp 会失败——这时可以改用 exec + 重定向，或直接重新构建镜像。",
    },
    {
      type: "heading",
      text: "describe：一张信息地图",
    },
    {
      type: "code",
      title: "describe 一个 Pod",
      language: "bash",
      code: `kubectl -n shop describe pod shop-api-pod`,
    },
    {
      type: "list",
      ordered: true,
      items: [
        "顶部字段快照：名称、命名空间、标签、所在节点、Pod IP、容器镜像与状态。容器状态里能看到上次退出的退出码与原因、当前 Waiting 的原因——崩溃类问题先看这里。",
        "Conditions 区块：PodScheduled、Initialized、ContainersReady、Ready 等条件逐条列出状态与最近变动时间，告诉你 Pod 走到哪一步卡住了。",
        "Events 区块：按时间排列的最近事件（调度成功、拉镜像、启动容器、探针失败……）。事件是滚动保留的（默认约 1 小时清理），排查要趁早看。",
      ],
    },
    {
      type: "paragraph",
      text: "读 describe 的口诀是「状态看顶部、进度看条件、因果看事件」。这套读法第 11 章《排障工具箱》会系统化，本课先建立习惯：apply 之后、排障之时，先 describe 再动手。",
    },
    {
      type: "heading",
      text: "kubectl debug：临时容器救场",
    },
    {
      type: "code",
      title: "给 Pod 附加一个调试容器",
      language: "bash",
      code: `# 业务容器没有 shell（scratch/distroless 镜像）或不能重启时：
kubectl -n shop debug shop-api-pod -it --image=busybox:1.36`,
    },
    {
      type: "paragraph",
      text: "exec 的前提是容器里有 shell，而生产镜像出于精简与安全考虑常常刻意不带 shell。此时 kubectl debug 是救命工具：它给运行中的 Pod 临时附加一个 ephemeral container（临时容器），用你指定的镜像（如 busybox:1.36）起一个调试环境。临时容器加入 Pod 后与业务容器共享网络命名空间，也能挂载 Pod 的卷，因此可以测网络、看卷内容——而业务容器全程没有被重启、镜像也没有被改动。想直接观察业务进程本身，可以加 --target=<容器名> 尝试共享目标容器的进程命名空间（能否生效取决于容器运行时，细节以官方文档为准）。两个提醒：临时容器要能拉到镜像；它会一直挂在 Pod 上直到 Pod 被删除，调试完记得清理，别把调试容器留在生产 Pod 上。",
    },
    {
      type: "heading",
      text: "删除与优雅终止：动手观察第 6 课的机制",
    },
    {
      type: "code",
      title: "删除 Pod 并观察状态变化",
      language: "bash",
      code: `kubectl -n shop delete pod shop-api-pod
kubectl -n shop get pods -w    # -w 持续观察状态变化`,
    },
    {
      type: "paragraph",
      text: "对照第 6 课讲的终止流程来读观察结果：应用正确处理 SIGTERM 时，Pod 会短暂显示 Terminating 然后快速消失；应用无视 SIGTERM 时，Terminating 会一直持续到宽限期（默认 30 秒）结束，被 SIGKILL 强杀才消失。配合退出码可以还原死因：",
    },
    {
      type: "table",
      caption: "常见退出码速查（describe / logs 里会看到）",
      headers: ["退出码", "含义"],
      rows: [
        ["0", "进程自己正常退出（可能是有意退出，也可能是收到了 SIGTERM 后优雅结束）"],
        ["137", "被 SIGKILL 杀死：常见于 OOM（内存超限）或宽限期结束后的强杀"],
        ["143", "被 SIGTERM 终止：常见于删除/滚动发布时的终止信号"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "--force 强删要慎用",
      body: "kubectl delete pod --grace-period=0 --force 会跳过优雅终止流程直接清理，日常不要用——它可能中断在途请求。它只在对象卡死（如 namespace 卡在 Terminating）需要兜底时才有意义，且常常是问题的结果而不是解法。",
    },
    {
      type: "exercise",
      title: "shop-web 完整演练：从运行到崩溃取证",
      description:
        "阶段一（正常运行）：用第 5 课学过的写法创建 shop-web 裸 Pod（镜像 nginx:1.27-alpine，端口 80，命名空间 shop），apply 后用 describe 确认 Running 且 READY 1/1。然后：port-forward 8080:80 并用 curl 访问默认页；logs 观察访问日志；exec 进入容器执行 ps；把本地一个自定义 index.html 用 cp 覆盖进 /usr/share/nginx/html/，再 curl 确认页面变了。阶段二（制造崩溃）：再提交一个 shop-web-broken Pod，故意把启动命令写成执行一个不存在的脚本（如 command: [\"/bin/sh\", \"-c\"], args: [\"/no/such/script.sh\"]），观察 STATUS 进入 CrashLoopBackOff、RESTARTS 不断增长；describe 看 Events 里的失败原因与上次退出码；对容器执行 logs --previous，确认能看到上一个实例的输出。阶段三（优雅终止）：删除正常 Pod 时用 get pods -w 观察 Terminating 与消失；再按第 6 课的 stubborn 例子起一个无视 SIGTERM 的 busybox Pod，删除它并观察 Terminating 持续约 30 秒后被强杀。",
      hint: "port-forward 是前台命令，curl 请在另一个终端执行；logs --previous 只在容器确实重启过（RESTARTS ≥ 1）时才有内容，先 get pods 确认；阶段三需要先清理前面创建的 Pod 以免名字冲突。",
    },
    {
      type: "quiz",
      question: "shop-api 的容器崩溃后已被 kubelet 自动重启。你想看它崩溃前最后一个实例输出了什么，应该用哪条命令？",
      options: [
        "kubectl -n shop logs shop-api-pod",
        "kubectl -n shop logs shop-api-pod --previous",
        "kubectl -n shop describe pod shop-api-pod",
        "kubectl -n shop exec -it shop-api-pod -- /bin/sh",
      ],
      answer: 1,
      explanation:
        "--previous 读取已终止的上一个容器实例的日志，正适合「崩溃重启后查死因」。不带参数的 logs 只显示当前实例（刚重启可能没输出）；describe 显示状态、条件与事件，但不包含日志正文；exec 需要容器在运行且镜像里有 shell，且看不到上一个实例的日志。",
    },
    {
      type: "quiz",
      question: "生产环境的一个 Pod 镜像刻意不带 shell（distroless），进程行为异常且不能重启、不能改镜像，你应该怎么排查？",
      options: [
        "kubectl exec -it 进入容器查看进程",
        "kubectl -n shop debug <pod> -it --image=busybox:1.36 附加临时容器排查",
        "删除 Pod 让它重启，赌下一次正常",
        "只读 kubectl logs，放弃进一步排查",
      ],
      answer: 1,
      explanation:
        "kubectl debug 附加 ephemeral container，用自带工具链的 busybox 在共享网络命名空间里排查，业务容器不受影响。exec 会因镜像没有 shell 而失败；删除重启解决不了镜像本身的问题；logs 只能看到应用写出的日志，看不到进程与网络现场。",
    },
    {
      type: "keypoints",
      items: [
        "logs：-f 跟随、--tail 限量、-c 指定容器；崩溃排查用 --previous 看上一个实例（需 RESTARTS ≥ 1）",
        "exec -it 在容器命名空间里新起进程，镜像须带 shell；port-forward 只适合本机单副本调试，生产入口是 Service/Ingress",
        "cp 借助容器内 tar 双向复制；describe 三区块：字段快照 / Conditions / Events",
        "kubectl debug 用临时容器救场：不重启业务容器即可获得调试环境（镜像 busybox:1.36）",
        "删除观察优雅终止：SIGTERM → 宽限期（默认 30s）→ SIGKILL；退出码 0/137/143 各有含义",
      ],
    },
  ],
};
