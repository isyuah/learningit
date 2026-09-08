/* ==================================================================
 * 课时：镜像供应链与数据保护（k8s-supply-chain-secrets）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "沿供应链四问（镜像从哪拉、是不是我要的、有没有毒、凭据怎么护）建立「每步都要验证」的信任链，收束安全章节。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课分别管住了「谁能操作集群」和「容器以什么形态运行」。但还有一个更上游的问题：节点上运行的镜像是从哪来的、内容有没有被换过？以及运行期依赖的凭据（数据库密码、仓库密钥）落在磁盘与日志里时，谁还能读到？安全章节的最后一课，用四个问题把「供应链」这条信任边界走完，并回到第 5 章的数据保护话题做闭环。",
    },
    {
      type: "heading",
      text: "问题一：镜像从哪拉——私有仓库与 imagePullSecrets",
    },
    {
      type: "paragraph",
      text: "公开镜像（如本课程的 nginx、echoserver）不需要认证；生产里更常见的是私有仓库——镜像属于公司内部，拉取需要凭据。kubelet 拉镜像时用的是节点上或清单里给出的凭据：Pod 通过 spec.imagePullSecrets 引用一个类型为 kubernetes.io/dockerconfigjson 的 Secret，里面装着仓库地址与账号密码。手工构造这种 Secret 容易出错，用 kubectl 生成即可：",
    },
    {
      type: "code",
      title: "创建私有仓库凭据（registry.example.com 为示例地址）",
      language: "bash",
      code: `kubectl -n shop create secret docker-registry shop-registry-cred \
  --docker-server=registry.example.com \
  --docker-username=shop-ci \
  --docker-password='请替换为真实凭据'`,
    },
    {
      type: "code",
      title: "生成的 Secret 结构",
      language: "yaml",
      code: `apiVersion: v1
kind: Secret
metadata:
  name: shop-registry-cred
  namespace: shop
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: "eyJhdXRocyI6eyJyZWdpc3RyeS5leGFtcGxlLmNvbSI6eyJ1c2VybmFtZSI6InNob3AtY2kiLCJwYXNzd29yZCI6ImV4YW1wbGUtcGFzc3dvcmQiLCJhdXRoIjoiYzJodmNDMWphVHBsZUdGdGNHeGxMWEJoYzNOM2IzSmsifX19"`,
    },
    {
      type: "paragraph",
      text: "注意上面 data 里的内容只是示例占位。.dockerconfigjson 的本质是一个 JSON：auths 下每个仓库地址一项，auth 字段是「用户名:密码」的 base64 编码——你可以亲手把上面的值 decode 出来验证（printf '<值>' | base64 -d）。这正是第 5 章反复强调的「base64 只是编码不是加密」：它防止的是配置文件中明文出现密码，而不是防读取。真正的保护是把该 Secret 的读取权限用 RBAC 收窄（回指《RBAC》一课的 secrets 排除设计）。",
    },
    {
      type: "code",
      title: "在 Deployment 里引用私有镜像与凭据",
      language: "yaml",
      code: `spec:
  template:
    spec:
      imagePullSecrets:
        - name: shop-registry-cred
      containers:
        - name: api
          # registry.example.com/team/shop-api 为示例地址
          image: registry.example.com/team/shop-api:v1.2.3`,
    },
    {
      type: "paragraph",
      text: "imagePullSecrets 按命名空间生效：Secret 建在 shop，引用它的 Pod 也必须在 shop。如果凭据缺失或错误，Pod 会卡在 ImagePullBackOff / ErrImagePull，事件里能看到认证失败的线索（这类排障在第 11 章《Pod 排障：从 Pending 到 CrashLoop》会系统讲）。",
    },
    {
      type: "heading",
      text: "问题二：拉的是不是我要的——tag 漂移与 digest 固定",
    },
    {
      type: "paragraph",
      text: "tag 是可变指针：v1.2.3 这个标签可以被重新推送、指向另一个镜像内容。于是出现一个经典事故：CI 审查通过的镜像，运行时却悄悄变成了同名 tag 下的新内容。镜像拉取策略（第 2 章《Pod 与容器：解剖一个 YAML》讲过 Always/IfNotPresent/Never）只决定「什么时候去仓库检查」，挡不住「同名 tag 内容变了」。要固定「拉的是哪个内容」，用 digest：",
    },
    {
      type: "code",
      title: "用 digest 固定镜像内容",
      language: "yaml",
      code: `containers:
  - name: api
    # digest 为示例占位，真实值以镜像仓库返回为准
    image: registry.example.com/team/shop-api@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`,
    },
    {
      type: "paragraph",
      text: "digest 是内容寻址：内容不变，digest 就不变；引用 digest 后，tag 被覆盖也影响不到你声明的内容。代价是升级必须显式换 digest——而这正是想要的：每一次内容变化都是一次显式的、可评审、可回滚的发布决策。实践中仓库侧可以再加「tag 不可变」策略，双保险。",
    },
    {
      type: "heading",
      text: "问题三：镜像里有没有毒——扫描与签名",
    },
    {
      type: "paragraph",
      text: "digest 只保证「内容没变」，不保证「内容没问题」。两个手段回答两个不同的问题：",
    },
    {
      type: "list",
      items: [
        "扫描：对镜像做漏洞扫描，发现基础镜像与依赖里的已知漏洞，高危阻断。具体扫描器与接入方式不在本课展开（以官方文档与你的 CI 为准），关键是把扫描做成镜像入库的前置步骤，而不是事后补救；",
        "签名：用私钥给镜像签名，部署侧验签——cosign（Sigstore 生态）与 notation 是当前常见工具，一句话定位：签名回答「这个镜像是受信任方构建并认可的」。",
      ],
    },
    {
      type: "paragraph",
      text: "验签要真正拦得住「未签名镜像进集群」，需要把验签放进准入阶段：由准入 Webhook 在 Pod 创建时校验镜像签名与扫描结论，不通过就拒绝。准入 Webhook 的机制（它如何介入 apiserver 请求）在第 9 章《扩展：CRD、Operator 与准入 Webhook》展开，本课只需要建立「签名 + 准入强制」这条链的直觉。",
    },
    {
      type: "heading",
      text: "问题四：运行时的凭据怎么保护",
    },
    {
      type: "paragraph",
      text: "镜像本身干净了，还要护住运行时的凭据。第 5 章《Secret：敏感数据与信任边界》已经盘点过 Secret 的暴露面，这里收拢成三层防线：",
    },
    {
      type: "list",
      items: [
        "静态加密：Secret 在 etcd 里默认明文存储；给 apiserver 配置 --encryption-provider-config 指向加密配置文件后，写入 etcd 的数据会被加密（加密在写入时生效，启用前已写入的数据需要重写才会被加密，细节以官方文档为准）。前提是你能修改 apiserver 启动配置——kubeadm 自管集群可以配置，托管集群通常由云平台侧提供开关；",
        "读取最小化：能 get Secret 的人越少越好——第 5 章讲过能 get 就能解出明文。用《RBAC》一课的方法给每个账号最小权限，发布机器人不需要读数据库密码；",
        "防泄露：应用不要把 Secret 打进日志或环境变量转储；不要把它写进 Dockerfile/镜像层（镜像会被分发、被扫描，等于把密钥公开）。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "一句话定位本课的边界",
      body: "静态加密配置、扫描器与 Sigstore 的部署步骤都是「以官方文档为准」的运维动作，本课只建立信任链的心智与每步该问的问题；动手环节请跟随官方文档完成。",
    },
    {
      type: "heading",
      text: "信任链心智：从「集群内一切都可信」到「每步都要验证」",
    },
    {
      type: "paragraph",
      text: "回顾本章的完整链条：威胁模型课把安全拆成五层边界，RBAC 管住「谁」，securityContext 与 PSA 管住「以什么形态跑」，本课补上最后两问——「跑的是什么（镜像）」与「凭据落盘后谁可读」。把它们连起来，是一条从「默认信任一切」走向「每步都验证」的链：私有仓库凭据最小权限并定期轮换；镜像用 digest 固定内容、扫描与签名确认来源、准入强制验签；Secret 静态加密护住 etcd、RBAC 最小化护住读取、应用层防泄露。",
    },
    {
      type: "paragraph",
      text: "你会发现这些防线的执行点大多落在 apiserver 的认证、授权与准入链路上——下一章《一次 API 请求的旅程》会从请求的角度，把这些机制如何串行执行讲清楚，安全章节就此收束。",
    },
    {
      type: "quiz",
      question:
        "镜像 v1.2.3 发布后，仓库维护者误把同名 tag 重新指向了另一个镜像内容。哪种部署方式不会悄悄拉到新内容？",
      options: [
        "引用 v1.2.3 tag，且 imagePullPolicy: Always",
        "引用 v1.2.3 tag，且 imagePullPolicy: IfNotPresent",
        "引用 v1.2.3 tag，且 imagePullPolicy: Never",
        "引用该镜像的 @sha256 digest",
      ],
      answer: 3,
      explanation:
        "digest 是内容寻址：内容不变 digest 不变，tag 被重新指向不影响已声明的 digest，所以选项 3 正确。imagePullPolicy 只决定「何时去仓库检查」：Always 每次创建容器都拉取、IfNotPresent 在节点无本地镜像时拉取，两者都可能拉到被覆盖后的新内容（选项 0、1 错）；Never 只用节点本地镜像，虽然不拉新内容，但在新节点上没有缓存时会直接失败，也没有解决「如何确认内容」的问题（选项 2 错）。",
    },
    {
      type: "keypoints",
      items: [
        "imagePullSecrets 用 kubernetes.io/dockerconfigjson 类型承载私有仓库凭据，kubectl create secret docker-registry 生成，按命名空间生效",
        "tag 是可变的，digest 固定「拉的是哪个内容」；imagePullPolicy 只决定何时检查仓库",
        "扫描解决「有没有已知漏洞」，签名解决「是不是受信任方构建」；验签要靠准入 Webhook 才能真正强制",
        "Secret 防护闭环：静态加密护住 etcd（apiserver --encryption-provider-config）、RBAC 最小化护住读取、应用层防日志与镜像层泄露——回指第 5 章与《RBAC》一课",
      ],
    },
  ],
};
