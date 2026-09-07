/* ==================================================================
 * 课时：JOIN：把多张表连起来（joins-intro）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "joins-intro",
  "courseSlug": "sql-basics",
  "title": "JOIN：把多张表连起来",
  "summary": "用外键把两张表拼成一张结果表。",
  "minutes": 25,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "真实系统不会把所有信息塞进一张表——那样会大量重复。更常见的做法是「拆表 + 外键引用」：学生表存基本信息，成绩表只存 student_id 和分数。要查「谁考了多少分」时，就用 JOIN 把两张表临时拼起来。"
    },
    {
      "type": "code",
      "title": "两张关联的表",
      "language": "sql",
      "code": "CREATE TABLE students (\n  id   INTEGER PRIMARY KEY,\n  name TEXT\n);\n\nCREATE TABLE scores (\n  id         INTEGER PRIMARY KEY,\n  student_id INTEGER,        -- 外键：指向 students.id\n  quiz       TEXT,           -- 测验名称\n  score      INTEGER\n);\n\nINSERT INTO students (id, name) VALUES (1, '小明'), (2, '小红');\nINSERT INTO scores (student_id, quiz, score) VALUES\n  (1, '第一次测验', 88),\n  (1, '第二次测验', 92),\n  (2, '第一次测验', 75);"
    },
    {
      "type": "code",
      "title": "INNER JOIN：只保留能匹配上的行",
      "language": "sql",
      "code": "SELECT students.name, scores.quiz, scores.score\nFROM students\nJOIN scores ON students.id = scores.student_id;\n\n-- 结果：\n-- name  quiz        score\n-- 小明   第一次测验    88\n-- 小明   第二次测验    92\n-- 小红   第一次测验    75"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "忘写 ON 的后果",
      "body": "JOIN 必须带 ON 条件。如果没有 ON，数据库会把两张表的行两两组合（笛卡尔积）——2 行 × 3 行 = 6 行，数据全乱。这是新手最常踩的坑。"
    },
    {
      "type": "quiz",
      "question": "INNER JOIN 返回的行是？",
      "options": [
        "左表的所有行",
        "右表的所有行",
        "两边都满足 ON 条件的行",
        "两张表的笛卡尔积"
      ],
      "answer": 2,
      "explanation": "INNER JOIN 只保留匹配 ON 条件的行；LEFT JOIN 才会保留左表的全部行。"
    },
    {
      "type": "exercise",
      "title": "联表练习",
      "description": "在上面的数据里，查出「每个学生的平均分」。提示：需要 GROUP BY students.name，并用 AVG(scores.score)；如果你还没学聚合，先跳到下一节再回来做。",
      "hint": "SELECT students.name, AVG(scores.score) FROM students JOIN scores ON students.id = scores.student_id GROUP BY students.name;"
    },
    {
      "type": "quote",
      "text": "能拆的表要拆，能连的查询要连——关系型数据库的优雅，正在于此。",
      "source": "本课讲义"
    },
    {
      "type": "keypoints",
      "items": [
        "用外键把数据拆到多张表，避免重复",
        "JOIN ... ON 把多张表拼成结果",
        "忘记 ON 会产生笛卡尔积，务必检查"
      ]
    }
  ]
};
