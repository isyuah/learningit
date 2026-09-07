/* ==================================================================
 * 课时：组合条件：Where、Not 与 Or（gorm-query-conditions）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-query-conditions",
  "courseSlug": "gorm",
  "title": "组合条件：Where、Not 与 Or",
  "summary": "用 ? 占位符安全地拼条件，理解 AND/OR 的嵌套语义与结构体零值陷阱。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一讲我们用 Find、First 读取了整张表。真实查询几乎总带着条件：「找出 2025 年之前注册、昵称叫小鱼的用户」。这一讲就来讲 GORM 组合条件的三件套——Where、Not、Or，以及它们的核心语义：链式的 Where 之间是 AND，Or 需要显式分组。"
    },
    {
      "type": "heading",
      "text": "db.Where：给查询加过滤条件"
    },
    {
      "type": "paragraph",
      "text": "最常用的形式是：第一个参数是带 ? 占位符的 SQL 片段，后面的参数依次填充到 ? 上。GORM 会把它编译成「预编译语句 + 参数绑定」，而不是把变量拼进 SQL 字符串里。"
    },
    {
      "type": "code",
      "title": "Where + 占位符",
      "language": "go",
      "code": "var users []User\n\n// age >= 18 且注册时间在 2025 年之前\n// 生成的 SQL 大致为：\n//   SELECT * FROM users WHERE age >= 18 AND created_at < ?\ndb.Where(\"age >= ?\", 18).\n  Where(\"created_at < ?\", time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)).\n  Find(&users)\n\n// 多个条件用逗号：等价于把两个条件用 AND 连接\ndb.Where(\"age >= ? AND created_at < ?\", 18, cutOff).Find(&users)\n\n// 字符串里还可以带表名/列名，只要不拼用户输入\ndb.Where(\"users.name LIKE ?\", \"小鱼%\").Find(&users)"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "绝不字符串拼接用户输入",
      "body": "永远把用户输入当参数放进 ? 占位符，绝不要这样写：db.Where(\"name = '\" + userInput + \"'\")。一旦 userInput 里混入 ' OR '1'='1 -- 之类的片段，就构成了 SQL 注入，可能泄露或篡改整张表。GORM 会把 ? 占位参数作为绑定值交给数据库预编译，注入代码只会被当成普通字符串值。这是所有 ORM 教程里最不该省的一课。"
    },
    {
      "type": "heading",
      "text": "链式 Where：默认就是 AND"
    },
    {
      "type": "paragraph",
      "text": "把查询拆成多个 .Where(...) 依次调用，它们会被 AND 连接。这样做的好处是可读性：每个片段只表达一个条件。多个 Where 与「一个 Where 里用 AND 拼」在语义上完全等价。"
    },
    {
      "type": "heading",
      "text": "Not 与 Or：取反和并集"
    },
    {
      "type": "paragraph",
      "text": ".Not(...) 包一层取反，.Or(...) 增加一个「或」的并列条件。难点在于 Or 的出现位置如何决定它的作用范围——尤其当后面还有条件时，Or 往往需要用分组把结合顺序说清楚，否则会得到「A 或 B 且 C」这种不是你以为的查询。"
    },
    {
      "type": "code",
      "title": "Not 与 Or 的组合",
      "language": "go",
      "code": "// 排除昵称是小鱼的用户\n// SELECT * FROM users WHERE NOT name = '小鱼'\ndb.Not(\"name = ?\", \"小鱼\").Find(&users)\n\n// 年龄小于 18 的、或是小鱼\n// SELECT * FROM users WHERE age < 18 OR name = '小鱼'\ndb.Where(\"age < ?\", 18).Or(\"name = ?\", \"小鱼\").Find(&users)\n\n// 关键陷阱：Or 后面还挂了条件时，需要把 Or 的分支用分组包起来\n// SELECT * FROM users WHERE age < 18 OR (name = '小鱼' AND age >= 30)\n// 但错误的写法 db.Where(\"age < ?\", 18).Or(\"name = ?\", \"小鱼\").Where(\"age >= ?\", 30)\n// 会生成：age < 18 OR name = '小鱼' AND age >= 30\n// 由于 AND 优先级高于 OR，等价于 age < 18 OR (name = '小鱼' AND age >= 30)？不——\n// 这正是混乱的来源，务必用分组显式表达。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "用分组（grouped Or）把结合顺序说清楚",
      "body": "当 Or 之后还要继续 AND 别的条件时，推荐用分组写法，避免把真伪完全押在 SQL 的优先级上：db.Where(\"age < ?\", 18).Or(\n  db.Where(\"name = ?\", \"小鱼\").Where(\"age >= ?\", 30),\n)。注意 GORM 的 Or 带一个 db.Where 参数叫「分组 Or」，它会生成 (name = '小鱼' AND age >= 30) 一个整体。断言的优先级规则容易写错，分组能让意图一目了然，也是代码 review 时的可读性保障。"
    },
    {
      "type": "heading",
      "text": "IN、LIKE、BETWEEN 与比较运算"
    },
    {
      "type": "paragraph",
      "text": "Where 的片段里可以直接使用 SQL 运算符，占位参数对齐到运算符。IN 尤其常用：一个切片参数会被展开成 (?,?,?,...) 的列表。"
    },
    {
      "type": "table",
      "caption": "常见运算符的 Where 写法",
      "headers": ["意图", "GORM 写法", "生成的 SQL 片段"],
      "rows": [
        ["属于某个集合", "db.Where(\"id IN ?\", []uint{1,2,3})", "id IN (?,?,?)"],
        ["模糊匹配（前缀）", "db.Where(\"name LIKE ?\", \"小%\")", "name LIKE '小%'"],
        ["区间", "db.Where(\"age BETWEEN ? AND ?\", 18, 30)", "age BETWEEN ? AND ?"],
        ["不等于", "db.Where(\"email <> ?\", \"x@y.z\")", "email <> ?"],
        ["大于等于", "db.Where(\"age >= ?\", 18)", "age >= ?"],
        ["集合取反", "db.Not(\"id IN ?\", []uint{1,2})", "id NOT IN (?,?)"]
      ]
    },
    {
      "type": "code",
      "title": "IN 与切片参数",
      "language": "go",
      "code": "ids := []uint{3, 7, 11}\n\n// GORM 会把 ids 切片展开成占位符列表\n// SELECT * FROM users WHERE id IN (?,?,?)  参数为 (3,7,11)\ndb.Where(\"id IN ?\", ids).Find(&users)\n\n// 空切片会生成永不匹配的 IN (NULL)，通常返回空结果而不是语法错误。\n// 业务层仍应区分“用户没有选择筛选项”和“明确筛选空集合”，避免误解请求语义。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "LIKE 的占位符要自己写 %",
      "body": "db.Where(\"name LIKE ?\", \"小%\") 里，% 是写在条件字符串中的通配符，参数只提供文本；如果写成 db.Where(\"name = ?\", \"小%\") 那只是精确匹配一个含 % 的名称。想要任意位置匹配就写 %小%，想逃逸字面量 % 可以用 ESCAPE，但绝大多数场景写 % 通配符就够了。"
    },
    {
      "type": "heading",
      "text": "用结构体、Map 或切片作为条件参数"
    },
    {
      "type": "paragraph",
      "text": "除了手写 SQL 片段，GORM 还允许直接把结构体或 map 当作条件：它们会被翻译成一批等值 AND 条件。这个写法的关键陷阱在于结构体的零值会被忽略。"
    },
    {
      "type": "code",
      "title": "结构体、map 与切片作为条件",
      "language": "go",
      "code": "// 结构体条件：只有『非零值』字段参与，字段之间是 AND\n// SELECT * FROM users WHERE name = '小鱼' AND age = 18\ndb.Where(&User{Name: \"小鱼\", Age: 18}).Find(&users)\n\n// 注意：Email 为空、Age 如果传 0 都不会生成条件\n// 所以不能依赖结构体条件去筛『等于 0』或『空字符串』\ndb.Where(&User{Name: \"小鱼\"}).Find(&users)\n// 上面只会过滤 name，即使你给 Age 传了 0\n\n// map 条件：所有键都会生成条件（包括 0 和空值）\n// SELECT * FROM users WHERE name = '小鱼' AND age = 0\n// 注意这里 age=0 是有效的！\ndb.Where(map[string]interface{}{\"name\": \"小鱼\", \"age\": 0}).Find(&users)\n\n// 主键切片：直接按主键批量查\n// SELECT * FROM users WHERE id IN (1,2,3)\ndb.Where([]uint{1, 2, 3}).Find(&users)"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "结构体条件会忽略零值——这是特性也是坑",
      "body": "因为 Go 的零值是 0、\"\"、nil、false，若让它们都生成条件，就无法表达「某列不等于 0」之外的查询，也无法区分「没填」和「填了 0」。GORM 因此约定结构体条件跳过零值字段。后果是：想筛 age=0 的用户，用结构体做不到，只能用 map 或手写片段。选哪种取决于你是否需要区分零值；需要精确控制时，用 map 或占位片段最保险。"
    },
    {
      "type": "heading",
      "text": "扫描结果"
    },
    {
      "type": "paragraph",
      "text": "Find(&users) 会把结果集扫描进切片（零行时得到空切片而非 nil），Find(&user) 传入单个结构体指针时只取第一条。配合条件，GORM 会自动拼出 SELECT 与 WHERE，你不需要手写 SELECT 列。"
    },
    {
      "type": "quiz",
      "question": "db.Where(\"age < ?\", 18).Or(\"name = ?\", \"小鱼\").Where(\"age >= ?\", 30) 的语义接近下面哪一项？",
      "options": [
        "age < 18 OR (name = '小鱼' AND age >= 30)",
        "(age < 18 OR name = '小鱼') AND age >= 30",
        "age < 18 AND name = '小鱼' AND age >= 30",
        "OR 会导致 SQL 语法错误"
      ],
      "answer": 1,
      "explanation": "链式 Where 之间是 AND，而管道顺序：先 Where(age<18).Or(name) 得到 (age<18 OR name)，再 .Where(age>=30) 整体 AND 上 age>=30。因为 AND 优先级高于 OR，最终 SQL 是 (age < 18 OR name = '小鱼') AND age >= 30。想表达别的含义请用分组 Or。"
    },
    {
      "type": "exercise",
      "title": "组合条件练习",
      "description": "写一个查询：找出「18 到 30 岁之间、且昵称以『小』开头的用户」，或者「邮箱是小鱼@example.com」的用户。要求：用 ? 占位符，绝不用拼接；再用结构体条件方式写一遍，并说明两者在这组需求下结果是否一定相同（提示：考虑 name 为空的用户）。",
      "hint": "一组写法：db.Where(\"age BETWEEN ? AND ?\", 18, 30).Where(\"name LIKE ?\", \"小%\").Or(\"email = ?\", \"小鱼@example.com\")；若要再 AND 别的条件就用分组 Or。结构体条件对这一需求无法可靠表达 LIKE 与 BETWEEN，只能用片段。"
    },
    {
      "type": "keypoints",
      "items": [
        "Where 的第一参是带 ? 的片段，后面的参数按序填充，绝对不要拼接用户输入",
        "多次链式 Where 之间是 AND；Or 需要时用分组把结合顺序显式化",
        "支持 IN、LIKE、BETWEEN 等运算符，切片参数会展开成占位符列表",
        "结构体条件忽略零值字段；map 条件全部键都生效——按需选用",
        "Find 进切片或单结构体指针，结果自动按列扫描"
      ]
    }
  ]
};
