/* ==================================================================
 * 课时：Select、排序、分页与聚合（gorm-query-advanced）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-query-advanced",
  "courseSlug": "gorm",
  "title": "Select、排序、分页与聚合",
  "summary": "控制列、排序、翻页、去重与分组聚合，组合出能直接落地的查询链。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "条件查得再准，如果列选得太多、顺序乱、数量不受控，结果依然不好用。这一讲我们把查询的“形状”控制住：Select 决定取哪些列、Order 决定顺序、Limit/Offset 决定页码、Distinct 去重、Group/Having 做聚合。它们是 GORM 查询链里出场率最高的几个方法。"
    },
    {
      "type": "heading",
      "text": "Select：只要需要的列"
    },
    {
      "type": "paragraph",
      "text": "默认 Find 会 SELECT *。当表很宽（Body、Token 等大字段）时，全列带回既浪费带宽又占内存。Select 让你只取指定列，扫描进对应结构体的字段，其余保持零值。"
    },
    {
      "type": "code",
      "title": "Select 列与计算表达式",
      "language": "go",
      "code": "var users []User\n\n// 只取两列\n// SELECT id, name FROM users\n// 其余字段（email、age…）保持零值\ndb.Select(\"id\", \"name\").Find(&users)\n\n// 也可以写计算表达式：取个更易读的别名\n// SELECT id, UCASE(name) AS upper_name FROM users\n// 需要一个临时结构体来承接别名字段\ntype Row struct {\n    ID         uint\n    UpperName  string\n}\n\nvar rows []Row\ndb.Model(&User{}).Select(\"id, UCASE(name) AS upper_name\").Scan(&rows)\n\n// 用 go 方言函数更好：CONCAT/COUNT/SUM 等聚合也能放在 Select 里"
    },
    {
      "type": "heading",
      "text": "Order：排序与多级排序"
    },
    {
      "type": "paragraph",
      "text": "Order(\"列 方向\") 指定排序，方向是 SQL 的 ASC/DESC。多个 Order 会按出现顺序叠加，先列优先级越高。若排序依据来自用户输入，务必用白名单校验，因为这一列名无法用 ? 占位符保护。"
    },
    {
      "type": "code",
      "title": "Order 多级与原生片段",
      "language": "go",
      "code": "// 先按 age 降序，同龄再按 id 升序\n// SELECT * FROM users ORDER BY age DESC, id ASC\ndb.Order(\"age DESC\").Order(\"id ASC\").Find(&users)\n\n// 需要表达式（如按某个计算列）时直接给它原始片段\ndb.Order(\"CHAR_LENGTH(name) DESC\").Find(&users)\n\n// 排序列的列名不要直接拼用户输入，用白名单映射\nsortMap := map[string]string{\"newest\": \"created_at\", \"hottest\": \"like_count\"}\ncol := sortMap[reqSort] // 查不到就退回默认\nif col == \"\" {\n    col = \"id\"\n}\ndb.Order(col + \" DESC\").Find(&users)"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "排序列名无法用占位符，必须白名单",
      "body": "Order(\"?\", col) 里的列名不能写成占位符——占位符只适用于值，GORM 不会给列名做参数化。所以传给 Order 的列名一旦来自用户输入，就要用 map 白名单映射，否则 `name; DROP TABLE...` 这类片段会直接被拼进 SQL。值与运算符可以用占位符，列名请走白名单。"
    },
    {
      "type": "heading",
      "text": "Limit / Offset：分页"
    },
    {
      "type": "paragraph",
      "text": "分页通常就是 LIMIT 每页条数、OFFSET 跳过前面多少条。OFFSET = (页码 - 1) × 每页条数。两者可单独用，也可配合 Order 使用——没有稳定的排序，分页结果会在翻页时“串行”跳跃。"
    },
    {
      "type": "code",
      "title": "Offset 与 Limit 的数学关系",
      "language": "go",
      "code": "page, pageSize := 3, 20\n\n// OFFSET = (page-1)*pageSize = 40\n// SELECT * FROM posts ORDER BY created_at DESC\n//        LIMIT 20 OFFSET 40\ndb.Model(&Post{}).\n  Order(\"created_at DESC\").\n  Limit(pageSize).\n  Offset((page - 1) * pageSize).\n  Find(&posts)"
    },
    {
      "type": "definition",
      "term": "OFFSET 与函数参数的区别",
      "definition": "Offset 接受整型偏移量（跳过多少行），Limit 接受最多返回多少行。二者与 Order 一起构成分页三件套；缺了稳定的 Order，OFFSET 翻页会产生重复或漏行。"
    },
    {
      "type": "heading",
      "text": "Distinct、Group 与 Having"
    },
    {
      "type": "paragraph",
      "text": "Distinct 去掉重复行；Group 按列分组，配合聚合函数统计；Having 是在分组之后对聚合结果做过滤（WHERE 管的是分组前的行）。这三件套把「明细查询」升级成「统计查询」。"
    },
    {
      "type": "code",
      "title": "Distinct 与 Group + Having",
      "language": "go",
      "code": "// 去重：每个不同的 age 值一行\nvar ages []int\ndb.Model(&User{}).Distinct(\"age\").Pluck(\"age\", &ages)\n\n// 每个作者发的文章数，只保留 ≥10 篇的作者\ntype CountRow struct {\n    UserID uint\n    Count  int\n}\nvar rows []CountRow\n\ndb.Model(&Post{}).\n  Select(\"user_id, COUNT(*) AS count\").\n  Group(\"user_id\").\n  Having(\"COUNT(*) >= ?\", 10).\n  Scan(&rows)"
    },
    {
      "type": "heading",
      "text": "把结果选进自定义结构体"
    },
    {
      "type": "paragraph",
      "text": "聚合查询的结果不是一个 Post 或 User，这时最好定义只装这一行结果的小结构体，再用 Scan 填充。Scan 与 Find 的区别是：Find 需要 Model 或表名推断目标表，Scan 直接把结果扫进给定结构体，适合定制列。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "Scan 与 Find 的选择",
      "body": "当你 Select 了与结构体不完全对齐的列（重命名、聚合、不存在的字段）时，用临时结构体 + Scan 最干净。若列名能对齐到现有模型，Find 也行。Scan 不关心目标结构体是否等于某个表模型，它只按列名与字段匹配扫描。"
    },
    {
      "type": "code",
      "title": "一个完整的分页模型",
      "language": "go",
      "code": "func Paginate[T any](db *gorm.DB, page, pageSize int) ([]T, int64, error) {\n    var items []T\n    var total int64\n\n    // 先数总数——注意用同一份条件（这里把条件也传出去更严谨）\n    // 用一个只会执行一条 COUNT 的副本\n    db.Model(&T{}).Count(&total)\n\n    // 再取当前页\n    err := db.\n        Order(\"id ASC\").\n        Limit(pageSize).\n        Offset((page - 1) * pageSize).\n        Find(&items).Error\n    return items, total, err\n}\n\n// 使用（伪代码，T 换成具体模型）\n// items, total, err := Paginate[Post](db, 2, 10)"
    },
    {
      "type": "quiz",
      "question": "db.Order(\"created_at DESC\").Limit(10).Offset(20).Find(&posts) 最接近下面的哪条 SQL？",
      "options": [
        "SELECT * FROM posts LIMIT 10 OFFSET 20 ORDER BY created_at DESC",
        "SELECT * FROM posts LIMIT 20 OFFSET 10",
        "SELECT * FROM posts ORDER BY created_at DESC LIMIT 10 OFFSET 20",
        "SELECT * FROM posts WHERE offset = 20 LIMIT 10"
      ],
      "answer": 2,
      "explanation": "Order 生成 ORDER BY created_at DESC，Limit(10) 是 LIMIT 10，Offset(20) 是 OFFSET 20。选项 1 与 3 语义等价（SQL 接受 LIMIT/OFFSET 出现在 ORDER BY 前后），但选项 3 是数据库最常见的规范写法，因此选它。含义都是：按时间倒序取第 21..30 条。"
    },
    {
      "type": "exercise",
      "title": "按热度分页",
      "description": "给 Post 组织一个新接口：按 like_count 降序、created_at 升序做多级排序，每页 15 条，返回第 3 页。写出完整的 GORM 链（含 ORDER BY、LIMIT、OFFSET），并说明为什么没有 Order 时这个分页结果不可靠。",
      "hint": "db.Model(&Post{}).Order(\"like_count DESC\").Order(\"created_at ASC\").Limit(15).Offset((3-1)*15).Find(&posts)；OFFSET 翻页依赖稳定排序，否则相同行可能跨页重复或漏读。"
    },
    {
      "type": "keypoints",
      "items": [
        "Select 列（含别名/聚合表达式），避免 SELECT * 拉全表",
        "Order 多级按调用顺序叠加；排序列名要走白名单，不能占位符化",
        "分页 = Limit(每页) + Offset((页-1)*每页)，配合稳定排序",
        "Distinct 去重，Group 分组，Having 过滤聚合结果",
        "定制列/聚合结果用临时结构体 + Scan 承接"
      ]
    }
  ]
};
