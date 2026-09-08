/* ==================================================================
 * 课时：用 kind 起第一个集群（k8s-kind-first-cluster）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "动手课：安装 kubectl 与 kind，用三节点配置创建集群 k8s-course，部署并访问第一个 Pod，观察裸 Pod 删除后不会复活。",
  blocks: [
    {
      type: "paragraph",
      text: "前三课建立了心智模型：控制面定状态、节点跑负载，对象靠声明与调谐运转。现在是第一次亲手验证它们——在本机用 kind 起一个三节点的 Kubernetes 集群，部署第一个 Pod，通过端口转发访问它，最后删除它并观察一个关键行为。整个过程约 20 到 30 分钟，除了本机已安装并启动的 Docker，不需要任何云资源。kind 的原理一句话就能讲清：它把每个「节点」做成一个 Docker 容器，容器里跑着真实的节点代理 kubelet 与容器运行时（containerd）——所以你在笔记本上体验到的调度与状态流转，和第 2 课解剖的组件协作是同一条链路。",
    },
    {
      type: "heading",
      text: "准备：安装 kubectl 与 kind",
    },
    {
      type: "paragraph",
      text: "需要两个命令行工具：kubectl（与集群对话的客户端）与 kind（创建本地集群）。版本要求与课程版本边界一致：kubectl 不低于 1.37，kind 不低于 v0.33。安装步骤以官方文档为准：kubectl 见 Kubernetes 官方文档的「Install kubectl」工具页（kubernetes.io/docs/tasks/tools/），kind 见其官方 Quick Start（kind.sigs.k8s.io/docs/user/quick-start/），Windows、macOS、Linux 均有对应安装方式。装完先验证版本：",
    },
    {
      type: "code",
      title: "验证工具版本",
      language: "bash",
      code: `kubectl version --client
kind version`,
    },
    {
      type: "paragraph",
      text: "预期看到：kubectl 输出中 Client Version 形如 v1.37.x；kind 输出形如 kind v0.33.x。kind 创建集群时使用的节点镜像（默认 kindest/node:v1.37.0）自带 kubeadm、kubelet 与 containerd，你不需要单独安装这些组件。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "版本一致性提醒",
      body: "kubectl 与集群 apiserver 之间官方建议相差不超过一个小版本（±1 minor）。学习机上 kubectl 用 1.37 而集群由 kind 以 v1.37.0 镜像创建，正好满足。若日后 kubectl 版本落后过多，先升级 kubectl 再连集群，避免出现「命令语法认识、服务器不认」的困惑。",
    },
    {
      type: "heading",
      text: "编写三节点集群配置",
    },
    {
      type: "paragraph",
      text: "kind 用一份 YAML 描述集群拓扑。本课程统一使用三节点配置：1 个 control-plane 角色节点（跑全部控制面组件）+ 2 个 worker 角色节点。第二个 worker 不是摆设——第 3 章演示多副本分散、第 10 章演示节点排空都要靠它。集群名固定为 k8s-course，后续所有章节的实操都沿用这套集群。",
    },
    {
      type: "code",
      title: "kind-config.yaml",
      language: "yaml",
      code: `kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-course
nodes:
  - role: control-plane
  - role: worker
  - role: worker`,
    },
    {
      type: "heading",
      text: "创建集群",
    },
    {
      type: "code",
      title: "创建并查看集群",
      language: "bash",
      code: `kind create cluster --config kind-config.yaml
kubectl cluster-info
kubectl get nodes`,
    },
    {
      type: "paragraph",
      text: "预期看到：kind create 依次打印节点创建与启动的进度（文本以 Creating cluster \"k8s-course\" 一类字样开头），首次运行会先拉取节点镜像，视网络情况需要几分钟；全部就绪后提示 kubectl 的上下文已设置为 kind-k8s-course、集群可以使用。期间执行 docker ps 能看到三个「节点容器」：k8s-course-control-plane 与两个 worker——这正是 kind「节点即容器」的体现。",
    },
    {
      type: "paragraph",
      text: "随后两条命令：kubectl cluster-info 显示控制面地址（本机回环加随机端口的形式，形如 https://127.0.0.1:端口）；kubectl get nodes 输出表格，列为 NAME/STATUS/ROLES/AGE/VERSION，三行节点的名称分别以 k8s-course-control-plane 与 k8s-course-worker 开头（第二个 worker 带数字后缀），STATUS 全部为 Ready。若某节点长时间停留在 NotReady，多半是镜像拉取失败或 Docker 资源不足，执行 kind delete cluster --name k8s-course 后重新创建即可。",
    },
    {
      type: "heading",
      text: "认识 context：当前在连哪个集群",
    },
    {
      type: "code",
      title: "查看与切换上下文",
      language: "bash",
      code: `kubectl config get-contexts
kubectl config current-context
kubectl config use-context kind-k8s-course`,
    },
    {
      type: "paragraph",
      text: "预期看到：get-contexts 列出你机器上登记的全部集群上下文（若装过 Docker Desktop 等工具，可能还有别的条目），带星号标记的是当前生效项；current-context 打印 kind-k8s-course。kubectl 只作用于当前上下文指向的集群，所以机器上有多套集群时，先确认 current-context 再动手是基本习惯。最后一条 use-context 用于手动切回本课程集群，平时它已被 kind 自动设为默认，可跳过。",
    },
    {
      type: "callout",
      variant: "note",
      title: "默认命名空间",
      body: "不带 -n 参数的 kubectl 命令只看 default 命名空间——这正是第 3 课「名字在命名空间内唯一」的实操体现。本课练习都在 default 里进行；从第 2 章起课程会在 shop 命名空间中部署书店系统。发现「明明部署了却查不到」时，先想想是不是命名空间看错了。",
    },
    {
      type: "heading",
      text: "部署第一个 Pod：echoserver",
    },
    {
      type: "code",
      title: "创建一个裸 Pod 并观察状态",
      language: "bash",
      code: `kubectl run echo --image=registry.k8s.io/echoserver:1.10 --port=8080
kubectl get pods
kubectl get pod echo -o wide`,
    },
    {
      type: "paragraph",
      text: "kubectl run 是命令式的快捷创建方式，直接产出一个「裸 Pod」——没有任何控制器在背后管理它，这一点稍后正是我们要利用的。镜像用 registry.k8s.io/echoserver:1.10：这是一个公共的 echo 演示镜像，会把收到的 HTTP 请求原样回显，监听 8080 端口，非常适合当 hello world 服务。",
    },
    {
      type: "paragraph",
      text: "预期看到：第一条命令输出 pod/echo created。kubectl get pods 的表格列为 NAME/READY/STATUS/RESTARTS/AGE，echo 的状态会先显示 ContainerCreating（首次需要拉取镜像，可能等待几十秒到几分钟），随后变成 Running、READY 变为 1/1。加 -o wide 后追加 NODE 与 IP 列：NODE 显示它被调度到了哪个 worker，IP 是集群内部地址。请对照第 2 课的旅程理解你看到的一切：调度器选了节点、kubelet 通过容器运行时拉镜像并启动容器、Running 字样来自回写进 status 的真实状态。",
    },
    {
      type: "heading",
      text: "用 port-forward 访问它",
    },
    {
      type: "paragraph",
      text: "这个 Pod 的 IP 是集群内网地址，你的笔记本无法直接路由到它。先用 kubectl port-forward 开一条临时隧道，把本机的某个端口转发到 Pod 的容器端口。第一个终端执行（命令会一直占用前台）：",
    },
    {
      type: "code",
      title: "终端一：开启端口转发",
      language: "bash",
      code: `kubectl port-forward pod/echo 8080:8080`,
    },
    {
      type: "paragraph",
      text: "预期看到：命令保持运行并打印形如 Forwarding from 127.0.0.1:8080 -> 8080 的提示。另开一个终端发起请求：",
    },
    {
      type: "code",
      title: "终端二：访问转发端口",
      language: "bash",
      code: `curl http://127.0.0.1:8080/`,
    },
    {
      type: "paragraph",
      text: "预期看到：curl 返回一段 echoserver 的请求回显文本，其中包含主机名（即容器内看到的主机名，正是 Pod 名 echo）以及你请求的方法、路径等字段——这说明请求确实到达了集群里那个容器并被它处理。验证完回到第一个终端按 Ctrl+C 结束转发。",
    },
    {
      type: "callout",
      variant: "note",
      title: "port-forward 的定位",
      body: "port-forward 是「单 Pod 临时调试通道」：它不经 Service、不做负载均衡，只适合本地验证单个实例。生产与多副本场景的稳定入口是 Service 与 Ingress（第 4 章细讲）。本课用它只为眼见为实——先确认「容器真的在跑、真的在监听」。",
    },
    {
      type: "heading",
      text: "describe：读 Events，看它如何被拉起来",
    },
    {
      type: "code",
      title: "查看 Pod 的详细状态与事件",
      language: "bash",
      code: `kubectl describe pod echo`,
    },
    {
      type: "paragraph",
      text: "预期看到自上而下三大块信息：对象字段快照（Name、Namespace、Node、Status、IP 等基本信息）、Conditions 条件列表，以及最后的 Events 时间线。Events 是排障的第一现场——你会看到调度器先写下「已调度」类事件，随后是 kubelet 拉取镜像、创建并启动容器的事件序列。这些事件正是第 2 课旅程每一步留下的日志：谁动了手、结果如何，都有据可查。请记住这个习惯：以后任何 Pod 行为异常，第一步永远是 describe 看 Events，而不是凭感觉猜。",
    },
    {
      type: "heading",
      text: "删除并观察：它不会复活",
    },
    {
      type: "code",
      title: "删除 Pod 并确认结果",
      language: "bash",
      code: `kubectl delete pod echo
kubectl get pods`,
    },
    {
      type: "paragraph",
      text: "预期看到：delete 输出 pod \"echo\" deleted；随后的 get pods 显示 default 命名空间里已经没有 Pod 了（提示形如 No resources found in default namespace）。请注意关键的一点：它没有被自动重建。这正是本课要你亲手记住的观察——kubectl run 创建的是裸 Pod，背后没有任何控制器盯着它，删除即消失、节点故障也不会有人替它重来。第 2 章《生命周期、重启与三种探针》会解释 Pod 的重启语义，第 3 章《Deployment 与 ReplicaSet》会展示「有控制器管理」时副本被删除会自动补回。到那时再回头对比今天的观察，工作负载控制器的价值就不言自明了。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "集群请保留",
      body: "后续所有章节的实操都在这套 k8s-course 集群上进行，正常学习不要删除它。若确实需要清理或集群状态异常，可执行 kind delete cluster --name k8s-course，然后重新走一遍创建流程。",
    },
    {
      type: "exercise",
      title: "独立演练：起一个 nginx Pod 并完整走查",
      description:
        "不翻看上文，独立完成一遍完整闭环：① 在 default 命名空间用 kubectl run 创建名为 nginx-demo 的裸 Pod，镜像 nginx:1.27-alpine（容器监听 80 端口）；② 等它 Running 后，用 port-forward 把本机 8081 转发到它的 80 端口，curl 验证能拿到 nginx 默认欢迎页（页面标题含 Welcome to nginx 字样）；③ 执行 kubectl describe pod nginx-demo，从 Events 中找到镜像拉取与容器启动的时间线；④ 删除 nginx-demo，确认它不会自动复活；⑤ 结束转发进程，保持集群与 default 命名空间干净。",
      hint: "port-forward 会占住前台终端，转发与 curl 分别在两个终端进行；若 Pod 长时间停在 ImagePullBackOff，用 describe 看 Events 里的具体错误原因（通常是镜像名拼写或网络问题），修复后 delete 重建。",
    },
    {
      type: "quiz",
      question: "你在 kind 集群里用 kubectl run 创建了一个裸 Pod，随后执行 kubectl delete 删除了它。几秒后再执行 kubectl get pods，最可能看到什么？",
      options: [
        "同名的 Pod 被自动重建，状态为 Running",
        "default 命名空间里没有任何 Pod",
        "该 Pod 一直停留在 Terminating 状态",
        "kubectl 报错，提示 Pod 不存在无法删除",
      ],
      answer: 1,
      explanation:
        "裸 Pod 没有任何控制器管辖，删除后不会自动重建，因此选 2。自动重建发生在对象由 Deployment/ReplicaSet 等控制器管理时（第 3 章展开）；正常删除是同步流程，对象不会滞留 Terminating（只有带终结器的删除才可能卡住，第 9 章解释）；删除不存在的对象才会报错，而这里删除时对象确实存在。",
    },
    {
      type: "paragraph",
      text: "到这里，你拥有了三样东西：一套可反复使用的三节点集群 k8s-course、第一个成功运行的 Pod 及访问它的经验、还有「裸 Pod 不会复活」与「先看 Events」两个关键习惯。下一章我们把 Pod 这个最小单元拆开——它的字段、生命周期与重启策略，正好用来解释为什么裸 Pod 不适合直接承载业务。",
    },
  ],
};
