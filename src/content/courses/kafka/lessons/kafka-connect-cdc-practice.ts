/* ==================================================================
 * 课时：Debezium CDC：数据库变更变成事件（kafka-connect-cdc-practice）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 7 章第二课。事实核对（2026-09-08）：
 * - 全部 Debezium 概念/配置名/主题命名/消息结构按官方文档
 *   https://debezium.io/documentation/reference/stable/connectors/mysql.html
 *   核对，写作时该 "stable" 指向 Debezium 3.6（文档内示例版本 3.6.2.Final）；
 * - 术语差异：Debezium 2.0 起 `topic.prefix` 取代旧名 `database.server.name`；
 *   MySQL 连接参数在 3.6 文档中仍写作 database.hostname/database.port 等；
 * - 配置骨架中的键与取值均摘自该文档 "MySQL connector configuration example"。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "为什么数据库集成要读日志而不是双写或轮询，Debezium MySQL 连接器如何快照+增量地把 binlog 变成事件，主题命名与消息结构长什么样，以及它与 Outbox 的取舍与生产运维要点。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课建立了 [Kafka Connect](glossary:connect) 的心智：连接器出方案、框架管搬运与进度。本课把镜头对准 Connect 生态里最重要的一族——**Debezium 数据库 CDC 连接器**：它订阅数据库的复制日志，把每一行 INSERT/UPDATE/DELETE 变成 Kafka 事件。为什么数据库集成要「读日志」而不是让业务代码双写、不是定时 SELECT？事件长什么样、怎么命名？它和上一章的事务性 [Outbox](glossary:outbox) 是什么关系？生产中哪些环节最常翻车？本课用 [Debezium MySQL 连接器官方文档](https://debezium.io/documentation/reference/stable/connectors/mysql.html)（写作时 stable = **Debezium 3.6**）作为事实基准逐条回答。",
    },
    {
      type: "heading",
      text: "为什么是日志级捕获：双写与轮询各自的死穴",
    },
    {
      type: "paragraph",
      text: "把数据库里的数据「搬进 Kafka」，候选方案有三条，前两条你在第 6 章已经见过一半。**业务代码双写**（在同一个业务事务里既写库又发 Kafka）的死穴是跨系统原子性——消息系统不在数据库事务里，总有一侧先成功；这正是 [Outbox](glossary:outbox) 模式要修补的问题，而 Outbox 本身要求改造业务代码（建表、写 relay）。**轮询快照**（定时 SELECT 全表/按更新时间戳增量）看着简单，但缺陷是结构性的：",
    },
    {
      type: "list",
      items: [
        "**看不到删除**：行被 DELETE 后 SELECT 里就没了，除非你额外维护「已删 id 清单」或软删除列——等于把业务表改成审计表。",
        "**看不到旧值**：UPDATE 只给你新值，事件里没有 before；要做「变更前后对比」就得自己再查一次，而查到的可能是已被下一次更新覆盖的值。",
        "**没有事务边界与顺序**：一批变更发生在同一事务里，轮询按自己的节奏分批 SELECT，无法表达「这几行是一个原子变更」；跨表先后关系也只能靠更新时间戳猜。",
        "**有延迟与负载的下限**：轮询间隔是延迟下限；为降延迟提高频率，就是把重复的全量/增量扫描压力持续打在业务库上。",
        "**与应用代码耦合**：谁改了表、改了哪些列，轮询方无法得知 DDL；连接器判断「该不该采这行」依赖业务方配合。",
      ],
    },
    {
      type: "paragraph",
      text: "**日志级捕获（CDC）**绕开这一切：数据库主从复制本来就要把每个变更写进事务日志（MySQL 的 **binlog**，binary log）；CDC 连接器把自己伪装成一个副本（replica），从日志里读出**行级变更流**——删除可见（带着删除前的整行）、更新可见 before/after、同事务的变更天然相邻且有序、DDL 也在日志里。业务代码零改造、零轮询压力，这就是 [CDC（变更数据捕获）](glossary:cdc)能成为「数据库 → Kafka」事实标准的原因。",
    },
    {
      type: "table",
      caption: "三种入库方案对比（把库里的数据变成 Kafka 事件）",
      headers: ["维度", "业务代码双写", "定时轮询（快照/增量）", "日志级 CDC（Debezium）"],
      rows: [
        ["对业务代码", "要改造：每个写路径多发一条消息，或上 Outbox", "零改造（读库即可）", "零改造（只读日志，伪装成副本）"],
        ["捕获能力", "只能发「业务方想发的」", "看不到删除与旧值、无事务边界", "行级全量变更：before/after/删除/事务内顺序/DDL 全有"],
        ["延迟", "即时（随业务事务）", "轮询间隔决定，有下限", "近实时（跟随 binlog 推送）"],
        ["对源库压力", "写路径多一次外部调用", "轮询 SELECT 持续打库", "极小（读日志，等价于一个从库）"],
        ["实现/运维成本", "业务代码 + relay，模式成熟但每服务都要做", "简单但残缺", "部署一个连接器；需要 DB 开 binlog 与授权"],
        ["典型用途", "领域事件（order.paid）——事件语义由业务定义", "临时同步、演示、低频全量", "数据平台同步/审计/搜索索引/读模型重建——要「数据变更」本身"],
      ],
    },
    {
      type: "paragraph",
      text: "注意最后一行：双写/Outbox 产出的是**领域事件**（订单已支付，语义由业务定义），CDC 产出的是**数据状态变更**（orders 表第 N 行变成什么，语义由表结构定义）。这不是谁替代谁，而是两层不同的事件——本课结尾的决策衔接表会把这个关系讲透。",
    },
    {
      type: "heading",
      text: "前置条件：把 MySQL 配置成「可被捕获」",
    },
    {
      type: "paragraph",
      text: "Debezium MySQL 连接器通过伪装成副本读 binlog，所以数据库侧有两件事必须做（官方文档 Setting up MySQL 一节）。第一，**开启并配置 binlog**：要求 `log_bin` 开启、`binlog_format=ROW`（行级日志，Statement 格式拿不到行数据）、`binlog_row_image=FULL`（UPDATE/DELETE 要带上变更前整行）。第二，**创建一个有复制权限的账号**。官方文档给出的建号与授权如下：",
    },
    {
      type: "code",
      title: "Debezium 专用账号与 binlog 配置（摘自官方文档）",
      language: "sql",
      code: `-- 1) 建账号并授权（官方文档原样；权限含义见文档权限表：
--    SELECT=快照读表，RELOAD/SHOW DATABASES=快照用，
--    REPLICATION SLAVE=读 binlog，REPLICATION CLIENT=SHOW MASTER STATUS 等）
mysql> CREATE USER 'debezium'@'%' IDENTIFIED BY 'dbz';
mysql> GRANT SELECT, RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT
       ON *.* TO 'debezium'@'%';
mysql> FLUSH PRIVILEGES;

-- 2) my.cnf（MySQL 服务端配置；改后重启 MySQL）
server-id               = 223344   -- 每个复制客户端唯一
log_bin                 = mysql-bin
binlog_format           = ROW
binlog_row_image        = FULL
binlog_expire_logs_seconds = 864000  -- 按需；决定 binlog 保留多久（见"大表快照"坑）`,
    },
    {
      type: "callout",
      variant: "note",
      title: "托管数据库的差异",
      body: "云托管实例（如 Amazon RDS/Aurora）通常不允许你改 my.cnf：RDS 需要开启自动备份才会产生 binlog（官方文档明说：不配置自动备份则 binlog 被禁用）；Aurora 等不允许全局读锁的环境，快照会改用表级锁，此时还需要给账号补 `LOCK TABLES` 权限。写连接器配置前，先把这两条与你的 DBA 对齐。",
    },
    {
      type: "heading",
      text: "工作原理：快照 + 增量两阶段",
    },
    {
      type: "paragraph",
      text: "一个 MySQL 连接器启动后的生命周期分两段（官方文档 How the connector works / Snapshots 一节）：**先快照（snapshot），后流式（streaming）**。为什么需要快照？连接器只会从「此刻之后」的 binlog 增量得到变更，但库里已有的几百万行历史数据没有任何 binlog 事件——要把「当前全量」也变成事件，就得先导一遍。快照结束后从记录的 binlog 位置无缝切换到增量，两者之间不重不漏（靠第一步记下的 binlog 坐标衔接）。",
    },
    {
      type: "list",
      items: [
        "**快照阶段（默认 `snapshot.mode=initial`，仅在尚无 offset 或上次快照未完成时触发）**：官方文档给出的默认流程是——连库 → 确定要捕获的表 → 对表加**全局读锁**（`snapshot.locking.mode=minimal` 时只在读 schema 与 binlog 位置的初始阶段短暂持有，随后释放）→ 开启 REPEATABLE READ 事务 → 记录当前 binlog 位置 → 读取所有表结构写入内部 schema history 主题 → 释放全局锁 → 在记录的位置上逐表 SELECT，为每行发一条 `op=r`（read，仅快照事件有）事件 → 提交并把快照完成记入 offset。",
        "**流式阶段**：快照完成后，连接器从第一步记录的 binlog 位置继续读后续事件，把每个行变更变成事件；期间它持续解析 binlog 里出现的 DDL，更新内存中的表结构视图。",
        "**schema history（表结构历史）**：MySQL 的 ROW 日志本身不含列名/类型，解码行数据必须知道「事件发生那一刻的表结构」。因此连接器把**所有 DDL 连同其在 binlog 中的位置**写进一个内部 Kafka 主题（schema history topic，单分区、必须保序）。崩溃重启后，连接器先读这个主题、重放到自己将要续读的 binlog 位置，重建当时的表结构视图——这就是它能在「表结构后来变过」的情况下仍正确解码旧事件的机制。",
        "**offset 即 binlog 坐标**：连接器的进度记录在 Connect 的 source offset 里（上一课讲过：distributed 模式存 `connect-offsets` 主题），内容是 binlog 文件名+位置（消息里的 `source.file`/`source.pos` 字段就是它）。",
      ],
    },
    {
      type: "code",
      title: "schema history 主题为什么必须单分区（官方文档提醒）",
      language: "text",
      code: `内部 schema history 主题要维持全库 DDL 的全局顺序才能正确重建表结构：
- 手动创建该主题时分区数必须为 1；
- 依赖 broker 自动创建时，需保证创建时的默认分区数为 1；
- 该主题仅供连接器内部使用，应用不要订阅、不要删——删了它，
  连接器将无法解码 binlog 里的旧事件（重启恢复即失败）。`,
    },
    {
      type: "heading",
      text: "输出长什么样：主题命名与消息结构",
    },
    {
      type: "subheading",
      text: "主题命名：topic.prefix + 库名 + 表名",
    },
    {
      type: "paragraph",
      text: "默认情况下，一张表的全部 INSERT/UPDATE/DELETE 事件进**同一张专属主题**，命名规则（官方文档原文约定）是：",
    },
    {
      type: "code",
      title: "主题命名规则",
      language: "text",
      code: `<topicPrefix>.<databaseName>.<tableName>

例：topic.prefix=fulfillment、库 bookdb、表 orders
    → 主题 fulfillment.bookdb.orders`,
    },
    {
      type: "paragraph",
      text: "三个组成部分里，**`topic.prefix` 是连接器配置里你给这台 MySQL 起的「逻辑名」**——Debezium 2.0 起取代了旧配置名 `database.server.name`（旧名已弃用，教程里见到 `database.server.name` 要换算）。它要求：集群内所有连接器的 prefix 全局唯一；一旦设置**不能再改**（改了之后重启，事件会进新名字的主题、且连接器无法从 schema history 恢复——官方文档原话）。前缀+库名+表名里的非法字符会被替换成下划线，可能导致不同表撞名，命名时避开特殊字符。schema change 事件与内部 schema history 主题也按类似约定命名（见下文 DDL 小节）。",
    },
    {
      type: "subheading",
      text: "消息结构：key 是主键，value 是 Envelope",
    },
    {
      type: "paragraph",
      text: "每条变更事件的 **key = 被变更行的主键**（无主键时用唯一键，也可用 `message.key.columns` 自定义），序列化后形如 `{\"id\": 1001}`——同一条行记录的多次变更永远同 key 同分区，天然支持[日志压缩](glossary:compaction)：想拿「表的最新状态」可以直接用一个 compacted 主题存 CDC 流。**value 是统一的信封（Envelope）结构**，下面按官方文档的 customers 示例改写成书舟的 orders 表（字段含义照抄文档，行文为便于阅读省略了完整的 schema 段）：",
    },
    {
      type: "code",
      title: "UPDATE 事件的 value 结构（示意：字段与语义按 Debezium 3.6 官方文档，表名/值改编）",
      language: "text",
      code: `{
  "schema": { "...": "Kafka Connect schema，自描述；用 Avro 转换器时换成 schema id" },
  "payload": {
    "before": {                       // 变更前行数据（create 事件为 null）
      "order_id": "20260908-000123", "state": "created", "amount": 5900
    },
    "after":  {                       // 变更后行数据（delete 事件为 null）
      "order_id": "20260908-000123", "state": "paid", "amount": 5900
    },
    "source": {                       // 源元数据：这一变更在源库的坐标与时刻
      "version": "3.6.2.Final", "connector": "mysql",
      "name": "fulfillment",          // 即 topic.prefix
      "db": "bookdb", "table": "orders",
      "snapshot": false,              // true = 该事件来自快照
      "file": "mysql-bin.000003", "pos": 484,   // binlog 坐标（连接器 offset 的可见形式）
      "row": 0, "thread": 7,
      "query": null,                            // 默认不含 SQL 原文；include.query=true 才携带（本课骨架未开启）
      "ts_ms": 1788861600000                    // 变更发生在数据库的时刻（源端时间，2026-09-08T10:00:00Z）
    },
    "op": "u",                        // 操作类型：c=create u=update d=delete
                                      //   r=read(仅快照) t=truncate
    "ts_ms": 1788861600423            // 连接器处理/发出该事件的时刻（处理端时间）
  }
}`,
    },
    {
      type: "paragraph",
      text: "需要记住的要点：`op` 字段标记操作类型——`c`（insert）、`u`（update）、`d`（delete）、`r`（快照期导出的行，仅快照阶段）、`t`（TRUNCATE，事件无 key）；**delete 事件之后连接器还会跟发一条同 key、value 为 null 的 tombstone**（`tombstones.on.delete` 默认 true），好让 compacted 主题能把已删行彻底清掉（机制同第 2 章 compact 语义，与第 5 章死信无关）。`source` 段里的 `file`/`pos` 就是这条变更的 binlog 坐标，而 `source.ts_ms`（库里的时刻）与顶层 `ts_ms`（连接器发出的时刻）之差就是**端到端滞后**——监控滞后的标准信号，第 9 章[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)会再见到它。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "消息带完整 schema：又大又自描述",
      body: "事件里 before/after 各含整行所有列，加 schema 信封后，单条消息体积往往是那一行数据的数倍（官方文档原话：JSON 表示含 schema+payload，常远大于行本身）。降体积的官方建议是用 Avro 转换器（schema 进 Schema Registry、线上只传 schema id，见第 6 章 [Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)）。另外注意：**事件里没有主键变更的三段式**——UPDATE 改了主键列时，连接器不发 `u`，而是发「旧 key 的 delete + tombstone + 新 key 的 create」三个事件并带 `__debezium.oldkey/newkey` 消息头，消费端按删除+新增处理即可。",
    },
    {
      type: "heading",
      text: "配置骨架：把连接器注册进 Connect",
    },
    {
      type: "paragraph",
      text: "下面是官方文档「MySQL connector configuration example」的配置（键与含义逐一对照文档），通过 REST `POST /connectors` 提交给 Connect 集群即完成注册。本课配置骨架以 Debezium 3.x 为准：连接参数仍是 `database.hostname`/`database.port`/`database.user`/`database.password`（3.6 文档原文），逻辑名是 `topic.prefix`，schema history 主题用 `schema.history.internal.*`（Debezium 2.0 前叫 `database.history.kafka.topic`，已改名）：",
    },
    {
      type: "code",
      title: "Debezium MySQL 连接器配置骨架（摘自 3.6 官方文档示例，书舟化）",
      language: "json",
      code: `{
  "name": "orders-mysql-connector",
  "config": {
    "connector.class": "io.debezium.connector.mysql.MySqlConnector",
    "database.hostname": "192.168.99.100",
    "database.port": "3306",
    "database.user": "debezium",
    "database.password": "dbz",
    "database.server.id": "184054",
    "topic.prefix": "fulfillment",
    "database.include.list": "bookdb",
    "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
    "schema.history.internal.kafka.topic": "schemahistory.fulfillment",
    "include.schema.changes": "true"
  }
}`,
    },
    {
      type: "table",
      caption: "骨架里每个键的含义（按 3.6 官方文档逐条核对）",
      headers: ["配置键", "含义与注意"],
      rows: [
        ["`connector.class`", "固定为 `io.debezium.connector.mysql.MySqlConnector`（文档原话 Always specify）。"],
        ["`database.hostname` / `database.port` / `database.user` / `database.password`", "连 MySQL 的地址与专用账号（就是前面 GRANT 的那个）；端口默认 3306。"],
        ["`database.server.id`", "连接器伪装成 MySQL 副本时用的 server id，必须与库内其它复制客户端（含其它连接器实例）互不相同（文档：必须在该 MySQL 集群所有运行中的复制进程里唯一）。"],
        ["`topic.prefix`", "这台 MySQL 的逻辑命名空间，决定所有输出主题名前缀；全局唯一、设后不可改（见前文）。"],
        ["`database.include.list` / `table.include.list`", "按正则白名单限定捕获范围（还有对应的 exclude 版）。默认捕获所有库的表；文档提醒 include 与 exclude 不能同设。"],
        ["`schema.history.internal.kafka.bootstrap.servers` + `schema.history.internal.kafka.topic`", "内部 schema history 主题的地址与名字（单分区！），连接器用它记录/恢复表结构历史。"],
        ["`include.schema.changes`", "是否把 DDL 变更作为事件发到「与 topic.prefix 同名」的 schema change 主题（默认 true）——消费方需要的 DDL 通知走这里（见下节）。"],
      ],
    },
    {
      type: "paragraph",
      text: "另外两个高频键顺手记住：`snapshot.mode`（默认 `initial`，可选 `always`/`initial_only`/`when_needed` 等）决定快照触发条件；`tasks.max` 对 MySQL 连接器写了也没用——文档原话：**「MySQL 连接器总是使用单个 task，修改默认值无效」**。一个库一个连接器实例，别指望 tasks.max 拆分。",
    },
    {
      type: "heading",
      text: "与 Outbox 的决策衔接：加深两个维度",
    },
    {
      type: "paragraph",
      text: "第 6 章[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)给了 Outbox 与 CDC 的概览对比。这里不重复那张表，只从 CDC 实践暴露出的两个维度**加深**——它们正是选错方案后最痛的返工点。",
    },
    {
      type: "table",
      caption: "Outbox vs CDC 加深：schema 演进与事件语义由谁负责",
      headers: ["加深维度", "Outbox（业务发事件）", "CDC（Debezium）", "工程后果"],
      rows: [
        ["schema 演进谁管", "事件契约由业务团队显式设计，在 Schema Registry 里受控演进（加字段→兼容检查→发布）", "事件结构 = 表结构，**由 DDL 自动驱动**：ALTER TABLE 立刻改变之后事件的 before/after 字段", "CDC 流的下游必须有应对「结构随时变」的机制：schema change 主题订阅、SR 兼容策略、或「新列可有可无」的宽容消费；Outbox 的演进节奏是可控的、发版式的"],
        ["你需要领域事件吗", "要：order.paid 这种「已发生业务事实」，消费方按业务语义订阅，事件名/载荷与表解耦", "不要领域语义也行：你只要「某表变了」的数据事实，语义留给消费方自己解释", "下游是业务服务（通知/结算）→ Outbox 事件更贴；下游是数据管道（数仓/搜索/读模型重建）→ CDC 流更贴"],
        ["要不要改造源系统", "业务库要加 outbox 表 + 业务代码写事件", "源库零改造，但 DBA 要开 binlog/授权；**第三方或老系统的表也能抓**（没有 outbox 可用）", "遗留系统/外部系统数据集成几乎只能选 CDC"],
        ["事件完整性", "只发业务方选择发的事件（可能漏发不发的事件）", "全部行的全部变更（含你没预料到的表和列），信息完整但噪音多", "CDC 适合「全量真相」，Outbox 适合「精选语义」；把 CDC 主题 compact 后可当「表的镜像」"],
        ["幂等负担", "事件按业务键幂等（第 5 章套路）", "同表同行的重复变更也照发，消费端处理「先 10 后 20」这类乱序/重复要靠键与状态", "两者都是 at-least-once，消费端幂等是共同必修；CDC 因为事件更原始，幂等设计更要围绕业务键"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "它们不是二选一，而是两层",
      body: "成熟架构常见共存形态：**Debezium 把订单库的每一行变更变成 `fulfillment.bookdb.orders` 主题（数据事实层），业务服务消费它、结合领域逻辑，再通过 Outbox 发出 `order.paid` 等语义事件（领域事件层）**；数仓/搜索直接吃 CDC 流，业务下游吃领域事件。CDC 是「捕捉」，Outbox 是「表达」，中间差着一层你自己的业务解释——这也是第 10 章订单管道项目里会动手验证的分层。",
    },
    {
      type: "heading",
      text: "生产运维坑：五个高频翻车点",
    },
    {
      type: "subheading",
      text: "坑一：DDL 变更——表结构变了，事件结构跟着变",
    },
    {
      type: "list",
      items: [
        "**机制**：ALTER TABLE 出现在 binlog 里，连接器解析后更新内存表结构，之后的 before/after 立即带上新列；同时按 `include.schema.changes=true` 把 DDL 事件发到**与 topic.prefix 同名**的 schema change 主题（载荷含 `ddl` 原文与结构化 `tableChanges`，文档提醒该消息格式仍处孵化期、可能变动）。",
        "**内部 schema history 主题**：单分区、仅供连接器使用、不要删不要订——删了它连接器重启后无法重建历史表结构，恢复即失败。",
        "**下游契约**：CDC 事件结构由 DDL 驱动，消费端要做好结构演进准备：订阅 schema change 主题做程序化应对，或给 topic 挂 Schema Registry 兼容检查（把「列结构漂移」变成可审计的演进）；schema 演进规则本身回顾第 6 章[事件建模与兼容性思维](/courses/kafka/lessons/kafka-event-modeling)。",
        "**在线 DDL 工具**：gh-ost / pt-online-schema-change 会产生辅助表与改名过程，官方文档要求连接器配置覆盖这些辅助表、或加 SMT 过滤掉不需要的记录。",
        "**操作纪律**：与 DBA 约定 DDL 走变更窗口；连接器对不可解析 DDL 默认 fail（`schema.history.internal.skip.unparseable.ddl=false` 是安全默认），不要为了省事开 skip。",
      ],
    },
    {
      type: "subheading",
      text: "坑二：重复投递与幂等消费",
    },
    {
      type: "paragraph",
      text: "CDC 管道是标准 at-least-once：连接器把事件写进主题与把 binlog 进度记入 offset 之间隔着提交周期，崩溃/再平衡/手动重放都会让**最近一段或整段事件重复**。消息里的 `source.file`/`source.pos` 给出这条变更在 binlog 里的坐标（`source.row` 是同一事件内的行号），可用于审计、定位重放位置、做事件级查重的参考坐标；但生产幂等仍按第 5 章结论以业务键为准：**用业务键（order_id 等）建唯一约束/处理记录表，与业务写同库事务**——从死信或历史重放换来的「同一个业务事实的重复事件」才会被正确吸收（详见[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）。",
    },
    {
      type: "subheading",
      text: "坑三：连接器任务分布与再平衡",
    },
    {
      type: "paragraph",
      text: "MySQL 连接器单 task 运行在 Connect 集群的**某一个** worker 上（`tasks.max` 无效是文档明说的）。worker 增删时连接器随集群再平衡在 worker 间迁移：迁移不丢进度，因为 offset（binlog 坐标）在 `connect-offsets` 主题里，新 worker 接手后从记录位置续读。要并行抓多台 MySQL 或分库，就注册多个连接器实例（`name` 与 `topic.prefix` 各自唯一），每个实例仍是单 task——这是 MySQL 连接器的并行边界：**并行单位是「库/实例」，不是「表」**。",
    },
    {
      type: "subheading",
      text: "坑四：大表快照",
    },
    {
      type: "list",
      items: [
        "**快照会碰锁**：默认 `snapshot.locking.mode=minimal` 只在初始阶段短暂持全局读锁，之后靠 REPEATABLE READ 事务保证一致性视图——但大表 SELECT 期间长事务会拖慢源库与连接器；文档也提醒可用 `snapshot.mode` 与隔离配置权衡，或改用增量快照。",
        "**快照时长必须小于 binlog 保留期**：快照要先把历史行导完才切增量；若导到一半，起步时记录的 binlog 位置已被清理（`binlog_expire_logs_seconds` 太短），连接器将无法接续——文档给的兜底是 `snapshot.mode=when_needed`（发现位置失效自动重新快照）。大表快照前先确认 binlog 保留时间。",
        "**快照中断可续**：快照因故障中断后，重启会从断点重来（连接器记录快照完成状态）；给大表加新表/无锁场景用**增量快照**（incremental snapshot，按 chunk 分批、可并发写），通过发信号触发（信号主题机制见官方文档）。",
        "**别乱调 snapshot.fetch.size**：官方文档建议保持默认（让 MySQL 流式吐行）；显式设大会把整个结果集拉进内存，反而坏事。",
      ],
    },
    {
      type: "subheading",
      text: "坑五：连接器健康——它可能「还活着但已停止前进」",
    },
    {
      type: "paragraph",
      text: "连接器状态分两层看。**进程层**：`GET /connectors/{name}/status` 看 connector/task 是 RUNNING 还是 FAILED（含错误信息）；连接器遇错默认自动无限重试（`errors.max.retries=-1`），真正「处理不了的事件」按 `event.processing.failure.handling.mode`（默认 fail）处置——文档的默认哲学是「宁可停下等人处理，不悄悄跳事件」。**数据层**：连接器 RUNNING 不代表在前进——源库长时间无变更时它自然安静，这要靠**心跳**区分「没数据」和「死了」：设 `heartbeat.interval.ms` 后连接器定期向 `__debezium-heartbeat.<topic.prefix>` 主题发心跳（默认前缀 `__debezium-heartbeat`，可配）。再配合前文说的 `source.ts_ms` vs `ts_ms` 差值做滞后告警。生产 checklist 见下。",
    },
    {
      type: "heading",
      text: "生产注意事项 checklist",
    },
    {
      type: "table",
      caption: "上线前 checklist（按本课内容整理；配置名/机制出处见各小节标注的官方文档）",
      headers: ["阶段", "检查项"],
      rows: [
        ["源库准备", "binlog 开启且 `binlog_format=ROW`、`binlog_row_image=FULL`；专用账号按官方权限表授权；server-id 不与现有复制进程冲突；binlog 保留期覆盖最大快照时长；云数据库确认 binlog 开启方式（RDS 需自动备份）"],
        ["连接器配置", "`topic.prefix` 全局唯一且确定后不再改；`database.include.list`/`table.include.list` 白名单收敛范围；schema history 主题单分区、手动创建并设置足够保留；`tasks.max` 不要指望能拆 MySQL 任务"],
        ["主题规划", "按下游用途决定目标主题保留策略：重建读模型/审计用保留+可回放；只取最新状态可对 CDC 主题开 compact（delete+tombstone 配合）；表数据量大时评估 Avro+Schema Registry 压缩体积"],
        ["下游契约", "消费端幂等（业务键）；DDL 应对方案（schema change 主题订阅或 SR 兼容策略）；delete/tombstone/主键变更三段式的处理都写过用例"],
        ["运维监控", "REST status 探活 + FAILED 告警；heartbeat 断流告警（区分无数据与假死）；`source.ts_ms` 与 `ts_ms` 差值的滞后告警；快照/流式阶段指标纳入第 9 章看板；binlog 清理与磁盘监控"],
        ["变更纪律", "DDL 走窗口并与 CDC 团队同步；连接器/worker 升级按官方升级文档滚动执行；不删内部 schema history 主题；演练过「重放历史」与「重置 offset」的恢复流程"],
      ],
    },
    {
      type: "quiz",
      question:
        "书舟给 `orders` 表接上 Debezium（topic.prefix=fulfillment，库名 bookdb）。某次 UPDATE 把订单 20260908-000123 的 state 从 created 改成 paid 后，这条事件会出现在哪个主题、value 的关键字段大致是什么？",
      options: [
        "主题 `bookdb.orders`；value 里 op=u，before.state=created，after.state=paid，source.file/pos 标记 binlog 坐标",
        "主题 `fulfillment.bookdb.orders`；value 里 op=u，before.state=created，after.state=paid，delete 之后还会跟一条 tombstone",
        "主题 `fulfillment.bookdb.orders`；value 里 op=u，before.state=created，after.state=paid，before/after 各含整行数据",
        "主题 `fulfillment.orders`；value 里 op=c，after 是整行新数据，key 是订单号",
      ],
      answer: 2,
      explanation:
        "主题命名是 topic.prefix.库名.表名 → `fulfillment.bookdb.orders`；UPDATE 事件的 op=u，before/after 各含**整行**（不是只含变化的列）。tombstone 只在 delete 事件后跟发（选项 2 的表述属于 delete 场景），主键没变时不发 c/d。选项 4 缺了库名段且 op 错。",
    },
    {
      type: "keypoints",
      items: [
        "日志级 CDC 胜在完整：删除/旧值/事务顺序/DDL 全在 binlog 里，业务零改造；双写有原子性死穴（Outbox 补救），轮询看不见删除与旧值",
        "Debezium MySQL = 伪装成副本读 binlog；启动先快照（snapshot.mode 默认 initial）后流式，靠起步记下的 binlog 坐标无缝衔接；内部 schema history 主题（单分区）记录 DDL 用于重启重建表结构",
        "主题名 `<topic.prefix>.<库>.<表>`；topic.prefix 全局唯一、设后不可改（2.0 起取代 database.server.name）；key=主键，value=Envelope（before/after/source/op/ts_ms），op 为 c/u/d/r/t，delete 后跟 tombstone",
        "配置骨架以官方 3.6 文档为准：connector.class=io.debezium.connector.mysql.MySqlConnector、database.hostname 等连接参数、topic.prefix、database.include.list、schema.history.internal.kafka.topic；MySQL 连接器恒单 task",
        "与 Outbox 的加深结论：schema 演进上 CDC 由 DDL 驱动、Outbox 由业务发版控制；语义上 CDC 给数据事实、Outbox 给领域事件；成熟架构常两层共存（CDC 捕捉 → 业务解释 → Outbox 表达）",
        "五大运维坑：DDL 变更（schema change 主题 + 别删 schema history）、重复投递（at-least-once，业务键幂等）、任务分布（单 task，按库/实例并行）、大表快照（锁与 binlog 保留期、增量快照）、健康（status + heartbeat + 双时间戳滞后）",
      ],
    },
    {
      type: "paragraph",
      text: "至此，第 7 章把「数据集成」讲完了：Connect 是执行框架，Debezium 是最重要的连接器族。下一章进入流处理——第 8 章[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)会回答：当 CDC 事件流进来之后，你是用 Kafka Streams/ksqlDB 做持续计算，还是用 Go 自己消费处理？另外，CDC 产出的主题正是第 10 章订单管道项目里「数据事实层」的原料，届时会回来用这条管道做端到端演练。",
    },
  ],
};
