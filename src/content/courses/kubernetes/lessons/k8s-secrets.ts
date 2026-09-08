/* ==================================================================
 * 课时：Secret：敏感数据与信任边界（k8s-secrets）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Secret 与 ConfigMap 同构但语义不同：base64 不是加密，本课拆解 Secret 的类型、三种消费方式与真实暴露面，建立「编码、权限、加密各管一段」的信任边界心智。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课给 shop-web 解决了「文案与配置放哪」，但 shop 还有一个更扎手的数据：shop-db（PostgreSQL）的密码。它也是配置，可它不能像 ConfigMap 那样摊开给人看——任何能读到 ConfigMap 的账号都能看到全部键值，密码放进去等于明文贴在集群里。Kubernetes 为此提供 Secret。不过先泼一盆冷水：Secret 的名字容易让人误以为它「自带加密」，实际上它的默认保护远比想象中薄。本课要建立的不是命令清单，而是一张信任边界图：Secret 的机制、它默认防不住什么、以及防线应该怎么分层。",
    },
    {
      type: "heading",
      text: "同构的对象，不同的语义",
    },
    {
      type: "paragraph",
      text: "Secret 与 ConfigMap 在结构上几乎一样：命名空间级对象，`data` 存键值对（值要求 base64 编码，二进制友好），也有 `binaryData`，同样可以声明 `immutable: true`；消费机制也完全复用上一课的两条路径——环境变量注入与卷挂载，生效边界（env 启动固化、卷 kubelet 同步、subPath 除外）照搬，不再重复。差异不在机制，在语义与防护边界：ConfigMap 面向人人可读的非敏感配置，Secret 面向需要单独管控的敏感数据。这意味着它可以获得与 ConfigMap 不同的待遇——在 RBAC 上单独收紧读取权限、在存储层单独加密、在审计里单独标记，而「哪些数据算敏感」由你的威胁模型决定（第 8 章《安全边界与威胁模型》会系统讲）。另外写 YAML 时可用 `stringData` 字段直接写明文，apiserver 会转成编码后的 `data`——它只写不读，`kubectl get` 看不到明文。",
    },
    {
      type: "heading",
      text: "base64：编码，不是加密",
    },
    {
      type: "code",
      title: "演示：Secret 的 data 编码可逆",
      language: "bash",
      code: `# 演示目的：Secret 的 data 值就是这种 base64 编码，肉眼不可读
echo -n 'Shop-db-pass-2026' | base64

# 编码可逆：解码立刻还原原文
echo -n 'Shop-db-pass-2026' | base64 | base64 -d`,
    },
    {
      type: "paragraph",
      text: "第一行输出一串字母、数字与 +/= 组成的字符串——这是 base64。它存在的唯一原因是让任意字节（包括二进制）都能安全地写进 YAML/JSON，与保密毫无关系；第二行证明它完全可逆。所以请记住这条推论：**凡是能 `kubectl get secret` 的账号，凡是能读到 etcd 的人，都等于拿到了原文**。Secret 的保护不来自格式，而来自访问控制与加密层——这正是本课后半的主题。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "演示密码不是真密码",
      body: "本课与全书示例里的密码（如 Shop-db-pass-2026）只服务于本地 kind 教学。真实环境请用生成器产出高熵随机密码并定期轮换；任何环境都别把真实 Secret 的明文或解码结果提交进 git、贴进聊天记录——仓库是历史，删掉也还留在提交记录里。",
    },
    {
      type: "heading",
      text: "Secret 的常见类型",
    },
    {
      type: "table",
      caption: "类型只是「键名契约」，不提供加密",
      headers: ["类型", "用途", "约定的 data 键（示例）"],
      rows: [
        ["Opaque", "任意键值，默认类型", "自定，如 POSTGRES_PASSWORD"],
        ["kubernetes.io/tls", "TLS 证书与私钥（Ingress 终止 TLS 时引用）", "tls.crt、tls.key"],
        ["kubernetes.io/basic-auth", "用户名密码认证", "username、password"],
        ["kubernetes.io/dockerconfigjson", "容器镜像仓库登录凭据", ".dockerconfigjson"],
      ],
    },
    {
      type: "paragraph",
      text: "类型字段不会加密内容，它只是告诉 apiserver 与使用方「这个 Secret 应该有哪些键」，让 Ingress、kubelet 这类组件知道去哪取值：第 4 章《Ingress 与 Gateway API：七层入口》里 Ingress 终止 TLS 引用的就是 `kubernetes.io/tls` 类型（键 `tls.crt`/`tls.key` 分别放 PEM 证书与私钥，值仍需 base64）；`basic-auth` 常配在入口网关做基础认证。证书从哪来属于证书签发流程，不在本课范围。生产实践与 ConfigMap 相同：把 Secret 写进 YAML 放 git、走评审，创建子命令以 `kubectl create secret --help` 为准。",
    },
    {
      type: "heading",
      text: "三种消费方式",
    },
    {
      type: "code",
      title: "方式一：环境变量注入（envFrom 整份导入）",
      language: "yaml",
      code: `containers:
  - name: postgres
    image: postgres:16-alpine
    envFrom:
      - secretRef:
          name: shop-db-credentials`,
    },
    {
      type: "code",
      title: "方式二：卷挂载（每个键变成一个文件）",
      language: "yaml",
      code: `containers:
  - name: app
    volumeMounts:
      - name: db-creds
        mountPath: /etc/db-credentials
        readOnly: true
volumes:
  - name: db-creds
    secret:
      secretName: shop-db-credentials`,
    },
    {
      type: "paragraph",
      text: "env 与卷挂载的机制和 ConfigMap 完全一致（详见上一课），Secret 特有的差异在两点：其一，Secret 卷由 **tmpfs（内存文件系统）** 承载，只存在于节点内存，不写入磁盘等持久存储——这是 Secret 卷与普通文件卷的关键区别；其二，两种方式对「进程可见性」的影响不同：env 注入后明文一定出现在进程环境里（会被子进程继承、可能进崩溃转储或被诊断工具读到），卷挂载默认不进环境，应用按需读文件，暴露面更小。选择没有绝对正确：启动参数类用 env 顺手，文件型配置（如含凭据的客户端配置文件）用卷。`readOnly: true` 与把 Secret 卷设计成只读是官方推荐姿势，防止运行中被篡改。",
    },
    {
      type: "code",
      title: "方式三：imagePullSecrets——让 kubelet 拉私有镜像",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-api
  namespace: shop
spec:
  imagePullSecrets:
    - name: shop-registry-cred
  containers:
    - name: shop-api
      # registry.example.com 为示例地址，仅用于说明私有仓库场景
      image: registry.example.com/team/shop-api:v1.2.3`,
    },
    {
      type: "paragraph",
      text: "前两种方式把凭据交给「应用」，imagePullSecrets 把凭据交给「kubelet」：Pod 里声明后，节点上的 kubelet 拉取镜像时会用该 Secret 里的仓库登录信息向镜像仓库认证。它对应表格里的 `kubernetes.io/dockerconfigjson` 类型——值是 docker 客户端登录后生成的 config.json 内容。注意它的边界：每个需要私有镜像的 Pod（或批量配置到 ServiceAccount）都要引用，且只解决「拉取认证」，不解决「镜像内容可信」（供应链问题在第 8 章《镜像供应链与数据保护》展开，那里会讲这份 dockerconfigjson 怎么造、怎么挂）。",
    },
    {
      type: "heading",
      text: "shop-db 实操：建 Secret、验编码、消费",
    },
    {
      type: "code",
      title: "为 shop-db 创建密码 Secret（演示目的）",
      language: "bash",
      code: `# 演示目的：本地 kind 教学用密码，见本课 warning
# 若第 3 章《StatefulSet：有状态应用的秩序》已创建过同值的 shop-db-credentials，
# 本步会报 AlreadyExists（kubectl create 不幂等）——值与键一致即可跳过。
kubectl -n shop create secret generic shop-db-credentials \\
  --from-literal=POSTGRES_USER=shop \\
  --from-literal=POSTGRES_PASSWORD='Shop-db-pass-2026' \\
  --from-literal=POSTGRES_DB=shop

kubectl -n shop get secret shop-db-credentials
# 预期：名为 shop-db-credentials 的 Secret 存在，TYPE 为 Opaque

# 直接查看：data 里是 base64，肉眼不可读
kubectl -n shop get secret shop-db-credentials -o yaml

# 取回并解码：证明「能 get 就能解」
kubectl -n shop get secret shop-db-credentials \\
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d
# 预期：还原出演示密码原文`,
    },
    {
      type: "paragraph",
      text: "三个 `--from-literal` 分别对应 PostgreSQL 官方镜像启动时要读的环境变量（用户、密码、库名），键名与 postgres:16-alpine 的初始化逻辑直接对应。最后一条命令演示了本课的核心警告：数据是 base64 的，jsonpath 取出来一解码就是原文——所以**读权限即明文**。让 postgres 真正用上它，只需在 shop-db 的 StatefulSet 容器里加一个 `envFrom` 引用（就是本课「方式一」那个片段；完整 StatefulSet 清单见第 3 章《StatefulSet：有状态应用的秩序》）。由于 shop-db 密码属于典型的高影响低频配置，可以顺手把它标成 `immutable: true`——想换密码就新建一个 Secret 再改引用，让变更走滚动发布（下一课的主题）。",
    },
    {
      type: "heading",
      text: "Secret 的四条主要暴露路径",
    },
    {
      type: "list",
      items: [
        "etcd 明文：Secret 默认只做 base64 编码就写进 etcd。能拿到 etcd 数据（磁盘、备份、快照）的人直接拥有全部 Secret；",
        "API 与授权：任何有读取权限的账号都能 `get -o yaml` 并解码。ConfigMap 常人人可读，Secret 应单独收紧（授权怎么配属于第 8 章《RBAC：谁可以对什么做什么》，这里只记住结论）；",
        "进程环境与日志：env 注入把明文带进进程环境，日志框架、崩溃转储、调试工具都可能泄露；卷挂载默认不进环境，能降低这条路径，但应用自己把读到的值打日志照样泄露；",
        "镜像层：把密码写进 Dockerfile、构建参数或镜像内置 env，等于发给每个能拉镜像的人——镜像分层不可变，密码删掉后仍留在历史层里。",
      ],
    },
    {
      type: "paragraph",
      text: "对应地，防线也应该分层，而不是指望 Secret 本身：第一层是**授权最小化**——按命名空间隔离，能读 Secret 的人越少越好；第二层是**静态加密（encryption at rest）**——给 kube-apiserver 配置 `--encryption-provider-config`，让数据在写入 etcd 之前加密、读出时解密。注意静态加密保护的是「存储层」：备份与磁盘泄露时拿到的是密文；它不替代授权，因为合法读取时 apiserver 照常解密返回。启用涉及控制面重启等集群运维操作，前提与细节在第 8 章《镜像供应链与数据保护》；第三层是**外部密钥管理**——把真实值放在集群之外（云 KMS、Vault 或 External Secrets/Secrets Store CSI 这类工具），集群内只放引用或运行时注入，一句话定位生态，工具使用不在本课。",
    },
    {
      type: "quiz",
      question: "关于 Secret，以下哪个理解是正确的？",
      options: [
        "Secret 的 data 做了 base64 编码，所以 etcd 里存的是加密内容，备份泄露也不怕",
        "base64 只是可逆的传输编码而非加密；Secret 默认保护很薄，要靠授权收紧、静态加密等分层防护",
        "只要把密码写进 Secret 并用 env 注入，应用进程环境里就不会出现明文",
        "kubernetes.io/tls 类型的 Secret 会由 apiserver 自动签发证书",
      ],
      answer: 1,
      explanation:
        "A 错：base64 可逆，能读 etcd 就等于拿到原文，所以静态加密要另行配置；C 错：env 注入恰恰会把明文放进进程环境，这正是 env 方式的主要暴露面；D 错：类型只是键名契约（约定 tls.crt/tls.key），apiserver 不负责签发证书。B 正确：Secret 的编码不构成安全边界，安全来自 RBAC 收紧、静态加密、外部管理组成的纵深。",
    },
    {
      type: "keypoints",
      items: [
        "Secret 与 ConfigMap 同构、消费机制相同，语义不同：面向敏感数据，可获得单独收紧的授权与加密待遇",
        "base64 是编码不是加密：能 get 的人、能读 etcd 的人都能还原原文——读权限即明文",
        "常见类型 Opaque / kubernetes.io/tls / basic-auth / dockerconfigjson 只是键名契约，不提供加密",
        "三种消费方式：env（明文进进程环境）、卷挂载（tmpfs 内存文件系统，按文件读取）、imagePullSecrets（kubelet 拉私有镜像用）",
        "四条暴露路径：etcd 明文、API 授权过宽、进程环境与日志、镜像层；对策是授权最小化 + 静态加密 + 外部密钥管理分层布防",
      ],
    },
  ],
};
