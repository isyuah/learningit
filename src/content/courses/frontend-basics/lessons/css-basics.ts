/* ==================================================================
 * 课时：CSS 让页面变好看（css-basics）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "css-basics",
  "courseSlug": "frontend-basics",
  "title": "CSS 让页面变好看",
  "summary": "选择器、属性与层叠——CSS 的三大基础概念。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "HTML 负责内容，CSS 负责外观。CSS 的核心机制是「选择器 + 声明」：你选择页面上的某些元素，然后告诉浏览器它们应该长什么样。"
    },
    {
      "type": "code",
      "title": "第一条 CSS 规则",
      "language": "css",
      "code": "h1 {\n  color: #5041d2;      /* 文字颜色：靛紫 */\n  font-size: 2rem;     /* 字号 */\n  letter-spacing: 0.02em;\n}"
    },
    {
      "type": "table",
      "caption": "最常用的三类选择器",
      "headers": [
        "选择器",
        "写法",
        "匹配对象"
      ],
      "rows": [
        [
          "标签选择器",
          "p",
          "所有 <p> 元素"
        ],
        [
          "类选择器",
          ".card",
          "所有 class=\"card\" 的元素"
        ],
        [
          "ID 选择器",
          "#header",
          "id=\"header\" 的唯一元素"
        ]
      ]
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "给练习的建议",
      "body": "在浏览器里按 F12 打开开发者工具，随时修改 CSS 看效果。调试 CSS 最快的方式就是「改一下、看一眼」——这比死记属性快得多。"
    },
    {
      "type": "heading",
      "text": "层叠：谁说了算"
    },
    {
      "type": "paragraph",
      "text": "当多条规则指向同一个元素时，按「优先级 + 顺序」裁决：ID 选择器 > 类选择器 > 标签选择器；同优先级时，后面的规则覆盖前面的。理解这一点，你就不会再被「为什么样式没生效」困扰。"
    },
    {
      "type": "quiz",
      "question": "下面哪个选择器的优先级最高？",
      "options": [
        "p",
        ".card",
        "#header",
        "div p"
      ],
      "answer": 2,
      "explanation": "ID 选择器（#header）优先级最高。class 次之，标签与后代选择器最低。"
    },
    {
      "type": "keypoints",
      "items": [
        "CSS = 选择器 + 声明（属性: 值）",
        "优先级：ID > 类 > 标签；同优先级后写覆盖先写",
        "善用浏览器开发者工具实时调试"
      ]
    }
  ]
};
