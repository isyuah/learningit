/* ==================================================================
 * 课时：Connect 架构与第一个连接器（kafka-connect-architecture）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 7 章第一课。事实核对（2026-09-08）：
 * - 命令/输出按 Apache Kafka 4.3.1 实测（Docker 镜像 apache/kafka:4.3.1，
 *   与第 1 章 quickstart 课时同一发行版；connect-file-4.3.1.jar 在发行包 libs/ 内）；
 * - 官方依据：kafka.apache.org/43 的 Kafka Connect 章节（overview / user-guide /
 *   configuration/kafka-connect-configs / OpenAPI connect_rest.yaml）与官方
 *   quickstart "Step 6: Import/export your data ... with Kafka Connect"；
 * - 发行包内 config/connect-*.properties 模板内容按 GitHub apache/kafka tag
 *   4.3.1 核对。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Kafka Connect 的五个角色（worker/connector/task/converter/transform）、source 与 sink 数据流与 offset 语义、分布式与 standalone 差异、REST 管理，以及用官方 FileStream 连接器在本地跑通一条真实管道。",
  blocks: [
    {
      type: "paragraph",
      text: "第 6 章介绍了事务性 [Outbox](glossary:outbox)、CDC 等事件集成模式——它们解决「业务数据怎么变成事件」的建模问题。但任何模式落地时都需要一个「执行者」：谁来盯住外部系统、把数据搬进 Kafka？谁来保证搬的过程不丢、可恢复、可扩展？Kafka 生态给出的标准答案是 [Kafka Connect](glossary:connect)——一个把「接外部系统」这件事**产品化**的框架。本课先讲清它的架构（五个角色、两条数据流、两种运行模式、一套管理 API），再动手把官方自带的最小连接器跑起来，最后给你一张「用 Connect 还是自己写 Go 客户端」的决策表。下一课（[Debezium CDC：数据库变更变成事件](/courses/kafka/lessons/kafka-connect-cdc-practice)）在它的基础上讲最常用的连接器族。",
    },
    {
      type: "heading",
      text: "为什么需要 Connect：接入外部系统的重复劳动",
    },
    {
      type: "paragraph",
      text: "截止目前，书舟的一切数据都直接由 Go 服务用 franz-go 读写 Kafka——那是「应用内嵌客户端」的正确姿势。但把**整个外部系统**接进来是另一类问题：要把 MySQL 的每行变更搬成事件、要把 HDFS/对象存储的文件导进主题、要把 Kafka 消息灌进 Elasticsearch——每个对接方都要求你回答同一串问题：怎么连、多久轮询一次、批量多大、读到哪了（位置存哪）、崩溃了从哪继续、能不能多实例分摊、重启要不要重放、格式用什么序列化。如果每个团队都为自己那条管道自研一套，十次里有九次是在重复发明一个又糙又不可运维的搬运工。Connect 就是把这套劳动收敛成框架：**连接器（connector）只回答「外部系统长什么样」，其余（进程、线程、偏移量、重试、分发、REST 管理）全部由框架承担**。",
    },
    {
      type: "heading",
      text: "五个角色：一张图建立全貌",
    },
    {
      type: "paragraph",
      text: "Connect 里的名词不多，但每个都是面试高频题。先把五个角色的职责用一句话钉死，再逐个展开。",
    },
    {
      type: "table",
      caption: "Connect 五个角色的职责（一句话版）",
      headers: ["角色", "一句话职责", "类比（书舟）"],
      rows: [
        ["worker（工作进程）", "一个运行 Connect 框架的 JVM 进程：负责跑 connector/task、管理 offset、对外提供 REST API；standalone 一个进程，distributed 多个进程组成集群", "「调度与搬运班」：所有搬运工（task）都由它拉起、监视、按需重启"],
        ["connector（连接器）", "一个「插件实例」：描述外部系统的接入方式，由框架加载并拆成若干 task 去执行；不直接搬数据", "「搬运方案」：MySQL CDC 方案 / 文件导入方案……方案本身不动手"],
        ["task（任务）", "connector 实际干活的最小单位：每个 task 独立线程，搬一部分数据（如一个文件、几个分区/表），真正的数据流动发生在 task 里", "「具体搬运工」：一个方案派 N 个工人，每人搬一块"],
        ["converter（转换器）", "在 Connect 内部的数据模型与 Kafka 上传输的字节之间做序列化/反序列化（如 JSON、Avro），key 与 value 可分别指定", "「打包/拆包规则」：进 Kafka 前按什么格式装箱，出 Kafka 后按什么格式开箱"],
        ["transform（单消息变换 SMT）", "消息在流入/流出主题途中做的轻量逐条改写（改字段、改 topic、过滤），写在 connector 配置里，不需要写代码", "「流水线上加个贴标机」：给每条消息加个来源字段、改个名字、扔掉一部分"],
      ],
    },
    {
      type: "definition",
      term: "连接器插件（connector plugin）",
      definition:
        "把连接器及其依赖打包成的一组 JAR。Connect 通过 worker 配置的 `plugin.path` 扫描并加载插件（支持目录、uber-jar 等形式），运行时按 `connector.class` 找到对应类。官方发行版自带 FileStream 与 MirrorMaker 两类插件；Debezium、JDBC、Elasticsearch 等第三方连接器以独立插件包形式安装。",
    },
    {
      type: "paragraph",
      text: "connector 与 task 的拆分是 Connect 可扩展性的核心：**一个 connector 负责「理解外部系统并制订计划」，一个或多个 task 负责「并行执行搬运」**。任务数由连接器配置里的 `tasks.max` 决定（上限），实际能开几个由连接器自行判断——例如下文要用的 FileStreamSource 只能开 1 个 task（单个文件没有并行切分点），而 JDBC 连接器可以按表拆多个 task。框架会为每个 task 建独立线程，task 崩溃由框架重启（达到 `errors.retry.timeout` 上限才把连接器标记 FAILED）。",
    },
    {
      type: "callout",
      variant: "note",
      title: "connector.class 的三种写法",
      body: "配置 `connector.class` 时既可以用全限定类名 `org.apache.kafka.connect.file.FileStreamSourceConnector`，也可以用短名 `FileStreamSourceConnector` 或别名 `FileStreamSource`——官方文档明确支持这三种形式（别名 = 插件类名去掉包名、可再去掉 Connector 后缀）。本课实操沿用官方示例文件里的 `FileStreamSource`。",
    },
    {
      type: "heading",
      text: "source 数据流：外部世界 → Kafka",
    },
    {
      type: "paragraph",
      text: "source 连接器（如文件、数据库 CDC）负责把外部数据变成 Kafka 记录。它的工作循环可以抽象成五步：",
    },
    {
      type: "code",
      title: "source 端五步循环（text 图）",
      language: "text",
      code: `外部系统（文件 / 数据库 / API…）
   │  ① poll()：连接器按自己的节奏"取到"一批外部记录（含进度信息）
   ▼
connector 的 task（把外部数据转成 Connect 内部数据模型 Record）
   │  ② 经过 value/key converter 序列化成字节（如 JSON）
   ▼
Kafka producer（框架内置，acks/重试等由 worker 的 producer.* 配置控制）
   │  ③ 写入目标 topic
   ▼
  ④ 写成功后，task 把该批的外部进度上报给框架
   │      （source 的"offset"不是 Kafka offset，而是外部系统自己的进度，
   │       如文件字节位置、binlog 文件名+位置）
   ▼
  ⑤ 框架周期性把进度持久化（standalone → 本地文件；distributed → 内部主题）
   │      重启时框架先读出进度，再让 task 从那里继续 → "断点续传"`,
    },
    {
      type: "paragraph",
      text: "注意第 ④⑤ 步是 source 端与普通生产者最本质的区别：**source task 的偏移量由框架代为管理并持久化**，task 只需在 `poll()` 返回的记录里告诉框架「这批数据的外部位置是什么」。以官方 FileStreamSource 为例：它按行读文件，每一行变成一条记录，位置就是**文件里的字节位置**——我们稍后会在实测里看到它的真实样子（`{\"filename\": ...} → {\"position\": N}`）。重启 worker 后，task 从上次记录的字节位置继续读，已经读过的行不会重读。",
    },
    {
      type: "paragraph",
      text: "「记录进度」与「写入 Kafka」两个动作之间有时间差：框架按 `offset.flush.interval.ms`（官方示例模板设 10 秒）周期性提交进度。于是崩溃窗口内会重复投递**最近一个提交周期**的数据（文件场景 = 最后几行会重读）——这是标准的 at-least-once：[投递语义](glossary:delivery-semantics)与你在第 5 章学到的完全一致，只是「提交」的对象从消费者的 Kafka offset 换成了 source 外部进度。反过来，如果想刻意重放（例如源文件被误删后重建），把已存进度清掉再启动，source 就会从头再读一遍——这会产生**整段重复**，稍后实操部分你会亲眼看到，这正是「下游消费必须幂等」的原因（与[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)一课呼应）。",
    },
    {
      type: "callout",
      variant: "note",
      title: "exactly-once 扩展（source 端）",
      body: "Kafka Connect 从 3.3.0 起为 source 连接器提供框架级 exactly-once 支持（文档原文），做法是把「写入 topic」与「记录 source 进度」放进同一个事务。前提很多：仅在 **distributed** 模式可用（standalone 不支持）、需要 worker 配置 `exactly.once.source.support=enabled`、且连接器本身要配合。绝大多数连接器（包括 Debezium）默认仍走 at-least-once——记住：框架给的是能力上限，连接器要不要用是另一回事。",
    },
    {
      type: "heading",
      text: "sink 数据流：Kafka → 外部世界",
    },
    {
      type: "paragraph",
      text: "sink 连接器（如写文件、写 Elasticsearch）方向相反：框架为每个 sink task 建一个**普通 Kafka 消费者**（属于名为 `connect-<连接器名>` 的消费组），把 topic 消息反序列化（converter 解包）后交给连接器，由连接器写入外部系统。sink 侧的「进度」就是普通消费者的已提交位置——所以它天然复用你已学过的整套[消费组](glossary:consumer-group)机制：sink 任务的提交同样由框架周期性执行（默认与 source 同一个 `offset.flush.interval.ms` 节奏），崩溃后组内重新分配分区、从已提交位置继续。",
    },
    {
      type: "list",
      items: [
        "**输入范围**：每个 sink 连接器必须通过 `topics`（逗号分隔的主题列表）或 `topics.regex`（正则）声明自己订阅什么，二者至少其一（官方文档原话）。",
        "**提交语义**：sink 端把「已消费」当作「已交给连接器去写」——框架的提交不保证外部写入已成功落盘（那是连接器自己的事）。这与第 4 章「提交时机决定重复窗口」是同一套推理：at-least-once 下外部系统必须容忍重复写入或自行幂等。",
        "**失败处理**：转换/反序列化/连接器写入出错时默认「快速失败」（task 报错重启）；可以配置 `errors.tolerance` 跳过、`errors.log.enable` 记日志、`errors.deadletterqueue.topic.name` 把坏消息投进死信主题——这套错误处理配置与你在[死信](glossary:dead-letter)一课自己写的 Go 版本功能对齐，只是由框架提供。",
      ],
    },
    {
      type: "heading",
      text: "standalone 与 distributed：两种运行模式",
    },
    {
      type: "paragraph",
      text: "同一套框架有两种运行形态，官方文档分别叫 standalone 与 distributed。**standalone（单机）**：一个 worker 进程干所有活，连接器配置通过命令行参数传入（properties 或 JSON 文件），offset 存本地文件；适合开发、测试、日志采集这类「单点就够」的场景，但没有容错、不能水平扩展。**distributed（分布式）**：多个 worker 进程组成集群（靠消费组协议协调，组名即 `group.id`），连接器配置通过 REST 提交并由集群分配执行；worker 增减时任务自动迁移，即「弹性 + 容错」。生产环境一律 distributed。",
    },
    {
      type: "table",
      caption: "standalone vs distributed 对比",
      headers: ["维度", "standalone（单机）", "distributed（分布式集群）"],
      rows: [
        ["进程形态", "单 worker 进程，配置以文件参数启动", "多个 worker 进程组成集群，`group.id` 标识集群（文档提醒：不得与消费组 ID 冲突）"],
        ["连接器管理", "启动时从命令行配置文件加载；运行中也可用 REST 增删", "纯 REST：配置提交后由集群分配到某个 worker 执行"],
        ["offset 存哪", "本地文件（`offset.storage.file.filename`，示例默认 `/tmp/connect.offsets`）", "Kafka 内部主题 `connect-offsets`（见下节）"],
        ["配置/状态存哪", "不共享（进程内配置 + 状态）", "Kafka 内部主题 `connect-configs`（配置）与 `connect-status`（状态）"],
        ["容错与扩展", "进程死了连接器就停，无故障转移", "worker 崩溃后其上的 connector/task 由集群在其它 worker 重启；加 worker 即扩容"],
        ["适合", "开发调试、小规模/边缘采集（官方文档举例：收集日志）", "生产数据集成，多连接器集中管理"],
        ["启动命令", "`connect-standalone.sh worker.properties connector1.properties ...`", "`connect-distributed.sh worker.properties`"],
      ],
    },
    {
      type: "heading",
      text: "distributed 的三个内部主题",
    },
    {
      type: "paragraph",
      text: "distributed 模式把「记忆」放进三个 Kafka 主题（名字在 worker 配置里可改，默认就是下面这三个——本课在 4.3.1 实测里看到集群自动创建了它们）：",
    },
    {
      type: "table",
      caption: "distributed 模式内部主题（默认名与用途）",
      headers: ["主题", "存什么", "官方建议的形态", "实测默认（单 broker 自动创建）"],
      rows: [
        ["`connect-offsets`", "每个 source task 的外部进度（source offset）；分布式模式下替代 standalone 的本地文件", "多分区、副本、compacted", "25 个分区、cleanup.policy=compact"],
        ["`connect-configs`", "所有连接器的配置（含版本号，用于滚动升级时的新旧兼容）", "单分区、高副本、compacted", "1 个分区、compact"],
        ["`connect-status`", "connector/task 的运行状态快照（供 REST 查询与多 worker 同步）", "可多分区、副本、compacted", "5 个分区、compact"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "生产环境请手动创建这三个主题",
      body: "worker 启动时若发现主题不存在会自动创建（上面实测就是这样），但自动创建的分区数/副本数跟随 broker 默认值，未必符合你的容量与容错要求。官方文档明确建议：**在启动 Connect 前手动创建**这三个主题，指定期望的分区数与 replication factor（offset 多分区、configs 单分区；多 broker 集群里副本数按集群规模来）。另外注意：`connect-offsets` 的语义与 broker 的 `__consumer_offsets` 不同——后者存消费组提交的 Kafka offset（第 4 章讲过），前者存连接器自己的 source 进度；别混为一谈。",
    },
    {
      type: "heading",
      text: "REST API：连接器的管理面",
    },
    {
      type: "paragraph",
      text: "无论哪种模式，worker 都提供 REST API（默认监听 **8083** 端口，用 worker 配置 `listeners` 可改；API 的完整定义见官方的 [OpenAPI 文档](https://kafka.apache.org/43/generated/connect_rest.yaml)）。它既是人用的管理界面，也是 distributed 模式里唯一正式的管理入口。最常用的端点如下（路径与语义均按 4.3 官方 user-guide 核对）：",
    },
    {
      type: "table",
      caption: "Connect REST API 常用端点（4.3）",
      headers: ["方法与路径", "作用"],
      rows: [
        ["`GET /`", "返回 worker 版本、git commit 与所连 Kafka 集群 ID"],
        ["`GET /connectors`", "列出当前全部连接器名"],
        ["`POST /connectors`", "创建连接器：body 为 `{\"name\": ..., \"config\": {...}}`（可带可选 `initial_state`）"],
        ["`GET /connectors/{name}`", "查看单个连接器信息"],
        ["`GET|PUT|PATCH /connectors/{name}/config`", "读 / 整体更新 / 局部修补连接器配置（更新即触发任务重配）"],
        ["`GET /connectors/{name}/status`", "连接器与各 task 的状态（RUNNING/PAUSED/FAILED/…）、所在 worker、错误信息"],
        ["`PUT /connectors/{name}/pause|resume|stop`", "暂停（保留资源）/ 恢复 / 停止（释放资源、任务退出）"],
        ["`POST /connectors/{name}/restart?includeTasks=true&onlyFailed=false`", "重启连接器（可带是否连任务一起、是否只重启失败者）"],
        ["`GET /connectors/{name}/tasks` / `.../tasks/{id}/status`", "任务列表 / 单个任务状态"],
        ["`DELETE /connectors/{name}`", "删除连接器：停掉任务并删除其配置"],
        ["`GET /connectors/{name}/topics` / `PUT .../topics/reset`", "查看 / 清空该连接器正在使用的主题集合"],
        ["`GET|PATCH|DELETE /connectors/{name}/offsets`", "读取 / 修改 / 重置连接器的 source 进度（KIP-875；改与删要求连接器先 stop）"],
        ["`GET /connector-plugins`", "列出已安装的连接器插件（含 class/type/version）"],
        ["`PUT /connector-plugins/{type}/config/validate`", "校验某连接器的配置并返回错误/建议值"],
      ],
    },
    {
      type: "paragraph",
      text: "这一整组端点后面会被编排工具（脚本、CI、Kubernetes operator）调用，形成「配置即代码」。你在书舟里看到的生产动作——查状态、调配置、重启失败任务、重置 offset 重放——全部落到这张表上。",
    },
    {
      type: "heading",
      text: "converter 与 transform：数据在途的两道工序",
    },
    {
      type: "paragraph",
      text: "数据在「外部系统 ↔ Kafka 字节」之间要过两道与具体连接器无关的工序。第一道是 **converter**：把 Kafka 上的字节与 Connect 内部数据模型互转，决定了**消息在主题里长什么样**。worker 级配置 `key.converter` / `value.converter` 指定全局默认（key 与 value 可不同），单个连接器可用 `key.converter` / `value.converter` 覆盖。官方发行版自带 JSON 转换器（`org.apache.kafka.connect.json.JsonConverter`）；要 Avro 则需要自行引入相应的 Avro 转换器（Confluent/Apicurio 生态提供，常与 [Schema Registry](glossary:schema-registry) 一起部署）——即第 6 章[Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)讲的 [serializer](glossary:serializer) 生态在 Connect 侧的对应物：字节里带 schema id，消费端去注册表取 schema 解码。",
    },
    {
      type: "paragraph",
      text: "JSON 转换器有个开关值得记住：`schemas.enable`。为 `true`（官方示例模板的默认值）时每条消息是**带 schema 信封**的 JSON，例如 FileStreamSource 读出的一行会变成下面左边这样；为 `false` 时是**纯 payload**（schema-less），例如右边。信封自描述、可校验，但每条消息膨胀明显；schema-less 紧凑，适合「结构简单且你确信消费端知道格式」的场合：",
    },
    {
      type: "code",
      title: "同一行文本在 schemas.enable=true / false 下的主题消息（4.3.1 实测）",
      language: "text",
      code: `// schemas.enable=true（默认）：schema 信封 + payload
{"schema":{"type":"string","optional":false},"payload":"foo"}

// schemas.enable=false：裸值（下方为便于阅读换行，实际是一行紧凑 JSON）
{"line":"foo","data_source":"test-file-source"}`,
    },
    {
      type: "paragraph",
      text: "第二道工序是 **transform（SMT，Single Message Transform）**：在消息进出 topic 途中做轻量逐条改写，直接写进连接器配置、无需写 Java。官方自带的变换有二十来种，常见的有 `InsertField`（加静态/元数据字段）、`ExtractField`（只留某个字段）、`MaskField`（打码）、`RegexRouter`/`TimestampRouter`（改 topic）、`Filter`+谓词（按条件丢弃消息）、`HoistField`（把整条包进一个 map）等（完整清单见[官方 user-guide](https://kafka.apache.org/43/kafka-connect/user-guide/)）。多个变换用 `transforms` 按逗号顺序声明，别名可自取：",
    },
    {
      type: "code",
      title: "给文件 source 的消息套壳并附加来源字段（官方示例的配置形态）",
      language: "properties",
      code: `# 官方 user-guide 的 transforms 示例，套用在 FileStreamSource 上：
# 1) HoistField：把整行文本包成 {"line": "<文本>"}
# 2) InsertField：追加静态字段 data_source
name=local-file-source
connector.class=FileStreamSource
tasks.max=1
file=test.txt
topic=connect-test

transforms=MakeMap,InsertSource
transforms.MakeMap.type=org.apache.kafka.connect.transforms.HoistField$Value
transforms.MakeMap.field=line
transforms.InsertSource.type=org.apache.kafka.connect.transforms.InsertField$Value
transforms.InsertSource.static.field=data_source
transforms.InsertSource.static.value=test-file-source`,
    },
    {
      type: "paragraph",
      text: "用上面配置跑出来的真实消息（本课实测，schema-less 模式）是 `{\"line\":\"hello world\",\"data_source\":\"test-file-source\"}`。这类「加来源标识、丢敏感字段、按表路由」的改写，用 SMT 比写代码便宜得多——它是连接器配置与自研处理之间性价比最高的折中。",
    },
    {
      type: "heading",
      text: "实操：把官方 FileStream 管道跑起来（教学演示）",
    },
    {
      type: "callout",
      variant: "warning",
      title: "教学演示说明（已按 4.3.1 实测）",
      body: "本小节命令基于 **Apache Kafka 4.3.1 官方 Docker 镜像 `apache/kafka:4.3.1`**，与第 1 章[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)同一发行版；步骤照搬官方 quickstart 的 Connect 一节（Step 6）并适配容器路径，仅供教学，不是生产部署样板。若你第 1 章起的容器还占着 9092 端口，请先 `docker stop kafka`（或把下面映射改成本机空闲端口）。先起一个**自带 8083 端口映射**的容器：",
    },
    {
      type: "code",
      title: "启动演示用 broker（发布 9092 与 8083）",
      language: "bash",
      code: `docker run -d --name kafka-connect-lab -p 9092:9092 -p 8083:8083 apache/kafka:4.3.1
# 等日志出现 "Kafka Server started"（docker logs -f kafka-connect-lab 查看，Ctrl+C 退出跟随）`,
    },
    {
      type: "paragraph",
      text: "容器里是完整发行版：Connect 脚本在 `/opt/kafka/bin`（`connect-standalone.sh`、`connect-distributed.sh`），官方示例配置在 `/opt/kafka/config`（`connect-standalone.properties`、`connect-file-source.properties`、`connect-file-sink.properties`），FileStream 连接器打包在 `/opt/kafka/libs/connect-file-4.3.1.jar`。官方 quickstart 明确要求：**先把这个 jar 加进 worker 配置的 `plugin.path`**，因为发行版默认不把它放上 classpath。容器内当前目录是 `/`，所以这里用绝对路径（官方文档也建议生产用绝对路径）：",
    },
    {
      type: "code",
      title: "准备种子数据与连接器配置（在容器内）",
      language: "bash",
      code: `# 1) 种子数据文件（source 要读它）
docker exec kafka-connect-lab sh -c 'mkdir -p /tmp/connect-demo && printf "foo\\nbar\\n" > /tmp/connect-demo/test.txt'

# 2) 让 worker 能找到 FileStream 插件（发行包自带的 connect-file jar）
docker exec kafka-connect-lab sh -c 'echo "plugin.path=/opt/kafka/libs/connect-file-4.3.1.jar" >> /opt/kafka/config/connect-standalone.properties'

# 3) 官方示例连接器文件用的是相对路径（file=test.txt），在容器里会指向根目录 /；
#    教学起见用绝对路径覆写两个连接器配置（docker exec -i + heredoc 写入容器内文件）：
docker exec -i kafka-connect-lab sh -c 'cat > /opt/kafka/config/connect-file-source.properties' <<'EOF'
name=local-file-source
connector.class=FileStreamSource
tasks.max=1
file=/tmp/connect-demo/test.txt
topic=connect-test
EOF
docker exec -i kafka-connect-lab sh -c 'cat > /opt/kafka/config/connect-file-sink.properties' <<'EOF'
name=local-file-sink
connector.class=FileStreamSink
tasks.max=1
file=/tmp/connect-demo/test.sink.txt
topics=connect-test
EOF

# 4) 确认写入结果
docker exec kafka-connect-lab sh -c 'cat /opt/kafka/config/connect-file-source.properties /opt/kafka/config/connect-file-sink.properties'`,
    },
    {
      type: "code",
      title: "覆写后的连接器配置（绝对路径版，与上面 heredoc 内容一致）",
      language: "properties",
      code: `# connect-file-source.properties
name=local-file-source
connector.class=FileStreamSource
tasks.max=1
file=/tmp/connect-demo/test.txt
topic=connect-test

# connect-file-sink.properties
name=local-file-sink
connector.class=FileStreamSink
tasks.max=1
file=/tmp/connect-demo/test.sink.txt
topics=connect-test`,
    },
    {
      type: "paragraph",
      text: "然后建主题、启动 standalone worker——启动命令的第一个参数永远是 worker 配置，后面跟若干个连接器配置文件（properties 或 JSON 均可，官方文档原话）。standalone 进程要**常驻**，建议单独占一个终端：",
    },
    {
      type: "code",
      title: "创建主题并启动 Connect（standalone，前台常驻）",
      language: "bash",
      code: `docker exec kafka-connect-lab /opt/kafka/bin/kafka-topics.sh \\
  --create --topic connect-test --partitions 1 --replication-factor 1 \\
  --bootstrap-server localhost:9092

# 另开一个终端：启动 standalone（含 file source + file sink 两个连接器）
docker exec -it kafka-connect-lab /opt/kafka/bin/connect-standalone.sh \\
  /opt/kafka/config/connect-standalone.properties \\
  /opt/kafka/config/connect-file-source.properties \\
  /opt/kafka/config/connect-file-sink.properties
# 日志出现一批 "Added plugin '...'" 与连接器实例化信息后即就绪；Ctrl+C 可停止`,
    },
    {
      type: "paragraph",
      text: "等十几秒，验证整条管道（源文件 → 主题 → 落地文件）已经打通：",
    },
    {
      type: "code",
      title: "验证 sink 端与主题内数据",
      language: "bash",
      code: `# sink 端：主题里的消息被写进了 test.sink.txt
docker exec kafka-connect-lab sh -c 'cat /tmp/connect-demo/test.sink.txt'
# 输出：
# foo
# bar

# 主题内真实数据（JsonConverter 默认带 schema 信封；--timeout-ms 让消费者读够即退）
docker exec kafka-connect-lab /opt/kafka/bin/kafka-console-consumer.sh \\
  --bootstrap-server localhost:9092 --topic connect-test \\
  --from-beginning --timeout-ms 4000`,
    },
    {
      type: "code",
      title: "主题内真实消息（4.3.1 实测）",
      language: "json",
      code: `{"schema":{"type":"string","optional":false},"payload":"foo"}
{"schema":{"type":"string","optional":false},"payload":"bar"}`,
    },
    {
      type: "paragraph",
      text: "source 是**持续**的：往源文件追加一行，十几秒内（`offset.flush.interval.ms` 与 task 轮询节奏之内）它就会流经主题出现在 sink 文件与消费者输出里：",
    },
    {
      type: "code",
      title: "追加数据观察增量流动",
      language: "bash",
      code: `docker exec kafka-connect-lab sh -c 'echo "line three" >> /tmp/connect-demo/test.txt'
sleep 15
docker exec kafka-connect-lab sh -c 'cat /tmp/connect-demo/test.sink.txt'
# foo / bar / line three`,
    },
    {
      type: "subheading",
      text: "用 REST API 观察与管理（宿主机的 8083 已映射）",
    },
    {
      type: "code",
      title: "REST 实测输出（4.3.1）",
      language: "bash",
      code: `curl -s http://localhost:8083/          # 版本与集群信息
# {"version":"4.3.1","commit":"26b251a451ce941d","kafka_cluster_id":"5L6g3nShT-eMCtK--X86sw"}

curl -s http://localhost:8083/connectors   # 活动连接器列表
# ["local-file-source","local-file-sink"]

curl -s http://localhost:8083/connectors/local-file-source/status
# {"name":"local-file-source","connector":{"state":"RUNNING","worker_id":"172.17.0.4:8083",
#  "version":"4.3.1"},"tasks":[{"id":0,"state":"RUNNING","worker_id":"172.17.0.4:8083",
#  "version":"4.3.1"}],"type":"source"}

# 运行中热创建一个新连接器（standalone 也支持 REST 增删）
curl -s -X POST -H "Content-Type: application/json" http://localhost:8083/connectors -d '{
  "name": "file-source-extra",
  "config": {"connector.class": "FileStreamSource", "tasks.max": 1,
             "file": "/tmp/connect-demo/test.txt", "topic": "connect-test"}
}'

curl -s -X DELETE http://localhost:8083/connectors/file-source-extra   # 用完删掉

curl -s http://localhost:8083/connector-plugins                        # 已装插件
# [{"class":"org.apache.kafka.connect.file.FileStreamSinkConnector","type":"sink","version":"4.3.1"},
#  {"class":"org.apache.kafka.connect.file.FileStreamSourceConnector","type":"source","version":"4.3.1"},
#  ... Mirror 系列连接器也随发行版提供 ...]`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "两个 source 读同一文件 = 双份重复（本课实测翻车现场）",
      body: "上面热创建 `file-source-extra` 时，如果它读的是**同一个文件、写同一个主题**，主题里每条数据都会出现两份——两个连接器各自维护一份独立进度、互不知情。这是真实发生过的场景（本课作者实测时 sink 文件立刻出现了整段重复），也是一条重要工程教训：**重复投递不只来自崩溃重放，也可能来自「两套采集同时跑」**，下游幂等是唯一通用解。实验后记得 DELETE 掉多余连接器。",
    },
    {
      type: "subheading",
      text: "观察 offset 语义：断点续传与重置重放",
    },
    {
      type: "paragraph",
      text: "standalone 的 source 进度存在本地文件 `/tmp/connect.offsets`（worker 配置 `offset.storage.file.filename`）。文件是 Java 序列化格式，肉眼不可读，但内容结构就是「(连接器名, 外部分区) → 进度值」：实测里两个 source 各自记录了 `(\"local-file-source\", {\"filename\":\"/tmp/connect-demo/test.txt\"}) → {\"position\":47}`，47 正是文件已读的**字节数**。想以 JSON 看进度，用 REST（KIP-875，4.3 支持）：",
    },
    {
      type: "code",
      title: "通过 REST 读取 source 进度（4.3.1 实测）",
      language: "bash",
      code: `curl -s http://localhost:8083/connectors/local-file-source/offsets
# {"offsets":[{"partition":{"filename":"/tmp/connect-demo/test.txt"},
#              "offset":{"position":47}}]}

curl -s http://localhost:8083/connectors/local-file-source/topics
# {"local-file-source":{"topics":["connect-test"]}}`,
    },
    {
      type: "code",
      title: "断点续传实验：停掉 worker 再启动，不会重读",
      language: "bash",
      code: `# 终端 B 里 Ctrl+C 停掉 connect-standalone，然后原命令重新启动
docker exec -it kafka-connect-lab /opt/kafka/bin/connect-standalone.sh \\
  /opt/kafka/config/connect-standalone.properties \\
  /opt/kafka/config/connect-file-source.properties \\
  /opt/kafka/config/connect-file-sink.properties

# 再查 sink 文件：行数没有增长——source 从上次记录的字节位置继续，没有重放`,
    },
    {
      type: "code",
      title: "重置实验：清掉进度再启动，整段重放",
      language: "bash",
      code: `# 1) 停 worker（终端 B Ctrl+C）
# 2) 删除 offset 文件（standalone 的"记忆"就在这；distributed 模式对应
#    REST: PUT /connectors/{name}/stop 后 DELETE /connectors/{name}/offsets）
docker exec kafka-connect-lab rm -f /tmp/connect.offsets

# 3) 原命令重新启动 worker → source 没有进度可续，从文件头重新读一遍：
#    主题里同一批数据再次出现，sink 文件整段追加（重复！）
#    —— 这正是 at-least-once 的现场：进度提交窗口/被清空都会带来重复，
#    下游消费必须幂等（回顾第 5 章）。`,
    },
    {
      type: "paragraph",
      text: "这次实操你亲手验证了本课的四个核心结论：连接器配置决定搬什么、框架负责搬与记进度、进度决定重启后是「续传」还是「重放」、而 REST 是唯一的管理面。有兴趣的读者可以再跑 distributed 模式（`connect-distributed.sh` + 上面的 REST 创建连接器），观察 worker 自动创建 `connect-offsets`/`connect-configs`/`connect-status` 三个主题——本课实测单 broker 环境下它们分别以 25/1/5 个分区、compacted 策略被自动创建（生产请手动建，见前文提醒）。",
    },
    {
      type: "heading",
      text: "什么时候用 Connect，什么时候自己写 Go 客户端",
    },
    {
      type: "paragraph",
      text: "学完架构，最该建立的是边界感：Connect 不是「Kafka 客户端的高级形态」，而是「数据集成平台的运行时」。书舟内部业务服务（orders、notify…）与 Kafka 之间永远是应用内嵌 franz-go——那是业务代码的一部分；而「把某个外部系统成建制地接进/接出 Kafka」才是 Connect 的领地。判断口诀：**接入方是「很多数据、很常规、想托管」还是「少量数据、很特殊、想内嵌」**。",
    },
    {
      type: "table",
      caption: "Connect vs 自研 Go 消费者/生产者（决策表）",
      headers: ["考虑维度", "用 Kafka Connect", "自己写 Go（franz-go）", "书舟的判断"],
      rows: [
        ["接入对象", "数据库/文件/对象存储/搜索/云服务等**已有连接器**的外部系统；或一个团队要维护几十上百条管道", "一个对接点、逻辑与业务强耦合、或纯自定义协议没有现成连接器", "订单库变更 → Debezium 连接器；web 网关行为埋点 → 直接 kgo 发 `user.behavior`"],
        ["需要框架能力吗", "要 offset 托管、断点续传、多 worker 容错、REST 运维面、热更新配置", "管道逻辑内嵌在服务里，随服务部署/伸缩，不需要独立运维面", "给「推荐/数仓」灌数据的管道值得托管；业务内的一次性转发不值得"],
        ["运维模型", "独立进程（JVM），需要一个 Connect 集群（或多集群），升级/监控是单独一条线", "随你的 Go 服务一起跑，无新增组件；但要自己实现重连/进度/重试/DLQ（第 5 章那套）", "已有 Go 服务的团队，接入量小 → 自研更省；接入面大 → Connect 集群摊销成本"],
        ["处理深度", "连接器 + SMT 适合「搬运 + 轻改写」；复杂业务处理（聚合、多流 join、窗口）不是 Connect 的活", "任意 Go 逻辑：状态、事务、外部调用都在一个进程里（配合第 5、6 章模式）", "「搬库」用 Connect，「算」用流处理/自研（下一章）"],
        ["序列化与 Schema", "converter 决定格式；可接 AvroConverter + Schema Registry（第 6 章生态）", "自己选 JSON/Avro + pkg/sr（[Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)）", "两边都能管 schema，取决于团队栈"],
        ["写新连接器", "连接器开发框架（Java）存在，但成本不低——只在「没有现成连接器且要多处复用」时值", "临时/一次性对接用 Go 直接写更快", "只有书舟自己系统的私有协议才考虑自研连接器"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "三条实用结论",
      body: "第一，**先查生态再动手**：连接器生态目录（如 [Confluent Hub](https://www.confluent.io/hub/)）与 Debezium 连接器族覆盖了绝大多数主流系统，能白嫖就不自研。第二，**业务代码不该跑在 Connect 里**：连接器/SMT 处理的是「数据搬运」，领域逻辑（发通知、算积分）留在你的服务里消费主题。第三，**自研 Go 管道与 Connect 不互斥**：书舟的现实形态往往是「Connect/Debezium 把库和外部系统变成主题 + Go 服务消费主题做业务 + 需要时 kgo 直发」，各管一段。",
    },
    {
      type: "quiz",
      question:
        "你的分布式 Connect 集群里跑着一个 FileStreamSource（读文件 test.txt 发到主题 connect-test）。某天你希望它把文件**从头重放一遍**，正确的操作顺序是什么？",
      options: [
        "直接删除文件再重建，source 检测到文件变化会自动从头读",
        "REST 调 PUT /connectors/local-file-source/stop，再 DELETE /connectors/local-file-source/offsets，最后重启连接器让它恢复运行",
        "用 kafka-topics 删掉 connect-test 主题重建，source 会自动重读源文件",
        "重启整个 connect-distributed 进程，source 没有内存状态就会从头读",
      ],
      answer: 1,
      explanation:
        "source 的「记忆」是持久化的外部进度（分布式模式在 connect-offsets 主题里），重启进程只会从已记录进度续传、不会重放。要让 source 从头重读，必须先把连接器置于 STOPPED 状态（官方要求 offset 的修改只在 stop 状态允许），再删除/重置其 offsets（KIP-875 的 DELETE /connectors/{name}/offsets），最后恢复运行——选项 2 是文档规定的完整顺序。选项 1/3 改的是源或目标而非进度；选项 4 重启进程不丢已提交进度。",
    },
    {
      type: "keypoints",
      items: [
        "五个角色：connector 出方案、task 干活、worker 跑框架并管 offset、converter 决定主题里的字节格式、transform 做途中轻改写；框架管扩展与容错",
        "source 端进度 = 外部系统自己的位置（文件字节/binlog 位置），由框架周期性持久化；sink 端 = 普通消费组提交，组名 `connect-<连接器名>`",
        "默认语义 at-least-once：提交周期窗口内崩溃 → 最近一批重投；清空/重置进度 → 整段重放（本课实操亲测）",
        "standalone 单进程无容错（offset 存本地文件），distributed 集群化（offset/config/status 存三个内部主题，默认名 connect-offsets/connect-configs/connect-status，生产要手动建）",
        "REST 默认 8083：增删改查/状态/暂停恢复/重启/进度管理（KIP-875）都是它；OpenAPI 定义见官方 connect_rest.yaml",
        "决策：成建制的外部系统接入交给 Connect（优先现成连接器）；业务内嵌收发用 franz-go；两者在书舟并存，各管一段",
      ],
    },
    {
      type: "paragraph",
      text: "本课跑通的 FileStream 只是「最小连接器」的样子——它帮你建立了角色与数据流的完整心智。下一课把这个心智用到生产级场景：用 Debezium 把 MySQL 的每一行变更变成事件（[Debezium CDC：数据库变更变成事件](/courses/kafka/lessons/kafka-connect-cdc-practice)），那里你会看到 topic 命名、消息结构、快照与增量这些本课概念如何被一个真实连接器兑现。再往后，第 8 章讲 Kafka Streams 时，Connect 搬进来的数据就是流处理的原料。",
    },
  ],
};
