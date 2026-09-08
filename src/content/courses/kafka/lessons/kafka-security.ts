/* ==================================================================
 * 课时：安全：TLS、认证、授权与配额（kafka-security）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.3（主线 4.3.1，KRaft-only）。所有配置名、
 * 默认值与命令均核对 kafka.apache.org/43 security 系列页面与
 * configuration/broker-configs（2026-09）；Go 片段核对 franz-go
 * v1.21.x（pkg/kgo、pkg/sasl/scram）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "安全是六层纵深：网络隔离、传输加密 TLS、认证 SASL、授权 ACL、配额与密钥管理。从 listener 分离设计出发，到证书与 SCRAM 用户管理、ACL 与配额命令，再到 franz-go 的 TLS+SCRAM 接入骨架。",
  blocks: [
    {
      type: "paragraph",
      text: "前面几课搭的集群默认是「裸奔」的：Kafka 出厂配置没有加密、没有认证、没有授权——官方文档原话是 security is optional，支持从明文到全安全的各种组合。对书舟这类要上生产的系统，「先跑起来再补安全」意味着要在运行中的集群上做[第 9 章开头部署课](/courses/kafka/lessons/kafka-kraft-cluster-deploy)提过的滚动改造，代价远高于一开始就规划好。这一课按纵深防御的顺序，把每一层解决什么问题、配置名是什么、Go 客户端怎么接，一次讲全。",
    },
    {
      type: "heading",
      text: "攻击面与纵深防御：六层各挡什么",
    },
    {
      type: "code",
      title: "安全分层（从外到内，越靠左越便宜、越靠右越精细）",
      language: "text",
      code: `威胁：陌生人直连 → 窃听/篡改 → 冒充身份 → 越权读写 → 抢占资源 → 密钥泄露\n\n① 网络隔离    只有该连的网段能连到 broker（防火墙/安全组/VPC）\n② 传输加密 TLS  数据在线上不可读不可改（可选同时做双向身份）\n③ 认证 SASL   每个连接声明「我是谁」并验证（账号密码/证书/令牌）\n④ 授权 ACL    验证过的身份能对哪些资源做哪些操作\n⑤ 配额         即使身份合法，也限制它能占用的带宽/请求比例\n⑥ 密钥与凭据管理 私钥、密码不进配置文件不进日志（贯穿全层）`,
    },
    {
      type: "paragraph",
      text: "各层回答不同的问题，不能互相替代：**TLS 加密挡不住「别人用你的账号密码登录」；ACL 挡不住「密码在网络上明文传输被截获」；网络隔离挡不住内部威胁**。Kafka 文档建议的常见生产组合是：内部网络（①）+ SASL_SSL（②③ 一起做，TLS 加密 + SASL 认证）+ ACL（④）+ 关键账号配额（⑤）。静态加密（磁盘加密/加密卷）官方文档只一句带过——它是主机安全的一部分，通常由云盘或系统层负责，不在 Kafka 配置里。",
    },
    {
      type: "heading",
      text: "listener 分离：先决定「谁从哪个口进来」",
    },
    {
      type: "paragraph",
      text: "Kafka 的安全配置全部挂在 **listener** 上：一个 listener = 一个「名字 + 地址 + 安全协议」的组合。一台 broker 可以同时开多个 listener，用 `listener.security.protocol.map` 给每个名字指定协议。安全协议只有四种：`PLAINTEXT`（明文无认证）、`SSL`（TLS 加密，可带客户端证书认证）、`SASL_PLAINTEXT`（SASL 认证但不加密，仅内网且不推荐）、`SASL_SSL`（TLS 加密 + SASL 认证，生产默认选项）。把不同流量分到不同 listener，安全策略、证书、甚至网络线程池（每个 listener 一套独立线程池）都随之隔离。",
    },
    {
      type: "definition",
      term: "listener（监听器）",
      definition:
        "broker 上开放的一个「入口」：`{名字}://{地址}:{端口}`，配套一个安全协议。典型命名习惯：`INTERNAL`（服务间与副本流量）、`EXTERNAL`（公网/跨网段客户端）、`CONTROLLER`（KRaft 控制面，只在内网）。",
    },
    {
      type: "code",
      title: "书舟生产参考：broker 节点的 listener 与安全相关配置骨架（4.3，示意部署）",
      language: "text",
      code: `# broker 节点（process.roles=broker；controller 节点见部署课）
process.roles=broker
node.id=2

# 两个面向客户端的 listener + 各自通告地址
listeners=INTERNAL://0.0.0.0:9092,EXTERNAL://0.0.0.0:9093
advertised.listeners=INTERNAL://kafka-2.internal.bookboat.local:9092,\\
                       EXTERNAL://kafka-2.pub.bookboat.example:9093

# broker 之间（副本复制）走 INTERNAL
inter.broker.listener.name=INTERNAL

# 每个 listener 名字 -> 安全协议；CONTROLLER 也要声明（broker 要连控制面）
listener.security.protocol.map=INTERNAL:SASL_SSL,EXTERNAL:SASL_SSL,CONTROLLER:SASL_SSL

# KRaft 控制面入口（4.x 用 bootstrap.servers 形式；老写法 controller.quorum.voters 已不推荐）
controller.quorum.bootstrap.servers=ctrl-1.internal.bookboat.local:9094,\\
  ctrl-2.internal.bookboat.local:9094,ctrl-3.internal.bookboat.local:9094
controller.listener.names=CONTROLLER

# 全局启用 SASL 机制（可按 listener 覆盖：listener.name.INTERNAL.sasl.enabled.mechanisms=...）
sasl.enabled.mechanisms=SCRAM-SHA-512
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-512`,
    },
    {
      type: "paragraph",
      text: "三个要点。**其一，`advertised.listeners` 决定客户端与其它 broker 实际去连哪个地址**：它默认等于 `listeners`，但在 NAT、容器、负载均衡后面必须改成「对端可达」的地址——这是「本地能连、换台机器就超时」这类问题的最常见来源（[第 1 章 quickstart](/courses/kafka/lessons/kafka-kraft-quickstart) 里用 `KAFKA_ADVERTISED_LISTENERS` 修的就是它）。官方还允许一个 listener 通告另一个 listener 的地址（端口可重复），用于外网经负载均衡接入的场景。**其二，INTERNAL 的地址要给集群内每个节点，包括 controller**：副本复制、控制面通信都走内部网络，绝不要暴露到公网。**其三，controller 监听器只在内网**：客户端请求会被 broker 转发给 controller，客户端永远不需要直连它。",
    },
    {
      type: "callout",
      variant: "note",
      title: "listener 分离的另一重收益：流量与故障隔离",
      body: "官方文档明确：每个 listener（controller listener 除外）有自己独立的网络线程池。把「内部复制流量」和「公网客户端流量」分开，既方便单独限流与监控，也能防止某一类流量打满线程池时拖垮另一类。这也是多 listener 设计与单 listener 塞一切的本质区别。",
    },
    {
      type: "heading",
      text: "传输加密 TLS：证书、配置与轮换",
    },
    {
      type: "paragraph",
      text: "TLS 解决「线路上安全」：加密防窃听、证书防伪造。Kafka 里 TLS 还要回答「证书怎么来、怎么配、怎么换」。先看证书需求（官方 SSL 文档的流程）：**每个 broker 一台一张服务端证书**，SAN（Subject Alternative Name）里带上它的 FQDN 与 IP——客户端按地址做主机名校验（`ssl.endpoint.identification.algorithm` 默认 `https`，即校验开启；证书 CN 自 2000 年起就不推荐用于主机名校验，用 SAN）。证书最好由公司 CA 签发（自己当 CA 只适合测试环境）。两个常踩的坑：一是证书的扩展密钥用法（Extended Key Usage）必须同时含 serverAuth 与 clientAuth——broker 之间互相复制时每台都既是服务端又是客户端；二是私钥只应存在于它所属的那台 broker 上，签发流程别让私钥离开服务器。",
    },
    {
      type: "paragraph",
      text: "信任关系靠 truststore 表达：客户端（及需要校验对端的 broker）在 truststore 里放它信任的 CA 证书。**单向 TLS**（加密 + 服务端认证）只需要客户端配置 truststore；**双向 TLS/mTLS**（客户端也出示证书，可兼作认证手段）时 broker 还要开 `ssl.client.auth=required` 并配置自己的 truststore 存放客户端 CA。注意：Kafka 既可用 JKS/PKCS12 文件型密钥库，也可直接给 PEM 内容——从 2.7.0 起 `ssl.keystore.certificate.chain` + `ssl.keystore.key`（私钥）+ `ssl.truststore.certificates`（信任的 CA 们）就能配 PEM，此时 `ssl.keystore.type=PEM`，且 `ssl.keystore.password`/`ssl.truststore.password` 不用于 PEM（私钥本身加密时才用 `ssl.key.password`）。",
    },
    {
      type: "code",
      title: "两种 TLS 配置形态（4.3 配置名，值均为示意占位）",
      language: "text",
      code: `# 形态 A：文件型密钥库（PKCS12/JKS）——传统、最常用
ssl.keystore.location=/etc/kafka/secrets/server.p12
ssl.keystore.type=PKCS12
ssl.keystore.password=\${fileProvider:/etc/kafka/secrets/ssl.properties:keystorePassword}
ssl.key.password=\${fileProvider:/etc/kafka/secrets/ssl.properties:keyPassword}
ssl.truststore.location=/etc/kafka/secrets/truststore.p12
ssl.truststore.type=PKCS12
ssl.truststore.password=\${fileProvider:/etc/kafka/secrets/ssl.properties:truststorePassword}

# 形态 B：PEM 直配（2.7+；chain/key 是完整 PEM 内容，实际部署经密文注入）
ssl.keystore.type=PEM
ssl.keystore.certificate.chain=-----BEGIN CERTIFICATE-----...（服务器证书链）
ssl.keystore.key=-----BEGIN PRIVATE KEY-----...（PKCS#8 私钥）
ssl.truststore.type=PEM
ssl.truststore.certificates=-----BEGIN CERTIFICATE-----...（信任的 CA）

# 是否要求客户端证书（mTLS）
ssl.client.auth=required        # none / requested / required；requested 不推荐（给伪安全）
ssl.enabled.protocols=TLSv1.2,TLSv1.3   # 4.3 默认即 TLSv1.2,TLSv1.3`,
    },
    {
      type: "paragraph",
      text: "上面的 `${fileProvider:...}` 是 Kafka 4.x 的**配置提供者（config provider）**语法：先在配置里声明 `config.providers=fileProvider` 与 `config.providers.fileProvider.class=org.apache.kafka.common.config.provider.FileConfigProvider`，就能把密码类配置外置到 properties 文件（或环境变量 provider），避免把密钥写死在 `server.properties`——这对应分层图第⑥层。四个密码/私钥项在官方文档里都是 `password` 类型，安全工具与审计会重点盯它们。",
    },
    {
      type: "subheading",
      text: "证书轮换：别等过期那天",
    },
    {
      type: "list",
      items: [
        "**证书要有生命周期管理**：每张证书设到期告警（提前 30 天起步），并走签发流程而不是手工重签——过期是生产事故里最常见的「非故障故障」。",
        "**4.3 支持按 listener 动态更新密钥库/信任库、无需重启 broker**：用 `listener.name.<listener>.ssl.keystore.*` / `ssl.truststore.*` 前缀做动态更新（`kafka-configs.sh --alter`）。官方提醒：inter-broker listener 换新密钥库时，新库必须仍被该 listener 的 truststore 信任。",
        "**换证书期间别断客户端认证**：新证书最好由同一 CA 签发；换信任库时先加新 CA 再删旧 CA。主机名校验（默认开启）不要为了「先跑通」关掉——官方文档对关掉它的评价是：最快见效、然后永远承诺「以后修」，等集群跑起来再补就难了。",
      ],
    },
    {
      type: "heading",
      text: "认证 SASL：连接说「我是谁」",
    },
    {
      type: "paragraph",
      text: "TLS 加密了线路，但还没回答「谁在连」。SASL（Simple Authentication and Security Layer）是 Kafka 的应用层认证框架，机制有五种：`GSSAPI`（Kerberos，大厂 AD 环境）、`PLAIN`（明文用户名密码）、`SCRAM-SHA-256` / `SCRAM-SHA-512`（加盐挑战应答）、`OAUTHBEARER`（OAuth 2 bearer token）。Kafka 文档对机制的选择没有「唯一正解」，但对新集群的默认建议是 **SCRAM**：密码不出网、凭据可动态增删，见下文。选择机制时记住一个组合约束：**加密与认证是两件事，`SASL_PLAINTEXT` 是「只认证不加密」，生产上认证一定要叠在 TLS 上（`SASL_SSL`）**，尤其 PLAIN——它的密码在验证前必须能被对端读到，明文传输等于白认证。",
    },
    {
      type: "table",
      caption: "SASL 机制一句话对比（细节按 4.3 文档）",
      headers: ["机制", "凭据放哪", "特点", "适用"],
      rows: [
        ["PLAIN", "broker 的 JAAS 配置（静态写死或用回调外接）", "实现最简单；密码明文存储；官方要求只在 TLS 之上用", "测试、自有验证服务（2.0+ 可插自定义 callback handler 接外部认证）"],
        ["SCRAM-SHA-256/512", "Kafka 自己的凭据库（KRaft 元数据日志）", "挑战应答，密码永不出网不上配置；可动态建/删用户（kafka-configs）", "新集群默认推荐；SCRAM-SHA-512 更强哈希"],
        ["GSSAPI (Kerberos)", "组织的 Kerberos/KDC", "与 AD 等既有身份体系打通", "公司已有 Kerberos 基建"],
        ["OAUTHBEARER", "外部 OAuth 2/OIDC 颁发方", "令牌认证，与公司 SSO 打通；默认实现只做未签名 JWT，仅限非生产", "已有 IdP、希望客户端不带 Kafka 专用密码"],
      ],
    },
    {
      type: "paragraph",
      text: "OAUTHBEARER 在 Kafka 2.0 起提供，生产用法一句话：broker 配置 `listener.name.<listener>.oauthbearer.sasl.oauthbearer.jwks.endpoint.url` 指向 IdP 的公钥端点来校验 JWT（`OAuthBearerValidatorCallbackHandler`），客户端用 client_credentials 或 jwt-bearer 授权向 IdP 换 token（4.x 内置 `sasl.oauthbearer.jwt.retriever.class` 等实现，KIP-1258 又加了私钥签名的客户端断言）。好处是账号体系统一、令牌短时效可撤销；代价是要维护与 IdP 的集成。书舟这类没有现成 IdP 的团队，SCRAM 是最务实的起点——下面把 SCRAM 走完整。",
    },
    {
      type: "subheading",
      text: "SCRAM 实操：凭据库、用户管理与启用",
    },
    {
      type: "paragraph",
      text: "SCRAM（RFC 5802）是挑战-应答机制：客户端与服务端各自从「口令 + 盐 + 迭代次数」推导密钥，线上只交换挑战与证明，**口令本身永远不经过网络、也不写进 broker 配置**。服务端存的不是口令，而是 salt、iterations、StoredKey 与 ServerKey。Kafka 默认实现把 SCRAM 凭据存在 **[KRaft](glossary:kraft) 元数据日志**里——所以「建用户」不是改配置文件，而是往元数据写一条记录；相应地，controller 本身的安全（内网 + 系统加固）就是凭据库的安全。",
    },
    {
      type: "code",
      title: "SCRAM 用户管理（4.3：kafka-storage format 时预置 / kafka-configs 动态管理）",
      language: "bash",
      code: `# 1) 集群首次格式化时预置 inter-broker 账号（broker 启动前必须存在）
#    （用 kafka-storage 预置；或起集群后立刻用 kafka-configs 建好再启动）
bin/kafka-storage.sh format -t "$(bin/kafka-storage.sh random-uuid)" \\
  -c config/server.properties \\
  --add-scram 'SCRAM-SHA-512=[name="admin",password="admin-secret"]'

# 2) 运行时创建/更新业务账号（幂等，改密码即重跑同一条）
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --alter \\
  --add-config 'SCRAM-SHA-512=[iterations=8192,password=alice-secret]' \\
  --entity-type users --entity-name alice

# 3) 查看已有凭据（不会回显口令）
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --describe \\
  --entity-type users --entity-name alice

# 4) 删除
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --alter \\
  --delete-config 'SCRAM-SHA-512' \\
  --entity-type users --entity-name alice`,
    },
    {
      type: "paragraph",
      text: "细节核对：不指定 `iterations` 时默认 4096（官方要求最小 4096，支持 SHA-256 与 SHA-512）；salt 不指定则随机生成。注意 inter-broker 通信用的账号必须**在 broker 启动前**就存在，所以要么在 `format` 时用 `--add-scram` 预置（上面的命令），要么先以单账号建好再扩。broker 端启用 SCRAM 只需两处：在 `sasl.enabled.mechanisms` 列出要开的机制（`SCRAM-SHA-256` 与 `SCRAM-SHA-512` 任选或都开，下面示例统一用 SHA-512），以及给每个用 SASL 的 listener 提供 JAAS 登录配置——4.x 推荐用带前缀的 broker 配置项而不是 JAAS 文件：",
    },
    {
      type: "code",
      title: "listener 级 JAAS 配置（4.3 属性名：listener.name.<名字>.<机制小写>.sasl.jaas.config）",
      language: "text",
      code: `# username/password = 该 broker 以什么身份去连别人（inter-broker/连 controller）
listener.name.internal.scram-sha-512.sasl.jaas.config= \\
  org.apache.kafka.common.security.scram.ScramLoginModule required \\
  username="admin" password="admin-secret";

# EXTERNAL 若也要 SASL：同样按 listener + 机制给一份（可用同一账号体系）`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "PLAIN 与 SCRAM 的取舍一句话",
      body: "两者都做「用户名 + 密码」认证，差别在凭据存放与传输：PLAIN 把密码明文写进 JAAS 配置或外部回调（换人 = 改配置/重启或回调联动），SCRAM 把凭据存进 Kafka 元数据、用 kafka-configs 动态增删且密码不出网。**新集群默认 SCRAM-SHA-512**；只有当你必须对接一个外部账号系统、且能接受自研/配置回调把明文口令接进来时，PLAIN 才值得考虑——而且必须叠 TLS。若公司已有统一 CA 与证书发放流程，mTLS（双向 TLS，客户端证书即身份）也是常见替代：ACL 里的主体名变成证书 DN（可用 `ssl.principal.mapping.rules` 把它映射成短名）。",
    },
    {
      type: "heading",
      text: "授权 ACL：认证之后，谁能做什么",
    },
    {
      type: "paragraph",
      text: "认证通过只说明「你是你」。授权回答「你被允许做什么」。Kafka 的 ACL（Access Control List）模型一句话：**「主体 P 被允许/拒绝从主机 H 对匹配资源模式 RP 的资源 R 执行操作 O」**。四个要素——主体（`User:alice`，认证层给出的身份）、资源（[主题](glossary:topic)、消费组、集群、TransactionalId 等，资源名可带 `literal`/`prefixed` 模式或通配 `*`）、操作（`Read`/`Write`/`Create`/`Describe`/`Alter`/`Delete`/`ClusterAction`/`IdempotentWrite` 等）、主机（只认 IP）。语义要点：**默认全部拒绝**——某个资源没有任何匹配 ACL 时，除超级用户外谁都不能碰它（这是 Kafka 文档的默认行为，想要相反行为得显式开 `allow.everyone.if.no.acl.found=true`，生产别开）。同一操作可能同时命中多条规则（精确名、`prefixed` 前缀、`*` 通配都会参与匹配），具体裁决语义以官方文档（KIP-290 的资源模式）为准——实践上「默认全拒 + 精确 Allow」最省心，别依赖 Deny 规则的微妙语义做精细化控制。",
    },
    {
      type: "paragraph",
      text: "KRaft 集群启用授权的做法（4.x）：在所有节点（broker 与 controller）配置 `authorizer.class.name=org.apache.kafka.metadata.authorizer.StandardAuthorizer`，ACL 就存在 **[KRaft](glossary:kraft) 元数据日志**里、随 quorum 复制——不再有 ZooKeeper 时代「ACL 文件在每台机器上」的同步问题。**默认 `authorizer.class.name` 为空 = 授权检查根本没开**，配了它才生效，这是一次「从裸奔到守门」的切换，切换前务必把 admin 加进 `super.users`（分号分隔，如 `super.users=User:admin`），否则你自己也进不去。",
    },
    {
      type: "code",
      title: "书舟 ACL 实操（kafka-acls.sh，4.3 命令）",
      language: "bash",
      code: `# 管理员预置（super.users=User:admin 已在 server.properties 声明，可跳过自身授权）

# orders 服务账号：向 orders.events 生产（--producer = topic 的 WRITE/DESCRIBE/CREATE）
bin/kafka-acls.sh --bootstrap-server kafka-1:9092 --add \\
  --allow-principal User:orders-svc --producer --topic orders.events

# 幂等生产（franz-go 默认开启）还需要 Cluster 上的 IdempotentWrite：
bin/kafka-acls.sh --bootstrap-server kafka-1:9092 --add \\
  --allow-principal User:orders-svc --idempotent          # 便捷写法

# analytics 服务账号：消费 user.behavior + 用组 analytics-group 提交位移
#   （--consumer = topic 的 READ/DESCRIBE + group 的 READ）
bin/kafka-acls.sh --bootstrap-server kafka-1:9092 --add \\
  --allow-principal User:analytics-svc --consumer \\
  --topic user.behavior --group analytics-group

# 前缀模式：今后 dlq.* 主题都由 ops 账号管理（prefixed 匹配）
bin/kafka-acls.sh --bootstrap-server kafka-1:9092 --add \\
  --allow-principal User:ops-svc --operation All --topic dlq --resource-pattern-type prefixed

# 审计：列出某个主题上所有生效的 ACL（含匹配它的 wildcard/prefixed）
bin/kafka-acls.sh --bootstrap-server kafka-1:9092 --list --topic orders.events --resource-pattern-type match`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "ACL 最常漏的两项：建主题与幂等写",
      body: "第一项：`auto.create.topics.enable` 开着时，没被授权的账号也能让 broker 自动建主题（授权模型里自动创建要 Create 权限，见官方文档说明）——生产上要么关掉自动建主题、要么按服务显式授 Create。第二项：**幂等生产者需要在 Cluster 资源上有 `IdempotentWrite`**（它要发 INIT_PRODUCER_ID，官方协议表：`An idempotent produce action requires this privilege`）。franz-go 默认就开幂等，所以上面示例特意补了 `--idempotent`——只授 topic 的 WRITE 会得到莫名的授权失败，这是安全集群接入 Go 服务时最高频的翻车点。另外事务型生产者还需要对 `--transactional-id` 的写权限。",
    },
    {
      type: "heading",
      text: "配额：给「合法用户」也上把锁",
    },
    {
      type: "paragraph",
      text: "ACL 管的是「能不能」，配额管「能占多少」。没有配额时客户端默认**无限**使用；一个写崩了的生产者或一个消费循环失控的分析任务，能把集群带宽与请求处理占满、拖垮所有邻居。配额按实体配置：`(user, client-id)`、`user` 或 `client-id` 三档（越具体优先级越高），每档可设三类限值：`producer_byte_rate`（生产字节/秒）、`consumer_byte_rate`（消费字节/秒）、`request_percentage`（请求处理时间占比）。超出限额时 broker 会**节流（throttle）**该连接——客户端的表现是请求变慢/被延迟，而不是被断开或报错。",
    },
    {
      type: "code",
      title: "配额管理（kafka-configs.sh；quota 与 SCRAM 用户同属 entity 配置体系）",
      language: "bash",
      code: `# 给 user1 的所有客户端设生产/消费上限与请求占比
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --alter \\
  --add-config 'producer_byte_rate=10485760,consumer_byte_rate=20971520,request_percentage=200' \\
  --entity-type users --entity-name user1

# 更常用：按 (user, client-id) 组合，或只按 client-id 限（多租户按应用限）
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --alter \\
  --add-config 'producer_byte_rate=10485760' \\
  --entity-type users --entity-name user1 --entity-type clients --entity-name orders-app

# 设全局默认（新实体自动继承），用 --entity-default 代替 --entity-name
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --alter \\
  --add-config 'producer_byte_rate=52428800,consumer_byte_rate=52428800' \\
  --entity-type users --entity-default

# 查看
bin/kafka-configs.sh --bootstrap-server kafka-1:9092 --describe --entity-type users`,
    },
    {
      type: "paragraph",
      text: "配额的单位是字节/秒，所以它天然和[上一课容量模型](/courses/kafka/lessons/kafka-capacity-tuning)的字节口径衔接：给每个接入方设的限额加起来，应该小于集群容量预算——配额表本身就是容量规划的输入。实践建议：先给所有账号设一个宽松的默认值兜底，再为关键服务收紧到压测过的真实峰值，避免「平时无限、出事互相拖累」。",
    },
    {
      type: "heading",
      text: "Go 客户端接入：franz-go 的 TLS 与 SCRAM",
    },
    {
      type: "paragraph",
      text: "对 franz-go 来说，安全集群与明文集群的差别只是 `NewClient` 时多加两个选项：**`kgo.DialTLSConfig(*tls.Config)`**（用给定 TLS 配置拨号）与 **`kgo.SASL(mechanisms...)`**（附加 SASL 机制，按顺序尝试、取 broker 支持的第一个）。[第 1 章 hello 课](/courses/kafka/lessons/kafka-go-client-hello)里 `SeedBrokers`、生产者/消费者写法全部不变——安全只是连接层的事。",
    },
    {
      type: "code",
      title: "producer/main.go：TLS（SASL_SSL）+ SCRAM-SHA-512 接入骨架（franz-go v1.21）",
      language: "go",
      code: `package main

import (
	"crypto/tls"
	"crypto/x509"
	"log"
	"os"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/scram"
)

// 只信任自建 CA 的 TLS 配置：加密 + 服务端证书校验
func tlsConfig(caFile string) *tls.Config {
	caPEM, err := os.ReadFile(caFile)
	if err != nil {
		log.Fatalf("读取 CA: %v", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		log.Fatal("解析 CA 证书失败")
	}
	// ServerName 不需要填：franz-go 每次拨号会按 broker 地址
	// 自动补上 ServerName，因此主机名校验默认生效
	return &tls.Config{RootCAs: pool}
}

func main() {
	// 双向 TLS（mTLS）时再加：
	// cert, _ := tls.LoadX509KeyPair("client.crt", "client.key")
	// cfg.Certificates = []tls.Certificate{cert}
	cfg := tlsConfig("ca.pem")

	cl, err := kgo.NewClient(
		kgo.SeedBrokers("kafka-1.pub.bookboat.example:9093"),
		kgo.DialTLSConfig(cfg), // SASL_SSL 的 TLS 半边
		// SASL 半边：账号来自 SCRAM 凭据库；密码从环境变量取，别写进代码
		kgo.SASL(
			scram.Auth{
				User: "orders-svc",
				Pass: os.Getenv("KAFKA_ORDERS_PASSWORD"),
			}.AsSha512Mechanism(),
		),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	// 之后的 Produce / PollFetches 用法与明文集群完全相同……
	_ = cl
}`,
    },
    {
      type: "paragraph",
      text: "对照 broker 端核对三处一致性，是最常见的排错路径：① 端口对应的是 `SASL_SSL` listener（而不是只开了 TLS 的 `SSL`，或没开 TLS 的 `SASL_PLAINTEXT`）；② broker 的 `sasl.enabled.mechanisms` 包含 `SCRAM-SHA-512`（客户端 `AsSha512Mechanism` 与它精确匹配，`SCRAM-SHA-256` 对应 `AsSha256Mechanism`，kgo 可同时传多个让 broker 选）；③ 账号在凭据库存在、且密码没错。典型报错：握手期 `tls: failed to verify certificate` = CA/主机名校验问题（证书没进 RootCAs，或连的地址与证书 SAN 不符）；`SASL Authentication failed` = 账号/密码/机制不匹配；握手成功但请求被拒 = 掉进上面 ACL 的坑（少授了 `IdempotentWrite` 之类）。",
    },
    {
      type: "heading",
      text: "生产安全 checklist",
    },
    {
      type: "list",
      items: [
        "网络：controller 与 inter-broker 流量只走内网；公网只暴露必需的 EXTERNAL listener；核对 `advertised.listeners` 是客户端可达地址",
        "TLS：每 broker 一张带 SAN 的证书（同 CA 签发），EKU 含 serverAuth 与 clientAuth；主机名校验保持默认开启；证书到期告警 + 轮换演练",
        "认证：新集群默认 SCRAM-SHA-512；一个服务一个账号，不用共享账号；inter-broker 账号在 broker 启动前预置；密码走 secrets 管理，不进代码与日志",
        "授权：全节点配置 `StandardAuthorizer`；admin 进 `super.users` 再开闸；按服务授最小 ACL（topic/group/cluster 分开看），幂等与事务账号记得 cluster/transactional-id 权限；ACL 变更进审计",
        "配额：设全局默认 + 关键服务按压测值收紧；配额合计小于集群容量预算",
        "密钥：私钥不离开所属主机；配置文件用 config provider 外置密文；`allow.everyone.if.no.acl.found` 保持默认关",
        "验证：用 `openssl s_client -connect <broker>:<port>` 看证书链；用带 `--command-config` 的 CLI（console producer/consumer、kafka-configs 等）走一遍真实账号；最后用 Go 客户端端到端发收一次",
      ],
    },
    {
      type: "keypoints",
      items: [
        "安全分层：网络隔离 → TLS → SASL → ACL → 配额 → 密钥管理；各层回答不同威胁，不能互相替代；Kafka 出厂全裸（无加密无认证无授权）",
        "listener 是安全配置的挂载点：`listeners` + `listener.security.protocol.map` + `advertised.listeners`；生产组合 INTERNAL:SASL_SSL / EXTERNAL:SASL_SSL / CONTROLLER 只在内网",
        "TLS：每 broker 一张 SAN 证书；文件库（PKCS12/JKS）或 PEM（`ssl.keystore.certificate.chain` / `ssl.keystore.key` / `ssl.truststore.certificates`）；mTLS 开 `ssl.client.auth=required`；4.3 支持按 listener 动态轮换密钥库/信任库",
        "SASL：SCRAM 凭据存 KRaft 元数据日志，`kafka-configs.sh --entity-type users` 动态建删（默认 iterations=4096）；PLAIN 密码明文只配 TLS 用；OAUTHBEARER 一句话：接公司 IdP、broker 配 jwks 端点校验 JWT",
        "授权：`StandardAuthorizer` + ACL 存元数据；默认全拒、`super.users` 开后门；kafka-acls.sh 的 --producer/--consumer/--idempotent 便捷项覆盖幂等与事务遗漏",
        "配额：`producer_byte_rate` / `consumer_byte_rate` / `request_percentage`，按 (user, client-id) 等三档配置，超限被节流而非断开",
        "Go：`kgo.DialTLSConfig(tlsCfg)` + `kgo.SASL(scram.Auth{...}.AsSha512Mechanism())`；ServerName 自动填充，其余 API 与明文集群无异",
      ],
    },
    {
      type: "quiz",
      question:
        "书舟为 orders 发布服务创建了 SCRAM 账号 User:orders-svc，并用 `kafka-acls.sh --producer` 授予了 orders.events（即 topic 的 WRITE/DESCRIBE/CREATE），集群已启用 StandardAuthorizer。该服务用默认配置的 franz-go 生产者发送仍被拒绝，最可能缺哪一项？",
      options: [
        "消费组权限：还需要授予 --group orders-svc 的 READ（因为生产者也要提交位移）",
        "Cluster 资源上的 IdempotentWrite：franz-go 默认开启幂等，客户端要请求 producer id，官方要求幂等写入需该权限（可用 --idempotent 便捷补授）",
        "把 orders-svc 加入 super.users，否则任何 topic 写入都会被拒",
        "主题级 Create 权限：--producer 只授了 WRITE/DESCRIBE，还需要单独 --operation Create",
      ],
      answer: 1,
      explanation:
        "`--producer` 便捷项生成 topic 的 WRITE、DESCRIBE、CREATE；但幂等生产者会发 INIT_PRODUCER_ID 请求，官方协议授权表明确「幂等写入需要 Cluster 上的 IdempotentWrite」（An idempotent produce action requires this privilege）。super.users 是绕过 ACL 的紧急后门，不该用来给普通服务授权；生产者不消费、不提交位移，也不需要 group 权限。补 `kafka-acls.sh --add --allow-principal User:orders-svc --idempotent` 即可。",
    },
  ],
};
