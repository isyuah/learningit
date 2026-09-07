/* ==================================================================
 * 课时：更新记录：Save、Updates 与零值处理（gorm-update）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-update",
  "courseSlug": "gorm",
  "title": "更新记录：Save、Updates 与零值处理",
  "summary": "全量更新 Save 与部分更新 Updates 的区别、struct 与 map 的零值行为差异，以及经典陷阱。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "更新是 CRUD 里陷阱最密集的一环，几乎每一个踩坑都跟「零值」有关。理解这一节，需要先认清 GORM 两种更新工具的本质差异：Save 是做「整行替换式」的全量写入，Updates 是做「挑字段写」的部分更新。用错工具，轻则多写了对的列，重则把不该清空的字段清空了。"
    },
    {
      "type": "heading",
      "text": "Save：全量更新"
    },
    {
      "type": "paragraph",
      "text": "db.Save(&u) 的语义是「把这行按结构体当前状态整体重写」。它会把结构体里的所有字段都纳入 UPDATE 的 SET，包括零值——0、空串、false 都会被原样写进去。因此 Save 要求你传入的记录必须「完整」，通常是从数据库查出、改到一半、再 Save 回去的完整对象。"
    },
    {
      "type": "code",
      "title": "Save 会把所有字段都写上去",
      "language": "go",
      "code": "// 先查出来一个完整记录\nvar u User\ndb.First(&u, 1) // u.Name=\"小吾\", u.Age=28, u.Email=\"wu@example.com\"\n\nu.Age = 29\ndb.Save(&u)\n// UPDATE users SET name='小吾', email='wu@example.com',\n//   age=29, updated_at=now WHERE id=1\n// 所有列都被重写，零值也照写",
    },
    {
      "type": "heading",
      "text": "Updates：部分更新，默认跳过零值"
    },
    {
      "type": "paragraph",
      "text": "只有当你想改「几个字段」而不是整行重写时，才应该用 Updates。而 Updates 的第一个反直觉行为是：当传入的是结构体时，零值字段会被跳过，只有非零字段进入 SET。这是 GORM 为「部分更新」设计的默认保护——可它也成了最大的陷阱来源。"
    },
    {
      "type": "code",
      "title": "Updates 传 struct：零值被跳过",
      "language": "go",
      "code": "db.Model(&u).Updates(User{Name: \"新名字\"}) // 只改 name\n// UPDATE users SET name='新名字', updated_at=now WHERE id=1\n\n// 注意：如果传的 struct 里有 Age 但为 0，age 不会进 SET\n// 这通常是「幸运」——你想改的内容是零值时就改不进去",
    },
    {
      "type": "subheading",
      "text": "struct 与 map 的零值行为不一样"
    },
    {
      "type": "paragraph",
      "text": "Updates 的第二个关键点：它接受 struct 或 map 两种参数，而两者的零值处理规则相反。传 struct，零值字段被跳过；传 map，map 里出现的键都会被写入，包含零值（0、\"\"、false）。因为 map 的键是你显式写的——「我明确要求更新 age 为 0」，GORM 就照做。"
    },
    {
      "type": "table",
      "caption": "select 零值行为对比",
      "headers": [
        "参数类型",
        "零值字段",
        "典型用途"
      ],
      "rows": [
        [
          "struct",
          "默认跳过",
          "从表单拿到的部分字段更新，天然不会误清其它字段"
        ],
        [
          "map",
          "全部写入（含零值）",
          "确实要把某列改成 0 / 空串的时候"
        ],
        [
          "Save（全量）",
          "全部写入",
          "整行替换，字段必须完整"
        ]
      ]
    },
    {
      "type": "heading",
      "text": "经典陷阱：想把字段清零却清不掉"
    },
    {
      "type": "paragraph",
      "text": "最常见的 bug 是这样的：用户提交了一个表单，把 `Age` 从 28 改成 0（比如清空年龄字段），你写 db.Model(&u).Updates(User{Age: 0})，结果 age 纹丝不动。为什么？因为 Updates 传 struct 时跳过了零值 0。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "Updates 传 struct 会跳过零值，清零时请改用 map 或 Select",
      "body": "当你要「把一个字段显式清零」时，传 struct 是不生效的——0、\"\"、false 都被跳过。正确的做法是改用 map：db.Model(&u).Updates(map[string]interface{}{\"age\": 0})；或者用 Select 白名单强制该字段参与：db.Model(&u).Select(\"Age\").Updates(User{Age: 0})。反过来，如果你只改了 Name 一处、其余字段仍是零值的 partial struct 直接传 Updates，其他字段不会被动——这通常是你想要的保护，只是别指望它能清零。这条规则的记忆口诀：struct 省心但清不了零，map 能清零但要把每个要改的键写全。"
    },
    {
      "type": "subheading",
      "text": "单列更新 Update 的快捷写法"
    },
    {
      "type": "paragraph",
      "text": "只想更新一列时，用单数 Update。它和 Updates 的重要区别是：Update 的列与值是显式成对给出的，与结构体字段无关，因此不受「零值被跳过」影响——你把 Age 设为 0 也会生效。"
    },
    {
      "type": "code",
      "title": "update 单列",
      "language": "go",
      "code": "// 指定主键 + 单列\nvar u User\ndb.First(&u, 1)\ndb.Model(&u).Update(\"age\", 30)\n\n// 或直接按条件更新，无需先查\nresult := db.Model(&User{}).Where(\"name = ?\", \"小吾\").Update(\"age\", 30)\n\n// 单列也能写零值：\ndb.Model(&u).Update(\"age\", 0) // 生效！不跳过",
    },
    {
      "type": "heading",
      "text": "Select 与 Omit 控制更新范围"
    },
    {
      "type": "paragraph",
      "text": "无论 struct 还是 map，你都可以用 Select 和 Omit 微调参与更新的列。Select 是白名单（只更新这些列），Omit 是黑名单（更新除了这些之外的所有列）。它们也让 struct 传零值成为可能。"
    },
    {
      "type": "code",
      "title": "用 Select 强制清除零值",
      "language": "go",
      "code": "db.Model(&u).Select(\"Age\").Updates(User{Age: 0})\n// 因为 Age 被 Select 强制点名，0 也会作为 age=0 写进去\n\n// 保护某列永远不被 Updates 误写\ndb.Model(&u).Omit(\"Email\").Updates(User{Name: \"新名字\"})",
    },
    {
      "type": "subheading",
      "text": "UpdatedAt 的自动维护"
    },
    {
      "type": "paragraph",
      "text": "你的 User 模型里有 UpdatedAt time.Time。GORM 会在每次更新时自动把它设为当前时间并写进 SET。这意味着：即使你只改 Name 一个字段，updated_at 也会被刷新——这对「记录最后修改时间」非常有用，但也要意识到它是一个默认副作用。如果你用 Save 或 Updates 时不希望动某条时间戳，需要显式 Omit 掉它。"
    },
    {
      "type": "quiz",
      "question": "某用户的 Age=28、Name=\"小吾\"，执行 db.Model(&u).Updates(User{Name: \"新\", Age: 0}) 后，数据库里该行的 age 会变成多少？",
      "options": [
        "0",
        "28（保持不变）",
        "nil",
        "报错"
      ],
      "answer": 1,
      "explanation": "Updates 传 struct 时会跳过零值字段，Age=0 是零值，不会进入 SET，所以 age 保持原有 28。想清零必须用 map 或 Select。"
    },
    {
      "type": "keypoints",
      "items": [
        "Save 全量重写，所有字段（含零值）都写入",
        "Updates 传 struct 跳过零值，传 map 时键全写入（含零值）",
        "想清零字段用 map 或 Select，别指望 struct 的零值生效",
        "save 前一般先查出完整记录再改，避免用不完整对象覆盖",
        "Update 单列快捷、不受 struct 零值限制",
        "UpdatedAt 由 GORM 在更新时自动刷新，不想动需 Omit"
      ]
    }
  ]
};
