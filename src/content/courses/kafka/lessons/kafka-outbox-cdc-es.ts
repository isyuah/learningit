/* ==================================================================
 * 课时：事务性 Outbox、CDC 与事件溯源（kafka-outbox-cdc-es）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 6 章第三课：把第 5 章“跨系统原子性不可兼得”的结论落地为三种
 * 集成模式。Debezium Outbox SMT 与 CDC 消息结构按官方文档口径核对；
 * CDC 与 Connect 细节归属第 7 章，本课只做衔接与决策。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "业务库与 Kafka 的原子一致：双写问题的拆解、事务性 Outbox（表结构 + 两种 relay）、Outbox 与 CDC 的决策，以及事件溯源/CQRS 的边界。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课给了你事件的样子（信封、兼容性）和契约的管理（Schema Registry），但还欠一个最要命的工程问题：**事件是怎么被可靠地“生产”出来的？**书舟下单时，订单服务要在自己的数据库里写订单，还要让 `notify`、`analytics` 等下游看到一条 `order.created`——「写数据库」和「写 Kafka」这两件事，怎么保证一致？第 5 章[投递语义课](/courses/kafka/lessons/kafka-delivery-semantics)已经预告过结论：**Kafka 事务覆盖不到数据库，数据库事务覆盖不到 Kafka，跨系统原子性不可兼得**，所以不能用「一个事务包两个系统」的幻想解决问题。这一课讲三个真正成立的工程模式：事务性 [Outbox](glossary:outbox)（发件箱）、[CDC](glossary:cdc)（变更数据捕获，Debezium），以及更激进的「把事件当存储」的事件溯源与 CQRS。学完你能回答：我的服务到底该用哪一种，以及哪一种明确不该用。",
    },
    {
      type: "heading",
      text: "双写问题的三个剧本",
    },
    {
      type: "paragraph",
      text: "「写完订单表，再发一条 order.created」，这个朴素方案叫**双写**。它有两个独立的写目标，任何一次崩溃/失败都可能让它们不一致：",
    },
    {
      type: "table",
      caption: "双写的三个失败剧本（书舟下单场景）",
      headers: ["顺序", "剧本", "后果"],
      rows: [
        ["先写库，后发 Kafka", "订单已落库，进程在 Produce 前/中崩溃，或 Kafka 暂不可用", "丢事件：订单存在，下游（通知/分析）永远不知道——用户没收到任何通知"],
        ["先发 Kafka，后写库", "事件已发出，写库失败或崩溃", "幻影事件：下游看到 order.created，回查订单却不存在；补偿逻辑复杂且容易再错"],
        ["两段都做，但中间崩溃", "库写了、Kafka 也写了，但恰好在下游处理时重试/重放", "至少一次的重复问题（第 5 章已解决）叠加：不是一致性问题，但让你误以为「双写偶尔也能成」"],
      ],
    },
    {
      type: "paragraph",
      text: "剧本一和剧本二的本质是同一个：**两个系统没有共同的事务边界，就无法原子提交**。解决思路不是发明「分布式事务」，而是**让 Kafka 的写入变成一个可以从数据库侧恢复的副作用**——先把「待发布的事件」和业务数据写进**同一个数据库事务**，再让一个独立的进程（relay）把事件发布出去。数据库事务提交成功 = 事件一定在待发布队列里；relay 可以崩溃、可以重试，事件不丢不重地到达 Kafka 由发布与消费语义保证。这就是 [Outbox（发件箱模式）](glossary:outbox)。",
    },
    {
      type: "heading",
      text: "Outbox 表结构：把“待发事件”变成一行数据",
    },
    {
      type: "code",
      title: "outbox_events 表（PostgreSQL；自建轮询 relay 的通用形态）",
      language: "sql",
      code: `CREATE TABLE outbox_events (
  id             UUID PRIMARY KEY,   -- 事件 id，即信封里的 event_id；全局去重键
  aggregate_type TEXT NOT NULL,      -- 聚合类型，如 'order'
  aggregate_id   TEXT NOT NULL,      -- 聚合 id，如 '20260908-000123'；发布时作消息 key
  event_type     TEXT NOT NULL,      -- 事件类型，如 'order.created'
  payload        JSONB NOT NULL,     -- 完整事件信封 JSON（含 event_id/occurred_at/...）
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ         -- relay 的发布标记；用 CDC 取数时不要此列（见下）
);

-- 轮询 relay 的取数索引：只看未发布行
CREATE INDEX idx_outbox_unpublished ON outbox_events (created_at)
  WHERE published_at IS NULL;`,
    },
    {
      type: "paragraph",
      text: "设计要点逐条说：`payload` 存的是**完整信封**（上一课定的 `event_id`/`type`/`occurred_at`/`payload` 都在里面），relay 因此保持「哑」——它不拼事件、不解释业务，原样搬字节，搬什么由写库的应用决定；`aggregate_id` 与消息 key 对应（同订单事件同分区有序）；`event_type` 与信封里的 type 冗余，是为了让 relay/运维按类型路由与排查时不用解析 JSON；`id` 是事件的唯一键——它既是「幂等发布后消费端去重」的依据，也是 relay 崩溃重试时保证同一事件只产生同一条消息的锚点。",
    },
    {
      type: "code",
      title: "下单事务：业务写 + Outbox 行，同一数据库事务（示意骨架）",
      language: "go",
      code: `// 订单服务：处理“下单”请求（HTTP/命令入口）时的写路径。
// 关键：订单行与 outbox 行在同一个 tx 里提交——要么都成，要么都回滚。
func createOrder(ctx context.Context, db *sql.DB, o orderInput) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // 提交成功后 Rollback 是 no-op

	// 1) 业务写：订单主表（示意，省略明细表）
	if _, err := tx.ExecContext(ctx,
		\`INSERT INTO orders (order_id, user_id, amount_cents, currency, status)
		 VALUES ($1, $2, $3, $4, 'created')\`,
		o.OrderID, o.UserID, o.AmountCents, "CNY"); err != nil {
		return err
	}

	// 2) 同一事务写 Outbox 行：事件信封 JSON 原样存入 payload 列
	envelope, err := json.Marshal(orderCreatedEvent{
		EventID:    o.EventID,        // 由调用方生成（UUID），重试同一请求必须复用同一个
		Type:       "order.created",  // 事件类型
		OccurredAt: o.OccurredAt,     // 业务事实时间（UTC RFC3339）
		Version:    1,
		OrderID:    o.OrderID,
		Payload:    o.Payload,
	})
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		\`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
		 VALUES ($1, 'order', $2, 'order.created', $3)\`,
		o.EventID, o.OrderID, envelope); err != nil {
		return err
	}

	// 3) 一起提交：此刻才对外可见“订单已建 + 事件待发”
	return tx.Commit()
}`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "invariant：事务提交 ⟺ 事件进了待发布队列",
      body: "这套写法的全部价值浓缩成一句话：**数据库事务成功提交，等价于这条事件已经安全地进入了待发布队列（outbox 表）；事务回滚，事件也随之消失。**两个系统间不再有“半成功”状态。之后事件能不能尽快、恰好一次地到达 Kafka，是 relay 与消费端语义的职责（下一节），与业务事务彻底解耦——第 5 章那句「数据库事务覆盖不到 Kafka」在这里被绕开，而不是被违反。",
    },
    {
      type: "heading",
      text: "Relay：两种取数实现",
    },
    {
      type: "paragraph",
      text: "Outbox 表只是队列，把行搬进 Kafka 的组件叫 **relay（中继）**。两种主流实现，区别在「怎么发现新行」：",
    },
    {
      type: "subheading",
      text: "方式一：轮询 + 标记/删除（应用内自建 relay）",
    },
    {
      type: "paragraph",
      text: "自己写一个循环：定时查 `published_at IS NULL` 的行，发布到 Kafka，再把 `published_at` 置为当前时间（或直接删行）。发布用第 1 章的 `ProduceSync`（同步等结果，成功才标记），循环结构如下：",
    },
    {
      type: "code",
      title: "轮询 relay 骨架（database/sql + franz-go；示意，事务边界见注释）",
      language: "go",
      code: `func runRelay(ctx context.Context, db *sql.DB, cl *kgo.Client) {
	for {
		// 1) 捞一批未发布行；SKIP LOCKED 让并发 relay 实例不抢同一批
		rows, err := db.QueryContext(ctx, \`
			SELECT id, aggregate_id, event_type, payload
			FROM outbox_events
			WHERE published_at IS NULL
			ORDER BY created_at
			LIMIT 100
			FOR UPDATE SKIP LOCKED\`)
		if err != nil {
			log.Printf("poll outbox: %v", err)
		} else {
			var pending []outboxRow
			for rows.Next() {
				var r outboxRow
				if err := rows.Scan(&r.ID, &r.AggregateID, &r.EventType, &r.Payload); err != nil {
					log.Printf("scan: %v", err)
					continue
				}
				pending = append(pending, r)
			}
			rows.Close() // 关闭后行锁即释放（autocommit）

			// 2) 逐条发布（Kafka 网络调用放在 DB 事务之外）
			for _, r := range pending {
				res := cl.ProduceSync(ctx, &kgo.Record{
					Topic: "orders.events", // 书舟订单事件主题；也可按 event_type 路由
					Key:   []byte(r.AggregateID),
					Value: r.Payload, // 信封 JSON 原样发布
				})
				if res.FirstErr() != nil {
					log.Printf("publish %s failed: %v（留待下轮重试）", r.ID, res.FirstErr())
					continue
				}
				// 3) 发布成功才标记已发布
				if _, err := db.ExecContext(ctx,
					\`UPDATE outbox_events SET published_at = now() WHERE id = $1\`, r.ID); err != nil {
					log.Printf("mark published %s: %v", r.ID, err)
				}
			}
		}

		// 4) 轮询间隔：短则延迟低、长则 DB 压力小，按延迟要求调
		select {
		case <-time.After(200 * time.Millisecond):
		case <-ctx.Done():
			return
		}
	}
}`,
    },
    {
      type: "callout",
      variant: "note",
      title: "Relay 的投递语义：至少一次 + 消费端幂等（与第 5 章严丝合缝）",
      body: "看第 2、3 步之间的窗口：Kafka 已确认、`published_at` 还没写就崩溃——下轮重捞同一行，**同一事件被发布两次**。反过来「先标记后发布」会丢事件（标记了却没发出去）。所以 relay 的诚实定位是 **at-least-once 发布**：同一条 outbox 行可能被发布多遍，`event_id` 不变。这不增加新负担——Kafka 管道本来就是 at-least-once，消费端按信封里的 `event_id` 幂等（第 5 章[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)的唯一键/处理记录表方法原样适用）。想缩窄重复窗口，可引入 `status` 状态机（捞取即置 `publishing`，超时回收），但消费端幂等依然是底线，别指望发布侧做到不重。",
    },
    {
      type: "subheading",
      text: "方式二：事务日志 CDC（引出 Debezium）",
    },
    {
      type: "paragraph",
      text: "轮询有两个先天弱点：轮询间隔带来秒级延迟；SELECT 轮询与业务读写抢数据库资源。第二种实现换了个思路——**不查表，读日志**：数据库的复制/事务日志（PostgreSQL 的 WAL、MySQL 的 binlog）本来就记录了每一行插入，让一个专门的连接器订阅日志、把 outbox 表的 INSERT 转成 Kafka 消息。这就是 [CDC（变更数据捕获）](glossary:cdc)，最著名的实现是 [Debezium](https://debezium.io/)（基于第 7 章的 Kafka Connect 运行）。对 outbox 场景，Debezium 提供开箱的 **Outbox Event Router SMT**（配置名 `io.debezium.transforms.outbox.EventRouter`）：它默认期望一张列名紧凑的 outbox 表（`id`/`aggregatetype`/`aggregateid`/`type`/`payload`——概念与上面的表一一对应：id=事件 id、aggregateid=消息 key、payload=消息体），把捕获到的行转换成一个消息：`aggregateid` 作消息 key、`payload` 作消息体；列名与上面不同的团队可用 SMT 的映射选项（如 `table.field.event.key`、`table.field.event.payload`、`route.by.field`）对齐，细节第 7 章。两个提醒：CDC 路线的表是**纯插入队列**——SMT 对 UPDATE 默认只告警、DELETE 会被过滤，所以别在表上做「标记已发布」这类更新（`published_at` 列只为自建轮询 relay 服务）；以及 CDC 的部署与运维（连接器、binlog 权限、位点、DDL 处理）是一整套课题，本课只到这里，[第 7 章](/courses/kafka/lessons/kafka-connect-cdc-practice)完整展开。",
    },
    {
      type: "heading",
      text: "Outbox 之外的 CDC：直接捕获整张业务表",
    },
    {
      type: "paragraph",
      text: "CDC 的用途不止 outbox。让 Debezium 直接订阅**业务表本身**（比如整张 `orders` 表），每行 INSERT/UPDATE/DELETE 都会变成一条消息，主题按 `<连接器前缀>.<库>.<表>` 组织（命名规则细节见[第 7 章](/courses/kafka/lessons/kafka-connect-cdc-practice)），消息结构大致是：`before`（变更前）、`after`（变更后）、`source`（来源元数据：连接器/库/表/事务等）、`op`（操作：c=插入/u=更新/d=删除，快照阶段为 r）、`ts_ms`（变更时间）。这条路线下应用代码**零侵入**——不用写 outbox、不用改事务——但产出的是「数据变成了什么」，不是「业务发生了什么」：一张订单表的 UPDATE 只能告诉你金额从 5900 变 12800，告诉不了你「用户改价了」还是「运营优惠了」。",
    },
    {
      type: "heading",
      text: "决策表：Outbox（领域事件）还是 CDC（数据变更）",
    },
    {
      type: "table",
      caption: "Outbox 与 CDC 的决策对照（能支撑选型的六个维度）",
      headers: ["维度", "事务性 Outbox（自建 relay 或 Debezium Outbox SMT）", "CDC 直接捕获业务表"],
      rows: [
        ["输出语义", "领域事件：团队定义「发生了什么」（order.created 带金额/渠道/原因）", "数据变更：行级 before/after + 操作类型，只陈述「表变成了什么」"],
        ["事件 schema 归谁", "业务团队：信封结构 + Schema Registry 完全自控，可加业务字段", "数据库表结构决定：字段跟随 DDL，需另做语义映射（Debezium 有 schema 变更主题，细节第 7 章）"],
        ["业务侵入", "每个要发事件的写路径：同一事务多插一行 + 部署 relay/连接器", "应用零侵入，但引入一整套 CDC 基础设施与运维"],
        ["回放", "重新发布历史 outbox 行（保留行/清标记即可重放事件）", "快照 + 日志增量可重建任意时点整库状态（第 7 章两阶段机制）"],
        ["延迟与负载", "轮询秒级延迟 + DB 查询压力（可调）；日志捕获则近实时且不查业务表", "近实时（跟随日志），对业务库只加日志读取负担，但需 binlog/WAL 权限与保留期配合"],
        ["典型场景", "领域事件驱动：订单状态机、跨服务编排、下游需要「原因」", "数据同步/镜像：数仓入仓、搜索索引、缓存重建、审计表——下游要的是「现状」"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "快速判断：先问“我要发布的是什么”",
      body: "一句话选型：**想让别的系统对「发生了什么」做出反应（发通知、推进订单状态机、触发下一步业务）→ Outbox 领域事件；想让别的系统拥有「和业务库一致的数据」（数仓、搜索、缓存）→ CDC 整表捕获。**两者不是互斥的，真实系统常常组合：订单域用 Outbox 发 `order.created` 驱动业务流程，同时用 CDC 把订单/用户表同步给数仓做分析——它们服务不同的下游，用不同的「原料」。（一个反直觉的点：用 CDC 捕获 outbox 表（方式二）是「用 CDC 技术做 Outbox 模式」，语义上仍属于领域事件路线，因为消息内容由应用写入 outbox 时决定。）",
    },
    {
      type: "heading",
      text: "更激进的选择：事件溯源（Event Sourcing）与 CQRS",
    },
    {
      type: "definition",
      term: "事件溯源（event sourcing）",
      definition:
        "把「状态」不当作存储本体，而当作**由事件日志投影（project）出来的派生视图**：系统只追加（append-only）地存事件，当前状态 = 对事件从头到尾重放的结果。要改状态不改老事件，而是追加一条新事件（修正 = 补偿事件）。",
    },
    {
      type: "paragraph",
      text: "Outbox 与事件溯源的区别要看清：Outbox 里，业务库的**表仍然是事实源**，事件只是它的「对外广播」；事件溯源里，**事件日志本身才是事实源**，表（或任何读模型）只是方便查询的投影——删掉投影库，从事件日志能原样重建一切。这个反转带来两样东西：**完整历史**（任何时候都能回答「这个订单当时为什么变成这样」，审计与合规的圣杯）与**任意时点回放**（投影出 bug，修好从日志重建即可，不用导数据）。代价同样来自这个反转：",
    },
    {
      type: "list",
      items: [
        "**schema 演进复杂度陡增**：事件一旦落库就永存，未来所有读取方都得能解**全部历史版本**——[事件建模课](/courses/kafka/lessons/kafka-event-modeling)的「向后兼容」从「最好做到」变成「硬性要求」，事件日志里躺着 2019 年的 v1 事件，2026 年的新消费者也必须读得懂（这正是[Schema Registry 实战课](/courses/kafka/lessons/kafka-schema-registry-go)的用武之地，但版本跨度与数量远超普通消息主题）",
        "**读模型（投影）的一致性与成本**：每个查询需求都是要维护的投影（更新逻辑、重建流程、幂等）；投影落后于事件日志是常态，跨投影的一致性要靠事件顺序与幂等保证——等于把「数据库事务保证一致性」换成了「自己管理一批派生的读模型」",
        "**团队认知与调试成本**：业务逻辑散在「事件处理函数」与「投影」里，新人要理解「当前状态是重放出来的」而非「表里存的」；排查线上问题时，你面对的不是一行行的当前值，而是一串事件流",
        "**工具链成熟度**：Go 生态没有官方/主流的事件溯源框架与事件存储，投影、快照、版本迁移基本自研；相比「关系库 + Outbox」的路子，团队要自己扛更多地基",
      ],
    },
    {
      type: "paragraph",
      text: "由此得出适用边界，判断标准是：**「过去发生了什么」是不是这个领域的核心价值？**",
    },
    {
      type: "list",
      items: [
        "**适合**：账务/资金流水（每笔变动必须可审计、可回溯、可重放对账）；合同/订单这类状态机复杂且变更历史本身就是业务资产的领域；需要把业务规则以「事件序列」形式显式建模（风控、合规分析要消费完整事实链）的场景",
        "**常与 CQRS 同现但可拆分**：CQRS（命令查询职责分离）指写入走命令模型、读取走独立读模型（投影/物化视图）——它解决「读写负载差异大」的问题，可以单独使用；事件溯源天然产生「事件日志（写） + 投影（读）」的分裂，所以常一起出现，但**不是绑定关系**：可以只有 CQRS（用普通表 + 读模型），也可以只有事件溯源（单一投影或直接查事件）",
        "**明确不要用**：普通 CRUD（用户资料、配置、商品信息——改了就覆盖，历史无价值，事件化只会让每个字段改动都变成一次投影负担）；查询模式多且临时（每种查询一个投影，投影数量失控）；团队还没有事件建模经验时把 ES 当「万能状态方案」硬上；与既有报表/BI/关系型生态强绑定的系统（投入产出比最差）",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "一个常见误区：事件溯源不是「把表换成日志」这么简单",
      body: "看到「状态 = 重放事件」会觉得优雅，但请把上面四条代价读三遍：schema 演进（历史事件永存）、投影维护（每个读模型都是长期负债）、团队认知（状态不是查出来的是算出来的）、工具链（Go 自研）。业界对 ES 的主流建议是**只在能直接兑换业务价值的地方用**（账务、审计、需要完整历史的少数聚合），而不是「既然上了事件驱动就全量 ES」。务实路径是：业务库照常 + 事务性 Outbox 发领域事件（本课前半）——你已经拿到事件驱动的九成收益，剩下的「把事件当存储」在确有审计/回放刚需的局部再引入。",
    },
    {
      type: "quiz",
      question:
        "书舟的 notify 服务需要维护「用户资料当前是否有效」等信息，这类状态查询频繁、模式多、字段经常小改；有人提议把用户资料域改造成事件溯源（把每次资料变更存为事件、按需投影出各种读模型）。以下哪个判断最合理？",
      options: [
        "应该上：事件溯源是最先进的状态管理方式，能同时解决查询模式和审计问题，还能让 Kafka 物尽其用",
        "不该上：这是典型 CRUD/查询型数据——历史价值低、字段频繁微调会让历史事件 schema 迅速过时，每种查询一个投影的维护成本会拖垮小团队；普通表 + 必要时的 CDC 或 Outbox 更合适",
        "应该上，但必须搭配 CQRS，否则事件溯源没有意义",
        "可以上，只要把全部事件原样发给 Kafka，下游就能自己投影，业务侧无需任何改动",
      ],
      answer: 1,
      explanation:
        "事件溯源的判断标准是「过去发生了什么是否是核心价值」：用户资料是典型的「当前状态」数据，改动历史既无审计刚需、schema 又频繁演进（[事件建模课](/courses/kafka/lessons/kafka-event-modeling)：历史事件永存 → 所有读取方要兼容全部旧版本），为它维护多个投影属于净负债。CQRS 与 ES 可拆分（选项 3 是常见误解）；「发给 Kafka 下游自己投影」混淆了事件广播（Outbox/CDC）与事件存储——下游投影仍要处理同样的 schema 与一致性成本。",
    },
    {
      type: "keypoints",
      items: [
        "双写不可能原子：先库后 Kafka 丢事件、先 Kafka 后库出幻影事件；出路是让 Kafka 写入变成「可从数据库侧恢复的副作用」",
        "[Outbox](glossary:outbox)：业务写 + outbox 行同库同事务；事务提交 ⟺ 事件进入待发布队列，invariant 简单清晰",
        "Outbox 表：`id`（=event_id，全局去重键）/`aggregate_type`/`aggregate_id`（=消息 key）/`event_type`/`payload`（完整信封 JSON）/`created_at`（+ 轮询用 `published_at`，可空）",
        "Relay 两种取数：轮询 + 标记/删除（简单、秒级延迟、查库压力）；事务日志 CDC + Debezium Outbox SMT（近实时、零侵入但引入基础设施；表须只插不改）",
        "Relay 是 at-least-once 发布：成功标记之间崩溃会重发；靠信封 `event_id` 在消费端幂等（第 5 章方法），不要追求发布侧不重",
        "Outbox vs CDC 决策看六个维度（语义/谁管 schema/侵入/回放/延迟负载/场景），核心一问：要发布「发生了什么」还是同步「现在是什么」；两者常组合而非二选一",
        "事件溯源 = 事件日志为唯一事实源、状态是投影；收益是完整历史与任意时点重建，代价是 schema 演进（历史永存）、投影维护、认知成本、工具链自研——账务/审计等「历史即价值」的领域才值得，普通 CRUD 明确不要硬上",
      ],
    },
    {
      type: "paragraph",
      text: "至此第 6 章收官：事件建模（长什么样）、Schema Registry（契约怎么管）、Outbox/CDC/ES（事件怎么可靠产生）三件套齐了。注意本课的 relay 和 CDC 其实都在做同一件事——**把 Kafka 外面的数据搬进来**，这正是第 7 章 [Kafka Connect](glossary:connect) 的职责范围：它把「自己写消费者/生产者搬运」变成声明式连接器，Debezium 也是跑在它上面的。下一章从 [Kafka Connect 架构与第一个连接器](/courses/kafka/lessons/kafka-connect-architecture)开始。",
    },
  ],
};
