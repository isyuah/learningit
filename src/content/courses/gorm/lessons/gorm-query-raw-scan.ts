/* ==================================================================
 * 课时：原生 SQL、Scan 与子查询（gorm-query-raw-scan）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-query-raw-scan",
  "courseSlug": "gorm",
  "title": "原生 SQL、Scan 与子查询",
  "summary": "当查询链表达不动时退回 Raw，用 Scan/Pluck 接住结果，学会在子查询里嵌套查询。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "GORM 的查询链能力很强，但总有它表达吃力的时候：窗口函数、复杂的 UNION、数据库专有语法。这时 GORM 给了你一条直通道——db.Raw 写原生 SQL，再用 Scan 把结果扫进结构体。这一讲讲 Raw/Exec、Scan 的目标形态、Pluck 取单列，以及更优雅的子查询方案。"
    },
    {
      "type": "heading",
      "text": "db.Raw + Scan：自己写 SELECT"
    },
    {
      "type": "paragraph",
      "text": "db.Raw(sql, args...) 把整条原生 SQL 交给数据库执行。它不在乎 GORM 的模型约定，你写什么 SQL 就跑什么。结果用 Scan 收进结构体切片或单结构体。参数依旧用 ? 占位符，同样受预编译保护——原生 SQL 不等于可以拼接。"
    },
    {
      "type": "code",
      "title": "Raw + Scan",
      "language": "go",
      "code": "type Row struct {\n    Name string\n    PostCount int\n}\nvar rows []Row\n\n// 复杂的 JOIN + GROUP BY，用链式写起来绕，原生一眼看懂\n// 注意仍用 ? 占位符，不要拼接阈值\nthreshold := 5\ndb.Raw(\n    `SELECT u.name, COUNT(p.id) AS post_count\n     FROM users u\n     LEFT JOIN posts p ON p.user_id = u.id\n     GROUP BY u.id\n     HAVING COUNT(p.id) >= ?`,\n    threshold,\n).Scan(&rows)\n\n// 单行结果\nvar one Row\ndb.Raw(\"SELECT COUNT(*) AS post_count FROM posts\").Scan(&one)"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别给同一块代码又占位符又拼接",
      "body": "Raw 的 SQL 字符串里仍然只放 ? 占位，用户输入继续走参数。两条铁律永远成立：①任何值都别字符串拼接；②列名/表名仍需要白名单。Raw 多了灵活性，但也把类型检查、跨数据库方言、模型映射这些保护一并交给你自己负责——能力越大，责任越大。"
    },
    {
      "type": "heading",
      "text": "扫描目标：结构体、切片还是 map"
    },
    {
      "type": "paragraph",
      "text": "Scan 的结果目标有三种常见形态，取舍看你是否关心列的类型与名字："
    },
    {
      "type": "list",
      "items": [
        "结构体切片 []T——最常用，列名与结构体字段（或 tag）对齐，类型安全，推荐",
        "单个结构体指针——取一行",
        "[]map[string]interface{}——列名任意、值类型由数据库决定，最灵活但类型要靠断言，常用于动态列或调试"
      ]
    },
    {
      "type": "code",
      "title": "map 目标与 Pluck 单列",
      "language": "go",
      "code": "// 结果打进 map 列表：每行一个 map，键是列名\nvar rows []map[string]interface{}\ndb.Raw(\"SELECT id, name FROM users LIMIT 3\").Scan(&rows)\n// rows[0][\"name\"] 是 interface{}，可能需要类型断言\n\n// Pluck 只适合「单列进切片」。若要两列组成键值映射，\n// 用 Select 选两列、Scan 进 map（key 列做键、value 列做值）更清晰。\nvar names []string\ndb.Model(&User{}).\n    Where(\"age >= ?\", 18).\n    Pluck(\"name\", &names)\n// 等价于 SELECT name FROM users WHERE age >= 18"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "断言 Scan 目标，避免类型不匹配",
      "body": "Scan 到结构体时，若某列返回 NULL 或数据库类型与字段类型不匹配（如字符串塞进 int），会报错或得到零值。用 map 则没有这种保护，值全是 interface{}，取值后必须手动断言。工程上优先用带类型的结构体，把类型边界压实。"
    },
    {
      "type": "heading",
      "text": "db.Exec：非查询的原生 SQL"
    },
    {
      "type": "paragraph",
      "text": "Raw 用于返回结果集的 SELECT；不返回行、只需执行效果的语句（UPDATE/DELETE/DDL）用 db.Exec。二者都会走预编译，Exec 同样接受 ? 参数。"
    },
    {
      "type": "code",
      "title": "Exec 批量更新",
      "language": "go",
      "code": "// 原生 UPDATE，注意还是用占位符\nres := db.Exec(\"UPDATE posts SET like_count = like_count + ? WHERE id = ?\", 1, postID)\nif res.Error != nil {\n    return res.Error\n}\n// 受影响行数\naffected := res.RowsAffected\n\n// Exec 也能执行 DDL（建索引等）\ndb.Exec(\"CREATE INDEX idx_posts_user ON posts(user_id)\")"
    },
    {
      "type": "heading",
      "text": "子查询：把 GORM 查询嵌进另一个查询"
    },
    {
      "type": "paragraph",
      "text": "很多“写完再查”的场景不需要整条 Raw。GORM 允许把一条链式 GORM 查询（db.Table(...).Select(聚合)...）作为子查询塞进 Where 或 From 里，让它生成一个带括号的嵌套 SELECT。这样既保留类型保护，又能组合。"
    },
    {
      "type": "code",
      "title": "Where 里嵌套子查询",
      "language": "go",
      "code": "var users []User\n\n// 找出年龄 > 全体平均年龄的用户\n// SELECT * FROM users WHERE age > (SELECT AVG(age) FROM users)\nsub := db.Table(\"users\").Select(\"AVG(age)\")\ndb.Where(\"age > (?)\", sub).Find(&users)\n\n// 找出发过至少一篇帖子的用户\n// SELECT * FROM users WHERE id IN (SELECT DISTINCT user_id FROM posts)\npostSub := db.Table(\"posts\").Select(\"DISTINCT user_id\")\ndb.Where(\"id IN (?)\", postSub).Find(&users)\n\n// 子查询也可以作为 SELECT 的一部分\n// SELECT id, name, (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) AS cnt ...\ndb.Model(&User{}).\n  Select(\"id, name, (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id) AS post_count\").\n  Scan(&rows)"
    },
    {
      "type": "heading",
      "text": "何时该用 Raw，何时该留在链式"
    },
    {
      "type": "definition",
      "term": "Raw vs 链式 Builder 的取舍",
      "definition": "链式 builder 提供类型检查、数据库方言翻译、模型映射、软删除等自动处理，可移植性好；Raw 把控制权全部交给你，适合浏览器特定方言、复杂窗口函数、性能手写 SQL 的场合，代价是放弃类型安全与跨库移植。原则：能表达就用链式，表达不动或性能敏感再降级到 Raw。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "尊重数据库方言，别默认 Raw 就更快",
      "body": "Raw 写的是你当前数据库的方言——换库就得重写。软删除（DeletedAt 非空才可见）在 Raw 里不会自动加上过滤，你可能把「已删除」的行也查出来。只有当你清楚自己在牺牲什么时才选 Raw；多数统计查询用子查询版链式写法即可，且可读性不差。"
    },
    {
      "type": "quiz",
      "question": "下面关于 db.Raw 的处理，哪一项是安全且推荐的写法？",
      "options": [
        "db.Raw(\"SELECT * FROM users WHERE name = '\" + name + \"'\")",
        "db.Raw(\"SELECT * FROM users WHERE name = ?\", name)",
        "db.Raw(\"SELECT * FROM users WHERE name = \" + name + \" LIMIT 1\")",
        "db.Raw(\"SELECT \" + column + \" FROM users\") 且 column 来自前端直接传"
      ],
      "answer": 1,
      "explanation": "Raw 的 ? 仍然是预编译占位符，参数会被安全地绑定，这正是防止 SQL 注入的写法。字符串拼接（1、3）和把列名直接拼接（4）都是注入或语法风险。"
    },
    {
      "type": "exercise",
      "title": "子查询迁移",
      "description": "把下面这条 Raw 改写为链式 + 子查询版本，且结果等价：db.Raw(\"SELECT * FROM users WHERE age > (SELECT AVG(age) FROM users)\").Scan(&users)。指出改写后你保留了哪些保护（类型、软删除等）。",
      "hint": "sub := db.Table(\"users\").Select(\"AVG(age)\"); db.Where(\"age > (?)\", sub).Find(&users)。改写后由 GORM 处理软删除过滤与模型映射，行为更可移植。"
    },
    {
      "type": "keypoints",
      "items": [
        "Raw + Scan 写原生 SELECT；Exec 执行非查询原生语句，均用 ? 占位符",
        "Scan 目标：结构体（类型安全）、单结构体、或 []map[string]interface{}（灵活但靠断言）",
        "Pluck 取单列进切片/键值 map；复合查询可用子查询嵌入",
        "子查询：把 db.Table(...).Select(...) 嵌进 Where 的 (?) 里，保留类型保护",
        "Raw 放弃类型安全与跨库移植、不自动处理软删除，能链式就链式"
      ]
    }
  ]
};
