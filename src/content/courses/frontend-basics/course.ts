/* ==================================================================
 * 课程：前端入门：从 HTML 到 React（frontend-basics）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  "slug": "frontend-basics",
  "title": "前端入门：从 HTML 到 React",
  "tagline": "零基础也能写出第一个网页应用",
  "description": "这是一门写给零基础学习者的前端入门课。我们会从「网页是如何工作的」讲起，一步步写出语义化的 HTML、漂亮的 CSS，最后理解 React 组件背后的思想。\n\n全程动手：每章都有配套练习与测验，学完第一章你就能做出第一个真正的网页。",
  "level": "beginner",
  "hours": 12,
  "learners": 1284,
  "coverIndex": "01",
  "coverColor": "primary",
  "updatedAt": "2025-06",
  "outcomes": [
    "理解 Web 的基本工作原理",
    "独立编写语义化的 HTML 页面",
    "用 CSS 完成基础排版与配色",
    "理解 React 组件化思想，搭建第一个组件"
  ],
  "chapters": [
    {
      "id": "ch1",
      "title": "认识 Web 与浏览器",
      "intro": "先搞清楚网页在浏览器里是怎么被渲染出来的，再动手写代码。",
      "lessons": [
        {
          "slug": "web-how-it-works",
          "title": "Web 是怎么工作的",
          "minutes": 12,
          "kind": "reading"
        },
        {
          "slug": "first-html",
          "title": "你的第一个 HTML 页面",
          "minutes": 15,
          "kind": "reading"
        },
        {
          "slug": "css-basics",
          "title": "CSS 让页面变好看",
          "minutes": 18,
          "kind": "reading"
        },
        {
          "slug": "chapter-1-quiz",
          "title": "第一章小测",
          "minutes": 10,
          "kind": "quiz"
        }
      ]
    },
    {
      "id": "ch2",
      "title": "HTML 语义化与结构",
      "lessons": [
        {
          "slug": "html-semantics",
          "title": "语义化标签：让结构自己说话",
          "minutes": 14,
          "kind": "reading"
        },
        {
          "slug": "forms-and-lists",
          "title": "表单与列表实战",
          "minutes": 16,
          "kind": "exercise"
        },
        {
          "slug": "layout-lab",
          "title": "布局实验室：搭建一个博客页",
          "minutes": 20,
          "kind": "exercise"
        }
      ]
    },
    {
      "id": "ch3",
      "title": "CSS 排版与响应式",
      "lessons": [
        {
          "slug": "css-layout",
          "title": "盒子模型与流式布局",
          "minutes": 22,
          "kind": "reading"
        },
        {
          "slug": "responsive-design",
          "title": "响应式设计入门",
          "minutes": 16,
          "kind": "reading"
        },
        {
          "slug": "flexbox-lab",
          "title": "Flexbox 实战：导航栏",
          "minutes": 24,
          "kind": "exercise"
        }
      ]
    },
    {
      "id": "ch4",
      "title": "React 入门",
      "intro": "最后一章，把前面的知识组装成真正的现代前端应用。",
      "lessons": [
        {
          "slug": "react-thinking",
          "title": "组件化思维：React 为什么存在",
          "minutes": 20,
          "kind": "video"
        },
        {
          "slug": "components-first",
          "title": "写出你的第一个组件",
          "minutes": 18,
          "kind": "reading"
        },
        {
          "slug": "final-project",
          "title": "结课项目：个人介绍页",
          "minutes": 40,
          "kind": "exercise",
          "locked": true
        }
      ]
    }
  ]
};
