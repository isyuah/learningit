/* ==================================================================
 * 课时：Scopes：复用查询片段（gorm-query-scopes）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-query-scopes",
  "courseSlug": "gorm",
  "title": "Scopes：复用查询片段",
  "summary": "把反复出现的条件/排序/分页封装成可组合的片段，用 db.Scopes 按需叠加。",
  "minutes": 14,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "写多了你会发现：几乎每个列表接口都在重复「只取已发布的、按时间倒序、翻页」这几段条件。复制粘贴一遍、两遍还行，改需求时漏改一处就是 bug。GORM 的 Scopes 机制把这些片段封装成「可组合的函数」，一处定义、到处复用，还能灵活拼接。"
    },
    {
      "type": "heading",
      "text": "Scope：一个函数，返回 *gorm.DB"
    },
    {
      "type": "paragraph",
      "text": "一个 scope 就是一个类型为 func(*gorm.DB) *gorm.DB 的函数：它接收当前的查询链，往上面追加条件，再原样返回。定义阶段它什么都不执行，只有真正调用 db.Scopes(...) 触发 Find/Count 时才会生效。"
    },
    {
      "type": "code",
      "title": "定义与使用一个 scope",
      "language": "go",
      "code": "// 只取已发布的文章\nfunc Published(db *gorm.DB) *gorm.DB {\n    return db.Where(\"published = ?\", true)\n}\n\n// 最近的 N 条：按时间倒序 + 限数量\nfunc Recent(limit int) func(*gorm.DB) *gorm.DB {\n    return func(db *gorm.DB) *gorm.DB {\n        return db.Order(\"created_at DESC\").Limit(limit)\n    }\n}\n\n// 使用：把想要的片段按顺序交给 db.Scopes\nvar latestPosts []Post\n// SELECT * FROM posts WHERE published = true\n//        ORDER BY created_at DESC LIMIT 5\ndb.Scopes(Published, Recent(5)).Find(&latestPosts)"
    },
    {
      "type": "heading",
      "text": "参数化 scope：闭包传参"
    },
    {
      "type": "paragraph",
      "text": "很多条件是可变参数（比如按某段时间、按某个作者）。scope 工厂函数接收参数、返回真正的 scope 函数，用 Go 闭包把参数捕获进判断里。这样同一份逻辑能应对不同输入。"
    },
    {
      "type": "code",
      "title": "闭包给 scope 传参",
      "language": "go",
      "code": "// 按作者过滤，作者为空则不加条件\nfunc ByAuthor(authorID uint) func(*gorm.DB) *gorm.DB {\n    return func(db *gorm.DB) *gorm.DB {\n        if authorID == 0 {\n            return db\n        }\n        return db.Where(\"user_id = ?\", authorID)\n    }\n}\n\n// 组合多个参数化 scope\n// SELECT * FROM posts WHERE user_id = 7 AND published = true\n//        ORDER BY created_at DESC LIMIT 10\ndb.Scopes(ByAuthor(7), Published, Recent(10)).Find(&posts)"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "条件式返回 db 是合法的“空操作”",
      "body": "在 scope 里，当参数不满足条件时直接 return db（不追加任何条件）是常见且正确的写法。它让调用方永远在同一份整洁的链式代码里组合，而把“要不要过滤”的判断收进 scope 内部——调用处不会出现一排 if 分支。"
    },
    {
      "type": "heading",
      "text": "分页也封装成 scope"
    },
    {
      "type": "paragraph",
      "text": "分页的 Offset = (page-1)*pageSize 数学，最适合收进一个 scope 里统一维护，避免每个接口都手写一遍导致页码公式不一。"
    },
    {
      "type": "code",
      "title": "可复用的分页 scope",
      "language": "go",
      "code": "func Paginate(page, pageSize int) func(*gorm.DB) *gorm.DB {\n    return func(db *gorm.DB) *gorm.DB {\n        if page < 1 {\n            page = 1\n        }\n        if pageSize <= 0 {\n            pageSize = 10\n        }\n        offset := (page - 1) * pageSize\n        return db.Limit(pageSize).Offset(offset)\n    }\n}\n\n// 任意列表都能套用同一套分页规则\nvar users []User\ndb.Scopes(Paginate(2, 20)).Order(\"id ASC\").Find(&users)\n\nvar posts []Post\ndb.Scopes(Published, Paginate(3, 15)).Find(&posts)"
    },
    {
      "type": "heading",
      "text": "默认过滤与排序入口"
    },
    {
      "type": "paragraph",
      "text": "scope 也是给整批查询统一加“默认约束”的入口：比如所有用户查询都要排除某个内部账号、所有帖子列表都要按创建时间倒序。把这种业务规则收敛成 Named Scope，比散落在各函数里更好维护、也不容易漏。"
    },
    {
      "type": "code",
      "title": "默认过滤/排序 scope",
      "language": "go",
      "code": "// 业务规则：列表默认排除内部测试账号\nfunc ExcludeInternal(db *gorm.DB) *gorm.DB {\n    return db.Not(\"email LIKE ?\", \"internal@%\")\n}\n\nfunc DefaultOrder(db *gorm.DB) *gorm.DB {\n    return db.Order(\"created_at DESC\")\n}\n\n// 一处改，处处生效\ndb.Scopes(ExcludeInternal, DefaultOrder, Paginate(1, 10)).Find(&users)"
    },
    {
      "type": "heading",
      "text": "为什么 scope 优于复制粘贴"
    },
    {
      "type": "paragraph",
      "text": "对比两种做法：复制粘贴让「已发布」这个条件出现在二十处，改需求（比如改成 is_deleted=0 AND published=1）就要碰二十个地方，漏一个就是线上 bug。scope 把它收敛成一处：改一个函数，所有调用方自动带新语义。副作用是组合顺序有讲究（先过滤再排序再分页通常更清晰），但比起维护二十份条件，这点复杂度值得。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "scope 是叠加，不是隔离",
      "body": "db.Scopes 传递给 scope 的是同一个查询链，scope 里追加的条件会继续参与后续 Find/Count。它非常适合“条件复用”，但它不会帮你隔离命名空间或作用域。如果某处不小心在 scopes 之后又 .Order，可能重复排序。组合时保留清晰的书写顺序。"
    },
    {
      "type": "quiz",
      "question": "已定义 Paginate(page,pageSize) 为分页 scope。下面哪一段能正确返回第 2 页、每页 20 条、且只含已发布文章？",
      "options": [
        "db.Scopes(Paginate(2, 20), Published).Find(&posts)",
        "db.Find(&posts, Paginate(2, 20), Published)",
        "db.Order(\"created_at\").Paginate(2, 20).Find()",
        "db.Limit(20).Offset(0).Scopes(Published).Find(&posts)"
      ],
      "answer": 0,
      "explanation": "scope 通过 db.Scopes(...) 按顺序叠加，Paginate(2,20) 生成 Limit(20) Offset(20)。选项 2 的传参方式不存在、3 的 Paginate 不是链式方法、4 的 Offset(0) 是第 1 页而非第 2 页。"
    },
    {
      "type": "exercise",
      "title": "用 scope 重构两个接口",
      "description": "接口 A 与接口 B 目前各自写了「只取已发布、按时间倒序、分页」三行，且 A 还多一个按作者过滤。请把它们重构为名为 Published、DefaultOrder、Paginate、ByAuthor 的 scope（你可以参考本文），然后把两个接口各自改写为一行 db.Scopes(...)。注明每个接口传入的 scope 参数。",
      "hint": "A：db.Scopes(ByAuthor(aid), Published, DefaultOrder, Paginate(page, size))；B：db.Scopes(Published, DefaultOrder, Paginate(page, size))。重复条件全部收敛进 scope。"
    },
    {
      "type": "keypoints",
      "items": [
        "scope = func(*gorm.DB) *gorm.DB；只追加条件，触发时才会执行",
        "用闭包工厂给 scope 传参；参数不满足时 return db 是合法空操作",
        "db.Scopes(...) 按顺序叠加多个片段（过滤→排序→分页）",
        "把分页数学、默认过滤/排序收敛成 scope，避免复制粘贴漏改",
        "scope 是叠加而非隔离，组合顺序要保持清晰"
      ]
    }
  ]
};
