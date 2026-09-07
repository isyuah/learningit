/* ==================================================================
 * 课时：范式：1NF / 2NF / 3NF 与反范式（mysql-normalization）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 术语约定：主键 / 外键 / 二级索引 / 聚簇索引 / 回表 / 覆盖索引。
 * 本课属于「数据建模与表设计」章节，只讲范式；索引详见下一章。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-normalization",
  "courseSlug": "database-mysql",
  "title": "范式：1NF / 2NF / 3NF 与反范式",
  "summary": "把「同一份数据只存一份、改动只改一处」的库设计原则讲透，再讲清楚什么时候需要故意反着来。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "你已经会写 SQL 了，但「把一张表建成什么样」才是决定数据库长期健壮性的关键。范式（Normal Form，NF）是一套评判「表结构设计得好不好」的规则：它用很少的几条约束，帮你把「同一份信息重复存了很多份」这个几乎所有坏表的通病解决掉。这一课我们用电商订单库（shop）的真实例子，先看一张坏表为什么会坏，再一步步把它改造成规范的表结构，最后讨论范式与反范式的取舍。"
    },
    {
      "type": "heading",
      "text": "先看一张坏表：订单信息全塞在一张表里"
    },
    {
      "type": "paragraph",
      "text": "假设你想要「一张表查出订单的所有信息」，于是建了下面这张 `orders_flat`。它把用户、商品、订单地址统统放进一行里。初看很省事，但它埋下了多处重复数据的问题："
    },
    {
      "type": "code",
      "title": "糟糕的扁平订单表（反例）",
      "language": "sql",
      "code": "CREATE TABLE orders_flat (\n    order_id     BIGINT PRIMARY KEY,\n    user_name    VARCHAR(64),\n    user_email   VARCHAR(128),\n    category     VARCHAR(32),\n    product_name VARCHAR(128),\n    product_price DECIMAL(10,2),\n    qty          INT,\n    total_amount DECIMAL(10,2),\n    ship_city    VARCHAR(64),\n    ship_address VARCHAR(255)\n);\n\n-- 张三下单两件商品：同一单被存成两行，用户信息、收货地址重复两遍\nINSERT INTO orders_flat VALUES\n(1, '张三', 'zhang@example.com', '手机', 'iPhone 15', 5999.00, 1, 5999.00, '杭州', '西湖区文一路 1 号'),\n(1, '张三', 'zhang@example.com', '耳机', 'AirPods',      1299.00, 1, 5999.00, '杭州', '西湖区文一路 1 号');"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "注意 total_amount 已经悄悄错了",
      "body": "上面第二行的 total_amount 仍写着 5999.00，而两件商品加起来应是 7298.00。这就是反模式的一个典型恶果：可推导的汇总值被手工重复存放，一旦某处漏改，数据就自相矛盾。后面讲「反范式」时我们会回到这个字段，但要记住：任何直接复制数据的做法，都在制造不一致的可能。"
    },
    {
      "type": "heading",
      "text": "什么是范式：用最少规则灭掉重复"
    },
    {
      "type": "paragraph",
      "text": "范式是一组递进的规则：满足第一范式称为 1NF，同时满足 1NF 和更严格的条件称为 2NF，以此类推。对大多数业务系统，做到 3NF（第三范式）就已经足够规范；更高级的 BCNF、4NF、5NF 在面试里偶有提及，但工程上极少需要刻意追求。理解范式的钥匙是三个概念：**原子性（atomicity）、部分依赖（partial dependency）与传递依赖（transitive dependency）**。"
    },
    {
      "type": "definition",
      "term": "函数依赖（Functional Dependency）",
      "definition": "若给定属性组 X 的值，就能唯一确定属性 Y 的值，则称 Y 函数依赖于 X，记作 X → Y。例如在用户表里，user_id → user_name：「由 id 能确定姓名」。函数依赖是理解 2NF / 3NF 的地基——它们本质上都是在问「非主属性到底应该由谁的『主键』来决定」。"
    },
    {
      "type": "definition",
      "term": "原子性（Atomicity）",
      "definition": "在关系模型语境下，指每个字段只保存一个值、不再拆分，且不保存「一个单元格里塞多个值」（如逗号分隔的列表）。注意：这里的「原子」是指逻辑上的最小单元，与关系数据库里「事务的原子性（ACID）」是两回事，别混淆。"
    },
    {
      "type": "heading",
      "text": "第一范式（1NF）：字段原子、无重复组"
    },
    {
      "type": "paragraph",
      "text": "1NF 只要求两件事：每个字段是原子的（一个字段只存一个值）；表里不出现「重复组」（即同一行用多个字段或一个列表字段去存多个同类值）。违反 1NF 的典型是「一个订单的多个商品用逗号拼在一个字段里」："
    },
    {
      "type": "code",
      "title": "违反 1NF：逗号列表字段",
      "language": "sql",
      "code": "CREATE TABLE orders_bad (\n    order_id    BIGINT PRIMARY KEY,\n    user_name   VARCHAR(64),\n    -- 多个商品名拼进一个字段：错误\n    products    VARCHAR(500),   -- 例：\"iPhone 15, AirPods\"\n    total       DECIMAL(10,2)\n);\n\n-- 想统计「AirPods 被多少人买过」会变得极其困难\n-- 只能 LIKE '%AirPods%'，还误伤 'AirPods Pro'，索引也无法用\nSELECT COUNT(*) FROM orders_bad WHERE products LIKE '%AirPods%';"
    },
    {
      "type": "paragraph",
      "text": "为什么 1NF 要强调原子？因为把多个值塞进一个字段后，你就再也无法把它当「一个值」来比较、聚合、join 或建索引——所有对这些值做「单独操作」的需求都会被逼成全表扫描和字符串匹配。这也是我们在 schema-design 一课里会反复强调的「不要用逗号列表」的根因。解决 1NF 违例的方法，是把一对多的商品关系拆成单独的子表（一个订单多行订单明细），这正是后面 shop 里 `order_item` 的来由。"
    },
    {
      "type": "heading",
      "text": "第二范式（2NF）：消除对复合主键的部分依赖"
    },
    {
      "type": "paragraph",
      "text": "2NF 的前提是表存在复合主键（两个或以上字段共同做主键）。它要求：所有非主键字段都必须由整个主键决定，而不能只由主键的一部分决定——不能只依赖复合主键的「一部分」。"
    },
    {
      "type": "code",
      "title": "违反 2NF：订单明细表里塞了商品描述",
      "language": "sql",
      "code": "-- 复合主键：(order_id, product_id)\nCREATE TABLE order_item_bad (\n    order_id      BIGINT NOT NULL,\n    product_id    BIGINT NOT NULL,\n    qty           INT,\n    price         DECIMAL(10,2), -- 下单时的单价：确实由整组主键决定\n    product_name  VARCHAR(128),  -- 商品名：只取决于 product_id，非整组主键 → 部分依赖\n    category      VARCHAR(32),   -- 商品类目：同样只取决于 product_id\n    PRIMARY KEY (order_id, product_id)\n);\n\n-- 插入同一商品在多张订单里出现：商品名、类目被复制了 N 份\nINSERT INTO order_item_bad VALUES (1, 101, 1, 5999.00, 'iPhone 15', '手机');\nINSERT INTO order_item_bad VALUES (2, 101, 1, 5999.00, 'iPhone 15', '手机');\nINSERT INTO order_item_bad VALUES (3, 101, 1, 5999.00, 'iPhone 15', '手机');"
    },
    {
      "type": "paragraph",
      "text": "这里的 `product_name` 和 `category` 只由 `product_id` 决定——商品本身的信息不该跟「某次下单」绑定，这就是部分依赖。它的后果是经典的更新异常：iPhone 从「手机」调到「数码」时，你得把所有包含它的订单行全部 UPDATE，漏一行就数据不一致；删除某个订单又会把商品描述连带删掉（删除异常）。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "什么时候才需要考虑 2NF",
      "body": "如果一张表只有一个单一主键（比如把 `order_item` 改成有自己的 `id BIGINT PRIMARY KEY`，再用 `unique(order_id, product_id)` 防重复），那么就没有「复合主键」可言，也就不存在部分依赖。所以做到 2NF 的关键往往是：**尽量别把业务键直接做成复合主键**——这也是 shop 里 `order_item` 用自增 `id` 做主键的原因之一。"
    },
    {
      "type": "heading",
      "text": "第三范式（3NF）：消除传递依赖"
    },
    {
      "type": "paragraph",
      "text": "3NF 要求：非主键字段不能「间接地」依赖主键——即不能出现「A → B，B → C，从而 A → C」这样的传递依赖。换句话说，非主键字段之间也不能互相决定；每个非主键字段都应该只依赖于主键本身，而不是依赖于另一个非主键字段。"
    },
    {
      "type": "code",
      "title": "违反 3NF：地址细节挂在订单/用户里",
      "language": "sql",
      "code": "-- 用户表里塞了省市区，省市区之间互相决定：pass    \nCREATE TABLE user_bad (\n    id         BIGINT PRIMARY KEY,\n    name       VARCHAR(64),\n    city       VARCHAR(64),\n    province   VARCHAR(32),  -- 由 city 决定 → 对 id 而言是传递依赖\n    country    VARCHAR(32)   -- 由 city/province 决定 → 同样传递依赖\n);\n\n-- 用户有多个收货地址时，address 也不该只放两列\nCREATE TABLE orders_3nf_bad (\n    id           BIGINT PRIMARY KEY,\n    user_id      BIGINT NOT NULL,\n    ship_city    VARCHAR(64),\n    ship_zip     VARCHAR(16),\n    ship_country VARCHAR(32) -- 由 ship_city 决定，仍属传递依赖\n);"
    },
    {
      "type": "paragraph",
      "text": "传递依赖的代价同样是更新异常：如果「杭州」对应的省份从「浙江」以外写错了，你需要在每个引用它的地方逐一纠正。规范化做法是把「地区」这种能被其它字段唯一确定的信息抽成独立的维度表（如 `region` 表），用外键引用。对绝大多数业务，省份/城市这类数据变动极低频，实际工程中是否拆成维度表取决于查询形态——但理解「非主键字段之间不应互相决定」这一原则，是判断 3NF 的核心。"
    },
    {
      "type": "heading",
      "text": "把坏表规范化到合规的 shop 结构"
    },
    {
      "type": "paragraph",
      "text": "现在我们把这些原则落回本课程贯穿使用的电商订单库。把前面那张 `orders_flat` 一步拆开，就得到 course.ts 里统一约定的 shop 库。拆分的依据正是范式：用户信息抽成 `user` 表（消除重复的用户数据）、商品信息抽成 `product` 表（消除商品数据的复制）、订单与明细分离（解决 1NF 与 2NF）、订单表只保留订单本身的属性。"
    },
    {
      "type": "code",
      "title": "规范化后的正确结构（与全课程一致）",
      "language": "sql",
      "code": "CREATE TABLE user (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name       VARCHAR(64),\n    email      VARCHAR(128),\n    created_at DATETIME\n);\n\nCREATE TABLE product (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name       VARCHAR(128),\n    category   VARCHAR(32),\n    price      DECIMAL(10,2),\n    stock      INT,\n    created_at DATETIME\n);\n\nCREATE TABLE orders (\n    id           BIGINT AUTO_INCREMENT PRIMARY KEY,\n    user_id      BIGINT NOT NULL,\n    status       VARCHAR(16),\n    total_amount DECIMAL(10,2),\n    created_at   DATETIME,\n    KEY idx_user (user_id)\n);\n\nCREATE TABLE order_item (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    order_id   BIGINT NOT NULL,\n    product_id BIGINT NOT NULL,\n    quantity   INT,\n    price      DECIMAL(10,2), -- 下单时快照单价，与商品现价解耦\n    KEY idx_order (order_id)\n);"
    },
    {
      "type": "table",
      "caption": "坏表 → 规范化：每个范式修掉了什么",
      "headers": ["范式", "它要求什么", "orders_flat 违反了哪一点", "规范化后落在 shop 哪张表"],
      "rows": [
        ["1NF", "字段原子、无重复组、无列表字段", "一行塞多个商品", "订单明细拆成 order_item，一行一件商品"],
        ["2NF", "无对复合主键的部分依赖", "商品名/类目被复制", "商品信息进 product 表，明细只留 order_id + product_id"],
        ["3NF", "无传递依赖", "用户/地址信息重复存储", "用户进 user 表、产品进 product 表，订单只存 user_id 外键"]
      ]
    },
    {
      "type": "paragraph",
      "text": "注意 `order_item.price`——它存的是「下单那一刻的成交价快照」，而不是直接引用 `product.price`。这看起来像反范式，其实是刻意的设计选择：商品价格会变，但历史订单必须永远按买家实际付的钱来算。这就是「可推导值」里最容易被误读的一个：**快照（固化历史事实）和冗余（复制当前可推导值）是两回事**。"
    },
    {
      "type": "heading",
      "text": "范式化的收益：三种异常怎么被消灭"
    },
    {
      "type": "paragraph",
      "text": "当同一份事实只存一处时，之前那三种异常会自然消失。用坏表做个对比，你会更清楚范式为什么值得："
    },
    {
      "type": "list",
      "items": [
        "更新异常：商品改名/改类目只需更新 product 表一行，之前要 UPDATE 所有相关订单行且容易漏",
        "插入异常：想录入一个还没人买的商品，在坏表里做不到（没有订单就无法插入），现在 product 表随时可插",
        "删除异常：删掉唯一一条订单就会连带删掉商品/用户信息，现在每张表各自独立、互不牵连",
        "冗余：同一份用户地址、商品描述不再被复制 N 份，既省空间又杜绝「两处不一致」的问题"
      ]
    },
    {
      "type": "quote",
      "text": "数据库设计的核心目标之一，是「同一事实只在一个地方出现」。公式化地说：让每张表只保存关于一个主题的事实，并且用主键唯一确定它。",
      "source": "经验法则（RDBMS 设计常识）"
    },
    {
      "type": "heading",
      "text": "反范式（Denormalization）：什么时候故意保留冗余"
    },
    {
      "type": "paragraph",
      "text": "范式追求「不重复、好维护」，但它也有代价：要得到一张表里的完整信息，往往得多表 JOIN，而 JOIN（尤其是大表上的多表聚合）是读路径上最昂贵的操作。反范式就是**为了提高读性能而有意保留一些冗余或可推导数据**。它并非「做错了」，而是一种有意识的工程权衡——你应该在清楚代价的前提下决定是否使用。"
    },
    {
      "type": "subheading",
      "text": "典型反范式 1：冗余可推导汇总值（orders.total_amount）"
    },
    {
      "type": "paragraph",
      "text": "`orders.total_amount` 可以由 `order_item` 里的 `SUM(quantity * price)` 现场算出来——严格说它是冗余的（3NF 下它本不该存在）。但「订单列表」几乎总是要显示总额，如果每次都去 JOIN 明细表聚合，读路径会非常昂贵。于是我们把它冗余存下来，换来「SELECT orders 就能直接拿到总额」。代价是：任何明细变化（增删改、改数量/单价）都必须同步更新 `total_amount`。"
    },
    {
      "type": "code",
      "title": "同步总额：在事务里更新",
      "language": "sql",
      "code": "-- 修改某项明细后，必须保证总额一致；用事务把这件必须原子的事包起来\nSTART TRANSACTION;\n\nUPDATE order_item\nSET quantity = 2        -- 原来是 1\nWHERE id = 88 AND order_id = 100;\n\nUPDATE orders\nSET total_amount = (\n    SELECT SUM(quantity * price) FROM order_item WHERE order_id = 100\n)\nWHERE id = 100;\n\nCOMMIT;\n\n-- 也可以用一个 UPDATE + JOIN 一步完成，语义等价"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "反范式最大的风险：冗余失去同步",
      "body": "冗余字段只有在「每次相关写操作都同步更新」时才成立。最容易出问题的是：程序里有多条代码路径能改明细，却只有其中一条记得更新总额。解决思路有三：把「改明细 + 更新总额」放进同一个事务（推荐）；或干脆不存、查询时现算；或在明细变更很少、订单只增不改的场景下把它当「只在创建时算一次」的快照。永远别假设「大多数时候来得及更新就够」。"
    },
    {
      "type": "subheading",
      "text": "典型反范式 2：冗余查询友好的宽表 / 物化聚合"
    },
    {
      "type": "paragraph",
      "text": "另一类反范式是「为高频读查询预聚合」。例如商城后台要看「每个商品被买走多少件」，如果实时 GROUP BY order_item，数据量大了会慢。可以定期跑一张汇总表 `product_sales(product_id, total_qty)` 或把它并进 product 表一列。代价正是 schema-design 一课会讲的「可变的冗余计数字段容易错」——你必须在每次下单/退款时同步增减，相当于把数据库的 COUNT 逻辑搬进了应用层。"
    },
    {
      "type": "definition",
      "term": "范式 vs 反范式（何时选谁）",
      "definition": "范式优先保证「写一致性」和「少冗余」，适合写入频繁、数据必须严格一致的核心业务表；反范式牺牲一部分一致性维护成本来换取「读更快、少 JOIN」，适合读多写少、对实时一致性要求不高的报表与搜索场景。没有绝对正确，只有针对读写比与一致性强度的取舍。"
    },
    {
      "type": "table",
      "caption": "范式与反范式的取舍",
      "headers": ["维度", "范式（规范化）", "反范式（冗余）"],
      "rows": [
        ["同一事实存储", "只存一处", "复制多处 / 存可推导值"],
        ["写路径", "更新点集中、不易不一致", "写时需要同步多处，风险高"],
        ["读路径", "常需多表 JOIN", "少 JOIN、读更快"],
        ["适用场景", "写入频繁、强一致的业务核心表", "读多写少、报表/搜索类查询"],
        ["典型例子", "user / product / order_item 明细", "orders.total_amount、商品销量汇总列"]
      ]
    },
    {
      "type": "heading",
      "text": "自检测验：这张表违反了哪个范式"
    },
    {
      "type": "paragraph",
      "text": "用下面两题检验你是否真的能分辨范式。做题时先问自己三个问题：字段是否原子（1NF）？是否存在「只由复合主键一部分决定」的字段（2NF）？是否存在「非主键字段之间互相决定」的传递依赖（3NF）？"
    },
    {
      "type": "quiz",
      "question": "一张 `order_item_bad` 表的主键是 `(order_id, product_id)`，其中字段包括 `qty`（下单数量）和 `category`（商品类目）。`category` 只由 `product_id` 决定，与 order_id 无关。这张表最直接违反了哪个范式？",
      "options": [
        "1NF：因为字段不原子",
        "2NF：因为存在对复合主键的部分依赖",
        "3NF：因为存在传递依赖",
        "没有违反任何范式"
      ],
      "answer": 1,
      "explanation": "category 只由复合主键的 product_id 一部分决定（product_id → category），与 order_id 无关，构成部分依赖，违反 2NF。qty 由整组主键决定，故不违反 1NF；这里也不存在非主键字段互相决定，故不是 3NF 问题。"
    },
    {
      "type": "quiz",
      "question": "一张表结构里，用户在 `profile` 字段中用 JSON 存了「兴趣标签列表」，例如 `[\"数码\",\"运动\"]`，并希望按单个标签精确统计有多少用户。这张表现在最突出的问题是？",
      "options": [
        "它违反 3NF，因为存在传递依赖",
        "它违反 1NF，因为一个字段内塞了多个值，无法按单个标签精确过滤/索引",
        "它完全合规，JSON 就是为这种需求设计的",
        "它违反 2NF，因为存在复合主键的部分依赖"
      ],
      "answer": 1,
      "explanation": "把一个列表塞进单一字段导致「值不再原子」，按单个标签做精确查询极为困难（只能用 LIKE/JSON 提取，无法利用普通二级索引）。这正是 1NF 要求的「字段原子、无重复组」被破坏的情形。"
    },
    {
      "type": "exercise",
      "title": "诊断并规范化一张坏表",
      "description": "某表 `orders_flat(order_id 主键, user_name, user_email, category, product_name, qty, total_amount, ship_address)` 用 order_id 作为主键，但一条订单多件商品时 order_id 重复、整行重复。请：① 指出它违反了哪些范式（逐个说明）；② 把它改造成把 shop 库中多个合规的表结构列出来；③ 说明 total_amount 在这套结构里应该怎么处理。",
      "hint": "同一行包含一份订单里的多件商品 → 违反了 1NF（重复组/无原子字段）；据此把它拆成 orders（放订单属性）与 order_item（放每件商品）。user 信息只在订单里出现 → 属于复制成的用户冗余，考虑是否该由 user 表统一承载。total_amount 是可由明细推导的冗余值，见反范式小节。"
    },
    {
      "type": "keypoints",
      "items": [
        "范式按 1NF → 2NF → 3NF 递进，旨在消灭「同一事实重复存储」并避免更新/插入/删除异常",
        "1NF：字段原子、无重复组、不用列表/逗号拼一个字段",
        "2NF：复合主键下，非主键字段不得只依赖主键的一部分",
        "3NF：非主键字段之间不得互相决定（避免传递依赖）",
        "做到 3NF 一般是业务表的默认目标；shop 库的 user / product / orders / order_item 就是规范化产物",
        "反范式是刻意保留冗余以换读性能的权衡，如 orders.total_amount；其核心风险是冗余失去同步，必须用事务或快照策略兜底",
        "快照（固化历史事实，如 order_item.price）≠ 冗余（复制当前可推导值）"
      ]
    }
  ]
};
