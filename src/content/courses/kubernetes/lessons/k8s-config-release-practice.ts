/* ==================================================================
 * 课时：配置发布实践：diff、dry-run 与滚动生效（k8s-config-release-practice）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把「改配置」走成一条可重复的发布流程：diff 看差距、dry-run 预演、apply 上线、验证生效路径、按类型回滚——全程不依赖任何额外工具。",
  blocks: [
    {
      type: "paragraph",
      text: "前面两课解决了「配置放哪」：ConfigMap 存非敏感配置、Secret 存敏感数据。但日常最高频的操作其实是「改配置」——换一句促销文案、调一个 nginx 参数。改完怎么安全上线？出问题怎么退回去？本课把这些动作炼成一条可重复的流程：看差距 → 预演 → 上线 → 验证 → 回滚。前提是第 19 课《ConfigMap：配置与镜像分离》的 `shop-web-config.yaml`（两个 ConfigMap 加 shop-web Deployment）已经成功 apply，本课所有练习都围绕它进行。",
    },
    {
      type: "heading",
      text: "先回顾：apply 的声明式语义",
    },
    {
      type: "paragraph",
      text: "第 1 章《对象模型：声明式、spec 与调谐循环》讲过声明式的核心：提交期望状态而不是操作步骤。`kubectl apply -f` 把本地清单文件当作期望状态：对象不存在就创建，已存在则按需合并更新，重复执行结果相同——幂等、可重放。apply 会自动记录上次应用的配置（`kubectl.kubernetes.io/last-applied-configuration` 注解），用来做三方合并与「字段被删掉」的检测；所以**不需要** `kubectl create --save-config` 这类旧工作流里的参数——发布统一用 apply，create 只适合临时起对象（重复执行会报 AlreadyExists）。顺带建立一个大视角：发布是一次「期望状态切换」，回滚是另一次切换，两者共用同一条流程。",
    },
    {
      type: "heading",
      text: "apply 之前：diff 与 dry-run",
    },
    {
      type: "paragraph",
      text: "`kubectl diff -f` 读取集群现状，按 apply 的合并语义推演「这次提交将产生什么改动」，以 +/- 前缀逐行展示，和看 git diff 一样——它不修改集群，适合在评审时当配置的 code review 用；没有差异时输出为空。dry-run 则回答「这次提交能不能过」：`--dry-run=client` 只在本机做解析与基础校验（查语法、字段类型），不接触集群；`--dry-run=server` 把请求真实发到 apiserver，走完服务端校验与准入（admission）链但不持久化——所以它能提前暴露「会被集群策略拒绝」的变更，例如第 8 章《工作负载加固》的 Pod Security 准入、第 10 章《命名空间治理：配额与多团队》的资源配额。准入这条链的完整机制在第 9 章《一次 API 请求的旅程》展开，这里先记住它的存在。",
    },
    {
      type: "table",
      caption: "发布检查命令分工",
      headers: ["命令", "做了什么", "不做什么"],
      rows: [
        ["kubectl diff -f file", "按 apply 语义推演并展示将发生的改动", "不修改集群、不经过服务端校验"],
        ["apply --dry-run=client", "本地解析与基础校验", "不接触 apiserver，服务端默认值/准入不执行"],
        ["apply --dry-run=server", "真实请求 apiserver，走校验与准入", "不写入 etcd，不产生实际变更"],
        ["kubectl apply -f file", "提交期望状态并持久化", "不是原子操作：需配合 describe/rollout 验证结果"],
      ],
    },
    {
      type: "paragraph",
      text: "所以一条稳妥的上线序列是：先 `diff` 看「改了什么」，再 `--dry-run=server` 看「能不能过」，最后 `apply`；上线后立刻验证。下面进入练习。",
    },
    {
      type: "heading",
      text: "改 ConfigMap 让变更生效：两种路径",
    },
    {
      type: "paragraph",
      text: "动手之前先想清楚一个关键问题：ConfigMap 内容改了，运行中的 Pod 什么时候用上？答案是「取决于注入方式」，这也是上一课反复强调的边界：卷挂载的 Pod 由 kubelet 周期同步，**不改 Pod 模板也能让文件变新**（内容型路径）；而 env 注入的值固化在容器启动时，模板不变就永远不更新（引用型路径）。想让模板「变」一下有两条手段：修改 Deployment 里对 ConfigMap 的引用（换名字、换键、新增 env 项），或者用 `kubectl rollout restart` 强制重建。注意 Deployment 的滚动只看 Pod 模板是否变化——ConfigMap 内容变化不产生新 revision，这正是两种路径代价差异的根源。",
    },
    {
      type: "table",
      caption: "三种生效方式与取舍",
      headers: ["生效方式", "怎么触发", "代价与取舍", "怎么回滚"],
      rows: [
        ["卷挂载同步", "直接改 ConfigMap 内容，等 kubelet 同步", "无重建、无停机；有同步延迟，副本间短暂新旧并存；应用需重新读文件", "把文件内容改回去再 apply"],
        ["rollout restart", "kubectl rollout restart deployment", "全部 Pod 重建，一致地读到新值；有滚动窗口", "再 restart 一次或 undo（模板未变时意义有限）"],
        ["改引用触发滚动", "新建/改名 ConfigMap 并更新 Deployment 引用", "走标准滚动：新旧并存受 maxSurge/maxUnavailable 约束，探针把关；最干净可审计", "kubectl rollout undo 回到上一 revision"],
      ],
    },
    {
      type: "paragraph",
      text: "选型直觉：低风险、需要快速见效的内容（页面文案、白名单）走卷同步；高风险或 env 注入的配置走模板变更/滚动——它把「改了什么」固化进 revision 历史，可审计也可一键回退。immutable 的 ConfigMap（如第 19 课示例里的 shop-web-nginx）没有别的选择：内容不能改，只能新建对象再改引用，天然落到第三种方式。",
    },
    {
      type: "heading",
      text: "练习主流程：换首页文案，验证，再回滚",
    },
    {
      type: "paragraph",
      text: "第 19 课的 `shop-web-html` 以卷挂载方式为 nginx 提供 `index.html`，所以这是一次典型的内容型变更。先确认基线：",
    },
    {
      type: "code",
      title: "第 0 步：确认 shop-web 处于就绪基线",
      language: "bash",
      code: `kubectl -n shop rollout status deployment/shop-web
kubectl -n shop get configmap
kubectl -n shop get pods -l app=shop-web`,
    },
    {
      type: "paragraph",
      text: "预期：Deployment 可用（滚动状态为成功），`shop-web-html` 与 `shop-web-nginx` 两个 ConfigMap 在列，两个副本 Pod 都 Ready。接着编辑本地文件 `shop-web-config.yaml`：把 `index.html` 里的 `<p>全店精选技术书，满 99 包邮。</p>` 替换成 `<p>开学季全场 5 折起，新用户再减 20。</p>`（文案随意，只要记得自己改了什么，后面验证与回滚要依据它）。",
    },
    {
      type: "code",
      title: "第 1 步：diff 看差距 → dry-run 预演 → apply 上线",
      language: "bash",
      code: `# 看差距：预期只有 index.html 相关行以 +/- 出现；Deployment 无 diff（模板没变）
kubectl -n shop diff -f shop-web-config.yaml

# 预演：先本地，再走服务端校验与准入
kubectl -n shop apply --dry-run=client -f shop-web-config.yaml
kubectl -n shop apply --dry-run=server -f shop-web-config.yaml

# 上线
kubectl -n shop apply -f shop-web-config.yaml`,
    },
    {
      type: "paragraph",
      text: "diff 的输出里应该只有 ConfigMap 内容的变化——如果 Deployment 段也出现 diff，说明你改动了模板，那就会触发滚动而不是卷同步（回头对比下面的观察点）。两次 dry-run 预期都不报错：client 证明语法与本地校验通过，server 证明它能过 apiserver 的完整校验与准入。apply 后 ConfigMap 更新完成，但注意此刻 Pod **不会**重建。",
    },
    {
      type: "code",
      title: "第 2 步：验证——Pod 没动，文件已变新",
      language: "bash",
      code: `# 观察：Pod 的 AGE 不应归零，说明没有重建
kubectl -n shop get pods -l app=shop-web

# describe 看状态与事件：不应出现新的扩缩/滚动事件
kubectl -n shop describe deployment/shop-web

# 等 kubelet 完成一次同步（本地练习稍等片刻）后，查看卷里的文件
POD=$(kubectl -n shop get pod -l app=shop-web -o jsonpath='{.items[0].metadata.name}')
kubectl -n shop exec "$POD" -- cat /usr/share/nginx/html/index.html

# 确认没有产生新的 Deployment revision（内容变化不记 revision）
kubectl -n shop rollout history deployment/shop-web`,
    },
    {
      type: "paragraph",
      text: "预期：Pod 列表里 AGE 保持不变（不是刚创建的样子），describe 输出里副本计数没有变化、事件区没有出现新的扩缩与滚动事件，`exec cat` 能看到新文案，rollout history 里 revision 数量没有增加——describe 是验证发布的通用手段，副本数与事件时间线都在这里读。这四条合起来印证了「卷同步」路径：kubelet 把新内容同步进了运行中 Pod 的卷文件，nginx 每次请求读盘，刷新页面即生效。kubelet 的同步是周期性的（精确节奏以官方文档为准），如果迟迟没看到新内容，用 `kubectl rollout restart deployment/shop-web` 兜底。",
    },
    {
      type: "code",
      title: "第 3 步：回滚——把文件改回去，重放 apply",
      language: "bash",
      code: `# 把 index.html 的文案改回原来的句子（若用 git 管理，git checkout 该文件即可）

kubectl -n shop diff -f shop-web-config.yaml   # 预期再次出现反向的 +/- 变化
kubectl -n shop apply -f shop-web-config.yaml

# 验证旧文案恢复；Pod 依然不重建
POD=$(kubectl -n shop get pod -l app=shop-web -o jsonpath='{.items[0].metadata.name}')
kubectl -n shop exec "$POD" -- cat /usr/share/nginx/html/index.html`,
    },
    {
      type: "paragraph",
      text: "内容型回滚的要点：ConfigMap 没有 revision 概念，回滚 = 把文件恢复到旧版本后重新 apply，让 kubelet 再同步一次。所以「配置随清单进 git」不是可选项而是回滚能力的前提——没有版本管理的配置，出问题时只能靠记忆手改回来。",
    },
    {
      type: "heading",
      text: "拓展：让变更走滚动（引用型路径）",
    },
    {
      type: "paragraph",
      text: "再练习第二种路径。第 19 课的 `shop-web-nginx` 是 immutable 的，想调它的 server.conf（比如关掉 gzip）只能新建对象、改 Deployment 引用——模板一变，自动滚动。",
    },
    {
      type: "code",
      title: "滚动路径：新建 v2 并改引用，用 rollout 收尾",
      language: "bash",
      code: `# 1. 复制 shop-web-nginx 为 shop-web-nginx-v2 并修改 server.conf 内容
# 2. 编辑 shop-web-config.yaml：Deployment 卷引用 name 改为 shop-web-nginx-v2
kubectl -n shop apply -f shop-web-config.yaml

# 观察滚动：新旧 Pod 短暂并存，探针就绪后逐个替换
kubectl -n shop rollout status deployment/shop-web

# 回滚：引用退回 v1（不再被引用的 v2 对象可另行删除）
kubectl -n shop rollout undo deployment/shop-web
kubectl -n shop rollout status deployment/shop-web`,
    },
    {
      type: "paragraph",
      text: "滚动的过程细节——新旧副本并存、maxSurge/maxUnavailable 默认 25% 的节奏、探针与 minReadySeconds 如何当刹车——在第 3 章《滚动更新、回滚与发布策略》已经完整讲过，这里只观察现象：`rollout status` 会先出现新副本在创建，完成后 Deployment 稳定；`rollout undo` 把 Pod 模板退回上一个 revision，再滚动一次。对比刚才的卷同步，两种路径的差异一目了然：一个不惊动 Pod，一个走完整发布。",
    },
    {
      type: "callout",
      variant: "note",
      title: "原生流程之上：Helm 与 Kustomize",
      body: "当「同一套应用的多份环境配置」成为负担，生态里有两大主流工具：Helm（模板化打包与发布）和 Kustomize（声明式叠加不同环境的补丁）。本课不展开它们的语法——先吃透 diff/apply/rollout 这套原生语义，你会发现那些工具只是在这套语义之上帮你组织文件与变量。",
    },
    {
      type: "exercise",
      title: "独立演练：一次完整的配置发布闭环",
      description:
        "不参考上文，独立完成：① 把 shop-web 首页文案改成「世界读书日，全场技术书 5 折」，上线前依次执行 diff 与 --dry-run=server 并解释各自输出；② 上线后确认运行中的 Pod 没有重建、文件已更新（指出你依据的观察命令）；③ 回滚到原文案并验证；④ 加分项：走一遍「新建 shop-web-nginx-v2 关掉 gzip → apply → rollout undo」的滚动路径，记录 rollout status 期间新旧副本并存的现象。",
      hint: "用 kubectl -n shop get pods 的 AGE 与 rollout history 的 REVISION 区分「卷同步」与「滚动」两条路径；dry-run=server 通过后 apply 才有意义，别跳过预演直接上线。",
    },
    {
      type: "quiz",
      question: "你想确认一次 apply 会不会被集群的准入策略拒绝，但又不想产生任何真实变更。应该用哪个命令？",
      options: [
        "kubectl -n shop diff -f shop-web-config.yaml",
        "kubectl -n shop apply --dry-run=client -f shop-web-config.yaml",
        "kubectl -n shop apply --dry-run=server -f shop-web-config.yaml",
        "kubectl -n shop rollout status deployment/shop-web",
      ],
      answer: 2,
      explanation:
        "diff 只展示将发生的改动，请求不经过服务端校验，A 错；--dry-run=client 只在本机解析，碰不到准入策略，B 错；rollout status 是发布后的状态查询，与预演无关，D 错。只有 --dry-run=server 会把请求真实送到 apiserver，走完校验与准入链但不持久化——正是「预演能否通过」的答案来源。",
    },
    {
      type: "keypoints",
      items: [
        "发布 = 换一份期望状态：apply 幂等可重放，自动记录上次应用配置，不需要 --save-config 之类旧参数",
        "上线前：diff 看改了什么，--dry-run=server 看能不能过（走真实校验与准入），最后才 apply",
        "内容型变更（卷挂载）不惊动 Pod：kubelet 周期同步，代价是延迟与短暂不一致，回滚 = 文件改回重放 apply",
        "引用型变更走滚动：改 ConfigMap 引用或 rollout restart 触发重建，回滚用 rollout undo——Deployment revision 只跟 Pod 模板走",
        "ConfigMap 内容没有 revision 概念，配置随清单进 git 是回滚能力的前提",
      ],
    },
  ],
};
