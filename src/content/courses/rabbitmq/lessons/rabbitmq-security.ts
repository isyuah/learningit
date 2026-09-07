/* ==================================================================
 * 课时：安全：权限、vhost 与 TLS（rabbitmq-security）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-security",
  courseSlug: "rabbitmq",
  title: "安全：权限、vhost 与 TLS",
  summary: "用 vhost 隔离、configure/read/write 权限、用户标签与 TLS 构建纵深防御，避开默认凭据陷阱。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "消息队列是业务数据的集散地——订单、支付、库存事件都在里面流动。安全的目标不是「防住高级攻击者」，而是把默认配置里的明显漏洞补上：默认凭据、无隔离的共享空间、明文传输。RabbitMQ 的安全模型由三块构成：认证（你是谁）、授权（你能做什么）、传输安全（数据不被窃听）。这一节按「vhost 隔离 → 用户与权限 → 用户标签 → TLS → 网络隔离」的顺序展开。",
    },
    {
      type: "heading",
      text: "vhost 隔离：第一道边界",
    },
    {
      type: "definition",
      term: "vhost（虚拟主机）",
      definition: "RabbitMQ 内独立的命名空间：交换机、队列、绑定、权限都在 vhost 内隔离。同一名称（如 orders.created）在不同 vhost 中是不同的资源。默认安装只有一个 vhost `/`。",
    },
    {
      type: "paragraph",
      text: "vhost 是权限的天然边界：一个团队/一个环境/一个业务域各用一个 vhost，用户对每个 vhost 单独授权。典型做法：`orders-dev`、`orders-staging`、`orders-prod` 分开；支付服务只给 `payments.*` 相关 vhost 的权限。注意 vhost 是逻辑隔离而非安全隔离——不要用 vhost 当作「租户安全边界」替代网络隔离，因为管理 API、CLI 的权限是按用户标签横跨集群的。",
    },
    {
      type: "heading",
      text: "用户与权限：configure / write / read",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 对资源的授权分三类操作：configure（创建/删除/修改资源）、write（向资源写入，如发布消息到交换机、绑定）、read（从资源读取，如消费、basic.get、purge）。每个用户在每个 vhost 上有一组三个正则表达式，分别匹配资源名。例如 `rabbitmqctl set_permissions -p orders-prod order-svc \".*\" \".*\" \".*\"` 授予全部权限；`\"^$\"` 表示什么都不匹配（禁止所有操作）。",
    },
    {
      type: "code",
      title: "为订单服务创建最小权限用户（shell）",
      language: "bash",
      code: `# 创建 vhost
rabbitmqctl add_vhost orders-prod

# 创建用户（密码避免特殊字符；或用 stdin 传入）
rabbitmqctl add_user order-svc '9f8e2a1c7b6d4e3f5a0b8c7d6e5f4a3b2c1d0e9f'

# 授权：configure 匹配 ^orders\\. 前缀的资源，
# write 允许发布到 orders 交换机，read 允许消费 orders 队列
rabbitmqctl set_permissions -p orders-prod order-svc \\
  '^orders\\.' '^orders\\.' '^orders\\.'

# 校验
rabbitmqctl list_permissions -p orders-prod
rabbitmqctl list_users`,
    },
    {
      type: "paragraph",
      text: "权限是按 AMQP 0-9-1 方法逐条映射的：`basic.publish` 需要目标交换机的 write 权限；`basic.consume`/`basic.get` 需要队列的 read 权限；`queue.declare` 需要队列的 configure 权限；`queue.bind` 需要队列的 write + 交换机的 read。注意 4.3.1 起，passive 声明（只检查资源是否存在）也需要至少一种权限。权限变更对已建立连接生效有延迟（授权缓存），通常建议让应用重连。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "最小权限的常见反面：一给到底",
      body: "很多团队图省事直接 `set_permissions ... \".*\" \".*\" \".*\"`。这让一个只该发布的支付服务能消费、能删队列、能 purge。正确做法：发布方只给 write，消费方只给 read（+ 必要时 configure）；用正则把权限钉死在 `orders.`、`payments.` 等前缀内。另外，默认 vhost `/` 与默认交换机 `amq.default`（空名）在所有 vhost 中都存在——权限正则默认不匹配 `amq.*` 内置名称，别指望靠权限阻止对内置交换机的使用。",
    },
    {
      type: "heading",
      text: "用户标签：谁能进管理界面",
    },
    {
      type: "paragraph",
      text: "用户标签（user tags）控制管理插件（UI 与 HTTP API）的访问级别，与 AMQP 权限正交。常用标签：management（可登录 UI、查看自己的连接与队列）、policymaker（management + 管理策略/参数）、monitoring（management + 查看所有连接/信道/节点）、administrator（全部，包括管理用户与权限）。新建用户默认无标签——也就是能连 AMQP 但进不了管理界面。不要把 administrator 给业务账号。",
    },
    {
      type: "table",
      caption: "常用用户标签与权限范围",
      headers: ["标签", "可做什么", "适合谁"],
      rows: [
        ["（无标签）", "仅 AMQP 连接与 vhost 内资源操作", "业务服务账号（order-svc 等）"],
        ["management", "登录管理 UI，管理自己可见的资源", "开发者、日常排障"],
        ["policymaker", "management + 增删策略/参数", "负责拓扑与死信策略的工程师"],
        ["monitoring", "management + 查看集群全局指标", "监控系统、值班同学"],
        ["administrator", "全部（含用户与权限管理）", "运维/安全管理员，越少越好"],
      ],
    },
    {
      type: "heading",
      text: "TLS：从明文到加密与双向认证",
    },
    {
      type: "paragraph",
      text: "默认 RabbitMQ 的 AMQP 监听端口 5672 是明文。要让连接走 TLS，配置一个 ssl 监听器（约定端口 5671）并指向 CA 证书包、服务器证书与私钥。基本配置：`listeners.ssl.default = 5671`、`ssl_options.cacertfile`、`ssl_options.certfile`、`ssl_options.keyfile`。进阶选项：`ssl_options.verify = verify_peer` 让客户端验证服务器证书链；`fail_if_no_peer_cert = true` 强制客户端也出示证书，实现双向 TLS（mTLS），客户端身份由证书决定（配合 `rabbitmq_auth_mechanism_ssl` 插件的 EXTERNAL 机制，可以完全用证书做认证）。",
    },
    {
      type: "code",
      title: "rabbitmq.conf 启用 TLS 并关闭明文监听",
      language: "ini",
      code: `# 只保留 TLS 监听器（关掉明文 5672）
listeners.tcp = none
listeners.ssl.default = 5671

# 证书与密钥（文件须对运行用户可读）
ssl_options.cacertfile = /etc/rabbitmq/certs/ca_certificate.pem
ssl_options.certfile   = /etc/rabbitmq/certs/server_certificate.pem
ssl_options.keyfile    = /etc/rabbitmq/certs/server_key.pem

# 校验对端证书链；客户端必须出示证书（mTLS）
ssl_options.verify     = verify_peer
ssl_options.fail_if_no_peer_cert = true

# 生产证书应由受信任 CA 签发；tls-gen 生成的自签证书只用于开发`,
    },
    {
      type: "paragraph",
      text: "开发环境快速生成自签证书可以用官方 tls-gen；生产环境务必用受信任的 CA（商业 CA 或内部 PKI）。TLS 也可以用于节点间通信（cluster 内部）与管理 API（HTTPS，15671 端口）。用 TLS 终止代理（如 HAProxy）也是合法方案，但端点到端点加密最好由 RabbitMQ 自己承担。",
    },
    {
      type: "heading",
      text: "网络隔离与防火墙",
    },
    {
      type: "list",
      items: [
        "只对外暴露必要端口：客户端走 5671（TLS）/5672（明文，尽量关）；管理 API 15672/15671 只在受控网络开放。",
        "节点间端口（4369 epmd、25672 分布、35672-35682 CLI）绝不对公网开放。",
        "用安全组/防火墙把 AMQP 限制在应用网段；管理界面放内网或 VPN 后。",
        "与安全相关的常见错误清单（见下）比任何单个配置都重要。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "三个最致命的安全默认值",
      body: "第一，guest/guest：默认用户密码众所周知，默认只能从 localhost 连接——有人为了图省事把 `loopback_users = none` 配上去，等于给全世界开了 guest 大门。正确做法是删掉或改掉 guest，为每个服务创建独立账号。第二，默认 vhost `/` 所有账号可访问：明确清理 guest 在 `/` 的权限。第三，明文传输：5672 默认明文，TLS 不启用时订单、支付事件在网络上裸奔。生产 checklist：删除 guest、生成强密码、最小权限、TLS、管理接口内网化。",
    },
    {
      type: "keypoints",
      items: [
        "vhost 是逻辑隔离边界：环境/业务域分 vhost，每个 vhost 单独授权。",
        "权限三件套 configure/write/read 按资源名正则授予；发布只给 write，消费只给 read。",
        "用户标签控制管理 UI/API 访问：业务账号无标签，administrator 尽量少。",
        "TLS：listeners.ssl + cacertfile/certfile/keyfile；verify_peer + fail_if_no_peer_cert 可做 mTLS。",
        "删除 guest/默认凭据、最小权限、TLS、内网化管理接口与节点间端口——纵深防御的核心清单。",
      ],
    },
  ],
};
