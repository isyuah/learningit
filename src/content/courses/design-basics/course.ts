/* ==================================================================
 * 课程：设计基础：给非设计师的视觉课（design-basics）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  "slug": "design-basics",
  "title": "设计基础：给非设计师的视觉课",
  "tagline": "不需要天赋，只需要方法",
  "description": "面向工程师、产品经理与内容创作者的视觉设计入门课。不教软件操作，教你判断「为什么这个设计更好」——从色彩、字体到排版，建立一套可复用的判断框架。",
  "level": "beginner",
  "hours": 8,
  "learners": 856,
  "coverIndex": "02",
  "coverColor": "amber",
  "updatedAt": "2025-05",
  "outcomes": [
    "建立色彩与对比度的判断框架",
    "理解字体搭配的基本原则",
    "用留白与网格组织信息层级",
    "能对任何界面做出有理有据的视觉评审"
  ],
  "chapters": [
    {
      "id": "ch1",
      "title": "先学会观察",
      "lessons": [
        {
          "slug": "color-first",
          "title": "色彩：先学会不犯错",
          "minutes": 20,
          "kind": "reading"
        },
        {
          "slug": "type-pairing",
          "title": "字体搭配：两套字体的艺术",
          "minutes": 18,
          "kind": "reading"
        },
        {
          "slug": "whitespace",
          "title": "留白不是浪费，是结构",
          "minutes": 12,
          "kind": "reading"
        }
      ]
    },
    {
      "id": "ch2",
      "title": "排版与网格",
      "lessons": [
        {
          "slug": "grid-basics",
          "title": "网格系统：对齐的魔法",
          "minutes": 16,
          "kind": "reading"
        },
        {
          "slug": "composition-lab",
          "title": "构图实验室：重新排版一页 PPT",
          "minutes": 25,
          "kind": "exercise"
        }
      ]
    },
    {
      "id": "ch3",
      "title": "把设计讲清楚",
      "lessons": [
        {
          "slug": "design-review",
          "title": "视觉评审：给设计挑毛病的方法",
          "minutes": 14,
          "kind": "reading"
        },
        {
          "slug": "final-critique",
          "title": "结课测验：你能看出问题吗",
          "minutes": 15,
          "kind": "quiz"
        }
      ]
    }
  ]
};
