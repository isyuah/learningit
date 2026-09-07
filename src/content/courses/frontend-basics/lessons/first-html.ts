/* ==================================================================
 * 课时：你的第一个 HTML 页面（first-html）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "first-html",
  "courseSlug": "frontend-basics",
  "title": "你的第一个 HTML 页面",
  "summary": "动手写一个语义化、结构清晰的页面骨架。",
  "minutes": 15,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "现在动手。打开任意文本编辑器，新建一个 index.html，把下面的代码贴进去，然后在浏览器里打开这个文件——你已经写出了人生第一个网页。"
    },
    {
      "type": "video",
      "title": "跟着视频一起写：5 分钟完成第一个页面",
      "provider": "placeholder",
      "src": "",
      "duration": "05:12"
    },
    {
      "type": "code",
      "title": "index.html —— 最小页面骨架",
      "language": "html",
      "code": "<!doctype html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <title>我的第一个网页</title>\n  </head>\n  <body>\n    <h1>你好，世界</h1>\n    <p>这是我的第一个网页。</p>\n  </body>\n</html>"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "常见误区",
      "body": "不要用 <div> 装下所有东西。<div> 没有语义，而 <header>、<nav>、<article>、<footer> 这些标签能告诉浏览器和搜索引擎「这块内容是什么」。"
    },
    {
      "type": "heading",
      "text": "标签的三要素"
    },
    {
      "type": "list",
      "items": [
        "标签成对出现：<p>…</p>，少数自闭合如 <img />",
        "属性提供额外信息：<a href=\"...\"> 中的 href",
        "嵌套要规范：先开后关，像括号一样配对"
      ]
    },
    {
      "type": "exercise",
      "title": "动手改一改",
      "description": "把上面的页面改成你自己的介绍页：加一个一级标题、一段自我介绍、一个指向你最喜欢网站的链接。",
      "hint": "链接用 <a href=\"https://...\">文字</a> 的写法。"
    },
    {
      "type": "keypoints",
      "items": [
        "HTML 描述「内容是什么」，不负责「长什么样」",
        "优先使用语义化标签，而非满屏 <div>",
        "标签嵌套遵循「先开后关」"
      ]
    }
  ]
};
