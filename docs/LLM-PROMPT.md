# LLM-PROMPT.md — 无课程创作 Skill 时的备用提示词

> 这是 **standalone fallback**：当当前 AI 环境没有安装专门的课程创作 Skill 时，可以把下面的提示词交给 AI。
>
> 如果已经安装课程创作 Skill，应优先使用 Skill 的 Learning Brief、研究、知识建模、课程策划和 Reviewer 流程；本文件不与 Skill 竞争教学策略。
>
> 无论是否使用 Skill，平台硬约束始终以 `docs/PLATFORM-CONTRACT.md` 与 `src/content/types.ts` 为准。

---

## 课程生产提示词

```text
你正在为一个数据驱动的多课程 Learning Platform 创作课程。

请先阅读并遵循：
1. docs/PLATFORM-CONTRACT.md
2. docs/CONTENT-AUTHORING.md
3. src/content/types.ts
4. 需要了解可用组件时阅读 docs/COMPONENTS.md

## 核心目标

生成的内容必须是真正承担教学作用的课程，而不是课程介绍页、Landing Page 或只有标题和简介的目录。

优先满足用户明确提出的学习目标、已有水平、内容范围、详细程度和特殊偏好。

## 工作方式

### A. 如果用户要求新建或系统生成整门课程

先完成课程策划，再写课时：

1. 识别学习对象（例如技术、框架/库、课程/学科、Git 仓库、工具、协议、系统）。
2. 识别学习意图（系统学习、快速上手、参考、深入理解、项目驱动、考试/复习等）。
3. 根据用户水平确定前置知识、重点和可以略过的内容。
4. 在有外部资料/源码/官方文档时先研究事实，不要凭印象补全关键 API、版本行为或设计原因。
5. 设计 Knowledge Map 和课程章节依赖。
6. 创建/更新 src/content/courses/<course-slug>/course.ts。
7. 再按大纲逐课创建 lessons/<lesson-slug>.ts。
8. 完成后从整门课程角度审校重复、遗漏、断层和术语一致性。

如果环境支持 Subagent 且课程规模足够大，可以让一个 Planner 负责 course.ts，多名 Author 分别写互不冲突的 lesson 文件，最后由 Reviewer/Integrator 统一审校。不要为了形式而强制使用多 Agent。

### B. 如果用户只要求写或修改某一课

先读取该课程的 course.ts、相邻课时和必要参考资料，理解这节课在课程中的位置，再修改目标 lesson 文件。不要无故重构整门课程。

## 内容要求

- 解释 What，也尽量解释真正有价值的 Why 和 How。
- 框架 / Library：重视准确 API、使用语义、错误行为、常见陷阱、工程实践和版本提醒。
- 技术：重视它解决什么问题、核心机制、常见解决方案、Trade-off、什么时候不适用。
- 课程 / 学科：重视前置知识、概念依赖、推导、例题/练习和知识联系。
- Git 仓库 / Codebase：优先按系统职责、执行流、模块关系和设计决策组织，不要只解释文件树。对于“作者为什么这样设计”，只有来源能证明时才作为事实；否则明确标注为从实现推导出的解释或可能的设计演进。
- 工具：优先围绕真实任务、工作流、排错和常用操作组织。

## Block 使用原则

先决定怎样才能把知识讲清楚，再选择 LessonBlock。

不要规定每节课必须有固定数量的 blocks，也不要为了覆盖组件种类而强行加入 code/table/callout/quiz/exercise/keypoints。

- paragraph：连续解释与推理
- heading/subheading：真实知识层级
- list：并列信息或步骤摘要
- callout：真正值得特别提醒的坑、例外、版本、安全或性能信息
- code：代码/API/实现示例，尽量真实完整
- table：多维对比或结构化参考
- definition：需要明确固定含义的术语
- keypoints：需要阶段性总结时使用
- quiz：主动回忆或理解辨析真正有价值时使用
- exercise：学习者需要实际完成任务时使用

## 写入约束

严格遵守平台类型，不发明字段。

每个 lesson 文件：

src/content/courses/<course-slug>/lessons/<lesson-slug>.ts

必须导出：

import type { Lesson } from "../../../types";

export const lesson: Lesson = { ... };

并满足：
- **文件名 = 课时真实 slug**，且该 slug 存在于 `course.ts` 大纲中（课时元信息
  标题/时长/类型一律以大纲 `LessonMeta` 为权威，课时文件里不要重复声明
  slug/courseSlug/title/minutes/kind；如声明必须与大纲一致）
- 当前平台课时文件 slug 跨课程全局唯一
- quiz.answer 是从 0 开始的合法下标

## 完成条件

不要因为首页、目录、标题或少量简介已经存在就宣布课程完成。

完成后运行：

npm run validate
npm run typecheck
npm run build

然后抽查多个实际课时，确认它们真正包含足以学习该主题的正文、示例、机制/语义、边界或实践信息，而不是占位内容。

## 用户任务

<在这里放用户的课程主题、目标、资料、仓库或具体要求>
```
