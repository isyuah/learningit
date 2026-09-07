/* ==================================================================
 * 课程：数据可视化实战（data-viz）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  "slug": "data-viz",
  "title": "数据可视化实战",
  "tagline": "让数据自己说话",
  "description": "学会用图表讲清楚一个数据故事。课程覆盖图表的选择逻辑、用代码绘制基础图表，以及如何把图表组织成有说服力的叙事——适合分析师、运营与任何需要汇报数据的人。",
  "level": "intermediate",
  "hours": 10,
  "learners": 523,
  "coverIndex": "03",
  "coverColor": "info",
  "updatedAt": "2025-04",
  "outcomes": [
    "根据问题类型选择正确的图表",
    "用代码绘制柱状图、折线图与散点图",
    "通过标注与配色突出数据结论",
    "把多张图表组织成一个完整叙事"
  ],
  "chapters": [
    {
      "id": "ch1",
      "title": "图表的选择",
      "lessons": [
        {
          "slug": "chart-grammar",
          "title": "图表的语法：数据如何变成形状",
          "minutes": 18,
          "kind": "reading"
        },
        {
          "slug": "choose-the-chart",
          "title": "选图练习：哪种图表最合适",
          "minutes": 15,
          "kind": "exercise"
        }
      ]
    },
    {
      "id": "ch2",
      "title": "用代码画图",
      "lessons": [
        {
          "slug": "first-chart",
          "title": "你的第一张图表",
          "minutes": 20,
          "kind": "reading"
        },
        {
          "slug": "chart-lab",
          "title": "图表实验室：对比两组数据",
          "minutes": 30,
          "kind": "exercise",
          "locked": true
        }
      ]
    },
    {
      "id": "ch3",
      "title": "讲述数据故事",
      "lessons": [
        {
          "slug": "narrative",
          "title": "从图表到叙事",
          "minutes": 16,
          "kind": "reading"
        },
        {
          "slug": "story-cover",
          "title": "结课作业：一份数据汇报",
          "minutes": 30,
          "kind": "exercise",
          "locked": true
        }
      ]
    }
  ]
};
