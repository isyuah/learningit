/* ==================================================================
 * 课时：故障注入与恢复演练（k8s-capstone-failure-recovery）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "对已上线的 shop 注入五类故障：杀 Pod、误删配置、drain 节点、配额拒绝、策略误伤，逐项练观察—恢复—预防，并以全课回顾测验收尾。",
  blocks: [
    {
      type: "paragraph",
      text: "前三课证明了 shop 能部署、能发布、能伸缩。最后一场演练换个角度：主动把系统弄坏，练的是「坏了之后怎么办」。生产里故障一定会来，区别只在于你是第一次见它，还是在演练里见过它。五项故障全部来自前面章节讲过的真实机制：自愈、配置注入、自愿中断、配额计账、网络策略。每项的练法是固定的三段：制造故障 → 观察现象并定位 → 恢复并总结预防。观察永远从状态与事件开始（第 11 章《排障工具箱：状态、事件与 describe》），不猜。",
    },
    {
      type: "heading",
      text: "演练一：杀掉一个 shop-api 副本",
    },
    {
      type: "paragraph",
      text: "这是最温和也最能建立信心的一场：副本由 Deployment 的 ReplicaSet（RS）管理，删掉一个，控制器会补一个——调谐循环把实际状态拉回期望状态（第 3 章《Deployment 与 ReplicaSet：副本从哪来》）。对比第 1 章里裸 Pod 被删后不会复活，差别就在「有没有控制器」。",
    },
    {
      type: "code",
      title: "杀副本并观察自愈",
      language: "bash",
      code: `kubectl -n shop get pods -l app=shop-api
# 记下某个 Pod 的名字

kubectl -n shop delete pod <上一步记下的 shop-api Pod 名>

kubectl -n shop get pods -l app=shop-api -w
# 预期：出现一个名字全新的 Pod，短暂 Pending/Running 后 READY 1/1——
# 是 RS 发现实际副本数低于期望值，重新创建并调谐到就绪

kubectl -n shop get rs -l app=shop-api
# 预期：ReplicaSet 的副本计数恢复，旧 Pod 的名字不会再出现`,
    },
    {
      type: "paragraph",
      text: "观察点：副本数是「期望状态」决定的，删掉只是让控制器多干一次活；恢复动作：什么都不用做。预防也只有一条：别用裸 Pod 承载业务，一切副本交给 Deployment/StatefulSet 这类控制器。期间若开着对 shop-api 的请求，你会发现请求不中断——Service 只把流量发给 Ready 的副本（第 4 章《Service：稳定的访问入口与 DNS》）。",
    },
    {
      type: "heading",
      text: "演练二：误删 Secret 与 ConfigMap",
    },
    {
      type: "paragraph",
      text: "故障往往不是「镜像坏了」，而是「配置没了」。这场删除 shop-db 的 Secret 和 shop-web 的 ConfigMap，观察两种注入方式的差异，再靠磁盘上的清单把状态救回来。核心预判来自第 5 章的两条边界：环境变量在容器启动时固化，卷挂载由 kubelet 同步——对象被删时，正在运行的 Pod 不受影响，遭殃的是「新建或重启」的 Pod。",
    },
    {
      type: "code",
      title: "误删配置，观察症状",
      language: "bash",
      code: `kubectl -n shop delete secret shop-db-credentials configmap shop-web-html
# 预期：两个对象删除成功（集群不会拦——删对象是合法操作）

kubectl -n shop get pods
# 预期：现有 Pod 全部照常 Running——运行中的 Pod 不受影响
# （env 已固化在进程里、卷内容已被 kubelet 缓存）

# 制造一次「需要新建 Pod」：StatefulSet 会以固定名字 shop-db-0 重建
kubectl -n shop delete pod shop-db-0
kubectl -n shop get pods -l app=shop-db
kubectl -n shop describe pod shop-db-0
# 预期：新 Pod 卡在创建容器阶段，事件里出现类似 CreateContainerConfigError、
# Secret 引用不存在的报错——它不是 CrashLoop（进程根本没起来），这是配置缺失
# 而不是业务错误（回第 11 章《Pod 排障：从 Pending 到 CrashLoop》判读）

kubectl -n shop delete pod <一个 shop-web Pod 的名字>
kubectl -n shop describe pod <新的 shop-web Pod 名字>
# 预期：同样的症状——卷引用的 ConfigMap 没了，新 Pod 起不来；
# 另一个还活着的 web 副本继续服务，首页仍然能打开`,
    },
    {
      type: "paragraph",
      text: "顺手验证一个关键事实：Pod 虽然卡住，数据一点没丢。PVC data-shop-db-0 与 Pod 是两个对象，删 Pod 不删 PVC，卷还在，等配置恢复后新 Pod 挂上同一个卷，postgres 会直接使用已有的数据目录——StatefulSet 的「删 Pod 不删卷」在此刻兑现（第 3 章《StatefulSet：有状态应用的秩序》、第 6 章《CSI 与有状态应用的生产注意》）。",
    },
    {
      type: "code",
      title: "恢复：把期望状态重新写回",
      language: "bash",
      code: `kubectl -n shop get pvc
# 预期：data-shop-db-0 仍是 Bound——Pod 没了，卷和里面的数据还在

kubectl apply -f manifests/02-config-secret.yaml
# 预期：apply 成功——对象被重建，apiserver 重新有了期望状态

kubectl -n shop get pods -l app=shop-db
kubectl -n shop get pods -l app=shop-web
# 预期：卡住的 Pod 被 kubelet 重试拉起，逐渐转 Running；
# 若个别 Pod 迟迟不恢复，手动删一次让控制器重建即可（等价操作）

kubectl -n shop exec <shop-db-0> -- pg_isready -U shop -d shop
# 预期：接受连接——postgres 复用了卷里的旧数据目录，数据完好`,
    },
    {
      type: "paragraph",
      text: "为什么 apply 能把删掉的对象救回来？因为声明式的「源」在磁盘上的清单文件，不在集群里——删除只是让期望状态消失，对象没有回收站；apply 把清单重新提交，控制器与 kubelet 各自调谐，系统就收敛回原状（第 1 章《对象模型：声明式、spec 与调谐循环》）。恢复后要记住 env 的边界：这次能自动恢复是因为「新 Pod 在对象恢复后才启动」；如果你改的是 Secret 的值而不是删除它，运行中的 Pod 不会热更，需要重建才能读到新值（第 5 章《ConfigMap：配置与镜像分离》《Secret：敏感数据与信任边界》）。预防：清单入库并受版本管理，改动前用 kubectl diff / --dry-run=server 检查（第 5 章《配置发布实践：diff、dry-run 与滚动生效》）；Secret 走外部管理，不进 Git。",
    },
    {
      type: "heading",
      text: "演练三：drain 一个 worker：PDB 与驱逐",
    },
    {
      type: "paragraph",
      text: "节点维护是运维的日常动作，drain 会把节点上的 Pod 逐出并禁止新调度——逐出属于「自愿中断」，必须尊重 PodDisruptionBudget（第 10 章《节点维护：cordon、drain 与故障自愈》）。shop-db 被 nodeSelector 钉在打了 shop-db=hosted 标签的节点上（第 48 课），hostPath 数据只在那台机器上，所以这场演练挑另一台 worker，数据库不受影响——这本身就是一次对「数据不跨节点」边界（第 6 章）的活体复习。",
    },
    {
      type: "code",
      title: "先看布局，再 cordon、drain、uncordon",
      language: "bash",
      code: `kubectl -n shop get pods -o wide
# 找 shop-db-0 在哪个 worker 上，下面的演练用另一台 worker（示例按 k8s-course-worker2 写，请替换）

kubectl -n shop get pdb
# 预期：shop-web-pdb 与 shop-api-pdb 都在，ALLOWED DISRUPTIONS 为 1

kubectl cordon k8s-course-worker2
kubectl get nodes
# 预期：k8s-course-worker2 状态带 SchedulingDisabled——存量 Pod 不动，新 Pod 不再调度上去

kubectl drain k8s-course-worker2 --ignore-daemonsets --delete-emptydir-data
# --ignore-daemonsets：kindnet/kube-proxy 这类 DaemonSet Pod 不会被驱逐（DaemonSet 语义见第 3 章）
# --delete-emptydir-data：允许删除带 emptyDir 的 Pod（本课没有，但这是 drain 的常备姿势）

kubectl -n shop get pods -o wide
# 预期：被逐出的 web/api 副本出现在另一台 worker 上，READY 恢复；
# drain 过程中 PDB 逐出检查的两种结果都可能出现，见下方说明

kubectl uncordon k8s-course-worker2
kubectl get nodes
# 预期：节点恢复 Ready、可调度；但被逐出的 Pod 不会自动迁回——这是第 10 章讲过的行为`,
    },
    {
      type: "paragraph",
      text: "观察点有两种可能，都算数。情况一：web/api 各有一个副本在别的节点上，drain 逐出本节点副本时，剩余可用副本仍 ≥ minAvailable，逐出放行，副本在另一节点重建，全程不中断。情况二：某工作负载的两个副本恰好都在这台节点上，逐出第二个时会被 PDB 拦下，drain 报错并停在原地——这正是地板生效的样子。处理办法：把该工作负载在另一节点先补齐（例如 kubectl -n shop scale deployment shop-web --replicas=3，等新副本 Ready），再继续 drain，完成后缩回 2。预防：PDB 的值要随副本数一起评审——minAvailable 太高会把维护卡死，太低则保护不住；单副本的有状态服务（shop-db）不放 PDB，靠节点隔离加备份兜底（第 6 章《CSI 与有状态应用的生产注意》、第 10 章《etcd 快照与灾难恢复》的责任边界）。",
    },
    {
      type: "heading",
      text: "演练四：扩容撞上配额",
    },
    {
      type: "paragraph",
      text: "第 48 课给 shop 装了 ResourceQuota，第 10 章《命名空间治理：配额与多团队》讲过它的拒绝行为：超配额时对象创建在准入阶段就被拒。这场把 shop-web 硬扩到 20 副本，看配额怎么「说不」。注意关键点：配额按 requests 计账，而 Pod 的创建请求是 ReplicaSet 控制器发出的——所以拒绝不会发生在 kubectl scale 这一步，而是发生在 RS 试图创建 Pod 时，证据在事件里。",
    },
    {
      type: "code",
      title: "制造超配并观察拒绝",
      language: "bash",
      code: `kubectl -n shop scale deployment shop-web --replicas=20
# 预期：scale 命令本身成功——Deployment 的期望状态被更新了

kubectl -n shop get pods -l app=shop-web
# 预期：副本数涨到配额允许的上限附近就停住，不会真的到 20

kubectl -n shop get resourcequota
# 预期：REQUEST 列的用量顶到了 hard 值——配额按 requests 计账，账目已满

kubectl -n shop get events --sort-by=.lastTimestamp
kubectl -n shop describe rs -l app=shop-web
# 预期：事件/描述里出现 FailedCreate 一类的报错，消息含 exceeded quota、
# requested/used/limited 字段——读这三个数字就知道是谁超了谁

# 恢复：把期望状态改回去
kubectl -n shop scale deployment shop-web --replicas=2
kubectl -n shop get pods -l app=shop-web
# 预期：回到 2 副本，FailedCreate 事件不再新增`,
    },
    {
      type: "paragraph",
      text: "这个故障的坑在于「看着像没生效」：Deployment 的副本数显示 20，实际可用只有十几个，中间层的事件才是真相——所以排障要养成读事件的习惯（第 11 章《排障工具箱：状态、事件与 describe》）。预防：把配额用量纳入日常观察；给每个 Pod 的 requests 定值时想清楚——requests 定大了，即使实际没用满也会提前挡住扩容（第 2 章《资源请求与限制：CPU 与内存的语义》的计账语义在这里兑现）。",
    },
    {
      type: "heading",
      text: "演练五：NetworkPolicy 误伤",
    },
    {
      type: "paragraph",
      text: "最后一场最阴险：一条「看起来在防护」的策略，实际在误伤。设想需求是「只允许 shop-web 访问 shop-api」，但策略的来源 selector 抄错了——写成了自己放行自己：",
    },
    {
      type: "code",
      title: "manifests/11-netpol-wrong.yaml（一条写错的策略）",
      language: "yaml",
      code: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-web-to-api
  namespace: shop
spec:
  podSelector:
    matchLabels:
      app: shop-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: shop-api`,
    },
    {
      type: "code",
      title: "观察与恢复",
      language: "bash",
      code: `kubectl apply -f manifests/11-netpol-wrong.yaml
# 预期：apply 成功——策略语法完全合法，apiserver 不会拒绝它

kubectl -n shop run api-check --image=busybox:1.36 --restart=Never --rm \\
  -- wget -qO- http://shop-api:8080/
# 预期：在 kind 里依然能访问——kindnet 不执行 NetworkPolicy，策略只是被接受、没有行为

kubectl -n shop get networkpolicy
# 预期：策略在列表里，看起来「一切正常」——这正是最大的陷阱

# 恢复：删除这条错误策略（演练结束，恢复「无策略」状态）
kubectl delete -f manifests/11-netpol-wrong.yaml`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "没报错 ≠ 已生效",
      body: "NetworkPolicy 是声明与实现分离的典型：apiserver 只负责接受并存储策略，真正执行它的是 CNI 插件。kind 默认的 kindnet 不执行 NetworkPolicy，所以 apply 成功、流量照旧——别把这种「平静」当成防护在起作用（第 4 章《NetworkPolicy：集群内的流量防线》明确过这个现实）。要真实验证策略行为，需要换成执行 NetworkPolicy 的 CNI（如 Calico/Cilium），本课只做概念与清单层面的演练。",
    },
    {
      type: "paragraph",
      text: "推演一下在支持 NetworkPolicy 的集群里这条策略会干什么：NetworkPolicy 是白名单模式——某方向一旦出现匹配规则，其余流量默认拒绝。策略把目标选为 app: shop-api、来源只放行同样带 app: shop-api 标签的 Pod，等于 shop-web（标签是 app: shop-web）对 shop-api 的访问被默认拒绝，接口瞬间全断，而写策略的人还以为是自己在「加防护」。这正是第 11 章《Service 与网络排障》检查链第 ⑤ 步要查的：Pod 健康、endpoints 正常、但策略后不通——先怀疑 NetworkPolicy 的 podSelector 选错了对象。修复：把来源的 podSelector 改成 app: shop-web 再 apply；在放行之前，先想清楚谁需要访问谁，以及 egress 方向会不会把 DNS 也一起掐断（第 4 章《NetworkPolicy：集群内的流量防线》的 egress 之坑）。预防：先在测试命名空间小范围试点，策略评审时逐条核对 podSelector 选中的 Pod 集合，别在「默认全放通」的集群里假装自己有防线。",
    },
    {
      type: "exercise",
      title: "练习：五场演练的记录与复盘",
      description:
        "按顺序完成五场演练，每场填一行记录：演练名称 / 观察点（你实际看到的特征）/ 恢复动作 / 预防一句话。要求：1) 演练二结束时确认 shop 全部恢复 Running、PVC 仍 Bound；2) 演练三先看 Pod 分布再决定 drain 哪台节点，把 PDB 逐出检查的两种结果都亲眼见过；3) 演练四抄下事件里 exceeded quota 的 requested/used/limited 三个数字；4) 演练五完成后 kubectl get networkpolicy 应为空；5) 全部完成后跑一遍第 47 课五条成功标准逐条打勾。",
      hint: "每场演练的「观察」都从 kubectl get 与 describe 开始，别跳过事件直接看结论；演练三如果没遇到 PDB 拒绝，说明副本恰好分散——把某工作负载临时缩到 1 副本再 drain 同一节点，就能看到地板生效的样子。",
    },
    {
      type: "heading",
      text: "全课回顾测验",
    },
    {
      type: "quiz",
      question: "shop-api 的一个副本进入 CrashLoopBackOff，退出码是 1。按排障方法论，第一步应该做什么？",
      options: [
        "删掉 liveness 探针，让它别再重启",
        "读 kubectl logs 与 --previous，定位进程自己报错的原因",
        "立刻 delete 这个 Pod，让控制器换一个新的",
        "把 resources.limits 调大，防止再被杀",
      ],
      answer: 1,
      explanation:
        "退出码 1 说明是进程自己退出（业务或配置错误），不是 OOM（那通常是 137）。删探针是掩盖症状；换新 Pod 会用同一镜像同一配置重蹈覆辙；提 limits 对主动退出毫无帮助。先读日志拿到证据，再判断是代码问题还是配置问题（第 2 章《Pod 日常操作：日志、进入与调试》与第 11 章《Pod 排障：从 Pending 到 CrashLoop》）。",
    },
    {
      type: "quiz",
      question: "shop-web-pdb 设了 minAvailable=1。以下哪种中断会被这个 PDB 拦住？",
      options: [
        "kubectl drain 节点时对该 Pod 的逐出",
        "kubectl delete pod 直接删除（Deployment 随后重建）",
        "滚动发布时 Deployment 把旧副本缩容",
        "节点失联后控制器清理失联节点上的 Pod",
      ],
      answer: 0,
      explanation:
        "PDB 只约束「自愿中断」中走逐出（eviction）路径的操作，drain 正是典型；直接 delete、滚动发布的自身缩容、节点故障后的清理都不经过这条路径，所以 PDB 拦不住它们。这也解释了为什么发布不断流靠滚动策略与探针、而不是 PDB（第 3 章《滚动更新、回滚与发布策略》、第 10 章《节点维护：cordon、drain 与故障自愈》）。",
    },
    {
      type: "quiz",
      question: "shop-web 整卷挂载了 ConfigMap 里的 index.html。改了 ConfigMap 的值并 apply 后，想让正在运行的 Pod 用上新文案，正确的是？",
      options: [
        "什么都不用做——kubelet 会周期同步，挂载目录里的文件最终会更新",
        "必须删除所有 web Pod 让它们重建",
        "必须重启整个 kind 集群",
        "必须重新 apply Deployment，Pod 才会看到新内容",
      ],
      answer: 0,
      explanation:
        "整卷挂载（非 subPath）的 ConfigMap 由 kubelet 同步更新，运行中的 Pod 无需重启就能最终拿到新文件；而环境变量在容器启动时固化，改了值要重建 Pod 才生效——第 5 章《ConfigMap：配置与镜像分离》讲的就是这条边界。删 Pod、重启集群、重 apply Deployment 都是不必要的动作。",
    },
    {
      type: "quiz",
      question: "给 shop-api 配好了 HPA、也放了负载，但 REPLICAS 一直不动。第一步应该看什么证据？",
      options: [
        "kubectl get hpa 的 TARGETS 列与 kubectl top pods 的用量",
        "直接把 maxReplicas 调大，期望它因此扩起来",
        "检查 Ingress 是否把流量送到 shop-api",
        "重启 metrics-server Deployment",
      ],
      answer: 0,
      explanation:
        "TARGETS 给出当前平均利用率与目标的对比，top pods 给出原始用量——先读这两个证据才能判断是负载不够、指标没采到还是配置错误。调大 maxReplicas 不解决「利用率没到阈值」；流量没送到 api 是负载侧原因，同样会反映在用量上；metrics-server 是否正常会表现为 TARGETS 一直是 unknown。先看指标再动手（第 7 章《HPA：按负载水平伸缩》、第 11 章《集群可观测：指标、事件与日志》）。",
    },
    {
      type: "quiz",
      question: "在支持 NetworkPolicy 的集群里，shop-web 访问 shop-api 突然超时，但两边 Pod 都 Running、endpoints 也正常。下一步最该查什么？",
      options: [
        "NetworkPolicy 是否把这条流量默认拒绝了，策略的 podSelector 是否选错了对象",
        "把 shop-api 的 Service 改成 NodePort 试试",
        "重启 shop-api Deployment",
        "检查 shop-web 的镜像是否损坏",
      ],
      answer: 0,
      explanation:
        "Pod 健康加 endpoints 正常，说明 Service 层没问题；「策略后不通」是 NetworkPolicy 白名单模式的典型症状——某方向一旦出现匹配规则，其余流量默认拒绝，而写错的 podSelector 会把该放行的来源挡在门外（第 4 章《NetworkPolicy：集群内的流量防线》）。改 Service、重启应用、查镜像都答非所问，正确的下一步是核对策略本身（第 11 章《Service 与网络排障》检查链第 ⑤ 步）。",
    },
    {
      type: "heading",
      text: "学完去哪",
    },
    {
      type: "paragraph",
      text: "课程到这一课结束，但学习路径没有终点。官方文档是接下来最权威的参照：kubernetes.io/docs 按「概念 → 任务 → 参考」三层组织——概念页讲机制与取舍，任务页给可复制的操作，参考页是字段级权威；日常写清单时 kubectl explain 能就地查字段，比记性好用得多（第 11 章《排障工具箱》）。如果想把能力「证明」出来，可以了解 CKA 认证：它考察在规定时间内用 kubectl 完成集群任务，覆盖控制面、网络、存储、排障等实操面，与本课程运维章节的重合度很高，考试前用官方模拟环境练手即可。想继续深入，有三个与课程排除项呼应的方向：Operator 模式（把有状态应用的运维知识代码化，第 9 章《扩展：CRD、Operator 与准入 Webhook》）、服务网格（流量治理下沉到基础设施层）、多集群与 Gateway API（第 4 章《Ingress 与 Gateway API》的下一代入口）——每一个都值得用官方文档从概念开始系统学。最后留一句运维层面的提醒：你已经能独立把一个系统放上 Kubernetes 并让它活着，接下来请把「故障演练」变成习惯——生产环境唯一可以确定的事，就是故障一定会来。",
    },
    {
      type: "keypoints",
      items: [
        "五项故障对应五条机制：自愈靠控制器、配置丢失靠声明式源恢复、drain 尊重 PDB、配额拒绝看事件、策略误伤查 podSelector——观察、恢复、预防三段式是通用姿势。",
        "恢复动作的共性：改回期望状态（apply/scale/undo）并让控制器调谐，而不是手动去「修」一个个 Pod。",
        "演练的价值在第一次真实故障到来前，就把「症状 → 证据 → 假设 → 验证」走成肌肉记忆。",
      ],
    },
  ],
};
