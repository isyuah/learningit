/* ==================================================================
 * 课时：第一次 SELECT（sql-select-basics）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "sql-select-basics",
  "courseSlug": "sql-basics",
  "title": "第一次 SELECT",
  "summary": "建立示例表，写出第一条查询。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "整门课我们共用一套数据：一个记录学生三次测验成绩的小库。先把它建出来——在任意 SQLite 环境（或 sqliteonline.com）里执行下面的语句。"
    },
    {
      "type": "code",
      "title": "建表并插入示例数据",
      "language": "sql",
      "code": "-- 学生表：id 是主键，唯一标识一行\nCREATE TABLE students (\n  id   INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  class TEXT\n);\n\n-- 插入四条记录\nINSERT INTO students (id, name, class) VALUES\n  (1, '小明', '一班'),\n  (2, '小红', '一班'),\n  (3, '小刚', '二班'),\n  (4, '小丽', '二班');"
    },
    {
      "type": "heading",
      "text": "最简单的查询"
    },
    {
      "type": "code",
      "title": "查询整张表",
      "language": "sql",
      "code": "-- * 表示「所有列」\nSELECT * FROM students;\n\n-- 结果：\n-- id  name  class\n-- 1   小明   一班\n-- 2   小红   一班\n-- 3   小刚   二班\n-- 4   小丽   二班"
    },
    {
      "type": "paragraph",
      "text": "只想要部分列？把 * 换成列名，用逗号分隔。返回的列顺序由你决定，而不是表定义的顺序。"
    },
    {
      "type": "code",
      "title": "只查询需要的列",
      "language": "sql",
      "code": "SELECT name, id FROM students;\n-- 结果列顺序：name, id"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "SQL 大小写",
      "body": "关键字（SELECT、FROM）习惯大写、表名列名小写，这只是约定不是语法要求。但每条语句末尾的分号（;）是必须的，它告诉系统「语句到此结束」。"
    },
    {
      "type": "table",
      "caption": "SELECT 语句的骨架",
      "headers": [
        "部分",
        "作用",
        "必填"
      ],
      "rows": [
        [
          "SELECT 列名",
          "选择要返回哪些列",
          "是"
        ],
        [
          "FROM 表名",
          "从哪张表取数据",
          "是"
        ],
        [
          "WHERE 条件",
          "过滤行（下一章）",
          "否"
        ],
        [
          "ORDER BY 列",
          "排序（下一章）",
          "否"
        ]
      ]
    },
    {
      "type": "exercise",
      "title": "动手查一查",
      "description": "基于上面的 students 表：1）查所有人的姓名与班级；2）只查 id 大于 2 的学生（提示：WHERE id > 2，下一课会细讲）。",
      "hint": "WHERE 写在 FROM 之后：SELECT name FROM students WHERE id > 2;"
    },
    {
      "type": "quiz",
      "question": "下面哪条语句会返回「所有学生的姓名」？",
      "options": [
        "SELECT name FROM students;",
        "SELECT * FROM name;",
        "SELECT students FROM name;",
        "GET name FROM students;"
      ],
      "answer": 0,
      "explanation": "SELECT 后跟列名（name），FROM 后跟表名（students）。注意 SELECT 是查询不是 GET，且列名不是表名。"
    },
    {
      "type": "keypoints",
      "items": [
        "SELECT 列名 FROM 表名 是查询的基本骨架",
        "\\* 表示所有列；列的顺序由 SELECT 决定",
        "每条语句以分号结尾"
      ]
    }
  ]
};
