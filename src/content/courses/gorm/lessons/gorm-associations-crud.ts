/* ==================================================================
 * 课时：关联操作：Append、Replace 与 Clear（gorm-associations-crud）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-associations-crud",
  courseSlug: "gorm",
  title: "关联操作：Append、Replace 与 Clear",
  summary: "在关联之间增删改：Association 模式、嵌套创建/保存，以及外键约束下的删除语义。",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前两节解决了「关联怎么建模」和「怎么把关联查出来」。这一节转向「怎么改关联」：如何给用户新增一篇文章、把文章的标签整个换成另一批、解绑某条评论，以及删除父记录时子记录怎么办。",
    },
    {
      type: "heading",
      text: "Association 模式：只操作关系本身",
    },
    {
      type: "paragraph",
      text: "GORM 提供 `Association(\"字段名\")` 进入关联管理模式。它接收一个已存在的「拥有方」记录，然后围绕该关联做 Append / Replace / Delete / Clear / Count。先从一个对象开始理解：这些操作管理的是「User 与它的一堆 Post」之间关系的增删。",
    },
    {
      type: "code",
      title: "进入关联模式",
      language: "go",
      code: "var user User\nif err := db.First(&user, 7).Error; err != nil {\n    return err\n}\n\n// 以 user 为宿主，操作它的 Posts 关联\nassoc := db.Model(&user).Association(\"Posts\")",
    },
    {
      type: "subheading",
      text: "Append：在现有关系上追加",
    },
    {
      type: "paragraph",
      text: "Append 把新记录加入关联。对 has many / belongs-to，它会写外键让子记录归属到宿主；对 many2many，它会往连接表插入对应行。",
    },
    {
      type: "code",
      title: "Append 追加关联",
      language: "go",
      code: "// 追加一篇新文章（也会把文章 create 出来，并填上 user_id）\nc1 := &Post{Title: \"第一课\"}\nc2 := &Post{Title: \"第二课\"}\ndb.Model(&user).Association(\"Posts\").Append(c1, c2)\n\n// 追加一批已存在的标签（many2many：往 post_tags 写行）\nvar tags []Tag\ndb.Where(\"name IN ?\", []string{\"gorm\", \"go\"}).Find(&tags)\ndb.Model(&post).Association(\"Tags\").Append(tags)",
    },
    {
      type: "callout",
      variant: "tip",
      title: "Append 的关键性质",
      body: "Append 不是「替换」，而是「追加」：它不会动关联里已有的记录。传进去的对象若还没存在（无主键），GORM 会先创建它们再建立关联。",
    },
    {
      type: "subheading",
      text: "Replace：整体换成新集合",
    },
    {
      type: "paragraph",
      text: "Replace 先把当前关联清空，再写入给定集合。它适合「把一篇文章的标签整体更新掉」这种场景。",
    },
    {
      type: "code",
      title: "Replace 整体替换关联",
      language: "go",
      code: "var freshTags []Tag\ndb.Where(\"name IN ?\", []string{\"advanced\", \"orm\"}).Find(&freshTags)\n\n// 这篇文章的标签整体变成 freshTags（旧的配对被清掉）\ndb.Model(&post).Association(\"Tags\").Replace(freshTags)",
    },
    {
      type: "subheading",
      text: "Delete 与 Clear：解绑，不是删除记录",
    },
    {
      type: "paragraph",
      text: "Delete 从关联里移除指定的记录；Clear 把整个关联清空。对 many2many 而言，它们操作的是连接表——只是「解绑」，并不会删除 Post 或 Tag 本身。",
    },
    {
      type: "code",
      title: "Delete 解绑指定项、Clear 清空全部",
      language: "go",
      code: "// 把 tagA 从文章的标签里解绑（post_tags 里删一行）\ndb.Model(&post).Association(\"Tags\").Delete(tagA)\n\n// 清空该用户的所有文章关联（注意语义，见下）\ndb.Model(&user).Association(\"Posts\").Clear()",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Delete / Clear 的语义因关联类型而异",
      body: "对 many2many，Delete/Clear 只动连接表，原件安全。但对 belongs-to / has one 这类单侧外键的关联，Clear 解绑时通常会把「子记录」也一并删除（清掉外键所属记录），行为与 many2many 不同。务必先明确关联类型再决定用 Clear 还是自己改外键，免得误删数据。",
    },
    {
      type: "subheading",
      text: "Count：数一数关联数量",
    },
    {
      type: "code",
      title: "统计关联数量",
      language: "go",
      code: "n := db.Model(&post).Association(\"Tags\").Count()\n// 返回这篇文章当前的标签数量",
    },
    {
      type: "heading",
      text: "创建记录时带上关联（嵌套创建）",
    },
    {
      type: "paragraph",
      text: "除了先建父再逐个 Append，也可以在 create 一个带关联字段的对象时，让 GORM 一次性把整套都写进库。这就是嵌套创建（full save associations）。",
    },
    {
      type: "code",
      title: "一次 Create 用户 + 文章 + 标签",
      language: "go",
      code: "user := User{\n    Name: \"小明\",\n    Profile: Profile{Bio: \"Go 爱好者\"},\n    Posts: []Post{\n        {\n            Title: \"第一篇\",\n            Tags:  []Tag{{Name: \"gorm\"}, {Name: \"入门\"}},\n        },\n    },\n}\n\n// Create 会递归地插入 User → Profile → Post → Tag，并建立各自关系\nif err := db.Create(&user).Error; err != nil {\n    return err\n}",
    },
    {
      type: "paragraph",
      text: "一次 Create 看起来简单，实际上会按依赖顺序插入多张表并回填主键、外键、连接表行。正因为有多条写操作，GORM 默认把这类关联处理放进事务里（默认事务），失败会整体回滚。" ,
    },
    {
      type: "heading",
      text: "Update / Save 与关联、外键",
    },
    {
      type: "paragraph",
      text: "Create/Save 默认会处理非零关联并主要维护外键引用，但不会把所有既有关联字段做完整同步。确实需要把整个对象图状态写回数据库时，要显式使用 Session{FullSaveAssociations: true}；这会放大 SQL 数量和覆盖范围，应先限定 Select/Omit 并放在清晰的事务边界内。",
    },
    {
      type: "code",
      title: "默认保存与 FullSaveAssociations",
      language: "go",
      code: "// 默认：更新父记录，并按默认规则维护关联引用\npost.Title = \"改标题\"\ndb.Save(&post)\n\n// 明确要求完整同步关联字段时才启用\nerr := db.Session(&gorm.Session{FullSaveAssociations: true}).\n    Updates(&post).Error\n\n// 只改标题时，用窄操作表达意图更安全\ndb.Model(&post).Update(\"title\", \"新标题\")",
    },
    {
      type: "callout",
      variant: "warning",
      title: "用手改外键不等于管理关联",
      body: "直接给 Post.UserID 赋值、再 Save，只是写了外键列，并没有同步更新 User 结构体字段、也没经过关联管理。大多数场景应优先用 Association(\"Posts\"…)。如果两者混用，容易造成「外键已改、关联对象还是旧的」的不一致状态。",
    },
    {
      type: "heading",
      text: "删除父记录时，子记录怎么办",
    },
    {
      type: "paragraph",
      text: "删除关联的宿主是常见的业务操作：删了一个用户，他的文章和简介该怎样。GORM 不默认级联，行为由数据库的外键约束（ON DELETE）决定，而这正是第一节引入 constraint 标签的地方。",
    },
    {
      type: "code",
      title: "删除宿主前先处理子数据",
      language: "go",
      code: "// 方式一：先清空/解绑，再删用户（安全、可控）\ndb.Model(&user).Association(\"Posts\").Clear()  // 视关联类型解绑或删子\nif err := db.Delete(&user).Error; err != nil {\n    return err\n}\n\n// 方式二：依靠约束级联（需在建模时声明）\n// type Post struct { ... User User `gorm:\"constraint:OnDelete:CASCADE;\"` }\n// db.Delete(&user)  // 依靠数据库把相关 Post 一并删掉",
    },
    {
      type: "callout",
      variant: "warning",
      title: "没有约束就没有级联",
      body: "如果外键列有约束拒绝删除（例如 NOT NULL 且无 ON DELETE），DB 会直接报错；要在 GORM 侧实现级联，就得先迁移出带 constraint:OnDelete:CASCADE 的约束。注意：GORM 的删除钩子（如软删除）与数据库级联是两套机制，不要想当然地以为软删父记录就一定级联软删子记录。",
    },
    {
      type: "heading",
      text: "关联操作默认在事务里执行",
    },
    {
      type: "paragraph",
      text: "一条关联操作往往涉及多次写（插入子、写连接表、更新外键），GORM 默认会把这些放进一个事务，要么全成、要么全回滚，避免半途而废造成脏数据。这也是嵌套 Create 看起来「一步写成一套」的原因。",
    },
    {
      type: "callout",
      variant: "note",
      title: "默认事务关掉后的影响",
      body: "跳过默认事务的配置（SkipDefaultTransaction）属于靠后章节的内容，这里只需记住：关联写操作默认带事务保护。一旦关闭默认事务，就需要你自己用 db.Transaction(...) 保证一组关联写的一致性。",
    },
    {
      type: "quiz",
      question: "把一篇文章当前的三、四个标签整体换成另外两个标签，最合适的 Association 操作是？",
      options: ["Append", "Replace", "Delete", "Clear"],
      answer: 1,
      explanation: "「整体换成新集合」正是 Replace 的语义：清空旧配对、写入新集合。Append 只追加不改旧，Delete 只删指定项，Clear 只清空不写入。",
    },
    {
      type: "quiz",
      question: "对 many2many 关联执行 Clear() 的后果是？",
      options: [
        "删除连接表里所有配对行，Post 与 Tag 本身保留",
        "删除所有参与的 Post",
        "删除所有参与的 Tag",
        "同时删除 Post 和 Tag",
      ],
      answer: 0,
      explanation: "many2many 的 Clear 只清连接表（post_tags）中的配对行来解绑，不删除原表里的 Post / Tag 记录本身。",
    },
    {
      type: "exercise",
      title: "管理一篇文章的标签",
      description: "写一组操作：① 给文章 post 追加标签 gorm；② 把它的标签整体替换为 advanced 与 orm；③ 查一下当前标签数量；④ 把标签清空但保留文章本身。分别调用对应的 Association 方法。",
      hint: "Append(aTag)；Replace(fresh); Count()；Clear()。注意每个方法都以 db.Model(&post).Association(\"Tags\") 开头。",
    },
    {
      type: "keypoints",
      items: [
        "Association(\"字段\") 提供 Append（追加）/ Replace（替换）/ Delete（解绑指定）/ Clear（清空）/ Count（计数）。",
        "Create/Save 会按默认规则保存关联引用；完整同步既有关联需显式 FullSaveAssociations。",
        "many2many 的 Delete / Clear 只动连接表，不删原记录；单侧外键类的 Clear 语义不同。",
        "直接改外键不等于管理关联，优先用 Association 方法保持一致性。",
        "删除父记录不默认级联，需显式 constraint:OnDelete 或先解绑再删。",
      ],
    },
  ],
};
