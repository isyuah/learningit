/* ==================================================================
 * 课时：第一章小测（ch1-sql-quiz）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "ch1-sql-quiz",
  "courseSlug": "sql-basics",
  "title": "第一章小测",
  "summary": "检验对关系模型与 SELECT 的掌握。",
  "minutes": 10,
  "kind": "quiz",
  "blocks": [
    {
      "type": "paragraph",
      "text": "四道题，覆盖本章核心概念。答错没关系，讲解里会说明为什么。"
    },
    {
      "type": "quiz",
      "question": "关系型数据库里，「行（row）」通常对应什么？",
      "options": [
        "一张表",
        "一条记录",
        "一种数据类型",
        "一个查询"
      ],
      "answer": 1,
      "explanation": "表由行组成，每一行是一条记录；列（字段）描述记录的属性。"
    },
    {
      "type": "quiz",
      "question": "主键（PRIMARY KEY）的作用是什么？",
      "options": [
        "给表排序",
        "唯一标识每一行，不允许重复",
        "加密数据",
        "加快所有查询"
      ],
      "answer": 1,
      "explanation": "主键唯一标识一行，是表与表之间建立关联（外键）的基础；它本身也会被索引。"
    },
    {
      "type": "quiz",
      "question": "执行 SELECT id, name FROM students; 返回的列顺序是？",
      "options": [
        "表定义的顺序：id, name",
        "SELECT 里写的顺序：id, name",
        "字母序：id, name",
        "随机顺序"
      ],
      "answer": 1,
      "explanation": "返回列的次序由 SELECT 子句决定，与表结构无关。"
    },
    {
      "type": "quiz",
      "question": "下面哪个不是 DBMS（数据库管理系统）？",
      "options": [
        "MySQL",
        "PostgreSQL",
        "Excel",
        "SQLite"
      ],
      "answer": 2,
      "explanation": "Excel 是电子表格软件，不是数据库管理系统；其余三个都是常见 DBMS。"
    },
    {
      "type": "keypoints",
      "items": [
        "表 = 行（记录）+ 列（字段）",
        "主键唯一标识一行",
        "SELECT 决定返回哪些列，FROM 决定从哪张表取"
      ]
    }
  ]
};
