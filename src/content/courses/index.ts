/* ==================================================================
 * 课程内容聚合入口（约定式自动加载）
 * ----------------------------------------------------------------
 * 约定：
 *   1. 每个课程文件夹包含 course.ts，导出 course: Course
 *   2. 课时文件放在 <course>/lessons/*.ts，导出 lesson: Lesson
 * 新课程/新课时只要把文件放进对应目录即自动生效，无需修改本文件。
 * 相关命令：npm run validate（校验）、npm run scaffold:course（新建课程）
 * ================================================================== */
import type { Course, GlossaryEntry, Lesson, LessonMeta } from "../types";

export type { Course, GlossaryEntry, Lesson, LessonMeta } from "../types";

const courseModules = import.meta.glob<{ course: Course }>("./*/course.ts", {
  eager: true,
});
const lessonModules = import.meta.glob<{ lesson: Lesson }>("./*/lessons/*.ts", {
  eager: true,
});
const glossaryModules = import.meta.glob<{ glossary: GlossaryEntry[] }>(
  "./*/glossary.ts",
  { eager: true },
);

/** 课程排序：coverIndex 数字优先，非数字兜底按字母序，保证稳定可预期 */
export type CourseSort = "default" | "newest" | "oldest";

export const COURSE_SORT_OPTIONS: { value: CourseSort; label: string }[] = [
  { value: "default", label: "默认排序" },
  { value: "newest", label: "最近更新" },
  { value: "oldest", label: "最早创建" },
];

export function courseSortValue(course: Course, sort: CourseSort): number {
  const n = Number.parseInt(course.coverIndex, 10);
  const index = Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  return sort === "newest" ? -index : index;
}

/** 全部课程（按目录字母序） */
export const courses: Course[] = Object.values(courseModules).map(
  (m) => m.course,
);

/**
 * 按封面序号排序后的课程列表（首页课程区用）。
 * coverIndex 即创建序号：默认顺序 = 创建先后；newest/oldest 反向。
 */
export const orderedCourses: Course[] = [...courses].sort(
  (a, b) => courseSortValue(a, "default") - courseSortValue(b, "default"),
);

/**
 * 全部课时内容：文件名 slug → Lesson（大纲有内容无的课时不在此列）。
 * 键取自课时文件名（<course>/lessons/<slug>.ts 的 <slug>），这是课时真实
 * slug 的权威来源；lesson 对象内的 slug 字段只是向后兼容的冗余声明，
 * 缺失不应影响查找（见 PLATFORM-CONTRACT §4）。
 */
export const lessons: Record<string, Lesson> = Object.fromEntries(
  Object.entries(lessonModules).map(([path, m]) => {
    const fileSlug = path.slice(path.lastIndexOf("/") + 1, -".ts".length);
    return [fileSlug, m.lesson];
  }),
);

/** 便捷查询：按 slug 取课程 */
export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}

/**
 * 取完整课时（按课时文件自身的 slug 作键）；不存在返回 undefined。
 * 注意：课时元信息一律以大纲为准；本映射只在需要正文 blocks/summary 时使用。
 */
export function getLesson(fileSlug: string): Lesson | undefined {
  return lessons[fileSlug];
}

/**
 * 取课程的术语表（glossary.ts 的词条数组，按文件内顺序）；
 * 课程未建术语表时返回 undefined。词条按首次被引用的课时排序、
 * 未引用词条统计等查询见 pages/glossary.tsx。
 */
export function getGlossary(courseSlug: string): GlossaryEntry[] | undefined {
  const mod = glossaryModules[`./${courseSlug}/glossary.ts`];
  return mod?.glossary;
}

/**
 * 大纲中查找课时元信息（含缺失课时、锁定课时）。
 * 页面展示 slug/title/minutes/kind 时一律用本函数，而不是读 Lesson 对象。
 */
export function findLessonMeta(
  course: Course,
  lessonSlug: string,
): LessonMeta | undefined {
  for (const chapter of course.chapters) {
    const meta = chapter.lessons.find((l) => l.slug === lessonSlug);
    if (meta) return meta;
  }
  return undefined;
}

/**
 * 课时正文元信息（以大纲为准，正文兜底）：
 * 返回展示用的完整元信息。大纲缺失该 slug 时由调用方自行决定兜底。
 */
export function getLessonDisplayMeta(
  course: Course,
  lessonSlug: string,
): { title: string; minutes: number; kind: LessonMeta["kind"] } | undefined {
  const meta = findLessonMeta(course, lessonSlug);
  if (meta) return { title: meta.title, minutes: meta.minutes, kind: meta.kind };
  const lesson = getLesson(lessonSlug);
  if (lesson && lesson.title && lesson.minutes && lesson.kind) {
    return {
      title: lesson.title,
      minutes: lesson.minutes,
      kind: lesson.kind,
    };
  }
  return undefined;
}

/** 把章节 + 课时拍平成有序列表（侧边栏 / 导航用） */
export function flattenLessons(course: Course): {
  chapterIndex: number;
  lessonIndex: number;
  meta: Course["chapters"][number]["lessons"][number];
  chapterTitle: string;
}[] {
  const flat: ReturnType<typeof flattenLessons> = [];
  course.chapters.forEach((chapter, ci) => {
    chapter.lessons.forEach((meta, li) => {
      flat.push({ chapterIndex: ci, lessonIndex: li, meta, chapterTitle: chapter.title });
    });
  });
  return flat;
}
