/* ==================================================================
 * 课时：ConfigMap：配置与镜像分离（k8s-configmap）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把配置从镜像里拆出来，用 ConfigMap 承载；分清环境变量注入（启动固化）与卷挂载（文件可热更）两条路径的边界，以及 immutable 的取舍。",
  blocks: [
    {
      type: "paragraph",
      text: "前面的课时里，shop-web 用 nginx:1.27-alpine 充当静态店面：首页文案、站点的 server 配置，理论上都可以在构建镜像时写死。但你很快就会遇到第 2 章《Pod 与容器：解剖一个 YAML》没解决的难题：测试环境和生产环境的接口地址不一样，改一句促销文案难道要重新构建一次镜像？本课回答这个问题——把配置当作数据，从镜像里拆出来，用 ConfigMap 这个原生对象承载，并在 Pod 启动或运行时注入。你带走的核心心智是：镜像负责代码，ConfigMap 负责差异；以及两条注入路径各自「什么时候生效」的精确边界。",
    },
    {
      type: "heading",
      text: "配置为什么不该烤进镜像",
    },
    {
      type: "paragraph",
      text: "镜像的立身之本是可复现：同一个镜像（同一 digest）在任何地方都产生相同行为，这是供应链审计与回滚的前提。一旦把环境相关的值——数据库地址、域名、功能开关、页面文案——烤进镜像，就同时牺牲了三个东西：",
    },
    {
      type: "list",
      items: [
        "环境差异：被迫为每个环境单独构建镜像，生产跑的那个版本是否与测试过的代码一致，变得无法保证；",
        "发布与回滚的节奏：改一行文案要触发一次完整的镜像构建与滚动发布，回滚文案则要回滚整个镜像版本，可能连同无关的代码变更一起退回；",
        "操作风险：低风险的配置变更与高风险的代码发布被绑死在同一趟流程里，发布频率只能迁就最慢、最危险的那个环节。",
      ],
    },
    {
      type: "paragraph",
      text: "所以成熟的模式是：镜像只包含代码与依赖，把「随环境变化的配置」留在集群里、在运行时注入。ConfigMap 就是为此设计的第一个原生对象（敏感数据用 Secret，下一课讲）。",
    },
    {
      type: "heading",
      text: "ConfigMap 的结构：键值对与整文件",
    },
    {
      type: "paragraph",
      text: "ConfigMap 是一个命名空间级的普通对象，核心字段是 `data`：一组字符串键值对。值可以是一段短参数，也可以是一整份文件的内容——YAML、HTML、nginx 配置片段都可以原样塞进去，只要不是二进制；二进制内容放 `binaryData`（值以 base64 编码）。它和 Deployment 一样参与清单评审与版本管理，改动有记录、可回滚，这正是上一节「配置应该像代码一样管理」的落地方式。",
    },
    {
      type: "definition",
      term: "ConfigMap",
      definition:
        "命名空间内保存非敏感键值配置的对象，供 Pod 以环境变量或卷的形式引用；不提供加密，不是存密码的地方。",
    },
    {
      type: "paragraph",
      text: "ConfigMap 不适合存放超大内容：官方文档对单对象大小有明确上限（约 1 MiB 量级，以官方文档为准），真要挂大文件应该走存储章节的卷方案。另外它创建后默认可以随时修改（`data` 可变），也可以声明 `immutable: true` 冻结，本课后半会讲这个取舍。",
    },
    {
      type: "heading",
      text: "注入方式一：环境变量——启动时固化",
    },
    {
      type: "code",
      title: "从 ConfigMap 取键注入环境变量",
      language: "yaml",
      code: `containers:
  - name: demo
    image: busybox:1.36
    env:
      - name: GREETING
        valueFrom:
          configMapKeyRef:
            name: demo-config
            key: GREETING`,
    },
    {
      type: "paragraph",
      text: "`configMapKeyRef` 按名字与键取值，容器启动后看到的就是普通环境变量 `GREETING`。关键语义在「启动时」三个字：环境变量只在容器进程被创建的那一刻由 kubelet 注入，之后无论你怎么修改 ConfigMap，运行中进程的环境都不会变化——env 注入没有热更新，要新值就必须重建 Pod（第 3 章《滚动更新、回滚与发布策略》的滚动机制，或手动删 Pod 让它重新创建）。适合 env 的配置是应用只在启动时读一次的东西：连接串、开关、运行模式。若引用的 ConfigMap 或键不存在，容器会创建失败，Pod 起不来（后文专门讲）。",
    },
    {
      type: "heading",
      text: "注入方式二：卷挂载——文件与热更新",
    },
    {
      type: "code",
      title: "把 ConfigMap 作为卷挂载进容器",
      language: "yaml",
      code: `containers:
  - name: demo
    image: busybox:1.36
    volumeMounts:
      - name: demo-files
        mountPath: /etc/demo
volumes:
  - name: demo-files
    configMap:
      name: demo-config`,
    },
    {
      type: "paragraph",
      text: "卷挂载的模型完全不同：ConfigMap 卷会把每个键变成挂载目录下的一个文件，文件名等于键名（可用 `items` 挑选键并改名）。kubelet 会周期性把 ConfigMap 的最新内容同步到这些文件里——文件会热更新，这是与 env 最本质的差异。但要注意两条边界：其一，「文件更新了」不等于「应用用上了」，进程是否生效取决于它是否重新读文件：nginx 的静态页面每次请求都读盘，改了立刻可见；而进程内缓存的配置需要应用自己 reload；其二，用 `subPath` 把单个文件挂到指定路径时，kubelet 不会推送后续更新，ConfigMap 变了文件也不变，必须重建 Pod——subPath 牺牲热更新换取「只覆盖单文件、保留目录其余内容」。另外，整目录挂载会遮蔽镜像里该目录原有的全部内容（见下文示例的警告）。",
    },
    {
      type: "table",
      caption: "两种注入方式的分工",
      headers: ["对比维度", "环境变量注入", "卷挂载"],
      rows: [
        ["取值时机", "容器进程启动时固化一次", "文件由 kubelet 周期同步"],
        ["ConfigMap 更新后", "运行中进程不变，需重建/滚动", "文件同步为新值（有延迟）"],
        ["subPath 单文件挂载", "—", "不热更，需重建 Pod"],
        ["应用如何拿到", "读环境变量", "读文件（可能要 reload 或重新读）"],
        ["适合场景", "连接串、开关等启动期参数", "配置文件、模板、静态内容"],
      ],
    },
    {
      type: "heading",
      text: "immutable：把配置冻住",
    },
    {
      type: "paragraph",
      text: "清单里声明 `immutable: true` 后，ConfigMap 的 `data`/`binaryData` 等字段就再也无法修改，只能删除重建。为什么主动放弃可改性？第一是防误改：可变 ConfigMap 会造成「改了配置但部分旧 Pod 还在跑旧值」的漂移窗口，行为不可预期；第二是省控制面压力：不可变对象永远不会产生更新事件，apiserver 与 kubelet 都无需为它们维护变更同步，对象量大的集群收益明显。冻结的代价是：想改内容只能换个名字新建，并更新引用它的 Pod 模板——这反而把配置变更推回到「模板变化 → 滚动发布」这条可审计、可回滚的正轨上（第 21 课《配置发布实践：diff、dry-run 与滚动生效》会用到这个特性）。判断标准一句话：稳定、低频、出错代价高的配置，值得 immutable。",
    },
    {
      type: "heading",
      text: "创建 ConfigMap：字面量、文件与清单",
    },
    {
      type: "code",
      title: "kubectl create configmap 的三种来源",
      language: "bash",
      code: `# 字面量键值：适合少量参数
kubectl create configmap demo-config --from-literal=GREETING=你好

# 整个文件：键名默认取文件名
kubectl create configmap shop-web-html --from-file=index.html

# 自定义键名导入文件
kubectl create configmap shop-web-nginx --from-file=server.conf=./server.conf

# 想看生成结果而不真正创建：dry-run 预览
kubectl create configmap demo-config --from-literal=GREETING=你好 --dry-run=client -o yaml`,
    },
    {
      type: "paragraph",
      text: "`--from-literal` 适合临时参数，`--from-file` 适合把本地已存在的整份配置导入（键名默认是文件名）。命令式 create 适合快速实验，但生产的主流是把 ConfigMap 写进 YAML、放进 git，用 `kubectl apply` 管理——这样配置变更走评审、可追溯，下一课练习就按这个流程走。注意上面的 `--dry-run=client -o yaml`：先预览将生成的对象，是发布流程的第一步预演，第 21 课会展开。",
    },
    {
      type: "heading",
      text: "shop-web 示例：静态页与 nginx 配置进 ConfigMap",
    },
    {
      type: "paragraph",
      text: "回到 shop-web。我们把两类内容拆成两个 ConfigMap：`shop-web-html` 存首页 HTML（文案常改，保持可变，等 kubelet 同步即可换文案）；`shop-web-nginx` 存站点 server 配置（行为类配置，低频且出错影响大，标 `immutable: true`）。清单如下：",
    },
    {
      type: "code",
      title: "shop-web-config.yaml：两个 ConfigMap 加一个 Deployment",
      language: "yaml",
      code: `apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-web-html
  namespace: shop
data:
  index.html: |
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head><meta charset="utf-8"><title>shop 书店</title></head>
    <body>
      <h1>欢迎光临 shop 书店</h1>
      <p>全店精选技术书，满 99 包邮。</p>
    </body>
    </html>
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-web-nginx
  namespace: shop
immutable: true
data:
  server.conf: |
    server {
        listen 80;
        server_name _;
        root /usr/share/nginx/html;
        index index.html;
        location / {
            try_files $uri $uri/ =404;
        }
        gzip on;
        gzip_types text/html text/css;
    }
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-web
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop-web
  template:
    metadata:
      labels:
        app: shop-web
    spec:
      containers:
        - name: shop-web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
          volumeMounts:
            - name: html
              mountPath: /usr/share/nginx/html
            - name: nginx-conf
              mountPath: /etc/nginx/conf.d/default.conf
              subPath: server.conf
      volumes:
        - name: html
          configMap:
            name: shop-web-html
        - name: nginx-conf
          configMap:
            name: shop-web-nginx`,
    },
    {
      type: "paragraph",
      text: "两处挂载各演示一种模式：`html` 卷整目录挂到 nginx 的文档根目录，键 `index.html` 变成一个文件，改文案由 kubelet 同步即可热更新；`nginx-conf` 卷用 `subPath` 把 `server.conf` 单文件挂成 `conf.d/default.conf`，覆盖镜像自带的默认站点配置——因为走了 subPath，这份文件不会热更新，加上 ConfigMap 本身 immutable，行为完全稳定，想调整只能新建对象并改 Deployment 引用（这一步将触发滚动发布）。`gzip`、`try_files` 这些指令证明：镜像里的 nginx 一行没改，行为完全由配置决定。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "整目录挂载会遮蔽镜像原目录",
      body: "把卷挂到 /usr/share/nginx/html，等于用卷的内容整体替换该目录——镜像里预置的默认页面、错误页全被盖住，目录里最终只有 ConfigMap 提供的文件。忘挂必需文件时应用会启动失败或行为异常；只想覆盖其中某个文件时，用 subPath 挂单文件（代价是失去热更新，正如本示例的 nginx 配置）。",
    },
    {
      type: "heading",
      text: "引用不存在的 ConfigMap 会怎样",
    },
    {
      type: "paragraph",
      text: "两种注入方式对「缺失」都是严格失败，但表现不同。env 引用不存在的 ConfigMap 或键：容器创建失败，Pod 长时间停在容器创建中的状态，事件里能看到 `CreateContainerConfigError` 与类似 `configmap \"xxx\" not found` 的报错。卷挂载引用不存在的 ConfigMap：卷挂不上去，Pod 卡在 ContainerCreating/Pending，事件里出现 `FailedMount`。两种情况都不会自动恢复，需要修正引用或补建对象；在 Deployment 里这会让滚动发布卡住，新副本一直起不来（回看第 3 章的滚动机制）。如果某个键确实可有可无，可以在引用处声明 `optional: true` 放宽：键缺失时该环境变量不注入，卷则跳过缺失键——这是官方提供的逃生门，默认仍是严格模式。",
    },
    {
      type: "quiz",
      question: "运行中的 Pod 通过 env 注入了 ConfigMap 的某个键。管理员随后修改了该 ConfigMap 的 data，这个 Pod 会怎样？",
      options: [
        "容器进程的环境变量会立即变成新值",
        "kubelet 会把新值同步进卷文件，应用重读后生效",
        "Pod 与容器不受影响；新值要等 Pod 重建（重新创建容器）后才生效",
        "ConfigMap 已被 Pod 引用，修改请求会被 apiserver 拒绝",
      ],
      answer: 2,
      explanation:
        "env 值在容器进程创建时由 kubelet 注入一次，之后 ConfigMap 的修改不会改动运行中进程的环境，所以 A 错；卷同步只发生在卷挂载方式，env 注入没有卷，B 错；ConfigMap 默认可变，被引用不构成拒绝修改的理由，只有声明 immutable 才会拒绝，D 错。要让 env 注入拿到新值，必须让引用它的 Pod 重新创建。",
    },
    {
      type: "keypoints",
      items: [
        "配置不该烤进镜像：同一镜像应可复现，环境差异与发布节奏都要求配置在运行时注入",
        "ConfigMap 是命名空间级键值对象，data 存字符串，binaryData 存 base64 二进制，不适合超大内容",
        "env 注入在启动时固化、不热更新；卷挂载每键一文件、kubelet 周期同步，但 subPath 单文件不热更",
        "文件更新 ≠ 应用生效：静态内容随请求读盘可见，进程内缓存配置要应用自己 reload",
        "immutable 防误改、省控制面变更同步压力，改动只能删了重建并更新引用——反而走回滚得动的发布流程",
        "引用缺失的 ConfigMap：env 路径容器创建失败、卷路径挂载失败，Pod 都起不来，可用 optional 放宽",
      ],
    },
  ],
};
