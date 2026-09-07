/* ==================================================================
 * 课时：CRUD 综合练习（gorm-crud-exercise）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-crud-exercise",
  "courseSlug": "gorm",
  "title": "CRUD 综合练习",
  "summary": "把 Create、Find、Updates、软删除串起来的一组动手练习，验证你真正掌握了增删改查的语义。",
  "minutes": 20,
  "kind": "exercise",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前面四节分别讲了增、查、改、删，现在把它们串成一段完整的「博客后台」流程。这一节不引入任何新概念，只要求你动手写代码，把每一节的陷阱在实际执行中踩一遍、再修一遍。先准备一个可运行的 GORM 环境（连上一张干净的 SQLite/MySQL 表），然后依次完成下面四道题。每道题给出 hint，做完后再对答案要点的思路。"
    },
    {
      "type": "heading",
      "text": "练习总览"
    },
    {
      "type": "list",
      "items": [
        "练习 1：创建几位用户，再用其中的一位发表一篇文章",
        "练习 2：按主键查询，并正确处理「查不到」",
        "练习 3：更新一个字段，先制造零值陷阱，再用 map 修复",
        "练习 4：软删除一位用户，再用 Unscoped 恢复并复查"
      ]
    },
    {
      "type": "exercise",
      "title": "练习 1：创建用户与文章",
      "description": "用批量插入一次创建三位用户（甲、乙、丙，email 分别为 a/b/c@example.com，年龄 20/24/27）。然后用 Find 取回「甲」，并让甲发布一篇 Post（title、body、UserID 指向甲），用 db.Create 插入。最后打印：三条 Create 各自的 RowsAffected，以及甲的 ID 是否已被回填。",
      "hint": "批量创建用 db.Create(&[]User{...})，逐条保存；用 db.Where(\"name = ?\", \"甲\").First(&jia) 取回甲后，用 jia.ID 作为 Post.UserID 再 Create。注意用 errors 检查每一步。"
    },
    {
      "type": "exercise",
      "title": "练习 2：主键查询与 ErrRecordNotFound",
      "description": "写一个函数：给定一个 id，用 db.First 去查 User。若 id 存在则打印该用户；若查不到（errors.Is(err, gorm.ErrRecordNotFound)）则打印「用户不存在」；其它错误则打印数据库错误。分别用存在与不存在的 id 调用两次，确认三种分支都能走到。",
      "hint": "先 var u User，再 result := db.First(&u, id)，用 result.Error 判断。先判断 errors.Is 未找到，再判断 result.Error != nil，最后才是正常分支——顺序别颠倒。"
    },
    {
      "type": "exercise",
      "title": "练习 3：更新与零值陷阱",
      "description": "取回「乙」（Age=24）。(a) 先执行 db.Model(&乙).Updates(User{Age: 0})，再查一次，观察 age 是否变成 0（预期：没有，还是 24）。(b) 然后用 map 方式 db.Model(&乙).Updates(map[string]interface{}{\"age\": 0})，再查，确认 age 变成 0。最后把乙的 age 改回 24，并用单列 Update 确认生效。",
      "hint": "struct 跳过零值所以 Age=0 不生效；map 会把 age=0 写进去。单列版写 db.Model(&乙).Update(\"age\", 24) 即可，且不跳过零值。每步更新后用 Find/First 复查。"
    },
    {
      "type": "exercise",
      "title": "练习 4：软删除与恢复",
      "description": "对 User（含 gorm.DeletedAt）的「丙」执行 db.Delete。随后 (a) 常规 Find 确认丙不可见；(b) Unscoped Find 确认行仍在；(c) 用 Unscoped + 条件更新把 deleted_at 显式设为 NULL，再确认恢复可见。",
      "hint": "恢复写法应类似 db.Unscoped().Model(&User{}).Where(\"id = ?\", id).Update(\"deleted_at\", nil)，并检查 Error 与 RowsAffected。"
    },
    {
      "type": "subheading",
      "text": "做完后对照这些要点"
    },
    {
      "type": "list",
      "items": [
        "批量 Create 的 RowsAffected 应等于切片长度，且每行主键都被回填",
        "First 查不到返回 gorm.ErrRecordNotFound，用 errors.Is 判断，别忽略 result.Error",
        "Updates 传 struct 跳过零值，清零必须 map 或 Select",
        "软删除后常规查询自动排除，Unscoped 可看到/恢复/物理删除",
        "每一步都要检查错误，避免把失败当成功继续往下跑"
      ]
    },
    {
      "type": "quiz",
      "question": "综合四个练习，以下哪个说法是正确的？",
      "options": [
        "批量 Create 后，切片里每个元素的主键都会自动回填",
        "db.Delete 一个含 DeletedAt 的记录会直接物理删除该行",
        "Updates 传 struct，零值字段（如 Age:0）也会被写入数据库",
        "软删除后，常规 Find 依然能查到该记录"
      ],
      "answer": 0,
      "explanation": "批量 Create 会逐行回填主键；含 DeletedAt 时 Delete 是软删除（打标记而非删行）；Updates 传 struct 跳过零值；软删除后常规查询默认排除。只有第一项正确。"
    },
    {
      "type": "keypoints",
      "items": [
        "增：批量 Create 合并为多值 INSERT，主键回填到切片元素",
        "查：First/Take/Last 空结果报 ErrRecordNotFound，Find 空结果不报错",
        "改：struct 跳过零值、map 与 Update 单列能清零、Save 全量重写",
        "删：有 DeletedAt 是软删除，Unscoped 可查看/恢复/真正删除",
        "贯穿始终：检查 result.Error 与 RowsAffected"
      ]
    }
  ]
};
