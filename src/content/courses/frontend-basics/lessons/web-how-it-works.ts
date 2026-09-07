/* ==================================================================
 * 课时：Web 是怎么工作的（web-how-it-works）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "web-how-it-works",
  "courseSlug": "frontend-basics",
  "title": "Web 是怎么工作的",
  "summary": "从输入网址到页面出现，中间发生了什么。",
  "minutes": 12,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "在写第一行代码之前，我们先花 12 分钟搞清楚一件事：当你在浏览器地址栏输入一个网址、按下回车，到页面显示出来，这中间到底发生了什么。理解了这条链路，后面所有知识都会有一个安放的位置。"
    },
    {
      "type": "heading",
      "text": "一条请求的旅程"
    },
    {
      "type": "paragraph",
      "text": "整个过程可以简化为三步：你的浏览器（客户端）向服务器发送「给我这个页面」的请求；服务器找到对应的文件，把内容打包成响应发回来；浏览器拿到响应后，解析并渲染成你看到的网页。"
    },
    {
      "type": "list",
      "items": [
        "浏览器根据网址找到服务器的地址（DNS 解析）",
        "浏览器向服务器发起 HTTP 请求",
        "服务器返回 HTML 文件（以及 CSS、JS、图片等资源）",
        "浏览器解析 HTML，构建页面并渲染"
      ]
    },
    {
      "type": "definition",
      "term": "HTTP",
      "definition": "超文本传输协议，浏览器与服务器之间沟通的「语言」。请求与响应都遵循这套格式。"
    },
    {
      "type": "definition",
      "term": "URL",
      "definition": "统一资源定位符，也就是网址。它告诉浏览器「去哪里、要什么」。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "为什么需要懂这些？",
      "body": "前端开发的大部分工作，都发生在「浏览器拿到响应之后」：解析、布局、交互。但不懂请求-响应模型，你会在调试网络问题、理解加载性能时寸步难行。"
    },
    {
      "type": "code",
      "title": "一个典型 URL 的组成",
      "language": "text",
      "code": "https://example.com:443/courses/frontend?page=2#lesson-1\n└─┬──┘  └───┬────┘ └┬┘ └──────┬──────┘ └───┬───┘ └──┬──┘\n协议    域名   端口    路径        查询参数    锚点"
    },
    {
      "type": "table",
      "caption": "链路中各角色的分工",
      "headers": [
        "角色",
        "职责",
        "例子"
      ],
      "rows": [
        [
          "客户端",
          "发起请求，解析并渲染",
          "浏览器、手机 App"
        ],
        [
          "服务器",
          "存储内容，响应请求",
          "Nginx、Node.js 服务"
        ],
        [
          "DNS",
          "把域名翻译成 IP 地址",
          "8.8.8.8 等公共 DNS"
        ]
      ]
    },
    {
      "type": "quote",
      "text": "计算机科学中只有两件难事：缓存失效和命名。—— Phil Karlton",
      "source": "常被引用的工程师名言"
    },
    {
      "type": "keypoints",
      "items": [
        "网页渲染 = 请求 → 响应 → 解析 → 绘制",
        "URL 由协议、域名、路径等部分组成",
        "HTTP 是浏览器与服务器沟通的协议"
      ]
    }
  ]
};
