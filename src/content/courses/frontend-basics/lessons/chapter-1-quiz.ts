/* ==================================================================
 * 课时：第一章小测（chapter-1-quiz）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "chapter-1-quiz",
  "courseSlug": "frontend-basics",
  "title": "第一章小测",
  "summary": "5 道题，检验第一章的掌握程度。",
  "minutes": 10,
  "kind": "quiz",
  "blocks": [
    {
      "type": "paragraph",
      "text": "这一测不记分、不设限，答错了直接看讲解就好。目标是确认自己没有留下模糊地带，再进入第二章。"
    },
    {
      "type": "quiz",
      "question": "在「输入网址 → 页面出现」的过程中，谁负责返回页面的内容？",
      "options": [
        "浏览器",
        "服务器",
        "DNS",
        "路由器"
      ],
      "answer": 1,
      "explanation": "服务器存储并返回内容；浏览器负责发起请求与渲染，DNS 负责把域名翻译成 IP 地址。"
    },
    {
      "type": "quiz",
      "question": "下面哪个标签最有语义，适合包裹文章主体？",
      "options": [
        "<div>",
        "<span>",
        "<article>",
        "<b>"
      ],
      "answer": 2,
      "explanation": "<article> 表示独立的、可复用的内容区块。<div> 和 <span> 没有语义，<b> 只表示加粗。"
    },
    {
      "type": "quiz",
      "question": "两条 CSS 规则同时命中同一个元素，哪条生效？",
      "options": [
        "先写的那条",
        "优先级更高的那条，同优先级时后写的生效",
        "随机一条",
        "两条都不生效"
      ],
      "answer": 1,
      "explanation": "优先级高的生效；若优先级相同，则后面的规则覆盖前面的（层叠规则）。"
    },
    {
      "type": "quiz",
      "question": "「HTTP」的本质是什么？",
      "options": [
        "一种编程语言",
        "浏览器与服务器之间的通信协议",
        "一种图片格式",
        "数据库的名称"
      ],
      "answer": 1,
      "explanation": "HTTP 是超文本传输协议，定义了请求与响应的格式与语义。"
    },
    {
      "type": "keypoints",
      "items": [
        "请求-响应链路：DNS → 请求 → 响应 → 渲染",
        "语义化 HTML 让结构可读、可维护",
        "CSS 层叠：优先级与顺序共同决定结果"
      ]
    }
  ]
};
