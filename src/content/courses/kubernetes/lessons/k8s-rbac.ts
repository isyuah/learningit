/* ==================================================================
 * 课时：RBAC：谁可以对什么做什么（k8s-rbac）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把「认证」与「授权」分开理解，用 Role/ClusterRole 与绑定四件套为 shop 的发布机器人配置最小权限，并用 kubectl auth can-i 验证。",
  blocks: [
    {
      type: "paragraph",
      text: "shop 团队现在有好几位同学、一条 CI 发布流水线，还有偶尔来排查问题的运维。如果所有人共用一把 cluster-admin 的 kubeconfig，任何一次误操作或令牌泄露，代价都是整个集群。安全章节上一课把「谁能碰 apiserver」列成了第一层信任边界，本课就给它装上具体的机制：RBAC（Role-Based Access Control，基于角色的访问控制），回答「谁可以对什么做什么」。",
    },
    {
      type: "heading",
      text: "认证与授权是两件事",
    },
    {
      type: "paragraph",
      text: "先拆开两个常被混在一起的问题。认证（authentication）回答「你是谁」：apiserver 收到请求后，先从 TLS 客户端证书、令牌等方式识别出请求者的身份——kubeconfig 里的 user 字段就是客户端侧「用哪份凭据去证明自己」的选择。授权（authorization）回答「你被允许做什么」：身份确认之后，服务端按这个身份查规则，决定请求放行还是拒绝。kubeconfig 本身不携带任何权限，权限永远在服务端判定。",
    },
    {
      type: "definition",
      term: "认证 vs 授权",
      definition:
        "认证是出示身份（你是谁：客户端证书、令牌、ServiceAccount 令牌等）；授权是核对权限（你能做什么，由 RBAC 决定）。apiserver 总是先认证、后授权。",
    },
    {
      type: "paragraph",
      text: "身份的种类很多：真实用户（证书、企业账号系统经 OIDC 换来的令牌——后者只讲概念，配置细节以官方文档为准）、机器人（ServiceAccount），以及组。RBAC 不关心你的身份是怎么来的，只把身份当作 subject（主体）来处理。认证与授权的完整顺序会在下一章《一次 API 请求的旅程》里正式走一遍。",
    },
    {
      type: "heading",
      text: "RBAC 四件套",
    },
    {
      type: "paragraph",
      text: "RBAC 的对象可以分成两半：一半描述「权限规则」，一半描述「把规则授予谁」。",
    },
    {
      type: "list",
      items: [
        "Role：命名空间内的权限规则；",
        "ClusterRole：集群范围的权限规则（也能被 RoleBinding 在单个命名空间内「借用」）；",
        "RoleBinding：把 subject 绑定到某个角色，作用范围是它所在的命名空间；",
        "ClusterRoleBinding：把 subject 绑定到集群范围，作用于整个集群。",
      ],
    },
    {
      type: "paragraph",
      text: "规则与授予分离，是为了复用：同一个 ClusterRole（比如官方内置的 view）可以绑给不同的人、不同的命名空间，而规则只维护一份。",
    },
    {
      type: "heading",
      text: "权限规则怎么写：apiGroups、resources、verbs",
    },
    {
      type: "paragraph",
      text: "一条规则回答「对哪类对象的哪些操作放行」。apiGroups 是对象所属的 API 组（核心组写空字符串 \"\"，Deployment 属于 apps，NetworkPolicy 属于 networking.k8s.io）；resources 写资源复数名，子资源用「资源/子资源」形式；verbs 是动作，读操作是 get/list/watch，写操作是 create/update/patch/delete。下面的 Role 给 shop 的发布机器人只读权限，并允许更新 Deployment：",
    },
    {
      type: "code",
      title: "shop-release-bot 的 SA、Role 与 RoleBinding",
      language: "yaml",
      code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: shop-release-bot
  namespace: shop
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: release-bot
  namespace: shop
rules:
  # 只读：查看发布状态与排障（故意不给 secrets——机器人不需要读密码）
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "events"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
  # 发布：只允许更新 Deployment（不能删除、不能改 StatefulSet 等其他工作负载）
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: release-bot-binding
  namespace: shop
subjects:
  - kind: ServiceAccount
    name: shop-release-bot
    namespace: shop
roleRef:
  kind: Role
  name: release-bot
  apiGroup: rbac.authorization.k8s.io`,
    },
    {
      type: "paragraph",
      text: "注意几处刻意设计：Role 与 RoleBinding 都带 namespace: shop，因此这条授权只在 shop 命名空间内生效；secrets 被排除在只读列表外，因为发布机器人没有理由读数据库密码；写权限只落在 deployments 上，没有顺手给 delete。还可以用 resourceNames 把写权限进一步收窄到指定对象：",
    },
    {
      type: "code",
      title: "用 resourceNames 收窄到两个 Deployment",
      language: "yaml",
      code: `rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["update", "patch"]
    resourceNames: ["shop-web", "shop-api"]`,
    },
    {
      type: "paragraph",
      text: "这样即使令牌泄露，能改的也只有这两个 Deployment。需要提醒的是：resourceNames 只约束 get/update/patch/delete 这类按名字的操作，list/watch 不做按名过滤，细节以官方文档为准。如果发布流水线还需要扩缩容，要给 deployments/scale 子资源加 update（见本课练习）。",
    },
    {
      type: "heading",
      text: "命名空间边界与内置 ClusterRole",
    },
    {
      type: "paragraph",
      text: "Role 只在它所在的命名空间内有效；ClusterRole 没有命名空间，可以描述节点这类集群级资源，也可以描述「任何命名空间里的 Deployment」。绑定时，ClusterRoleBinding 授予集群范围，而 RoleBinding 即使引用 ClusterRole，也只在绑定所在的命名空间内生效——这是「用全局规则、限局部生效」的常用组合。",
    },
    {
      type: "table",
      caption: "官方内置 ClusterRole 的一句话定位（精确规则清单以官方文档为准）",
      headers: ["角色", "定位", "典型授予对象"],
      rows: [
        ["cluster-admin", "集群超级用户：几乎所有资源与 RBAC 本身都可管理", "极少数平台管理员"],
        ["admin", "命名空间内接近全权，可在命名空间内建 Role/RoleBinding，但不能改 ResourceQuota 与命名空间本身", "命名空间负责人"],
        ["edit", "命名空间内业务对象读写（Deployment/Service/ConfigMap 等），不能管理 RBAC", "开发者、CI 流水线"],
        ["view", "命名空间内只读", "只读排障与审计查询"],
      ],
    },
    {
      type: "paragraph",
      text: "「给所有人 cluster-admin」是很多事故的根源：权限过大让任何一次误操作都没有缓冲，也让「谁干了什么」失去意义。需要精确核对某个内置角色的规则时，`kubectl get clusterrole view -o yaml` 可以直接看到它的规则清单（前提是你的账号有权读取）。",
    },
    {
      type: "heading",
      text: "默认 ServiceAccount 与自动挂载的令牌",
    },
    {
      type: "paragraph",
      text: "每个命名空间都有一个名为 default 的 ServiceAccount；不指定 serviceAccountName 的 Pod 会自动使用它，并且默认把该账号的令牌以投射卷（projected volume）形式挂到容器里。这意味着：集群里每个 Pod 天生带着一把调用 apiserver 的钥匙，而 default 账号通常没有任何授权——可一旦有人给 default 账号绑了权限，所有没指定账号的 Pod 就都拿到了它。",
    },
    {
      type: "paragraph",
      text: "所以最小权限要从两端做：不需要调 apiserver 的工作负载（shop-web、shop-api 运行期只响应请求）不挂令牌；确需调用的工作负载，用专用 ServiceAccount + 最小 Role + Binding，并在清单里显式指定。关闭自动挂载只需一个字段：",
    },
    {
      type: "code",
      title: "关闭令牌自动挂载",
      language: "yaml",
      code: `apiVersion: v1
kind: ServiceAccount
metadata:
  name: shop-worker
  namespace: shop
automountServiceAccountToken: false`,
    },
    {
      type: "paragraph",
      text: "Pod 清单里也可以单独声明 automountServiceAccountToken: false，它会覆盖 ServiceAccount 上的设置。第 5 章《Secret：敏感数据与信任边界》讲过凭据的暴露面，这里关闭自动挂载就是在源头减少一把会到处乱放的钥匙。",
    },
    {
      type: "heading",
      text: "实操：验证发布机器人的最小权限",
    },
    {
      type: "paragraph",
      text: "把上面的 SA/Role/RoleBinding 存成清单（比如 shop-release-bot.yaml）应用后，先用 kubectl auth can-i 自查——它用 SelfSubjectAccessReview 以指定身份提问，不需要真的拥有那个身份：",
    },
    {
      type: "code",
      title: "kubectl auth can-i 验证",
      language: "bash",
      code: `kubectl apply -f shop-release-bot.yaml

# --as 模拟该 ServiceAccount 提问
kubectl -n shop auth can-i get pods --as=system:serviceaccount:shop:shop-release-bot
kubectl -n shop auth can-i update deployments --as=system:serviceaccount:shop:shop-release-bot
kubectl -n shop auth can-i delete deployments --as=system:serviceaccount:shop:shop-release-bot
kubectl -n shop auth can-i get secrets --as=system:serviceaccount:shop:shop-release-bot`,
    },
    {
      type: "paragraph",
      text: "预期前两条回答 yes（读取、更新都放行），后两条回答 no（删除、读 Secret 被拒）。can-i 的「模拟提问」走的是授权规则本身，会给出真实判定：不带对象名时按资源级提问；要验证 resourceNames 这类按名字收窄的规则，需要把名字带进提问（形如 kubectl -n shop auth can-i update deployments/shop-web --as=...，完整用法以官方文档为准）。",
    },
    {
      type: "paragraph",
      text: "更彻底的一步是拿该账号的真实令牌去调 apiserver，感受「最小权限」在 HTTP 层面长什么样：",
    },
    {
      type: "code",
      title: "用 SA 令牌实际调用 API",
      language: "bash",
      code: `# 生成一个短期令牌（默认有效期约 1 小时，可用 --duration 调整）
TOKEN=$(kubectl -n shop create token shop-release-bot)
# 从当前 kubeconfig 里取出 apiserver 地址
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')

# 读取 deployments：预期 HTTP 200，返回 JSON 列表
curl -ks -H "Authorization: Bearer $TOKEN" "$SERVER/apis/apps/v1/namespaces/shop/deployments"

# 尝试删除 shop-web：预期 HTTP 403 Forbidden
curl -ks -X DELETE -H "Authorization: Bearer $TOKEN" "$SERVER/apis/apps/v1/namespaces/shop/deployments/shop-web"`,
    },
    {
      type: "callout",
      variant: "note",
      title: "-k 仅限本地实验",
      body: "kind 的 apiserver 使用自签证书，上面用 -k 跳过校验只为本地演示。真实环境必须配置受信 CA（kubeconfig 里的 certificate-authority），不要用 -k 访问生产 apiserver。kubectl create token 生成的令牌用于演示与 CI 短时凭据；长生命周期凭据应走各自的官方流程（证书轮换、OIDC 等以官方文档为准）。",
    },
    {
      type: "exercise",
      title: "给发布机器人补上扩缩容能力",
      description:
        "shop 的发布流水线新增需求：发布后把 shop-api 扩到 3 个副本（kubectl scale 或对副本数字段做 patch）。基于最小权限原则，判断这条能力应该加在哪类对象上、需要哪些 verbs，修改 shop 里的 Role 并重新 apply；然后用 kubectl auth can-i 验证两条预期：更新 shop-api 副本数返回 yes，读取 secrets 仍然返回 no。",
      hint: "副本数由 deployments/scale 子资源承载，规则应写在 apiGroups: [\"apps\"]、resources: [\"deployments/scale\"] 上；secret 不在你的新规则里，can-i 结果应该不变。",
    },
    {
      type: "quiz",
      question:
        "运维创建了一个 RoleBinding：subject 指向 CI 的 ServiceAccount，roleRef 指向内置 ClusterRole view，绑定在 shop 命名空间。这个账号能做什么？",
      options: [
        "读取集群所有命名空间的对象",
        "读取 shop 命名空间内 view 规则允许的对象，且不拥有写权限",
        "更新 shop 命名空间里的 Deployment",
        "在 shop 命名空间里创建任意新对象",
      ],
      answer: 1,
      explanation:
        "RoleBinding 的作用范围是它所在的命名空间：即使引用的是 ClusterRole，规则也只在 shop 内生效，所以选项 0 错。view 是只读角色，不含 update/create/delete 这类写动词，因此选项 2 与 3 都不成立。这正是「用全局规则、限局部生效」的标准组合。",
    },
    {
      type: "keypoints",
      items: [
        "认证回答「你是谁」，授权回答「你能做什么」；RBAC 只负责授权这一半",
        "四件套：Role/ClusterRole 定义权限规则（apiGroups/resources/verbs），RoleBinding/ClusterRoleBinding 把 subject（ServiceAccount/User/Group）绑到角色",
        "Role 有命名空间边界；RoleBinding 可以借用 ClusterRole 的规则并限制在本命名空间内生效",
        "默认 ServiceAccount 令牌自动挂载是常见的过度授权源：不需要的关掉（automountServiceAccountToken: false），需要的用专用 SA + 最小 Role",
        "最小权限用 kubectl auth can-i 验证；cluster-admin 只应授予极少数人",
      ],
    },
  ],
};
