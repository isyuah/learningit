/* ==================================================================
 * 课时：Pod 与容器：解剖一个 YAML（k8s-pod-basics）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Pod 是 Kubernetes 的最小调度单元。解剖一个裸 Pod 清单：镜像与启动命令、环境变量、拉取策略，以及 init 容器与边车两种多容器形态。",
  blocks: [
    {
      type: "paragraph",
      text: "第 1 章我们跟着一次 kubectl apply 走完了「清单 → apiserver → 调度器 → kubelet → 容器运行时」的旅程，也在 kind 上亲手跑起过第一个 Pod。但那时 Pod 对我们还是一个黑盒：它的 YAML 每一行字段意味着什么？为什么 Kubernetes 不直接调度容器，而是多包了一层 Pod？从这一课开始，我们用四课把 Pod 这个最小调度单元拆开讲透。本课先解剖一个 Pod 清单：多容器共享什么、镜像与启动命令怎么写、拉取策略怎么选，最后是 init 容器与边车这两种多容器形态。",
    },
    {
      type: "heading",
      text: "Pod：一组容器的「合租屋」",
    },
    {
      type: "paragraph",
      text: "Kubernetes 里最小的调度单元不是容器而是 Pod：一个 Pod 可以包含一个或多个容器，它们永远被调度到同一台节点上，共享同一组运行资源。共享到什么程度？Pod 内所有容器共享同一个网络命名空间——拥有同一个 IP、同一组端口空间，彼此用 localhost 就能互相访问；机制上，kubelet 会先让容器运行时创建一个极小的 pause 沙箱容器来「持有」这套命名空间，业务容器再加入其中，所以同 Pod 的容器对外天然是一个网络整体。反过来，文件系统并不默认共享：每个容器仍然有自己独立的镜像层与可写层，想交换文件必须显式挂载同一个卷。多容器还共享同一条生命周期：Pod 是整体被调度、整体被重启、整体被删除的单位。最后别忘了 metadata 里的 labels——它是 Service、工作负载等对象选择 Pod 的唯一依据，第 1 章《对象模型》里「labels 是关联基石」的论断在这里第一次落地。",
    },
    {
      type: "code",
      title: "shop-api-pod.yaml：一个最小的裸 Pod",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-api-pod
  namespace: shop
  labels:
    app: shop-api          # 供 Service/控制器按标签选择
spec:
  containers:
    - name: api
      image: registry.k8s.io/echoserver:1.10   # 模拟 shop 的接口服务
      imagePullPolicy: IfNotPresent
      env:
        - name: SHOP_ENV
          value: dev
      ports:
        - containerPort: 8080                  # 文档性声明，不真正“开放”端口`,
    },
    {
      type: "paragraph",
      text: "apiVersion/kind/metadata 这套对象外壳在第 1 章已经见过，本课只看 Pod 特有的 spec。spec.containers 是数组——一个 Pod 里可以有多个普通容器。每个容器四个常用字段：name 在 Pod 内唯一，后面 kubectl logs -c、describe 区分容器都靠它；image 指向镜像仓库的镜像，注意不写 tag 等价于 latest；env 注入环境变量；ports 声明「这个容器监听 8080」。env 的取值来源有讲究：这里写的是静态值，生产里更常见的是从 ConfigMap 与 Secret 注入，让配置随环境走而镜像保持不可变——第 5 章会系统展开。",
    },
    {
      type: "callout",
      variant: "note",
      title: "containerPort 只是文档",
      body: "ports 列表里的 containerPort 不会真的去「开放」端口：只要进程在监听，外部就能连，写不写这一行都不影响连通性。它的实际价值是文档——告诉读清单的人这个容器在监听什么，也让 Service 可以按「命名端口」引用它。端口究竟怎么被访问，属于第 4 章《网络模型》的内容。",
    },
    {
      type: "heading",
      text: "image、command 与 args：谁负责启动进程",
    },
    {
      type: "paragraph",
      text: "镜像本身已经定义了启动命令：Dockerfile 里的 ENTRYPOINT 与 CMD 合起来决定容器跑什么。清单里的 command 与 args 分别覆盖这两者：command 覆盖 ENTRYPOINT，args 覆盖 CMD。规则可以记成一句话——想换启动器就写 command，只想换参数就写 args。四象限组合如下：",
    },
    {
      type: "table",
      caption: "command / args 与镜像默认值的组合语义",
      headers: ["清单写了什么", "容器实际运行什么"],
      rows: [
        ["都不写", "镜像的 ENTRYPOINT + CMD"],
        ["只写 args", "镜像 ENTRYPOINT + 新的 args（即用新参数覆盖 CMD）"],
        ["只写 command", "只运行新 command，镜像的 ENTRYPOINT 与 CMD 都被替换"],
        ["两个都写", "新 command + 新 args"],
      ],
    },
    {
      type: "code",
      title: "hello-pod.yaml：用 busybox 演示覆盖",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-hello
  namespace: shop
spec:
  containers:
    - name: hello
      image: busybox:1.36
      command: ["/bin/sh", "-c"]               # 覆盖镜像 ENTRYPOINT
      args: ["echo 'shop 环境就绪'; sleep 3600"]   # 覆盖镜像 CMD`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "覆盖 ENTRYPOINT 的代价",
      body: "很多官方镜像把「初始化」逻辑放在 ENTRYPOINT 里（等待配置文件、加载证书、启动前置进程）。一旦你用 command 整个替换掉它，这些初始化也会一起消失，容器可能起不来或行为异常。所以：只想调参数时优先写 args，别动 command；必须写 command 时，确认你理解了镜像原本的启动流程。",
    },
    {
      type: "paragraph",
      text: "如果担心容器退出后反复被拉起，可以先记住一个预告：容器退出后是否重启由 restartPolicy 决定（默认 Always，退出码为 0 也会重启）——所以上面的例子让 sleep 持续 3600 秒保持存活。restartPolicy 的完整语义是下一课的主题。",
    },
    {
      type: "heading",
      text: "imagePullPolicy：节点什么时候重新拉镜像",
    },
    {
      type: "paragraph",
      text: "节点上的 kubelet 通过容器运行时拉取镜像，imagePullPolicy 决定拉取的时机，三个取值对应三种意图：IfNotPresent——本地已有就直接用，没有才拉，省流量也省时间，适合固定版本的生产镜像；Always——每次启动容器都让运行时去检查镜像（层已缓存时并不重复下载），适合开发期频繁换 latest、或者镜像 tag 在远端被改写的场景；Never——只允许用节点上已存在的镜像，常用于离线环境或验证「节点预置镜像」的部署。注意：不写这个字段时 Kubernetes 会自动补默认值——用 latest 或无 tag 的镜像默认 Always，用明确的非 latest tag（如 registry.k8s.io/echoserver:1.10）默认 IfNotPresent。这个默认值在对象创建时定型，之后改 tag 不会自动跟着变。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "生产环境用固定 tag，别用 latest",
      body: ":latest 是移动的靶子：今天部署的镜像和三个月前部署的，名字相同内容不同，回滚时你无法确定「上一次跑的是什么」。生产应使用有意义的版本 tag，进阶做法是按镜像 digest（sha256:…）固定，保证每次启动的都是同一份内容——供应链安全那一课（第 8 章）还会回到这一点。",
    },
    {
      type: "heading",
      text: "initContainers：主容器启动前的前置步骤",
    },
    {
      type: "paragraph",
      text: "有些工作必须在主容器启动之前完成，比如等待依赖就绪、拉取或生成初始化数据、给共享目录设置权限。把这些步骤放进 initContainers 而不是塞进主镜像，有三个好处：初始化代码与业务镜像解耦，业务镜像可以保持精简、不需要为了一个 sed 脚本就 FROM 一个带全套工具的基础镜像；需要敏感凭据的初始化步骤可以只出现在 init 容器里，缩小业务容器的暴露面；多个 init 容器天然按声明顺序串行执行，前一个成功（退出码 0）后一个才启动，全部成功后主容器才开始。语义上还有一条：init 容器不支持探针和 lifecycle 钩子（它跑完即走，不需要这些）。",
    },
    {
      type: "code",
      title: "shop-web-init.yaml：init 容器预生成页面",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-web-init
  namespace: shop
  labels:
    app: shop-web
spec:
  initContainers:
    - name: render-index
      image: busybox:1.36
      command: ["/bin/sh", "-c"]
      args:
        - |
          echo '<h1>shop 书店</h1><p>首页由 init 容器预生成</p>' > /www/index.html
          echo '页面生成完毕'
      volumeMounts:
        - name: www
          mountPath: /www
  containers:
    - name: web
      image: nginx:1.27-alpine
      ports:
        - containerPort: 80
      volumeMounts:
        - name: www
          mountPath: /usr/share/nginx/html
  volumes:
    - name: www
      emptyDir: {}`,
    },
    {
      type: "paragraph",
      text: "这个例子里 init 容器把静态页面写进名为 www 的 emptyDir 卷，主容器 nginx 把同一卷挂到站点目录——这就是「init 与主容器共享卷」的典型用法：卷是两者之间唯一的文件通道。emptyDir 的生命周期语义（随 Pod 存在、节点重启会丢）属于第 6 章《卷的心智模型》，本课只需要知道它能让同 Pod 的容器交换文件。失败语义同样重要：若某个 init 容器失败，kubelet 会反复重启它直到成功（restartPolicy 为 Always/OnFailure 时）；若 restartPolicy 是 Never，init 失败会让整个 Pod 进入 Failed——等下一课讲完 restartPolicy，这条规则就能完整读懂了。",
    },
    {
      type: "heading",
      text: "边车（sidecar）：与主容器同生共死的辅助进程",
    },
    {
      type: "paragraph",
      text: "与 init 容器「跑完即退」相对，边车是另一类多容器形态：一个与主容器共享网络命名空间与卷、随 Pod 的整个生命周期常驻的辅助进程，典型例子是日志转发（把主容器写到共享卷的日志送出去）和本地代理（为 legacy 应用补一个 TLS 或协议转换的 localhost 出口）。边车和主容器共享 localhost，所以主应用代码几乎不用改——这正是 Pod 多容器设计最实用的一面。什么时候真的需要多容器，判断标准是「几个进程必须同生共死、共享网络」；如果只是几个独立服务，各自用独立的 Pod 才符合 Kubernetes 的习惯。",
    },
    {
      type: "quiz",
      question: "把两个容器放进同一个 Pod（多容器 Pod）时，下面哪种说法正确？",
      options: [
        "两个容器各自拥有独立的 IP 地址",
        "两个容器共享同一个网络命名空间，可以通过 localhost 互相访问",
        "两个容器的文件系统自动共享，可以互相读写对方的文件",
        "两个容器必须使用同一个镜像",
      ],
      answer: 1,
      explanation:
        "Pod 内所有容器共享网络命名空间：同一 IP、同一端口空间，用 localhost 互通（pause 沙箱容器持有这套命名空间）。文件系统不默认共享，必须显式挂载同一卷；镜像更是完全独立；同 Pod 容器共用一个 IP，不存在「各自独立 IP」。",
    },
    {
      type: "quiz",
      question: "某镜像的 ENTRYPOINT 是 /app/server、CMD 是 --port 8080。清单里只写 args: [\"--port\", \"9090\"]，容器实际运行什么？",
      options: [
        "/app/server --port 8080",
        "/app/server --port 9090",
        "--port 9090",
        "/app/server",
      ],
      answer: 1,
      explanation:
        "只写 args 时，镜像 ENTRYPOINT 保持不变，args 覆盖镜像 CMD——所以运行 /app/server --port 9090。若同时写 command 才会替换 ENTRYPOINT；什么都不写则按镜像默认运行 /app/server --port 8080。",
    },
    {
      type: "keypoints",
      items: [
        "Pod 是最小调度单元：同 Pod 容器共享网络命名空间（localhost 互通）与卷，pause 沙箱容器先持有命名空间，业务容器再加入",
        "containerPort 是文档性字段，不真正开放端口；env 注入环境变量，生产值多来自 ConfigMap/Secret（第 5 章）",
        "command 覆盖镜像 ENTRYPOINT、args 覆盖 CMD；只想换参数就只写 args",
        "imagePullPolicy 三值：IfNotPresent / Always / Never；latest 或无 tag 默认 Always，固定 tag 默认 IfNotPresent",
        "initContainers 按序执行、全部成功主容器才启动，失败会反复重启（restartPolicy=Never 时整个 Pod 失败）；边车是与主容器同生命周期常驻的辅助进程",
      ],
    },
  ],
};
