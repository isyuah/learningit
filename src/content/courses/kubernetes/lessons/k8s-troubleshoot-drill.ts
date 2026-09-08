/* ==================================================================
 * 课时：综合故障演练（k8s-troubleshoot-drill）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "五个可复现故障场景，症状在前、工具自取：镜像 tag 不存在、selector 打错、readiness 404、ResourceQuota 拒绝扩容、PDB 卡住 drain。",
  blocks: [
    {
      type: "paragraph",
      text: "这是排障章的收尾演练，也是把第 42 到 45 课的工具和本章四步骨架「症状 → 证据 → 假设 → 验证」全部串起来的一课。下面给出五个可复现的故障场景，每个场景分两步呈现：先给故障清单与症状，你需要用前面几课的工具自己定位、推理并修复；答案与逐步推理统一放在后半段的「复盘」里。先动手，再对照——直接看答案会丢掉这次演练唯一的收获：亲手走一遍证据链。",
    },
    {
      type: "callout",
      variant: "note",
      title: "演练前提与纪律",
      body: "假设你已连上第 1 章的 kind 三节点集群（k8s-course，1 个 control-plane + 2 个 worker）。每个场景都在独立命名空间 drill 中进行，先执行 kubectl create namespace drill；场景之间按各场景复盘末尾的清场命令清理，保证下一个场景从干净状态开始。镜像名只使用 busybox:1.36、nginx:1.27-alpine、registry.k8s.io/echoserver:1.10，以及一个刻意写错的虚构示例 tag（正文中已标注）。",
    },
    {
      type: "heading",
      text: "场景 1：Deployment 起来了，但 Pod 一直 ImagePullBackOff",
    },
    {
      type: "code",
      title: "场景 1 故障清单：web-bad.yaml（故意使用不存在的虚构 tag）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-bad
  namespace: drill
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-bad
  template:
    metadata:
      labels:
        app: web-bad
    spec:
      containers:
        - name: web
          # 虚构的 tag，仅用于制造故障：这个 tag 在仓库里不存在
          image: nginx:9.9
          ports:
            - containerPort: 80`,
    },
    {
      type: "paragraph",
      text: "apply 之后你会看到：`kubectl get pods -n drill` 里 Pod 的 STATUS 停在 ImagePullBackOff。请用工具回答三个问题：这个状态是哪个组件、在哪个环节报出来的（describe 的事件里写了什么特征）？为什么此时 kubectl logs 看不到任何容器日志？修复动作是什么、修完如何验证？",
    },
    {
      type: "heading",
      text: "场景 2：Service 建好了，访问却失败",
    },
    {
      type: "code",
      title: "场景 2 故障清单：shop-api.yaml（注意 Service 的 selector）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: drill
spec:
  replicas: 2
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
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: shop-api
  namespace: drill
spec:
  selector:
    app: shop-apy   # 这一行与 Deployment 的标签不一致
  ports:
    - port: 80
      targetPort: 8080`,
    },
    {
      type: "paragraph",
      text: "Pod 是 1/1 Running，但 Service 访问失败。请走《Service 与网络排障》一课的检查链：Endpoints 长什么样？Service 的 selector 与 Pod 标签是否一致？修复后如何验证（起一个 busybox 临时 Pod 访问 shop-api.drill.svc.cluster.local 应看到响应特征）？",
    },
    {
      type: "heading",
      text: "场景 3：Pod Running，但 READY 一直是 0/1",
    },
    {
      type: "code",
      title: "场景 3 故障清单：web-app.yaml（readiness 探针路径可疑）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-app
  namespace: drill
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-app
  template:
    metadata:
      labels:
        app: web-app
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /ready
              port: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web-app
  namespace: drill
spec:
  selector:
    app: web-app
  ports:
    - port: 80
      targetPort: 80`,
    },
    {
      type: "paragraph",
      text: "观察：Pod 一直 Running、RESTARTS 为 0，但 READY 0/1，Service 的 Endpoints 为空。请解释「为什么它不重启」；describe 的 Ready 条件 message 里有什么特征；再亲自验证探针路径：用临时 busybox Pod 分别请求该 Pod 的 / 与 /ready（或 port-forward 到本地），对比两次返回有何不同。修复方向是改探针还是改应用？修复后按什么特征确认恢复？",
    },
    {
      type: "heading",
      text: "场景 4：扩容命令成功了，Pod 却没变多",
    },
    {
      type: "code",
      title: "场景 4 故障清单：quota 与 api-q.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: drill-quota
  namespace: drill
spec:
  hard:
    pods: "3"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-q
  namespace: drill
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-q
  template:
    metadata:
      labels:
        app: api-q
    spec:
      containers:
        - name: api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - containerPort: 8080`,
    },
    {
      type: "paragraph",
      text: "先 apply 上面两个对象，等 3 个 Pod 全部 Running 后执行 `kubectl scale deployment api-q -n drill --replicas=5`。你会看到 scale 命令本身没有报错，但 Pod 数量不再增长。请回答：scale 不报错说明了什么（写进去的是什么）？谁在真正负责创建 Pod，它为什么失败？用 describe resourcequota 看 used 与 hard，确认卡点；修复动作是什么（调整 replicas 还是配额）？",
    },
    {
      type: "heading",
      text: "场景 5：drain 节点，命令卡住不动了",
    },
    {
      type: "code",
      title: "场景 5 故障清单：gate.yaml（Deployment + PDB）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: gate
  namespace: drill
spec:
  replicas: 1
  selector:
    matchLabels:
      app: gate
  template:
    metadata:
      labels:
        app: gate
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: gate-pdb
  namespace: drill
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: gate`,
    },
    {
      type: "code",
      title: "触发故障：对运行着 gate Pod 的 worker 执行 drain",
      language: "bash",
      code: `# 先看 gate Pod 在哪个 worker 上（NODE 列）
kubectl get pods -n drill -o wide

# 对该 worker 执行 drain（kind 里需要 --ignore-daemonsets 跳过 DaemonSet）
kubectl drain k8s-course-worker --ignore-daemonsets`,
    },
    {
      type: "paragraph",
      text: "你会看到 drain 先提示节点被 cordon，随后卡在驱逐 drill/gate 这个 Pod 上不再前进（或在反复提示无法驱逐）。另开一个终端：`kubectl get pdb -n drill` 看 DISRUPTIONS ALLOWED，`kubectl get pods -n drill` 看 Pod 是否还在。请解释 drain 为什么卡住（PDB 与驱逐的关系回第 10 章《节点维护：cordon、drain 与故障自愈》）；然后选择一个安全且尊重业务可用性的修复顺序（提示：先让集群里出现「可被打断的余量」，再继续 drain）；全部完成后别忘了 uncordon。演练目标节点是 worker，绝不要对 control-plane 节点执行 drain。",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "复盘：五个场景的证据链与修复",
    },
    {
      type: "subheading",
      text: "场景 1：镜像 tag 不存在",
    },
    {
      type: "paragraph",
      text: "证据链：STATUS=ImagePullBackOff → describe 看到与拉取镜像相关的 Warning 事件、消息里带镜像名与失败原因特征（tag 不存在时是 manifest/not found 一类）→ 容器从未启动，所以 logs 必然没有内容（这点能帮你区分「拉不下来」与「起来就崩」）。根因：镜像 tag 写错。修复：`kubectl set image deployment/web-bad web=nginx:1.27-alpine -n drill`，再 `kubectl rollout status deployment/web-bad -n drill`，确认 STATUS 变 Running、READY 1/1。预防：apply 前本地 docker pull 验证 tag 存在；重要镜像用 digest 固定（回第 8 章）。清场：kubectl delete deployment web-bad -n drill。",
    },
    {
      type: "subheading",
      text: "场景 2：Service selector 打错",
    },
    {
      type: "paragraph",
      text: "证据链：Pod 全部 1/1 Running（应用侧正常）→ 走检查链第①步：describe svc 或 get endpoints 显示 Endpoints 为空 → 对照 Service 的 selector 与 Pod 的标签（kubectl get pods -l app=shop-api）发现拼写不一致。根因：selector 没配上任何 Pod，ClusterIP 没有后端可转发，访问被拒。修复：把 selector 改回 app: shop-api（kubectl edit svc shop-api -n drill 或重新 apply 修正后的清单），Endpoints 出现地址后，busybox 里 wget shop-api.drill.svc.cluster.local 应能看到 echoserver 的响应特征。预防：Service 与工作负载的标签约定一致，创建后先看一眼 endpoints 再接入流量。清场：kubectl delete deployment,service shop-api -n drill。",
    },
    {
      type: "subheading",
      text: "场景 3：readiness 探针路径 404",
    },
    {
      type: "paragraph",
      text: "证据链：Running 且 RESTARTS=0 → 不是 liveness 在杀（存活失败会重启），是 readiness 失败只摘流量不重启（回第 2 章探针课）→ describe 里 Ready 条件为 False、reason 指向探针、message 带 HTTP 状态码 404 一类特征 → 自测：请求 Pod 的 / 有响应（nginx 默认页），请求 /ready 得到 404。根因：探针路径 /ready 在应用里不存在，readiness 永远失败，Pod 一直不 Ready、Endpoints 为空。修复：让探针路径与真实可用端点一致——改 readinessProbe 的 path 为 /（最快）；更贴近真实系统的是给应用提供真正的 /ready 健康端点（本场景改 path 即可，kubectl edit deployment web-app -n drill）。验证：READY 变 1/1，Endpoints 出现地址，Service 访问恢复。预防：探针路径随路由变更同步更新，发布前用临时 Pod 自测探针端点（回《Pod 排障：从 Pending 到 CrashLoop》）。清场：kubectl delete deployment,service web-app -n drill。",
    },
    {
      type: "subheading",
      text: "场景 4：ResourceQuota 拒绝扩容",
    },
    {
      type: "paragraph",
      text: "证据链：scale 命令成功但 Pod 不增长 → 期望状态（replicas=5）写入了，真正创建 Pod 的 ReplicaSet 控制器在创建时被拒 → describe rs 或 get events 里有创建失败、与配额相关的特征消息 → describe resourcequota 显示 pods 的 used 已到 hard（3/3）。根因：命名空间配额限制了 Pod 总数，新 Pod 创建被准入拒绝（回第 10 章《命名空间治理：配额与多团队》：配额按对象数量与 requests 记账，超了 apply/创建即被拒）。修复：扩容前先确认配额余量——要么把 replicas 调回配额内（这里是练习，推荐 `kubectl scale deployment api-q -n drill --replicas=3`），要么与配额所有者确认后调大 quota。预防：把 quota 当治理手段而非障碍——扩容动作前先 describe resourcequota 看余量，多团队共享命名空间时尤其如此。清场：kubectl delete deployment api-q -n drill; kubectl delete resourcequota drill-quota -n drill。",
    },
    {
      type: "subheading",
      text: "场景 5：PDB 卡住 drain",
    },
    {
      type: "paragraph",
      text: "证据链：drain 先 cordon（预期行为）→ 驱逐 gate Pod 时停滞、反复提示无法驱逐 → PDB 的 DISRUPTIONS ALLOWED 为 0 → Pod 仍健在。根因：gate 是唯一副本，minAvailable=1 意味着任何时刻至少要有一个可用副本，驱逐唯一 Pod 会让可用数降到 0，驱逐请求被 PDB 拒绝，drain 只能等待（回第 10 章：驱逐尊重 PDB，不满足时 drain 卡住并提示）。修复顺序（尊重业务可用性）：先 `kubectl scale deployment gate -n drill --replicas=2`——扩容出的新副本会调度到另一个 worker（本节点已 cordon），此时 disruptionsAllowed 变为 1；再重试 drain，逐个驱逐成功，Pod 在另一节点重建；完成后 `kubectl uncordon k8s-course-worker` 恢复调度。若确认业务可短暂中断，临时把 PDB 的 minAvailable 调为 0 或删除 PDB 是应急手段，但要知道代价是「演练期间可能零可用」。预防：节点维护前先盘点受影响工作负载的副本分布与 PDB（回第 10 章），维护窗口内先扩副本再 drain。清场：kubectl delete deployment gate -n drill; kubectl delete pdb gate-pdb -n drill。",
    },
    {
      type: "heading",
      text: "复盘：本课带走什么",
    },
    {
      type: "paragraph",
      text: "五个场景覆盖了本章全部工具与机制：场景 1 用事件与状态区分「没拉下来」和「起来就崩」；场景 2 用 Endpoints 判断 selector；场景 3 用 READY 与 RESTARTS 区分 readiness 与 liveness、用自测验证探针路径；场景 4 提醒你「命令成功 ≠ 期望达成」，创建动作发生在控制器那一侧，失败要看事件与配额；场景 5 把 PDB 从概念变成「drain 卡住时你要能读懂的那行状态」。它们共同的形状都一样：症状只是入口，证据链每走一步就排除一批假设，最后落在某个具体的机制上——这正是《排障工具箱：状态、事件与 describe》一课立下的四步骨架。",
    },
    {
      type: "quiz",
      question: "Pod 处于 ImagePullBackOff，describe 事件里是与镜像相关的失败原因，且容器日志为空。最合理的下一步是？",
      options: [
        "修改镜像为已存在且正确的 tag，重新 apply 并观察滚动",
        "反复 kubectl delete pod 等它自愈",
        "检查 NetworkPolicy 是否拦截了拉取",
        "调大探针的 failureThreshold",
      ],
      answer: 0,
      explanation: "事件已把根因定位到镜像层（拉不下来），修正 image 字段是直接动作；delete 重建只会重演同一失败（清单没变）；NetworkPolicy 不作用于节点拉镜像；探针只在容器运行后生效，与镜像拉取无关——它甚至还没进入 Running 阶段。",
    },
    {
      type: "quiz",
      question: "某 Pod Running、RESTARTS 为 0、READY 0/1，且 Service Endpoints 为空。最可能的直接原因是？",
      options: [
        "readiness 探针失败，Pod 被摘出后端列表",
        "镜像拉取失败",
        "调度器找不到可用节点",
        "Service selector 与 Pod 标签不一致",
      ],
      answer: 0,
      explanation: "Pod 已经 Running，说明镜像与调度都已完成，排除镜像与调度；RESTARTS=0 说明不是 liveness 在杀，而是 readiness 失败——它不重启容器，只是不让流量进来，Endpoints 因此为空。若 selector 不一致，Pod 即使 1/1 Ready 也不会进 Endpoints——这个场景下 READY 0/1 已经把矛头指向探针。",
    },
    {
      type: "quiz",
      question: "扩容后 Pod 数量不增长，scale 命令本身没有报错。按排障框架，第一步该看什么证据？",
      options: [
        "describe ReplicaSet 或查事件，看创建 Pod 时被什么拒绝",
        "重启 kube-scheduler",
        "删除旧 Pod 给新 Pod 腾位置",
        "检查节点磁盘空间",
      ],
      answer: 0,
      explanation: "scale 写的是期望状态，实际创建由 ReplicaSet 控制器执行，失败会以事件和 RS 状态的形式留下证据——配额拒绝就是典型的「命令成功但创建被拒」。重启调度器与删除旧 Pod 都是未经证据的假设动作；本场景与磁盘无关。",
    },
    {
      type: "quiz",
      question: "drain 一个 worker 时卡住，PDB 显示 DISRUPTIONS ALLOWED 为 0。下面哪个处理顺序最稳妥？",
      options: [
        "先用 kubectl delete node 强制移除节点",
        "先扩副本制造可中断余量（或经评估后临时放宽 PDB），再重试 drain，最后 uncordon",
        "直接对节点执行重启",
        "把 PDB 的 minAvailable 改成比副本数更大",
      ],
      answer: 1,
      explanation: "PDB 卡住说明驱逐会突破可用性下限——正确顺序是先恢复「可被打断的余量」（扩副本或临时放宽/移除 PDB 并承担零可用代价），再继续 drain，完成后 uncordon。delete node 是危险且几乎不需要的动作；重启节点绕过了 drain 的保护；把 minAvailable 调大只会让卡得更死。",
    },
  ],
};
