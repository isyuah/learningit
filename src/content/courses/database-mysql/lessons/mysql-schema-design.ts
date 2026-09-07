/* ==================================================================
 * 课时：表设计实战：需求到建表与常见反模式（mysql-schema-design）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 术语约定：主键 / 外键 / 二级索引 / 回表 / 覆盖索引（详见索引章）。
 * 前置：已学过范式（mysql-normalization）与数据类型（mysql-data-types）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-schema-design",
  "courseSlug": "database-mysql",
  "title": "表设计实战：需求到建表与常见反模式",
  "summary": "把业务需求一步步翻译成表结构：识别实体与关系、选键、加约束与索引，并躲开常见反模式。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "范式回答的是「某张表本身是否规范」，而表设计要回答「整个库要建哪些表、它们之间怎么关联、字段怎么定」。这一课我们把电商订单库的需求从头翻译成 schema，讲清楚一套可复用的步骤：识别实体与关系 → 选主键 → 定字段与类型 → 加约束与外键 → 补索引。然后集中过一遍真实项目里最容易踩的五个反模式。"
    },
    {
      "type": "heading",
      "text": "第 1 步：从需求里识别实体（Entity）与关系（Relationship）"
    },
    {
      "type": "paragraph",
      "text": "先不碰键盘，先把自然语言需求里的「名词」圈出来——它们多半是实体（entity），就是要建成表的主题；名词之间的动词则是关系。以 shop 的需求为例："
    },
    {
      "type": "list",
      "items": [
        "「用户」可以下「订单」：用户 1:N 订单",
        "一个「订单」包含多件「商品」：订单 1:N 订单明细，订单明细 1:1 某个商品",
        "「商品」与「订单明细」的关系是多对多经由明细表表达：一个商品可出现在多个订单，一个订单含多个商品",
        "「订单」对应「支付」流水：订单 1:N 支付（可能分次支付/退款）"
      ]
    },
    {
      "type": "definition",
      "term": "一对多（1:N）与多对多（N:M）",
      "definition": "「一个用户有多张订单」是 1:N，我们把「多」的那一端（orders.user_id）存成外键。「一个订单含多个商品、一个商品又属于多个订单」是 N:M，关系模型里必须拆成一张关联表（junction table）来承载，本库即 order_item——它本质上就是订单与商品的关联加上本次购买的数量与成交价。"
    },
    {
      "type": "heading",
      "text": "第 2 步：把关系翻译成表与外键列"
    },
    {
      "type": "paragraph",
      "text": "三类关系的落地规则很固定：1:N 在「多」端加一个外键列（`orders.user_id`）；N:M 建一张中间表（`order_item`）并各放一个外键（`order_id`、`product_id`）；1:1 通常把外键放在任意一端，或用同一主键。中间表还可以带上关系自身的属性——`order_item` 的 `quantity` 和 `price` 就属于「某次购买」而不属于商品或订单任何一方。"
    },
    {
      "type": "code",
      "title": "实体与关系的落表草稿",
      "language": "sql",
      "code": "-- 概念草图（先想清楚，再定类型细节）：\n--   user      id, name, email, created_at\n--   orders    id, user_id(FK->user), status, total_amount, created_at\n--   order_item id, order_id(FK->orders), product_id(FK->product), quantity, price\n--   payment   id, order_id(FK->orders), amount, method, paid_at\n\n-- 关系落地要点：\n-- 1:N：orders.user_id 存 user 的 id\n-- N:M：order_item 一张中间表，两个外键都建索引\n-- 1:N：payment.order_id 引用 orders 的 id"
    },
    {
      "type": "heading",
      "text": "第 3 步：选主键（Primary Key）"
    },
    {
      "type": "paragraph",
      "text": "主键的选择关乎整棵 B+ 树聚簇索引的结构（下一章细讲），这里先建立三个工程原则：优先自增整型主键、避免「有业务含义」的键做代理主键、符合唯一性需求再补唯一约束。为什么倾向自增 BIGINT？因为 InnoDB 的聚簇索引按主键顺序排列，自增主键会让新行「追加到末尾」，减少页分裂与随机写；而像 email、order_no 这种字符串或带业务语义的键，既更长又可能变化（用户改邮箱），不适合当代理主键。"
    },
    {
      "type": "code",
      "title": "主键与唯一约束的配合",
      "language": "sql",
      "code": "CREATE TABLE user (\n    id       BIGINT AUTO_INCREMENT PRIMARY KEY, -- 代理主键：只用来唯一标识一行\n    email    VARCHAR(128) NOT NULL,\n    -- 一个邮箱只能注册一次：用唯一约束而不是当主键\n    UNIQUE KEY uk_email (email)\n);\n\n-- 备忘：BIGINT 最大约 9.2e18，自增在绝大多数业务里不会耗尽；\n-- 但仍应警惕「接近上限前就设计好换型/归档」——见 mysql-data-types 一课。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别把自然业务号当物理主键",
      "body": "订单号、身份证、邮箱都不宜直接做聚簇索引主键：它们可能是字符串（更大、乱序插入导致页分裂），也可能在业务上会变（用户改绑邮箱→要连带改关联表）。正确姿势是永远用自增/序列生成的无意义 id 当主键，把「业务上的唯一」用 UNIQUE 约束声明。"
    },
    {
      "type": "heading",
      "text": "第 4 步：加约束：NOT NULL、默认值、CHECK、外键"
    },
    {
      "type": "paragraph",
      "text": "约束是数据库替你兜底的「不变量」。能在数据库层声明的，就不要只依赖应用层的自觉。NOT NULL 表达「必须有值」，DEFAULT 表达「没给时的兜底」，CHECK 表达取值范围。外键（FOREIGN KEY）表达引用完整性；但注意 InnoDB 上外键会带来额外的 DML 检查开销，很多高吞吐表会刻意省略物理外键而只在应用层保证引用关系——这是需要权衡的工程决策，面试也常问。"
    },
    {
      "type": "code",
      "title": "用约束把业务规则落进库",
      "language": "sql",
      "code": "CREATE TABLE orders (\n    id           BIGINT AUTO_INCREMENT PRIMARY KEY,\n    user_id      BIGINT NOT NULL,             -- 订单必须属于某个用户\n    status       VARCHAR(16) NOT NULL DEFAULT 'pending'\n                   CHECK (status IN ('pending','paid','shipped','completed','cancelled')),\n    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,\n    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    KEY idx_user (user_id)                    -- 按用户查订单的高频路径，见下\n    -- 外键可选项：FOREIGN KEY (user_id) REFERENCES user(id)\n);"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "CHECK 在 MySQL 5.7 的坑（版本敏感）",
      "body": "MySQL 5.7 会「解析但不强制」CHECK 约束，8.0.16 起才真正强制。如果你的库还是 5.7，别指望 CHECK 挡住坏数据——要在应用层校验，或用外键/触发器兜底。这一例属于「版本敏感行为」，写文档或面试时都要先确认目标版本。"
    },
    {
      "type": "heading",
      "text": "第 5 步：为查询补索引：先看 WHERE / JOIN / ORDER BY"
    },
    {
      "type": "paragraph",
      "text": "索引不是越多越好（每个索引都要占空间、拖慢写入），而是「为真实查询而建」。最朴素的方法是找高频 SQL 里 WHERE、JOIN 上的列，以及 ORDER BY/GROUP BY 用到的列。本库 `orders.idx_user(user_id)` 就是为「查某用户的所有订单」这类查询建的；`order_item.idx_order(order_id)` 是为「按订单取明细」建的。"
    },
    {
      "type": "code",
      "title": "为什么这两个索引长这样",
      "language": "sql",
      "code": "-- 高频查询 1：某用户的所有订单\nSELECT * FROM orders WHERE user_id = 42 ORDER BY created_at DESC;\n--   -> 需要 (user_id) 索引；如果再高频按时间排序，可考虑 (user_id, created_at) 联合索引\n\n-- 高频查询 2：某订单的所有明细\nSELECT * FROM order_item WHERE order_id = 100;\n--   -> 需要 (order_id) 索引\n\n-- 关联查询依赖两边的索引保持良好\nSELECT o.id, oi.product_id, oi.quantity\nFROM orders o\nJOIN order_item oi ON oi.order_id = o.id\nWHERE o.user_id = 42;"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "索引细节留给下一章，这里只要会「识别」",
      "body": "本课只负责「在字段/关系层面想清楚哪列需要索引」。为什么要用二级索引、什么时候会「回表」、联合索引的「最左前缀」怎么生效、覆盖索引如何避免回表，全部在索引章（B+ 树、聚簇/二级索引、索引设计）展开。现在记住结论即可：每个外键列一般都要建索引，否则 JOIN 会退化成全表逐行扫描。"
    },
    {
      "type": "heading",
      "text": "常见反模式 1：用逗号分隔的列表存一对多"
    },
    {
      "type": "code",
      "title": "反模式：一张表里用逗号拼 ids",
      "language": "sql",
      "code": "-- 错误：把多值塞进一个字段\nCREATE TABLE order_tags_bad (\n    order_id BIGINT PRIMARY KEY,\n    tag_ids  VARCHAR(200) -- 例：'3,7,21' 一个字段\n);"
    },
    {
      "type": "paragraph",
      "text": "这几乎是范式课上 1NF 违例的实战翻版。它的致命点不是「不能存」，而是「存了之后的一切查询都会很难受」：按单个 id 过滤无法用索引（要 FIND_IN_SET 或 LIKE，全表扫）、无法做 join、无法加唯一约束保证不重复。正确做法永远是把多值拆行：要么一张子表（`order_item`），要么一张真正的关联表（`order_tag`）。"
    },
    {
      "type": "heading",
      "text": "常见反模式 2：用 VARCHAR 存数字和日期"
    },
    {
      "type": "code",
      "title": "反模式：身份证号/金额/日期用字符串",
      "language": "sql",
      "code": "-- 错误 1：金额用字符\n--   '9.9' 与 '9.90' 是不同字符串；排序按字典序（'100'<'20'）\nCREATE TABLE pay_bad (\n    id     BIGINT PRIMARY KEY,\n    amount VARCHAR(20)  -- 金额绝不该用字符串\n);\n-- 错误 2：日期用字符串\n--   无法使用 DATETIME 的区间比较/索引优化，时区也难处理\nCREATE TABLE log_bad (\n    id  BIGINT PRIMARY KEY,\n    ts  VARCHAR(32)     -- 应用 DATETIME/TIMESTAMP\n);"
    },
    {
      "type": "paragraph",
      "text": "用 TEXT/VARCHAR 存数字的最大问题：排序和比较是基于字符的，`'20'` 会大于 `'100'`，`'9.9'` 不等于 `'9.90'`，聚合函数（SUM/AVG/MAX）语义也全乱。存日期同理，无法高效做 `BETWEEN`、`DATE_ADD` 或靠索引做范围扫描。选择正确的数值/时间类型（见 mysql-data-types 一课），跑通「存得对、查得快、不搞错比较」三条线。唯一合理的「数字当字符串」是像手机号、身份证号这类「只展示、从不算」的标识——偶尔可用字符串避免前导零丢失，但也要接受排序/匹配的代价。"
    },
    {
      "type": "heading",
      "text": "常见反模式 3：可变冗余汇总字段却不同步"
    },
    {
      "type": "paragraph",
      "text": "范式课里我们认可了 `orders.total_amount` 这类「只增订单」下的快照式冗余，但要小心它滑向真正的错误：**存一个随明细而变的可推导值，却没有一套强制同步机制**。比如「商品库存 stock」「订单总额」「用户未读消息数」，如果业务上会频繁变动，而你对每条相关写路径都「忘了更新」，就会得到范式课里那种自相矛盾的数据。"
    },
    {
      "type": "code",
      "title": "库存这种高变更冗余的正确姿势",
      "language": "sql",
      "code": "-- 库存是高频变动的冗余计数，其同步必须是原子的：\n-- 用条件更新 + 事务，而不是「先读再减」\nSTART TRANSACTION;\nUPDATE product\nSET stock = stock - 1\nWHERE id = 101 AND stock >= 1;   -- 条件保证不超卖\n\nIF ROW_COUNT() = 0 THEN\n    ROLLBACK;                     -- 库存不足，撤销\nELSE\n    -- 这里再插入 order_item / 更新订单总额\n    COMMIT;\nEND IF;"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "决策顺序：能不算就别存；要存就确保原子同步",
      "body": "对可变总量，按成本从低到高选：① 直接用查询现算（COUNT/SUM），最正确但读贵；② 存下来，但把「改动 + 更新冗余」放进同一个事务或同一批原子语句，保证不出现中间坏状态；③ 用异步汇总（如定期物化），接受短暂延迟。无论选哪种，都要明说「这一刻靠谁保证一致」，绝不要留下没人负责的冗余字段。"
    },
    {
      "type": "heading",
      "text": "常见反模式 4：JOIN 键上漏建索引"
    },
    {
      "type": "code",
      "title": "反模式：外键列没建索引",
      "language": "sql",
      "code": "-- 错误：order_item 上没给 order_id / product_id 建索引\nCREATE TABLE order_item_bad (\n    id         BIGINT PRIMARY KEY,\n    order_id   BIGINT NOT NULL,   -- 作为联接列却无索引\n    product_id BIGINT NOT NULL,   -- 同样无索引\n    quantity   INT,\n    price      DECIMAL(10,2)\n);\n\n-- 症状：这个 JOIN 以 orders 为驱动表时，对每行都要扫一遍 order_item 全表\n-- SELECT * FROM orders o JOIN order_item_bad oi ON oi.order_id = o.id ..."
    },
    {
      "type": "paragraph",
      "text": "JOIN 的「被驱动表」一侧如果找不到可用索引，MySQL 会对每一条驱动行去扫描整张被驱动表（嵌套循环连接），数据一多就完蛋。经验法则是：**每个会出现在 JOIN ON 条件里的列（尤其外键列）都建索引**，把「查一行」从全表扫变成索引命中（最理想是覆盖索引避免回表，但那是下一章的话题）。这是最容易排查也最好修的一类性能问题。"
    },
    {
      "type": "heading",
      "text": "常见反模式 5：EAV（实体-属性-值）表"
    },
    {
      "type": "definition",
      "term": "EAV（Entity-Attribute-Value）反模式",
      "definition": "试图「通用」地用一张 (entity_id, attribute, value) 的表去存所有实体的任意属性，即把「列」都降格成「行」。看起来灵活（加属性不用改表），但代价巨大：每个查询都要把多张行转成列（大量自连接/PIVOT）、无法对 value 建有效索引、类型也丢失（value 只能存字符串）。除非需求真的要求「运行时动态字段且数量少」，否则应立即重构为真正的列或 JSON 列。"
    },
    {
      "type": "code",
      "title": "反模式 vs 正确：可变属性",
      "language": "sql",
      "code": "-- 反模式：EAV，所有附加属性都塞成行\nCREATE TABLE product_eav (\n    product_id BIGINT,\n    attr       VARCHAR(32),\n    value      VARCHAR(255),\n    PRIMARY KEY (product_id, attr)\n);\n-- 查询'所有颜色是红色的商品'要折腾多行转列，性能与正确性都差\n\n-- 正确：属性少且固定 → 直接做列（可配合 JSON 存半结构化扩展字段）\nCREATE TABLE product (\n    id        BIGINT PRIMARY KEY,\n    name      VARCHAR(128),\n    category  VARCHAR(32),\n    price     DECIMAL(10,2),\n    stock     INT,\n    extras    JSON NULL   -- 少量、确实易变的扩展属性放 JSON，避免 5.7 无校验的坑\n);"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "什么时候 EAV 勉强可接受",
      "body": "只有当「属性集真的在运行时增长、且每次查询只需要其中少数几个、且数量不大」时才值得考虑 EAV（例如某类可插拔扩展）。即便如此也常见到它被滥用。对一般业务，优先「明确列 + 必要的 JSON 列」组合，既保类型与索引，又留扩展空间。"
    },
    {
      "type": "heading",
      "text": "把整个 shop 需求拼成最终建表脚本"
    },
    {
      "type": "paragraph",
      "text": "把所有决策串起来，就是全课程统一的 shop 建表脚本（与 course.ts 约定一致）。注意这里如何同时体现：代理主键、正确的数据类型、NOT NULL/默认值、外键列上的索引、N:M 中间表、以及类型/约束的取舍。"
    },
    {
      "type": "code",
      "title": "shop 电商订单库：规范化的完整建表",
      "language": "sql",
      "code": "CREATE TABLE user (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name       VARCHAR(64)  NOT NULL,\n    email      VARCHAR(128) NOT NULL,\n    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    UNIQUE KEY uk_email (email)\n);\n\nCREATE TABLE product (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name       VARCHAR(128) NOT NULL,\n    category   VARCHAR(32),\n    price      DECIMAL(10,2) NOT NULL,\n    stock      INT          NOT NULL DEFAULT 0,\n    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    KEY idx_category (category)\n);\n\nCREATE TABLE orders (\n    id           BIGINT AUTO_INCREMENT PRIMARY KEY,\n    user_id      BIGINT      NOT NULL,\n    status       VARCHAR(16) NOT NULL DEFAULT 'pending',\n    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,\n    created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    KEY idx_user (user_id),          -- 外键列建索引\n    KEY idx_status_created (status, created_at)  -- 后台按状态+时间查单\n);\n\nCREATE TABLE order_item (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    order_id   BIGINT       NOT NULL,\n    product_id BIGINT       NOT NULL,\n    quantity   INT          NOT NULL DEFAULT 1,\n    price      DECIMAL(10,2) NOT NULL,   -- 下单快照价\n    KEY idx_order (order_id),            -- 外键列建索引\n    KEY idx_product (product_id)\n);\n\nCREATE TABLE payment (\n    id       BIGINT AUTO_INCREMENT PRIMARY KEY,\n    order_id BIGINT       NOT NULL,\n    amount   DECIMAL(10,2) NOT NULL,\n    method   VARCHAR(16),\n    paid_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    KEY idx_order (order_id)\n);"
    },
    {
      "type": "heading",
      "text": "动手练习：把一套小需求设计成 schema"
    },
    {
      "type": "exercise",
      "title": "设计一个「课程与讲师」小库",
      "description": "需求：一个讲师可以主讲多门课程；一门课有唯一 slug、标题、价格、上架时间；一个学员可以报名多门课，一门课有很多学员；报名记录要记录报名时间。请写出 ① 实体清单与它们的关系类型；② 完整 CREATE TABLE 语句（自带主键、必要的 NOT NULL/默认值/唯一约束、合适的数据类型、外键列索引），并说明每张表主键与外键列的选择理由。",
      "hint": "讲师与课程是 1:N（课程里放 teacher_id）；课程与学员是 N:M，需要一张报名中间表（含报名时间）。课程 slug 用 UNIQUE 而不是主键；金额用 DECIMAL；每个外键列都建索引。回想「表设计五步」逐一核对。"
    },
    {
      "type": "heading",
      "text": "回顾：从需求到 schema 的五步"
    },
    {
      "type": "keypoints",
      "items": [
        "五步法：识别实体与关系 → 关系落表（1:N 加外键 / N:M 建中间表）→ 选代理主键 → 定类型与约束 → 为查询建索引",
        "主键优先自增整型；业务上的唯一用 UNIQUE 表达，别把自然业务号当主键",
        "约束（NOT NULL / DEFAULT / CHECK / 外键）是数据库替你守的不变量，但要留意 5.7 不强制 CHECK 的版本差异",
        "每个外键列 / JOIN 键通常都应建索引，否则关联查询退化为全表扫描",
        "反模式清单：逗号列表存一对多、VARCHAR 存数字/日期、可变冗余汇总不同步、JOIN 键漏索引、EAV",
        "可变总量：能不算就不存；要存就把改动与同步放进同一事务，明确谁保证一致",
        "索引的「为什么/怎么生效」留到索引章；本课只要会在建表时识别该建的索引列"
      ]
    }
  ]
};
