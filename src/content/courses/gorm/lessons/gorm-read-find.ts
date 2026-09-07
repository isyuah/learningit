/* ==================================================================
 * 课时：读取记录：Find、First 与主键查询（gorm-read-find）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-read-find",
  "courseSlug": "gorm",
  "title": "读取记录：Find、First 与主键查询",
  "summary": "查询的四个入口 First/Find/Take/Last 各自语义、主键查询写法，以及 ErrRecordNotFound 的判断。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "读取是 CRUD 里你用得最多、也最容易写「看起来对但语义错」的部分。GORM 提供 First、Find、Take、Last 四个查询入口，它们的差异不只是名字，而是「结果为空时怎么处理」和「是否自动排序」这两种完全不同的语义。把这一点彻底搞清楚，你就能避免后面一大半的隐性 bug。"
    },
    {
      "type": "heading",
      "text": "四个查询入口的语义"
    },
    {
      "type": "paragraph",
      "text": "设 users 表里当前有 ID 为 1、2、3 三条记录。四者区别如下。"
    },
    {
      "type": "table",
      "caption": "四个查询入口的差异",
      "headers": [
        "方法",
        "结果为空时",
        "是否自动加 ORDER BY",
        "语义"
      ],
      "rows": [
        [
          "Take",
          "返回 ErrRecordNotFound",
          "不加",
          "取任意一行（数据库顺序）"
        ],
        [
          "First",
          "返回 ErrRecordNotFound",
          "按主键升序（ORDER BY id）",
          "取主键最小的那一行"
        ],
        [
          "Last",
          "返回 ErrRecordNotFound",
          "按主键降序（ORDER BY id DESC）",
          "取主键最大的那一行"
        ],
        [
          "Find",
          "不返回错误，留空结果",
          "不加",
          "取所有匹配行，可装进切片"
        ]
      ]
    },
    {
      "type": "paragraph",
      "text": "关键差异落在两点。第一：Take / First / Last 都是「取单行」，查询结果为空时它们返回 gorm.ErrRecordNotFound；而 Find 是「取多行」，结果为空时只是把目标变量留空，错误是 nil。第二：First 和 Last 会隐式按主键排序（First 升序 = 主键最小，Last 降序 = 主键最大），Take 不排序——它只是「拿一行」。"
    },
    {
      "type": "code",
      "title": "单行查询的典型写法",
      "language": "go",
      "code": "var u User\n\n// 取主键最小（等价于 ORDER BY id LIMIT 1）\nerr := db.First(&u).Error\n\n// 取任意一行（无排序）\nerr = db.Take(&u).Error\n\n// 取主键最大\nerr = db.Last(&u).Error",
    },
    {
      "type": "heading",
      "text": "主键查询的正确写法"
    },
    {
      "type": "paragraph",
      "text": "按主键查某一条，是后台最常见的需求。GORM 支持两种写法：直接把主键值作为第二个参数给 First / Take / Last，或者写一个显式条件。两者结果一样，前者更简洁。"
    },
    {
      "type": "code",
      "title": "按主键查询",
      "language": "go",
      "code": "var u User\n\n// 写法一：主键值直接传入（推荐）\ndb.First(&u, 5)\n\n// 写法二：显式条件\n// 注意这里 \"id = ?\" 是原始 SQL 片段，? 由值替代，无注入风险\ndb.First(&u, \"id = ?\", 5)",
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "数字 vs 字符串条件，别搞混",
      "body": "db.First(&u, 5) 里的 5 会被 GORM 识别为「主键值」，翻译成 id = 5。而 db.First(&u, \"id = ?\", 5) 里 \"id = ?\" 是完整的 SQL 条件。如果你想要的是「按 name 查」，两种写法并不等价：db.First(&u, \"name = ?\", \"小吾\") 才是对的；写成 db.First(&u, \"小吾\") 会被 GORM 当作主键值为 '小吾' 去查 id，多半查不到。分清「裸值 = 主键」和「SQL 片段 = 条件」是这节的第一个易错点。"
    },
    {
      "type": "heading",
      "text": "ErrRecordNotFound 与错误判断"
    },
    {
      "type": "paragraph",
      "text": "当单行查询找不到记录时，First/Take/Last 会返回 gorm.ErrRecordNotFound。处理它的正确姿势是用 errors.Is 判断，而不是 == 比较，因为 GORM 的错误可能被包裹（wrapped），用 errors.Is 才能穿透包裹层命中目标错误。"
    },
    {
      "type": "code",
      "title": "正确处理未找到",
      "language": "go",
      "code": "import (\n  \"errors\"\n  \"gorm.io/gorm\"\n)\n\nvar u User\nresult := db.First(&u, 999) // 不存在的 ID\n\nif errors.Is(result.Error, gorm.ErrRecordNotFound) {\n  // 业务上：该资源不存在，返回 404 或给出友好提示\n  fmt.Println(\"用户不存在\")\n  return\n}\n// 其它错误也要处理，不能只关心未找到\nif result.Error != nil {\n  fmt.Println(\"数据库出错:\", result.Error)\n  return\n}",
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "永远不要忽略返回值",
      "body": "db.First(&u, id) 即使查不到，u 也可能保留上次的零值，而错误在 result.Error 里。新手常写 var u User; db.First(&u, id); 用 u —— 未找到时它用的是零值记录，还毫无报错。请务必接收返回值并判断错误。GORM 全程采用「返回值里带错误」而非 panic 的设计，忽略错误等于把失败吞掉。"
    },
    {
      "type": "heading",
      "text": "扫进切片与 map"
    },
    {
      "type": "paragraph",
      "text": "查多条时用 Find，把一个切片指针传进去，GORM 会把所有匹配行依次填入。"
    },
    {
      "type": "code",
      "title": "扫进切片",
      "language": "go",
      "code": "// 扫进结构体切片（推荐，能拿到强类型字段）\nvar users []User\ndb.Find(&users) // SELECT * FROM users\n\n// 带条件\nvar adults []User\ndb.Where(\"age >= ?\", 18).Find(&adults)\n\n// 只想要少量列，可以扫进 map（弱类型）\nvar results []map[string]interface{}\ndb.Model(&User{}).Select(\"name\", \"age\").Find(&results)",
    },
    {
      "type": "paragraph",
      "text": "扫进结构体切片是首选：类型安全、字段名对齐、后续使用舒服。map 方案通常只用于「动态列、列名来自运行期配置」这类强类型结构体表达不了的需求，代价是丢失类型检查，Access 时要自己做断言。日常增删改查优先结构体。"
    },
    {
      "type": "subheading",
      "text": "Find 空结果不报错的场景"
    },
    {
      "type": "paragraph",
      "text": "正因为 Find 在空结果时返回 nil 错误，才能写出「查不到就当空列表返回」的简洁代码：列表页没有数据时，直接返回一个空 slice，让前端渲染空态即可。这是 Find 与单行查询最大的行为分水岭——如果你用 First 去查列表且没有数据，你会拿到 ErrRecordNotFound，必须单独处理。记住：查「一条」用 First/Take，查「多条」用 Find。"
    },
    {
      "type": "quiz",
      "question": "users 表当前为空，以下四个调用中，哪一个的错误是 nil（即不报错）？",
      "options": [
        "db.First(&u)",
        "db.Take(&u)",
        "db.Last(&u)",
        "db.Find(&users)"
      ],
      "answer": 3,
      "explanation": "First/Take/Last 都是单行查询，结果为空时返回 gorm.ErrRecordNotFound；只有 Find 是多行查询，空结果时把目标留空并返回 nil 错误。"
    },
    {
      "type": "keypoints",
      "items": [
        "First 按主键升序取一行、Last 按主键降序取一行、Take 无排序取任意一行",
        "First/Take/Last 为空时返回 gorm.ErrRecordNotFound，Find 为空时返回 nil",
        "db.First(&u, 5) 的裸值 5 被当作主键；想按其它列查要写 \"col = ?\" 条件",
        "用 errors.Is(err, gorm.ErrRecordNotFound) 判断未找到，别用 == 或忽略",
        "多行用 Find 扫进结构体切片，动态列场景才考虑 map",
        "查「一条」用 First/Take，查「多条」用 Find"
      ]
    }
  ]
};
