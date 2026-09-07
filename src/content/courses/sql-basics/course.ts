/* ==================================================================
 * 课程：数据库入门：SQL 从零开始（sql-basics）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  "slug": "sql-basics",
  "title": "数据库入门：SQL 从零开始",
  "tagline": "把数据存进去，再把答案查出来",
  "description": "从「数据库为什么存在」讲起，用一套贯穿始终的示例数据（学生成绩库），逐步学会 SELECT、过滤、排序、聚合与 JOIN；最后讲表设计与事务。\n\n全程手写 SQL，所有查询都可以在任意 SQLite / MySQL 环境里直接运行——学完你能读懂业务系统里的大部分查询。",
  "level": "beginner",
  "hours": 10,
  "learners": 412,
  "coverIndex": "04",
  "coverColor": "success",
  "updatedAt": "2025-07",
  "outcomes": [
    "理解关系模型：表、行、列与主键",
    "写出带过滤与排序的 SELECT 查询",
    "用聚合函数完成统计（GROUP BY）",
    "理解 JOIN 联表查询",
    "设计不冗余的表结构，理解事务"
  ],
  "chapters": [
    {
      "id": "ch1",
      "title": "关系模型入门",
      "intro": "先建立「数据库到底是什么」的心智模型，再动手写第一条 SQL。",
      "lessons": [
        {
          "slug": "what-is-a-database",
          "title": "数据库为什么存在",
          "minutes": 15,
          "kind": "reading"
        },
        {
          "slug": "relational-model",
          "title": "关系模型：表、行、列与主键",
          "minutes": 18,
          "kind": "reading"
        },
        {
          "slug": "sql-select-basics",
          "title": "第一次 SELECT",
          "minutes": 20,
          "kind": "reading"
        },
        {
          "slug": "ch1-sql-quiz",
          "title": "第一章小测",
          "minutes": 10,
          "kind": "quiz"
        }
      ]
    },
    {
      "id": "ch2",
      "title": "查询的艺术",
      "lessons": [
        {
          "slug": "where-filtering",
          "title": "WHERE：把数据筛出来",
          "minutes": 16,
          "kind": "reading"
        },
        {
          "slug": "order-limit-lab",
          "title": "排序与去重练习",
          "minutes": 15,
          "kind": "exercise"
        },
        {
          "slug": "aggregation",
          "title": "聚合函数与 GROUP BY",
          "minutes": 22,
          "kind": "reading"
        },
        {
          "slug": "joins-intro",
          "title": "JOIN：把多张表连起来",
          "minutes": 25,
          "kind": "reading"
        }
      ]
    },
    {
      "id": "ch3",
      "title": "设计与实战",
      "intro": "会查之后，学怎么把表设计好、把数据写对。",
      "lessons": [
        {
          "slug": "table-design",
          "title": "表设计：让数据不重复",
          "minutes": 20,
          "kind": "reading"
        },
        {
          "slug": "transactions",
          "title": "事务：要么全做，要么全不做",
          "minutes": 15,
          "kind": "reading"
        },
        {
          "slug": "final-db-project",
          "title": "结课项目：搭一个课程报名库",
          "minutes": 35,
          "kind": "exercise",
          "locked": true
        }
      ]
    }
  ]
};
