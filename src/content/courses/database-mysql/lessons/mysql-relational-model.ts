/* ==================================================================
 * 课时：关系模型：表、行、键与关系（mysql-relational-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-relational-model",
  courseSlug: "database-mysql",
  title: "关系模型：表、行、键与关系",
  summary: "回顾关系模型与键，建立整门课的数据心智模型。",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "你已经会写 CRUD 和 JOIN，但「会写」和「为什么这么设计」之间还差一层。关系模型（Relational Model）是 MySQL 一切行为的地基：表和表之间靠什么连起来、为什么要有主键、外键到底在约束什么。这一节不是空谈理论——后面所有章节（索引、事务、隔离、锁）的解释都会反复引用这节的术语。先把地基夯实。",
    },
    {
      type: "heading",
      text: "关系：表、行、列，而不是 Excel",
    },
    {
      type: "paragraph",
      text: "在关系模型里，一张表叫一个「关系」（Relation），一行叫一个「元组」（Tuple），一列叫一个「属性」（Attribute）。你不需要记住这些学究叫法，但要把一个思想抓牢：关系模型强调「集合」——表是一个有序可重复的行的集合，每一行是这个关系的一个实例，而列定义了这一行的结构（类型、含义）。它和 Excel 的本质区别在于：关系是结构化的、基于类型的，而不只是把格子粘在一起。",
    },
    {
      type: "paragraph",
      text: "在 MySQL 中，这个模型落地为 DDL。下面的建表语句定义了本课程贯穿始终的「电商订单库 shop」里的一张表 product（商品表）：每一行是一个商品，列定义了这个商品有哪些属性。注意最后那几行：主键、索引、外键——它们不是可有可无的装饰，而是关系模型「键」概念的数据库实现。",
    },
    {
      type: "code",
      title: "商品表：关系模型落地为 CREATE TABLE",
      language: "sql",
      code: "CREATE TABLE product (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY, -- 主键\n    name       VARCHAR(64)  NOT NULL,\n    category   VARCHAR(32)  NOT NULL,\n    price      DECIMAL(10,2) NOT NULL,\n    stock      INT          NOT NULL DEFAULT 0,\n    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP\n) ENGINE = InnoDB;\n\n-- 插入几行真实的演示数据\nINSERT INTO product (name, category, price, stock) VALUES\n    ('无线机械键盘', '数码', 399.00, 120),\n    ('机械键盘轴体', '数码', 45.00, 800),\n    ('便携充电宝', '数码', 129.00, 0),\n    ('纯棉T恤', '服饰', 59.00, 300);",
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么用 DECIMAL 存金额，而不是 FLOAT",
      body: "金额这种需要精确表示的小数，用 FLOAT/DOUBLE（浮点）会有精度误差。关系模型的列是「带类型的」，选对类型就是选对语义。DECIMAL(10,2) 是定点数，能精确表示两位小数。这是后面「数据类型」章节会展开的内容，先记住结论。",
    },
    {
      type: "heading",
      text: "主键（Primary Key）：每一行的身份证",
    },
    {
      type: "paragraph",
      text: "主键是一行数据的唯一标识，它的定义是：能唯一确定一行、且不允许为 NULL 的列（或列的组合）。「唯一」和「非空」缺一不可。主键意味着两件事：其一，你可以精确地定位到某一行（WHERE id = 42），而不必模糊匹配；其二，数据库会为主键自动建立一个索引（在 InnoDB 里就是聚簇索引，我们到「索引」章节再讲）来加速这个定位。",
    },
    {
      type: "code",
      title: "id 主键的自增写法",
      language: "sql",
      code: "-- id 是主键，AUTO_INCREMENT 让数据库自动分配自增值\n-- 你不需要手动指定 id，插入时数据库会帮你 +1\nINSERT INTO product (name, category, price, stock)\nVALUES ('降噪耳机', '数码', 899.00, 50);\n\n-- 查出来的 id 就是这条记录的唯一标识\nSELECT id, name FROM product WHERE name = '降噪耳机';\n-- 预期：id 自动增长，如 5",
    },
    {
      type: "definition",
      term: "主键（Primary Key）",
      definition:
        "用于唯一标识一行数据的列或列组合，必须满足「非空 + 唯一」。InnoDB 表必须要有主键；没显式指定时，InnoDB 会自动选择一个唯一的非空索引作为隐含主键，否则会生成一个隐藏的 rowid 作主键。主键伴随聚簇索引，是数据物理存储顺序的依据。",
    },
    {
      type: "heading",
      text: "候选键与唯一约束（Unique Key）",
    },
    {
      type: "paragraph",
      text: "在一个关系里，能唯一标识一行的属性组合可能不止一个。满足「唯一 + 非空（或可空但有唯一约束）」的每一个这样的属性组合，都叫一个候选键（Candidate Key）。你选定其中一个做主键，其余没被选中的候选键就退化为「备用键」，在 MySQL 里用 UNIQUE 约束来表达。",
    },
    {
      type: "paragraph",
      text: "拿 user（用户）表举例：id 是主键，但它不一定是唯一的候选键——email 通常也是唯一且非空的。既然 email 也能唯一定位一个用户，就应该给 email 加 UNIQUE 约束。这样数据库不仅管住主键，也拦住重复邮箱的脏数据。UNIQUE 约束在 MySQL 里也会自动建立一个二级索引。",
    },
    {
      type: "code",
      title: "主键 + 唯一约束：两个候选键",
      language: "sql",
      code: "CREATE TABLE user (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY, -- 主键（候选键之一）\n    name       VARCHAR(64)  NOT NULL,\n    email      VARCHAR(128) NOT NULL UNIQUE,      -- 第二个候选键：唯一约束 + 二级索引\n    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP\n) ENGINE = InnoDB;\n\n-- 试插两条相同的 email：第二条会报错，因为 UNIQUE 拦截\nINSERT INTO user (name, email) VALUES ('小明', 'ming@shop.com');\nINSERT INTO user (name, email) VALUES ('小明2', 'ming@shop.com'); -- Duplicate entry 错误",
    },
    {
      type: "definition",
      term: "唯一约束（Unique Key / 候选键）",
      definition:
        "保证某一列（或列组合）的值在全表不重复的约束。它是候选键在数据库里的落地方式。与主键不同，UNIQUE 允许 NULL（MySQL 中 NULL 被认为彼此不相等，因此可出现多个 NULL）。UNIQUE 会自动创建二级索引。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "区分「唯一索引」与「主键」",
      body: "很多人把 UNIQUE 和 PRIMARY KEY 混为一谈，但它们行为不同：主键强制非空 + 唯一，且是聚簇索引的锚点；UNIQUE 只约束「非重」，允许 NULL，且只是二级索引。面试常考这个区别。",
    },
    {
      type: "heading",
      text: "外键（Foreign Key）：表之间的引用",
    },
    {
      type: "paragraph",
      text: "只靠一张表无法表达现实世界的关联——订单属于哪个用户？订单里有哪几个商品？这时就需要外键：外键是一个表中的列，它的值引用（指向）另一张表的主键（或唯一键）。外键建立的这条线，就是关系模型里「关系」二字的真正含义。",
    },
    {
      type: "paragraph",
      text: "看 shop 库的 orders（订单）表：user_id 是一个外键，引用 user(id)。它的作用有两个层面。第一个层面是「约束」（Integrity）：数据库强制 user_id 必须能在 user 表里找到对应行（除非是 NULL），从而保证不会出现「订单挂在不存在用户名下」的悬空引用。第二个层面是「语义」：它告诉阅读者这两张表是怎么连起来的。",
    },
    {
      type: "code",
      title: "外键：orders 引用 user",
      language: "sql",
      code: "CREATE TABLE orders (\n    id           BIGINT AUTO_INCREMENT PRIMARY KEY,\n    user_id      BIGINT       NOT NULL,\n    status       VARCHAR(16)  NOT NULL DEFAULT 'pending', -- pending/paid/shipped/completed/cancelled\n    total_amount DECIMAL(10,2) NOT NULL,\n    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    KEY idx_user (user_id),   -- 为外键列建二级索引，加速按用户查订单\n    CONSTRAINT fk_orders_user FOREIGN KEY (user_id)\n        REFERENCES user (id)   -- 外键：user_id 必须能在 user.id 中找到\n) ENGINE = InnoDB;\n\n-- 插入一个不存在的 user_id=999：违反外键约束，报错\nINSERT INTO orders (user_id, status, total_amount) VALUES (999, 'pending', 59.00);\n-- 错误：Cannot add or update a child row: a foreign key constraint fails",
    },
    {
      type: "definition",
      term: "外键（Foreign Key）",
      definition:
        "一张表中引用另一张表主键（或唯一键）的列。它保证引用完整性：子表（含外键的表）中的值所指向的父表行必须存在。MySQL 中只有 InnoDB 支持外键约束；它同时意味着约束检查成本与潜在的锁开销。",
    },
    {
      type: "heading",
      text: "三种关系：1:1、1:N、N:M",
    },
    {
      type: "paragraph",
      text: "外键天然表达「一对多」（1:N）：一个 user 可以有多个 orders，所以在 orders 里放外键 user_id。反过来说，「多对一」只是从另一头的视角看同一条线。真正需要小心的是另外两种。",
    },
    {
      type: "list",
      items: [
        "1:1（一对一）：一个人对应一列身份证信息。通常把外键放在其中一张表，并在该外键列上加 UNIQUE（这样它就只能出现一次，变成一对一）。一对一的表常用来拆分访问频率不同的字段。",
        "1:N（一对多）：一个用户多个订单。外键放在「多」的那一侧（orders.user_id）。这是最常用的关系。",
        "N:M（多对多）：一个订单可以含多种商品，一种商品可以出现在多个订单里。关系模型里没有「多对多」的直接列，必须用一张中间表（关联表）把它拆成两个 1:N。",
      ],
    },
    {
      type: "paragraph",
      text: "N:M 尤其重要，也最容易画错。shop 库里的 order_item（订单明细）和 product 之间，其实是通过中间表形式表达的经典多对多：要表达「订单 ↔ 商品」的多对多，我们中间放一张 order_item，它同时存放 order_id 和 product_id，每个都是外键。这样一张订单通过 order_item 关联出多种商品，一种商品也能出现在多张订单里。",
    },
    {
      type: "code",
      title: "多对多：用中间表 order_item 拆成两个 1:N",
      language: "sql",
      code: "CREATE TABLE order_item (\n    id         BIGINT AUTO_INCREMENT PRIMARY KEY,\n    order_id   BIGINT NOT NULL,\n    product_id BIGINT NOT NULL,\n    quantity   INT    NOT NULL,\n    price      DECIMAL(10,2) NOT NULL, -- 下单时的成交单价快照\n    KEY idx_order   (order_id),\n    KEY idx_product (product_id)\n) ENGINE = InnoDB;\n\n-- 查询：一个订单买了哪些商品（通过中间表把 orders 和 product 连起来）\nSELECT o.id AS order_id, p.name, oi.quantity, oi.price\nFROM orders o\nJOIN order_item oi ON oi.order_id = o.id\nJOIN product   p  ON p.id        = oi.product_id\nWHERE o.id = 1001;",
    },
    {
      type: "callout",
      variant: "tip",
      title: "中间表里存 price 快照，而不是 JOIN 现查",
      body: "order_item.price 是「下单那一刻的成交价」，而不是实时 JOIN product.price。商品价格后来会变，但历史订单的价格不该变。外键关系表达的是结构，是否「快照字段」则是数据的正确性设计——这是后面「范式与表设计」章节会细讲的思想。",
    },
    {
      type: "heading",
      text: "范式：先把直觉种下，深入放到后面",
    },
    {
      type: "paragraph",
      text: "你可能听过「三范式」：1NF、2NF、3NF。这一节不展开证明，只给你一个判断标准，帮你在建表时多问一句「这个数据该不该出现在这张表里」。范式的核心直觉是：**每个非主属性都应只依赖于主键，而不是部分依赖或传递依赖**——换句话说，一张表只描述「一种东西」，别把不属于它的重复信息硬塞进去。",
    },
    {
      type: "paragraph",
      text: "为什么要在意？反范式带来的直接恶果是冗余和更新异常：同一个数据在表里存了很多份，改的时候要么漏改要么不一致。比如把「用户姓名」直接塞进 orders 表，出现三笔订单就要存三遍姓名，用户改名时还得改三处。正确做法是只存外键 user_id，需要名字时 JOIN 去查。这块我们会在「数据建模」章节系统讲解 1NF/2NF/3NF 和反范式的取舍。",
    },
    {
      type: "table",
      caption: "关系模型核心术语对照",
      headers: ["关系模型术语", "MySQL 中的对应", "一句话含义"],
      rows: [
        ["关系 Relation", "表 Table", "结构化数据的集合，行是实例、列是属性"],
        ["元组 Tuple", "行 Row", "关系中的一个数据实例"],
        ["属性 Attribute", "列 Column", "行的某一维度，带类型与语义"],
        ["候选键 Candidate Key", "主键 + 唯一约束", "能唯一定位一行的属性组合"],
        ["主键 Primary Key", "PRIMARY KEY", "被选中的那个候选键，非空且唯一，聚簇锚点"],
        ["外键 Foreign Key", "FOREIGN KEY", "对另一张表主键的引用，保证引用完整性"],
      ],
    },
    {
      type: "quiz",
      question: "关于「主键」与「唯一约束（UNIQUE）」，下列哪一项说法正确？",
      options: [
        "两者完全等价，都强制非空且唯一",
        "主键非空且唯一；UNIQUE 只约束不重复，且允许 NULL",
        "UNIQUE 必须建立在主键之上",
        "主键允许出现多个 NULL 值",
      ],
      answer: 1,
      explanation:
        "主键要求「非空 + 唯一」，而 UNIQUE 只保证不重复，MySQL 中允许出现多个 NULL（NULL 彼此视为不相等）。这是面试常考的区别。",
    },
    {
      type: "exercise",
      title: "识别 shop 库中的关系",
      description:
        "给定 shop 库的五张表（user、product、orders、order_item、payment），指出每对表之间是 1:1、1:N 还是 N:M，并说明外键该放在哪一侧、为什么。特别辨析：user 与 orders、orders 与 payment、orders 与 product 分别是什么关系。",
      hint: "payment 表只有 order_id 一个外键——想一想它为什么能成为 1:1；orders 和 product 之间需要靠中间表 order_item，它对应 N:M。",
    },
    {
      type: "keypoints",
      items: [
        "表/行/列即关系/元组/属性；关系模型强调集合与类型",
        "主键：非空 + 唯一，是 InnoDB 聚簇索引的锚点",
        "候选键中没选中的那个用 UNIQUE 表达，它允许 NULL 且生成二级索引",
        "外键引用另一张表的主键，保证引用完整性，仅 InnoDB 支持",
        "1:N 外键放在「多」的一侧；N:M 必须用中间表拆成两个 1:N",
        "范式直觉：一张表只描述一种东西；深入了解放到「数据建模」章节",
      ],
    },
  ],
};
