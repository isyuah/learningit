/* ==================================================================
 * 课时：数据类型与字段设计选择（mysql-data-types）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 术语约定：主键 / 外键 / 二级索引 / 回表 / 覆盖索引（详见索引章）。
 * 前置：基本 SQL + 范式（已学）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-data-types",
  "courseSlug": "database-mysql",
  "title": "数据类型与字段设计选择",
  "summary": "为什么金额必须用 DECIMAL、什么时候用 BIGINT 而不是 INT、CHAR 与 VARCHAR 怎么选、时间类型与 2038 问题。",
  "minutes": 16,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "字段类型选错，往往不是「存不下」，而是「悄悄丢精度」「排序混乱」「索引失效」「几年后突然溢出」这类代价高昂的问题。这一课不讲零碎语法，而是教你面对每个字段时怎么决策：数字（INT/BIGINT）、小数（DECIMAL vs FLOAT/DOUBLE）、字符串（CHAR vs VARCHAR vs TEXT）、时间（DATETIME vs TIMESTAMP）、枚举（ENUM/SET）、以及 8.0 默认字符集 utf8mb4。"
    },
    {
      "type": "heading",
      "text": "整数：INT 还是 BIGINT，以及自增会怎样"
    },
    {
      "type": "paragraph",
      "text": "整数类按位宽分档：TINYINT(1字节)/SMALLINT(2)/MEDIUMINT(3)/INT(4)/BIGINT(8)。范围依次扩大：INT 最大约 21 亿（2^31-1），BIGINT 最大约 9223372036854775807（2^63-1）。像主键、用户 id 这类以后可能上亿的表，推荐直接 BIGINT——自增主键一旦撞顶，插入会报主键溢出错误，而 BIGINT 给足余量让你几乎不用想「换型」的事。"
    },
    {
      "type": "code",
      "title": "自增主键接近上限的风险",
      "language": "sql",
      "code": "CREATE TABLE id_test (\n    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,\n    name VARCHAR(64)\n);\n\n-- 当 id 到达类型上限时：\n--   INT 到 2147483647、BIGINT 到 9223372036854775807\n-- 再插入：AUTO_INCREMENT 会报错（主键冲突或溢出），而非自动换型\n-- 所以关键字段用 BIGINT，并留意 INSERT 报错时先查 AUTO_INCREMENT 是否逼近极限\n\nSELECT AUTO_INCREMENT\nFROM information_schema.TABLES\nWHERE TABLE_SCHEMA = 'shop' AND TABLE_NAME = 'orders';"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "自增会「跳过」号码，不保证连续",
      "body": "AUTO_INCREMENT 只保证「越来越大且不重复」，不保证连续：事务回滚后分配的号会被跳过，8.0 里 AUTO_INCREMENT 计数器还有「重启后可能复用/变化」的细节。凡是业务上拿自增序号当「订单号」并期待连续者，都该改用显式订单号策略。另外 `INT(11)` 里的 `(11)` 只是显示宽度，不影响取值大小，别把它当精度。"
    },
    {
      "type": "heading",
      "text": "小数：DECIMAL 才对，FLOAT/DOUBLE 是近似值"
    },
    {
      "type": "paragraph",
      "text": "这是面试和实战里最容易踩的一句话：**金钱必须用 DECIMAL，绝不用 FLOAT/DOUBLE**。FLOAT/DOUBLE 是二进制浮点，按 IEEE 754 存储，很多十进制小数（如 0.1）在二进制里是无限循环、只能近似表示，因此比较与累加会产生误差。DECIMAL 是定点十进制，按十进制定长精确存储，加减乘除在给定精度内精确。"
    },
    {
      "type": "code",
      "title": "FLOAT 精度丢失 vs DECIMAL 精确",
      "language": "sql",
      "code": "-- FLOAT 存十进制会有舍入误差\nSELECT 0.1 + 0.2;                    -- 用 FLOAT/DOUBLE 算会得到 0.30000000000000004\nSELECT CAST(0.1 AS DECIMAL(10,2)) + CAST(0.2 AS DECIMAL(10,2)); -- 0.30，精确\n\n-- shop 里金额/单价一律 DECIMAL(10,2)\nCREATE TABLE product (\n    id    BIGINT PRIMARY KEY,\n    price DECIMAL(10,2) NOT NULL  -- 精确到分\n);\n\n-- DECIMAL(10,2)：总 10 位，其中 2 位小数，即最多 99999999.99"
    },
    {
      "type": "table",
      "caption": "数值类型对比（到底该选谁）",
      "headers": ["类型", "存储方式", "精确性", "典型用途", "注意"],
      "rows": [
        ["INT / BIGINT", "二进制整数", "精确", "主键、id、数量、库存", "别把 id 用 VARCHAR 存；BIGINT 留足余量"],
        ["DECIMAL(p,s)", "十进制定点", "精确", "金额、单价、税率", "金钱、金融计算唯一选择"],
        ["FLOAT / DOUBLE", "二进制浮点", "近似", "科学计算、折扣率等不需要精确的连续量", "绝不要用于金额；比较/累加有误差"]
      ]
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "折扣率这类用 FLOAT 可以吗",
      "body": "当数值只用于「展示百分比」或「参与模糊的比较」，近似误差无所谓时才可考虑 FLOAT/DOUBLE。但只要这个值要被精确相加（总价、对账、余额），就必须 DECIMAL。判断标准不是「是不是小数」，而是「这个量需不需要被精确累加与比较」。"
    },
    {
      "type": "heading",
      "text": "CHAR 与 VARCHAR：定长 vs 变长"
    },
    {
      "type": "paragraph",
      "text": "两者都存字符串，区别在存储结构与长度语义：CHAR(n) 是定长，存不够就补空格、取出时去掉尾部空格，n 是「字符数」（不是字节数，注意字符集）。VARCHAR(n) 是变长，额外用 1~2 字节记录长度，只存实际字符。因此对长度稳定/一致的字段（如性别、状态码、国家代码）用 CHAR 更省事且更稳；对变动较大的字段（名字、地址、描述）用 VARCHAR 更省空间。"
    },
    {
      "type": "code",
      "title": "CHAR vs VARCHAR 的取舍",
      "language": "sql",
      "code": "-- status 取值固定且短（pending/paid/...）→ CHAR(16) 或 VARCHAR(16) 皆可\nCREATE TABLE orders (\n    status   CHAR(16)      NOT NULL DEFAULT 'pending',  -- 取值固定/长度稳定\n    email    VARCHAR(128),  -- 长度差异大 → 变长更省空间\n    name     VARCHAR(64)\n);\n\n-- VARCHAR 额外占用 1~2 字节记录长度；CHAR 没有\n-- 所以「短且稳定」用 CHAR 更省，长且可变用 VARCHAR 更省\nSELECT CHAR_LENGTH(email)  -- 字符数\n     , LENGTH(email)       -- 字节数（utf8mb4 下中文 1 字=3~4 字节）\nFROM user WHERE id = 1;"
    },
    {
      "type": "paragraph",
      "text": "判断一句话：**取值固定且长度稳定 → CHAR；取值长度差异大 → VARCHAR**。注意 utf8mb4 下 `VARCHAR(128)` 表示最多 128 个「字符」而非字节，这在索引长度计算（下一章）会有关键影响。另一个易错点是 CHAR 的尾部空格比较：因为定长补空，`CHAR 'abc'` 会认为等于 `'abc  '`，VARCHAR 则严格区分——需要精确匹配尾空格时用 VARCHAR。"
    },
    {
      "type": "heading",
      "text": "TEXT / BLOB：大字段的尺寸限制与索引限制"
    },
    {
      "type": "paragraph",
      "text": "VARCHAR 最大约 65535 字节（受行大小与字符集字节数影响，实际能装下的字符数更少）。更大的文本用 TEXT（TINYTEXT/TEXT/MEDIUMTEXT/LONGTEXT），二进制用 BLOB 系列。它们的主要代价是：默认情况下 TEXT/BLOB **不能直接做为二级索引键前缀之外的部分**（只能对 TEXT 建前缀索引，如 `KEY idx(name(20))`），并且大字段会显著增加行大小与 IO 成本。"
    },
    {
      "type": "code",
      "title": "大文本字段与前缀索引",
      "language": "sql",
      "code": "-- TEXT/BLOB 不能整体建普通索引，只能建前缀索引\nCREATE TABLE article (\n    id      BIGINT PRIMARY KEY,\n    title   VARCHAR(200),\n    body    TEXT,\n    KEY idx_title (title),\n    KEY idx_body_prefix (body(100))  -- 只对前 100 个字符建索引\n);\n\n-- 行溢出：InnoDB 会把过长的 TEXT 存到溢出页，主表只留指针\n-- 所以「查询所有列」当遇到 TEXT 列时会变慢；能只投影就只投影\nSELECT id, title FROM article WHERE id = 3;  -- 快\nSELECT body       FROM article WHERE id = 3;  -- 才需要读大字段"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "「行大小」与字符集的坑",
      "body": "InnoDB 单行（含所有列）默认有上限（约 65535 字节总量、以及 dy 页内行限制）。utf8mb4 下一个字符最多 4 字节，所以写 `VARCHAR(255)` 在 utf8mb4 下可能吃掉比你以为更多的字节。设计特别宽的宽表前，先算一算各列字节数是否逼近行上限。"
    },
    {
      "type": "heading",
      "text": "DATETIME 与 TIMESTAMP：范围、时区与 2038 问题"
    },
    {
      "type": "table",
      "caption": "时间类型对比",
      "headers": ["维度", "DATETIME", "TIMESTAMP"],
      "rows": [
        ["取值范围", "1000-01-01 ~ 9999-12-31", "1970-01-01 ~ 2038-01-19（32 位无符号上限附近）"],
        ["存储", "按字面日期时间，8 字节", "以 UTC 时间戳存储，4 字节"],
        ["时区", "存什么显示什么，与时区无关", "按会话时区换算：存的是 UTC，取回时转成当前会话时区"],
        ["典型用途", "业务日期、历史记录、需要至少到 2038 之后的日期", "记录「发生时刻」且接受会话时区换算；注意 2038 上限"],
        ["默认/自动", "都可配 CURRENT_TIMESTAMP 默认值", "同样可配 CURRENT_TIMESTAMP 默认值"]
      ]
    },
    {
      "type": "paragraph",
      "text": "**2038 问题**：TIMESTAMP 以 32 位秒级时间戳存储，其上限对应 2038-01-19 03:14:07 UTC。超过这个时刻会溢出——这就是经典的 Y2038 问题。设计长期系统时若日期可能超过 2038，应使用 DATETIME（范围到 9999 年）。MySQL 8.0 已把内部时间范围扩大，但从「选型不踩坑」的角度，业务日期仍然推荐 DATETIME。"
    },
    {
      "type": "code",
      "title": "两种时间类型的正确用法",
      "language": "sql",
      "code": "-- 业务日期（如订单创建、生日、到期日）：用 DATETIME，范围大、不随会话时区变\nCREATE TABLE orders (\n    id         BIGINT PRIMARY KEY,\n    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\n-- 记录「事件发生时刻」，并希望按会话时区展示：可用 TIMESTAMP\nCREATE TABLE audit (\n    occured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n    action     VARCHAR(64)\n);\n\n-- 但注意 2038 上限：长期日志/排程若跨 2038，请改 DATETIME\n-- 时区敏感性：SET time_zone='+08:00' 后再 SELECT 会看到不同的本地时间"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别用字符串或 INT 存时间",
      "body": "看到 schema-design 课的反模式 2：日期/时间请用 DATETIME 或 TIMESTAMP，而不是 VARCHAR 或纯整数秒。只有当你确实需要「自增秒数」做排序分片这类特殊用途时才用整数秒，但要自己维护时区与格式化，工程上通常不划算。"
    },
    {
      "type": "heading",
      "text": "ENUM 与 SET：受限取值"
    },
    {
      "type": "paragraph",
      "text": "ENUM 定义一个受限的取值集合，字段只能是其中之一；SET 则允许取集合里的任意多个（按位存储）。它们的优点是约束强、存储紧凑；缺点是「加一个新取值需要 ALTER TABLE（改元数据）」「排序按定义顺序而非字典序」「在部分场景下灵活性和升级性差」。"
    },
    {
      "type": "code",
      "title": "ENUM / SET 的用法与代价",
      "language": "sql",
      "code": "CREATE TABLE orders_enum (\n    id     BIGINT PRIMARY KEY,\n    -- 只能是这四个之一，写别的会报错/被截断\n    status ENUM('pending','paid','shipped','completed','cancelled'),\n    -- 可同时取多个：'1,3' 表示 flags=RED|BLUE\n    flags  SET('RED','GREEN','BLUE')\n);\n\n-- 代价：\n-- 1) 加取值要改表结构：ALTER TABLE orders_enum MODIFY status ENUM(...,'refunded');\n-- 2) ORDER BY status 按定义顺序，而不是字典序\n-- 3) ENUM('a','b','c') 与写死字符串相比，未来加值要锁表迁移"
    },
    {
      "type": "paragraph",
      "text": "对「取值集合非常固定且几乎不变」的字段（如订单状态），ENUM 或 CHAR + CHECK 都是合理选择；对「以后可能经常新增取值」的字段，用 VARCHAR 加应用层校验更省心。判断标准：**这个集合会变吗、多久变一次**。"
    },
    {
      "type": "heading",
      "text": "字符集：8.0 默认 utf8mb4（版本敏感）"
    },
    {
      "type": "paragraph",
      "text": "MySQL 的 `utf8`（utf8mb3）最多 3 字节，**存不了 Emoji 和部分少见汉字（4 字节字符）**；utf8mb4 支持完整的 Unicode（含 Emoji）。MySQL 8.0 起数据库与表的默认字符集就是 utf8mb4，其中默认排序规则是 `utf8mb4_0900_ai_ci`。而在 MySQL 5.7，默认排序规则是 `utf8mb4_general_ci`。"
    },
    {
      "type": "code",
      "title": "字符集与排序规则的显式声明",
      "language": "sql",
      "code": "-- 8.0 默认：CHARACTER SET utf8mb4, COLLATE utf8mb4_0900_ai_ci\n-- 5.7 默认排序：utf8mb4_general_ci\n\nCREATE DATABASE shop\n  CHARACTER SET utf8mb4\n  COLLATE utf8mb4_0900_ai_ci;   -- 8.0 之后的默认；5.7 用 utf8mb4_general_ci\n\n-- 建表/建列时可显式覆盖\nCREATE TABLE note (\n    id   BIGINT PRIMARY KEY,\n    body VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci\n);\n\n-- SELECT 里的排序规则会影响比较是否区分大小写/重音：\nSELECT name FROM user WHERE name = 'Alice';  -- _ci 表示不区分大小写"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别再用古老的 utf8 (utf8mb3)",
      "body": "数据库/表和连接的字符集都应统一到 utf8mb4，否则 Emoji、特殊汉字会出现乱码或报 1366 错误。同时，连接时设置 `SET NAMES utf8mb4`（或连接串 charset=utf8mb4）也很重要——表是 utf8mb4 但连接是 latin1 仍会丢字。8.0 默认已纠正，5.7 迁移上来时要逐个检查表与连接。"
    },
    {
      "type": "heading",
      "text": "自检测验与练习"
    },
    {
      "type": "quiz",
      "question": "商城要记录订单金额（精确到分，不能有精度误差）和商品平均评分（允许近似）。正确的类型选择是？",
      "options": [
        "金额用 FLOAT，评分用 DECIMAL",
        "金额用 DOUBLE，评分用 FLOAT",
        "金额用 DECIMAL(10,2)，评分可用 FLOAT 或 DECIMAL（若需精确则 DECIMAL）",
        "金额用 VARCHAR(20)，评分用 INT"
      ],
      "answer": 2,
      "explanation": "金额必须精确，只能 DECIMAL(10,2)；评分是连续量，若只做展示可近似，但更稳妥也用 DECIMAL 或明确接受近似。选项 1/2 把金钱放浮点会引入累计误差；把金额放 VARCHAR 更是双重错误（无法正确比较/聚合）。"
    },
    {
      "type": "quiz",
      "question": "一个需要记录到 2050 年之后的事件日志，时间字段应该选什么？",
      "options": [
        "TIMESTAMP，因为它存储紧凑",
        "DATETIME，因为它范围可到 9999 年且不随会话时区换算",
        "VARCHAR(20)，方便格式化",
        "BIGINT 存毫秒时间戳，最通用"
      ],
      "answer": 1,
      "explanation": "TIMESTAMP 是 32 位秒级，上限约 2038-01-19（Y2038 问题），跨过它必须用范围到 9999 年的 DATETIME。用 VARCHAR 或纯整型时间戳虽然也能存，但失去了时间类型自带的比较、索引与时区能力，除非你有特殊分片需求，否则不推荐。"
    },
    {
      "type": "exercise",
      "title": "为一套会员系统选类型",
      "description": "为下面的字段各选一个 MySQL 类型并写一行注释说明理由：① 用户主键（预计最多 3 亿用户）；② 会员余额（精确到分）；③ 用户昵称（最长 32 字符，Emoji 也要支持）；④ 注册时间（记录发生时刻，含时区展示需求）；⑤ 会员等级（固定 gold/silver/bronze 三档，几乎不再增）。",
      "hint": "① 用 BIGINT 留足余量；② DECIMAL(12,2)；③ VARCHAR(32) 且表用 utf8mb4；④ 若接受 2038 用 TIMESTAMP，追求稳妥用 DATETIME；⑤ 取值固定几乎不变，ENUM 合适，但想加值灵活就用 VARCHAR + CHECK。逐一对照课内「决策标准」检查。"
    },
    {
      "type": "keypoints",
      "items": [
        "主键/大表 id 用 BIGINT；AUTO_INCREMENT 不保证连续，也别拿它当业务订单号",
        "金额必用 DECIMAL；FLOAT/DOUBLE 是二进制近似的，绝不能用于需要精确累加与比较的量",
        "CHAR 定长适合「短且长度稳定」，VARCHAR 变长适合「长度差异大」；注意 utf8mb4 下长度按字符计、CHAR 尾部空格比较特殊",
        "TEXT/BLOB 不能整体建普通索引（只能用前缀索引），且可能触发行溢出",
        "TIMESTAMP 有 2038 上限，范围到 9999 的业务日期用 DATETIME；TIMESTAMP 按会话时区换算、DATETIME 存字面值",
        "ENUM/SET 适合几乎不变的受限取值；要常加值就用 VARCHAR 自行校验",
        "8.0 默认 utf8mb4 + utf8mb4_0900_ai_ci，5.7 默认 utf8mb4_general_ci——版本敏感，别再用只支持 3 字节的旧 utf8"
      ]
    }
  ]
};
