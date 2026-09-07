/* ==================================================================
 * 课时：SQL 注入与防御、权限与 GRANT（mysql-sql-injection）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-sql-injection",
  "courseSlug": "database-mysql",
  "title": "SQL 注入与防御、权限与 GRANT",
  "summary": "看透 SQL 注入的拼接本质，用参数化查询防住它，并用最小权限收窄敌人能造成的伤害。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "SQL 注入是数据库最经典的攻击方式：它不依赖数据库的某个版本 bug，也不依赖某个隐藏漏洞——它来源于一个看似无害的编程错误「把用户输入拼进了 SQL 字符串」。这一节我们从机制讲透它，然后用一击即中的「参数化查询」（Prepared Statement）防住它，最后用你已经掌握的 GRANT 权限知识，把「即使被注入，敌人能造成的伤害也最小」。"
    },
    {
      "type": "heading",
      "text": "注入的本质：用户输入变成了可执行代码"
    },
    {
      "type": "paragraph",
      "text": "先看一个电商搜索登录场景。很多初学的代码是这样写的：拿到用户提交的「用户名」，直接拼进一条 SQL。当数据里只有正常的字符串时看起来一切正常。问题在于：SQL 字符串和用户输入之间没有边界——用户输入里的内容会被数据库当作 SQL 的一部分执行，而不是当作它只是一个「值」。"
    },
    {
      "type": "code",
      "title": "有漏洞的拼接写法（伪代码）",
      "language": "python",
      "code": "username = request.form[\"username\"]       # 用户可控\npassword = request.form[\"password\"]       # 用户可控\n\n# 危险：直接把输入拼进 SQL 字符串\nsql = \"SELECT * FROM user WHERE name = '\" + username + \"' AND password = '\" + password + \"'\"\nrows = db.execute(sql)"
    },
    {
      "type": "paragraph",
      "text": "当用户名正常，比如 `alice`、密码 `pw`，生成的 SQL 是良性的。但攻击者不按常理输入。比如在用户名框里输入：`alice' -- `。这条输入里带了单引号和注释符，最终拼出的 SQL 变成了下面这样。"
    },
    {
      "type": "code",
      "title": "攻击后实际拼接出的 SQL",
      "language": "sql",
      "code": "SELECT * FROM user WHERE name = 'alice' -- ' AND password = 'anything'\n\n-- 解析后，密码校验条件被注释符吞掉，只剩下：\nSELECT * FROM user WHERE name = 'alice'"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "注入的三种典型后果",
      "body": "1) 认证绕过：把 WHERE 条件改写成永远为真，直接以他人身份登录；2) 数据泄露：通过 UNION SELECT 把别的表的数据带出来；3) 破坏性：直接 UPDATE / DELETE / DROP 数据。攻击面有多大，取决于该数据库连接的权限有多大——这正是后面「最小权限」的意义所在。"
    },
    {
      "type": "heading",
      "text": "主防线：参数化查询 / Prepared Statement"
    },
    {
      "type": "paragraph",
      "text": "根治办法不是「把引号转义得更严」，而是「根本不让用户输入进入 SQL 语法」。参数化查询（Prepared Statement）把 SQL 结构（表名、列名、运算符）和值分开：SQL 先被预先编译为固定模板，值通过占位符单独绑定，由驱动把「值」原样交给数据库引擎，而不是重新拼进 SQL 字符串。因此无论用户输入什么，它都只会被当作一个「值」，永远无法改变 SQL 的结构。"
    },
    {
      "type": "code",
      "title": "参数化查询的正确写法（伪代码）",
      "language": "python",
      "code": "username = request.form[\"username\"]\npassword = request.form[\"password\"]\n\n# 正确：用占位符（?）占住值的位置，值与 SQL 分离\nsql = \"SELECT * FROM user WHERE name = ? AND password = ?\"\nrows = db.execute(sql, (username, password))\n\n# 即使 username = \"alice' -- \", 它也只被当作一个字面值，\n# 不会改变 WHERE 结构，查询在 name 列根本找不到匹配行。"
    },
    {
      "type": "list",
      "items": [
        "所有带外部输入的 SQL 一律使用参数占位符，杜绝字符串拼接",
        "ORM（如用 ORM 框架时）默认用参数绑定生成 SQL，是最省力的防线——用好它，别手工拼字符串绕过绑定",
        "能参数化的值一律参数化；实在要动态改变的表名/列名/排序字段等「标识符」，单独做白名单校验，绝不让用户输入直接拼接标识符"
      ]
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "标识符与值要区别对待",
      "body": "参数化解决的是「值」。如果有人让你做「按用户选择的列排序」或「按用户选择的表操作」，那就是在让你动态拼标识符——这是参数化救不了的地方，也是最容易再次引入注入的坑。对标识符的规则是：在白名单里枚举允许的选项，不在白名单就拒绝，绝不用用户输入直接拼。"
    },
    {
      "type": "heading",
      "text": "纵深防御：校验、转义与意识"
    },
    {
      "type": "paragraph",
      "text": "参数化是主防线，但好的防御是分层的。即便未来的某段代码不小心漏了参数化，或需要处理动态标识符，下面的习惯也能显著压缩风险："
    },
    {
      "type": "list",
      "items": [
        "输入校验（Validation）：对格式明确的输入（邮箱、手机号、金额、枚举）在入口做类型 / 白名单 / 长度校验，把明显恶意或越界的输入提前拦下",
        "输出转义（Escaping）：在确实需要手工拼 SQL 的极少数场景，按对应方言转义（如把 `'` 转成 `''`）——但这只能作为参数化不可用时的兜底，不能替代参数化",
        "永远不要信任任何客户端传来的数据：哪怕它来自你自己的前端页面、日志、文件导入，只要最终进 SQL 就要按「不可信」处理",
        "把 SQL 审计 / 静态扫描接入 CI，让「字符串拼接 SQL」的坏味道在代码评审时就被发现"
      ]
    },
    {
      "type": "heading",
      "text": "权限：即便被注入，也要把伤害关进笼子"
    },
    {
      "type": "paragraph",
      "text": "参数化减少「能不能注入」，权限决定「注入后能造成多大破坏」。你已经会写 GRANT 了——这一节把它用到安全实践上。核心思想是「最小权限」（Principle of Least Privilege）：给每个账号只授予完成其职责所必需的最小权限，而不是图省事一把梭。"
    },
    {
      "type": "code",
      "title": "分开的账号：应用账号 vs 管理账号",
      "language": "sql",
      "code": "-- 应用账号：只给业务需要的表、需要的操作，绝不给 ALL PRIVILEGES\nCREATE USER 'shop_app'@'%' IDENTIFIED BY 'STRONG_PASSWORD';\nGRANT SELECT, INSERT, UPDATE, DELETE ON shop.user TO 'shop_app'@'%';\nGRANT SELECT, INSERT, UPDATE    ON shop.orders TO 'shop_app'@'%';\nGRANT SELECT, INSERT            ON shop.product TO 'shop_app'@'%';\n\n-- 需要时才追加，不需要时用 REVOKE 收走\nREVOKE DELETE ON shop.orders FROM 'shop_app'@'%';\n\n-- 管理账号：真正的 DBA 或运维才用，只在本机登录、不暴露给应用\nCREATE USER 'dba'@'localhost' IDENTIFIED BY 'REALLY_STRONG_PASSWORD';\nGRANT ALL PRIVILEGES ON shop.* TO 'dba'@'localhost';\n-- 或按需给更细：GRANT SELECT, INSERT, UPDATE, DELETE, ALTER, INDEX, CREATE, DROP ..."
    },
    {
      "type": "list",
      "items": [
        "绝不把 `*.*` 或 `ALL PRIVILEGES` 授给应用直连账号",
        "按表授：只给那几张表需要的列级权限（如只 SELECT user.email、不 UPDATE）",
        "应用账号与运维/管理账号分开，管理账号不暴露给应用进程",
        "绝不把 `GRANT` / `SUPER` / 高危权限授给应用账号，应用永远不要用 root 连接数据库",
        "定期审计：`SHOW GRANTS FOR 'shop_app'@'%';` 检查账号实际权限，收走不再需要的授权"
      ]
    },
    {
      "type": "table",
      "caption": "最小权限：不同角色该有什么",
      "headers": ["角色", "建议权限", "为什么"],
      "rows": [
        ["只读报表服务", "仅 SELECT 需要的表", "无法改数据，注入最多只能泄露其可见数据"],
        ["读写应用服务", "仅业务表的 SELECT/INSERT/UPDATE，必要时才 DELETE", "即使被注入，也只到这几张表这几类操作的上限"],
        ["运维 / DBA", "必要的 DDL / 管理权限，且只在受控主机登录", "管理权限越多，单个账号沦陷造成的破坏越大"],
        ["应用直连账号", "不要 root、不要 ALL、不要 GRANT", "把应用接触的权限收窄到业务需要的最小集合"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么应用绝不能用 root",
      "body": "如果应用用 root 连库，那么一旦被 SQL 注入，注入者就获得了对这台 MySQL 的完全控制：可以读任意库任意表、可以 DROP 一切、甚至借超级权限做更多事情。用最小权限的 `shop_app` 账号连接，即使注入突破，敌人也最多碰你授权的那几张表的那些操作——这就是「最小权限」在安全上最直接的价值。"
    },
    {
      "type": "heading",
      "text": "一次完整的攻防复盘（搜索场景）"
    },
    {
      "type": "paragraph",
      "text": "把上面串起来看一个搜索场景。有漏洞的版本把搜索关键词拼进 SQL，攻击者输入 `' OR '1'='1` 让 WHERE 恒真，返回所有商品（数据泄露）。改成参数化后同一输入只是一个普通字符串，查询不到结果。同时应用账号只授权了 product 的 SELECT，即便哪天某处又出现拼接，注入者能拿到的也只是 product 这一张表的只读内容，而不是整个数据库。"
    },
    {
      "type": "code",
      "title": "搜索场景的攻防对比",
      "language": "text",
      "code": "漏洞版：\n  kw = request.form[\"kw\"]\n  sql = \"SELECT * FROM product WHERE name LIKE '%\" + kw + \"%'\"\n  输入 kw = \"' OR '1'='1 -- \" -> 返回所有商品（泄露全表）\n\n修复版：\n  sql = \"SELECT * FROM product WHERE name LIKE ?\"\n  db.execute(sql, (\"%\" + kw + \"%\",))   # kw 永远只是“值”\n  同样输入 -> 只会当成普通字符串去模糊匹配，找不到任何东西"
    },
    {
      "type": "quiz",
      "question": "下面哪段代码最容易存在 SQL 注入风险？",
      "options": [
        "`db.execute(\"SELECT * FROM user WHERE id = ?\", (uid,))`",
        "`db.execute(\"SELECT * FROM user WHERE id = \" + uid)`",
        "`db.execute(\"SELECT * FROM user WHERE id = ?\", [uid])` 并开启参数绑定",
        "先对 uid 做整数校验再用参数化查询"
      ],
      "answer": 1,
      "explanation": "把用户输入 `uid` 直接用 `+` 拼进 SQL 字符串，正是注入的温床——输入会成为 SQL 结构的一部分而非值。其余三项要么参数化、要么在参数化基础上加强，都没有把输入拼进 SQL 语法。"
    },
    {
      "type": "quiz",
      "question": "「最小权限」为什么能降低 SQL 注入的危害？",
      "options": [
        "它能让注入完全无法发生",
        "它能在注入突破后，把攻击者能碰到的数据与操作限制在授权的最小集合内",
        "它能让数据库自动拦截任何恶意 SQL",
        "它只为数据库提供性能优化，与安全无关"
      ],
      "answer": 1,
      "explanation": "最小权限不阻止注入发生（那是参数化查询的职责），但它决定了「注入成功后敌人能造成多大破坏」：只拿到业务需要的最小表与最小操作，从而限制数据泄露与破坏的范围。"
    },
    {
      "type": "exercise",
      "title": "为 shop 应用设计最小权限授予",
      "description": "为电商订单应用创建一个应用账号，按“只能访问业务需要的最小权限”授予权限：只读商品、能写入订单相关表、绝不能删表和收走高危权限，并把管理账号与应用账号分开；最后用 SHOW GRANTS 验证。",
      "hint": "想想下单流程会写哪些表、报表只读服务需要哪些权限；管理账号单独建并只允许 localhost 登录。"
    },
    {
      "type": "keypoints",
      "items": [
        "注入本质：用户输入被拼进 SQL 字符串，变成了可执行结构而不是值",
        "主防线是参数化查询 / Prepared Statement：值与 SQL 结构分离",
        "动态标识符（表名/列名/排序字段）单独做白名单，不能用用户输入直接拼",
        "纵深防御：入口校验 + 必要时的转义 + CI 扫描，多一层就多一层保险",
        "最小权限：应用账号按表授最小操作，应用绝不用 root / ALL / GRANT",
        "管理账号与应用账号分开，REVOKE 收走不再需要的权限并定期审计"
      ]
    }
  ]
};
