/* ==================================================================
 * 课时：安装、启动与管理界面（rabbitmq-install-setup）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-install-setup",
  courseSlug: "rabbitmq",
  title: "安装、启动与管理界面",
  summary: "用 Docker 快速拉起 RabbitMQ 4.x，掌握端口、默认用户、management 插件与健康检查，为第一段代码做准备。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面两课我们建立了心智模型，现在需要一台真正能跑的 RabbitMQ。本课程以 RabbitMQ 4.x 为版本边界（主线 4.3，LTS 4.2）。最省事的方式是 Docker——一条命令就能得到完整的服务与管理界面；当然，各操作系统也都有原生安装方式。装好之后，你会学会三个端口、一个默认账号，以及如何确认它健康地活着。",
    },
    {
      type: "heading",
      text: "方式一：Docker（推荐）",
    },
    {
      type: "code",
      title: "拉取并启动 RabbitMQ 4.x（含管理插件）",
      language: "bash",
      code: `# 官方镜像标签：4.3（主线）、4.2（LTS）、4.3-management（带管理插件）
docker run -d --name rabbitmq \\
  -p 5672:5672 \\          # AMQP 0-9-1 协议端口（客户端连接）
  -p 15672:15672 \\        # Management 管理界面（HTTP）
  -p 25672:25672 \\        # 集群节点间通信端口
  rabbitmq:4.3-management`,
    },
    {
      type: "paragraph",
      text: "标签选择：开发学习用 `4.3-management` 或 `4.2-management` 即可，镜像已内置 management 插件，无需手动启用。生产部署建议把数据目录挂载到宿主机卷，避免容器重建丢失队列与消息（本课程稍后会讲持久化）。",
    },
    {
      type: "heading",
      text: "方式二：原生安装",
    },
    {
      type: "list",
      items: [
        "Windows：官方提供 Erlang + RabbitMQ 的安装包；装完后 `rabbitmq-server` 服务自动启动，用 `rabbitmqctl.bat status` 查看状态。",
        "macOS：`brew install rabbitmq`，然后 `brew services start rabbitmq`，或手动执行 `/opt/homebrew/opt/rabbitmq/sbin/rabbitmq-server`。",
        "Debian/Ubuntu：配置 RabbitMQ 官方 apt 源后 `apt install rabbitmq-server`，systemd 会自动托管服务。",
        "通用：无论哪种平台，核心都是先装匹配版本的 Erlang/OTP，再装 RabbitMQ——它运行在 Erlang 虚拟机上。",
      ],
    },
    {
      type: "heading",
      text: "三个端口与默认账号",
    },
    {
      type: "table",
      caption: "RabbitMQ 常用端口",
      headers: ["端口", "用途", "说明"],
      rows: [
        ["5672", "AMQP 0-9-1", "客户端（生产者/消费者）连接的主端口"],
        ["15672", "Management UI / HTTP API", "管理界面与 REST API"],
        ["25672", "Clustering", "节点间通信（集群时使用）"],
        ["15692", "Prometheus 指标", "启用 prometheus 插件后的监控端点"],
      ],
    },
    {
      type: "definition",
      term: "默认账号 guest / guest 与 vhost /",
      definition: "安装后的默认凭据：用户名 `guest`、密码 `guest`，仅允许从 localhost 连接（这是安全设计）。默认虚拟主机（vhost）名为 `/`——vhost 是逻辑隔离单元，不同团队/环境可以在同一 Broker 上各用各的 vhost。生产环境必须新建专用账号并限制权限。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "guest 无法从远程连接",
      body: "RabbitMQ 出于安全考虑，默认只允许 `guest/guest` 从本机（localhost）连接。如果你的代码运行在另一台机器、或 Docker 里没有映射到宿主机回环地址，会报 `user 'guest' can only connect via localhost`。学习阶段就本地连接；要远程访问请创建专用用户（`rabbitmqctl add_user`），而不是放开 guest 的限制。",
    },
    {
      type: "heading",
      text: "启用 management 插件",
    },
    {
      type: "code",
      title: "手动启用管理插件（非 management 镜像时）",
      language: "bash",
      code: `# 默认已启用；若未启用，执行：
rabbitmq-plugins enable rabbitmq_management

# 启用后访问 http://localhost:15672，用 guest/guest 登录`,
    },
    {
      type: "heading",
      text: "验证健康状态",
    },
    {
      type: "code",
      title: "命令行健康检查",
      language: "bash",
      code: `# 查看节点状态：版本、内存、分区、运行时长
rabbitmqctl status

# 查看队列列表（空集群时输出空表）
rabbitmqctl list_queues

# Docker 场景下：
docker exec rabbitmq rabbitmqctl status`,
    },
    {
      type: "list",
      items: [
        "命令行：`rabbitmqctl status` 输出中 `RabbitMQ version` 应为 4.x；`Status of node` 正常即服务健康。",
        "管理界面：浏览器打开 http://localhost:15672，登录后能看到 Overview 面板——节点、队列、连接数一目了然，还能直接在 Queues 页建队列、发消息试手。",
        "健康检查端点：`rabbitmq-diagnostics -q ping` 返回 `Ping succeeded` 表示节点响应正常。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "版本确认与 4.x 行为差异",
      body: "本课程基于 RabbitMQ 4.x：4.0 移除镜像队列、4.2 默认启用 Khepri 元数据存储、4.3 默认禁止声明 transient 非排他经典队列。你装的版本决定这些行为是否默认生效；后续章节讲到队列类型与高可用时，我们会明确标注版本差异。",
    },
    {
      type: "quiz",
      question: "客户端代码连接 RabbitMQ 时，默认使用哪个端口？",
      options: ["5672", "15672", "25672", "15692"],
      answer: 0,
      explanation: "5672 是 AMQP 0-9-1 客户端连接端口；15672 是管理界面（HTTP），25672 是集群通信，15692 是 Prometheus 指标端点。",
    },
  ],
};
