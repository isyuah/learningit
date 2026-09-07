/* ==================================================================
 * 内容模型（Content Model）
 * ----------------------------------------------------------------
 * 本文件是整个模板的「数据契约」。填充真实内容 = 按照这些类型提供
 * 数据，页面会自动渲染。所有字段都有注释。
 *
 * 对 LLM 助手（如 Claude / ChatGPT）的提示词模板见
 * docs/LLM-PROMPT.md，完整教学见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */

/** 课程难度 */
export type Level = "beginner" | "intermediate" | "advanced";

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: "入门",
  intermediate: "进阶",
  advanced: "高级",
};

/** 课时类型：决定课程大纲里的图标与文案 */
export type LessonKind = "reading" | "video" | "exercise" | "quiz";

export const LESSON_KIND_LABEL: Record<LessonKind, string> = {
  reading: "阅读",
  video: "视频",
  exercise: "练习",
  quiz: "测验",
};

/** 封面配色（来自主题色板） */
export type CoverColor = "primary" | "amber" | "info" | "success" | "danger";

/* ------------------------------------------------------------------ */

/** 章节：课程内容按章节分组，章节包含若干课时 */
export interface Chapter {
  /** 章节 id（课程内唯一，仅作 key 使用） */
  id: string;
  title: string;
  /** 章节导语（可选，展示在大纲折叠面板里） */
  intro?: string;
  lessons: LessonMeta[];
}

/**
 * 课时元信息：用于课程页、大纲、侧边栏。
 *
 * 本类型是课时「顺序与元信息」的权威来源：
 * - slug / title / minutes / kind 一律以大纲中的这一份为准；
 * - lessons/<slug>.ts 中的 Lesson 与之重复的字段只是冗余声明，
 *   页面只信任这里（validate 会交叉检查两份是否一致）；
 * - 增删课时、改标题、调顺序、改时长：只改大纲，不改课时文件。
 */
export interface LessonMeta {
  /** 课时 slug，与对应 lessons/<slug>.ts 中的完整课时一一对应 */
  slug: string;
  title: string;
  /** 预计学习时长（分钟） */
  minutes: number;
  kind: LessonKind;
  /** 是否锁定（可选）。锁定课时会显示锁图标并不可点击 */
  locked?: boolean;
}

/** 课程 */
export interface Course {
  /** 课程 slug，用于路由 /courses/:slug */
  slug: string;
  title: string;
  /** 一句话副标题（课程卡片与课程页头部） */
  tagline: string;
  /** 课程简介（课程页使用，支持 \n 换行分段） */
  description: string;
  level: Level;
  /** 预计总时长（小时），展示用 */
  hours: number;
  /** 学习人数（示例数据为占位；上线前替换为真实数据） */
  learners?: number;
  /** 课程封面上的装饰序号，如 "01" */
  coverIndex: string;
  /** 封面配色 */
  coverColor: CoverColor;
  /** 更新时间，如 "2025-06" */
  updatedAt: string;
  /** 学习本章后你将掌握的内容（课程页「你将学到」） */
  outcomes?: string[];
  chapters: Chapter[];
}

/* ------------------------------------------------------------------ */

/**
 * 课时内容块（Lesson Block）：一节课由若干「块」按顺序组成。
 * 每个块对应页面上的一个教学组件。新增块类型时，在
 * src/components/learning/lesson-blocks.tsx 中注册渲染器即可。
 */
export type LessonBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | {
      type: "callout";
      variant: "tip" | "note" | "warning" | "example";
      title?: string;
      body: string;
    }
  | { type: "code"; title?: string; language: string; code: string }
  | { type: "table"; caption?: string; headers: string[]; rows: string[][] }
  | { type: "definition"; term: string; definition: string }
  | { type: "keypoints"; items: string[] }
  | {
      type: "quiz";
      question: string;
      options: string[];
      /** 正确答案下标（从 0 开始） */
      answer: number;
      explanation: string;
    }
  | { type: "exercise"; title: string; description: string; hint?: string }
  | {
      type: "video";
      title: string;
      /** provider 为 placeholder 时不加载任何 iframe，仅展示占位 */
      provider: "youtube" | "bilibili" | "mp4" | "placeholder";
      src: string;
      duration?: string;
    }
  | { type: "quote"; text: string; source?: string }
  | { type: "divider" };

/**
 * 完整课时：每节课保存在对应课程的 lessons/<slug>.ts 中。
 *
 * 元信息（slug/title/minutes/kind）以大纲 LessonMeta 为权威；
 * 下方同名可选字段仅是向后兼容的冗余声明，validate 会交叉检查，
 * 页面只读大纲。summary（一句话简介）与 blocks 是课时独有字段。
 */
export interface Lesson {
  /** 冗余声明，见 slug 注释 */
  slug?: string;
  /** 冗余声明，见 slug 注释 */
  courseSlug?: string;
  /** 冗余声明，见 slug 注释（正文仍需在文件顶部注释里标注标题） */
  title?: string;
  /** 一句话简介（课时页页头与侧边栏展示） */
  summary?: string;
  /** 冗余声明，见 slug 注释 */
  minutes?: number;
  /** 冗余声明，见 slug 注释 */
  kind?: LessonKind;
  /** 课时正文：只允许出现在这里的内容块序列 */
  blocks: LessonBlock[];
}
