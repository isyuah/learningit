/* ==================================================================
 * 课时：删除与软删除（gorm-delete-soft）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-delete-soft",
  "courseSlug": "gorm",
  "title": "删除与软删除",
  "summary": "物理删除与软删除的判断依据、gorm.DeletedAt 的语义、Unscoped 的用途，以及软删除的代价与陷阱。",
  "minutes": 17,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "删除在 GORM 里有一个隐藏的分水岭：你的模型是否包含 gorm.DeletedAt 字段，直接决定 db.Delete 是「物理删除」还是「软删除」。这个判断是 GORM 替你做的——它像开关一样切换两种完全不同的行为。不搞清楚规则，你会困惑为什么删了还在、为什么查不到、为什么 Unscoped 突然出现了。"
    },
    {
      "type": "heading",
      "text": "默认是物理删除"
    },
    {
      "type": "paragraph",
      "text": "如果你的模型里没有 DeletedAt 字段，db.Delete 就是标准的 DELETE 语句，直接从表里删掉行。以本课的 User（含 DeletedAt）为例，先看一个「物理删除」的对照——这里用一个没有 DeletedAt 的 Post 模型来说明。"
    },
    {
      "type": "code",
      "title": "物理删除（模型无 DeletedAt）",
      "language": "go",
      "code": "// Post 结构体没有 DeletedAt 字段\nvar p Post\ndb.First(&p, 3)\nresult := db.Delete(&p)\n// DELETE FROM posts WHERE id = 3\n// 行被真正删除，无法恢复",
    },
    {
      "type": "paragraph",
      "text": "物理删除的代价是信息彻底丢失：删错了没法还原、审计无从谈起、被删除的行没法追溯。这就是「软删除」存在的理由。"
    },
    {
      "type": "heading",
      "text": "有 DeletedAt，就变成软删除"
    },
    {
      "type": "paragraph",
      "text": "GORM 约定：模型里只要出现 gorm.DeletedAt 字段，Delete 就不再发 DELETE，而是发 UPDATE，把 deleted_at 字段设为当前时间。这个字段就是软删除标记。"
    },
    {
      "type": "code",
      "title": "软删除（模型含 DeletedAt）",
      "language": "go",
      "code": "// User 含 DeletedAt gorm.DeletedAt\nvar u User\ndb.First(&u, 1)\ndb.Delete(&u)\n// UPDATE users SET deleted_at=now WHERE id=1 AND deleted_at IS NULL\n// 行还在，但被打上删除标记",
    },
    {
      "type": "subheading",
      "text": "查询默认看不到软删除的行"
    },
    {
      "type": "paragraph",
      "text": "软删除之后最影响日常的一点是：GORM 会默认在每次查询里附加 deleted_at IS NULL 条件，把软删除的行自动排除。也就是说，你查 User 时看到的是「未删除的全部用户」，被软删除的不会出现在结果里——这正是大多数业务想要的。"
    },
    {
      "type": "code",
      "title": "查询自动排除软删除",
      "language": "go",
      "code": "db.Find(&users)\n// SELECT * FROM users WHERE deleted_at IS NULL\n\nvar one User\ndb.First(&one, 1)\n// SELECT * FROM users WHERE id=1 AND deleted_at IS NULL\n// 若 id=1 已被软删除，则查不到，返回 ErrRecordNotFound",
    },
    {
      "type": "heading",
      "text": "Unscoped：越过软删除"
    },
    {
      "type": "paragraph",
      "text": "软删除的世界里，当你需要「看到」或「永久清除」已被软删除的行，就用 Unscoped()。它让查询不再附加 deleted_at IS NULL 过滤。"
    },
    {
      "type": "code",
      "title": "Unscoped 的两种用法",
      "language": "go",
      "code": "// 1. 查询时包含被软删除的行\nvar all []User\ndb.Unscoped().Find(&all) // 不带 deleted_at IS NULL，能看到全部\n\n// 2. 用 Unscoped + Delete 物理清除（真正的删除）\ndb.Unscoped().Delete(&u)\n// DELETE FROM users WHERE id=1  真正删掉，无法恢复",
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "软删除的「恢复」不是 SQL 层的事实",
      "body": "恢复本质是显式把 deleted_at 清回 NULL。更新时要用 Unscoped 取消默认的 deleted_at IS NULL 条件，例如 db.Unscoped().Model(&User{}).Where(\"id = ?\", id).Update(\"deleted_at\", nil)。只在内存里把 DeletedAt 置零再 Save 容易受到默认 scope 与 Save 语义影响，不适合作为恢复模板。物理删除一旦执行则无法靠 GORM 恢复。"
    },
    {
      "type": "heading",
      "text": "为什么用软删除，代价又是什么"
    },
    {
      "type": "paragraph",
      "text": "软删除赢得的是「可审计、可恢复、不破坏关联完整性的历史」：被删除的用户评论仍可追溯，删错能救回来，删掉主记录不会连带破坏外键关系。但它也有实打实的代价。"
    },
    {
      "type": "list",
      "items": [
        "行不会真消失，表会随着删除不断累积废弃数据，长跑之后越来越大",
        "每张含 DeletedAt 的表查询都要带 deleted_at IS NULL，索引和查询计划需为此设计",
        "被删的 User 若还有外键指向（如评论引用 user_id），不能直接物理删，得先处理依赖",
        "对「唯一约束」的行反复软删再新增，可能触发冲突（见下方陷阱）"
      ]
    },
    {
      "type": "subheading",
      "text": "软删除与唯一索引冲突的已知问题"
    },
    {
      "type": "paragraph",
      "text": "一个真实工程里常见的坑：User.Email 带 uniqueIndex 标签。流程是——创建用户 A（email=wu@x.com）→ 软删除它 → 再创建一个相同 email 的用户。按直觉第二次应该成功（因为 A 已「删除」），但往往报唯一键冲突。原因在于软删除并没有把行删掉：第一次插入和第二次插入都试图写入 email=wu@x.com 的行，而唯一索引（取决于它是否包含 deleted_at）仍认为两行冲突。GORM v2 的具体处理会随版本与驱动有所不同——在不同方言下，deleted_at 是否参与唯一索引、NULL 如何参与唯一性（多数数据库里多个 NULL 互不冲突）并不完全一致。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "软删除 + 唯一索引 = 隐藏雷区",
      "body": "在做“软删除后重建同名资源”前，先确定业务唯一性的真实含义。可选方案包括 PostgreSQL 的部分唯一索引、把删除状态编码进复合索引、使用 soft_delete 插件的非 NULL 标志位，或禁止复用该业务键。不要为了绕过冲突而移除本来必要的唯一约束；应用层先查再插也挡不住并发竞争。"
    },
    {
      "type": "heading",
      "text": "一句话把握软删除的心智模型"
    },
    {
      "type": "paragraph",
      "text": "有 DeletedAt = 软删除 = 用 UPDATE 打标 + 查询自动过滤 + Unscoped 可查看或真正清除；没有 DeletedAt = 物理删除 = 行直接消失。选择是否软删除的本质，是「以数据增长和唯一索引的复杂度，换取可审计与可恢复」。"
    },
    {
      "type": "quiz",
      "question": "User 模型包含 gorm.DeletedAt。执行 db.Delete(&u) 之后，再执行 db.First(&u, u.ID)，会发生什么？",
      "options": [
        "查询到该用户，一切正常",
        "返回 gorm.ErrRecordNotFound，因为查询自动加了 deleted_at IS NULL",
        "直接 panic",
        "查询仍能返回，但字段被清空"
      ],
      "answer": 1,
      "explanation": "含 DeletedAt 的模型被 Delete 会打上删除标记，之后所有常规查询自动附加 deleted_at IS NULL，被软删除的行不再返回，因此 First 拿到 ErrRecordNotFound。"
    },
    {
      "type": "exercise",
      "title": "理解软删除而非仅仅调用",
      "description": "不写任何代码，先在空数据库上推演：创建两个 User（id=1、2），软删除 id=1。然后分别设想 db.Find(&users) 返回什么、db.Unscoped().Find(&users) 返回什么、db.Unscoped().Delete(&u) 与 db.Delete(&u) 各自对 id=2 做了什么。写下来，再对着下面的要点核对。",
      "hint": "常规 Find 看不到 id=1；Unscoped().Find 能看到两个；db.Delete 是打标（deleted_at 非空），db.Unscoped().Delete 才是物理删行。"
    },
    {
      "type": "keypoints",
      "items": [
        "模型无 DeletedAt → db.Delete 是物理删除",
        "模型含 gorm.DeletedAt → DELETE 变 UPDATE deleted_at，查询默认附加 deleted_at IS NULL",
        "Unscoped() 查询可包含软删行；Unscoped().Delete 才真正物理清除",
        "软删除换来可审计、可恢复，代价是数据累积与查询开销",
        "软删除后重建同唯一键行可能冲突，需按驱动实测处理"
      ]
    }
  ]
};
