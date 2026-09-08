/**
 * 内容校验：npm run validate
 * ----------------------------------------------------------------
 * 按目录约定自动扫描 src/content/courses/：
 *   - 每个课程文件夹必须有 course.ts（导出 course: Course）
 *   - 课时文件放在 <course>/lessons/*.ts（导出 lesson: Lesson）
 *
 * 元信息权威：课时 slug/title/minutes/kind 以 course.ts 大纲 LessonMeta
 * 为权威；课时文件里的同名可选字段只是向后兼容的冗余声明，本校验会
 * 交叉检查两份是否一致（以大纲为准）。文件名 = 课时文件的实际 slug。
 *
 * 检查项：
 *   [错误] 大纲内重复 slug / 跨课程重复 slug（会静默覆盖）
 *   [错误] 大纲↔课时文件 title/minutes/kind 声明不一致
 *   [错误] 课时文件未导出 lesson / 文件内 slug 与文件名不一致
 *   [错误] 课时文件 courseSlug 冗余声明与所在课程不一致
 *   [错误] quiz 的 answer 下标越界、选项不足
 *   [错误] 叙事字段混入块级 Markdown（标题/列表/表格/围栏…，引导改用对应块）
 *   [错误] 叙事字段出现非白名单链接 scheme（仅 http/https/mailto/站内/glossary:）
 *   [错误] [x](glossary:key) 引用了不存在的词条 / 所在课程没有 glossary.ts
 *   [错误] glossary.ts 词条 key 重复或格式非法、term/summary 缺失、
 *           detail 使用不允许的块类型（仅 paragraph/list/callout/code/table/quote）
 *   [警告] 文件夹名与 course.slug 不一致
 *   [警告] 大纲有但无内容文件（占位课时，属正常）
 *   [警告] 有内容文件但大纲未收录
 *   [警告] 课时文件无任何内容块（blocks 为空）
 *   [警告] 纯文本字段（heading/summary 等）出现 Markdown 记号（会字面显示）
 *   [警告] 术语表词条尚无课时正文引用（提前建档属正常）
 * 有错误时退出码为 1（可接入 CI）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Course, GlossaryEntry, Lesson, LessonMeta } from "../src/content/types.ts";
import {
  classifyHref,
  collectGlossaryKeys,
  collectLinks,
  findBlockMarkers,
  hasInlineMarkers,
  walkLessonBlockMd,
  walkLessonBlockPlain,
} from "../src/lib/inline-markdown.ts";

const coursesDir = join(process.cwd(), "src", "content", "courses");

const errors: string[] = [];
const warnings: string[] = [];

/** glossary.ts 允许出现在 detail 里的块类型子集 */
const DETAIL_ALLOWED_TYPES = new Set([
  "paragraph",
  "list",
  "callout",
  "code",
  "table",
  "quote",
]);

interface GlossaryCheck {
  keys: Set<string>;
  entries: GlossaryEntry[];
}

/** 课程目录 → 已载入词条 */
const glossaries = new Map<string, GlossaryCheck>();
/** 课程目录 → 词条 key → 被引用次数（词条完整性检查用） */
const referencedKeys = new Map<string, Map<string, number>>();

/** 摘要化一段文本（错误信息里展示上下文用） */
function snippet(value: string): string {
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > 46 ? `${s.slice(0, 46)}…` : s;
}

/** 检查一段行内 Markdown 叙事文本：块级记号 / 链接白名单 / 术语引用 */
function checkNarrative(dir: string, where: string, text: string): void {
  for (const m of findBlockMarkers(text)) {
    errors.push(
      `[${dir}/${where}] 叙事字段含 Markdown 块级记号（${m.name}）：「${snippet(m.sample)}」——请改用 ${m.fix}`,
    );
  }
  for (const href of collectLinks(text)) {
    if (classifyHref(href) === "other") {
      errors.push(
        `[${dir}/${where}] 链接目标不受支持：「${snippet(href)}」（仅支持 http/https/mailto、站内 / 路径与 glossary:key）`,
      );
    }
  }
  const glossary = glossaries.get(dir);
  for (const key of collectGlossaryKeys(text)) {
    if (!glossary) {
      errors.push(
        `[${dir}/${where}] 引用了术语 glossary:${key}，但该课程还没有 glossary.ts`,
      );
    } else if (!glossary.keys.has(key)) {
      errors.push(
        `[${dir}/${where}] 术语引用 glossary:${key} 未找到对应词条（检查 key 拼写或 glossary.ts）`,
      );
    }
    let perCourse = referencedKeys.get(dir);
    if (!perCourse) {
      perCourse = new Map();
      referencedKeys.set(dir, perCourse);
    }
    perCourse.set(key, (perCourse.get(key) ?? 0) + 1);
  }
}

const courseDirs = readdirSync(coursesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const allLessons: Lesson[] = [];
const fileSlugs: string[] = [];
let courseCount = 0;

for (const dir of courseDirs) {
  const courseFile = join(coursesDir, dir, "course.ts");
  if (!existsSync(courseFile)) {
    errors.push(`[${dir}] 缺少 course.ts`);
    continue;
  }
  const mod = (await import(`../src/content/courses/${dir}/course.ts`)) as {
    course?: Course;
  };
  const course = mod.course;
  if (!course) {
    errors.push(`[${dir}] course.ts 未导出 course`);
    continue;
  }
  courseCount += 1;
  if (course.slug !== dir) {
    warnings.push(`[${dir}] 文件夹名与 course.slug 不一致：${dir} vs ${course.slug}`);
  }

  const outlineMeta = new Map<string, LessonMeta>();
  const outlineSlugs = new Set<string>();
  for (const ch of course.chapters) {
    for (const m of ch.lessons) {
      if (outlineSlugs.has(m.slug)) {
        errors.push(`[${course.slug}] 大纲内重复课时 slug：${m.slug}`);
      }
      outlineSlugs.add(m.slug);
      outlineMeta.set(m.slug, m);
      if (!Number.isFinite(m.minutes) || m.minutes <= 0) {
        warnings.push(`[${course.slug}] ${m.slug} 的 minutes 无效：${m.minutes}`);
      }
    }
  }

  const lessonsDir = join(coursesDir, dir, "lessons");

  // —— 课程术语表（可选）：载入并检查词条本体 ——
  const glossaryFile = join(coursesDir, dir, "glossary.ts");
  if (existsSync(glossaryFile)) {
    const gm = (await import(`../src/content/courses/${dir}/glossary.ts`)) as {
      glossary?: GlossaryEntry[];
    };
    if (!Array.isArray(gm.glossary)) {
      errors.push(`[${course.slug}] glossary.ts 未导出 glossary: GlossaryEntry[]`);
    } else {
      const keys = new Set<string>();
      for (const entry of gm.glossary) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.key)) {
          errors.push(
            `[${course.slug}] 词条 key「${entry.key}」不合法：仅允许小写字母、数字与连字符（如 dead-letter-queue）`,
          );
        }
        if (keys.has(entry.key)) {
          errors.push(`[${course.slug}] 术语表词条 key 重复：${entry.key}`);
        }
        keys.add(entry.key);
        if (!entry.term || !entry.term.trim()) {
          errors.push(`[${course.slug}] 词条 ${entry.key} 缺少 term`);
        }
        if (!entry.summary || !entry.summary.trim()) {
          errors.push(`[${course.slug}] 词条 ${entry.key} 缺少 summary（悬浮卡片文案）`);
        } else if (hasInlineMarkers(entry.summary)) {
          warnings.push(
            `[${course.slug}] 词条 ${entry.key} 的 summary 含 Markdown 记号（悬浮卡片按纯文本渲染）：「${snippet(entry.summary)}」`,
          );
        }
      }
      glossaries.set(dir, { keys, entries: gm.glossary });
      for (const entry of gm.glossary) {
        for (const block of entry.detail ?? []) {
          if (!DETAIL_ALLOWED_TYPES.has(block.type)) {
            errors.push(
              `[${course.slug}] 词条 ${entry.key} 的 detail 不允许使用 ${block.type} 块（仅 paragraph/list/callout/code/table/quote）`,
            );
            continue;
          }
          walkLessonBlockMd(block, (field, value) => {
            checkNarrative(dir, `glossary:${entry.key}.detail.${field}`, value);
          });
        }
      }
    }
  }

  if (!existsSync(lessonsDir)) continue;

  for (const file of readdirSync(lessonsDir).filter((f) => f.endsWith(".ts"))) {
    const lessonMod = (await import(
      `../src/content/courses/${dir}/lessons/${file}`
    )) as { lesson?: Lesson };
    const lesson = lessonMod.lesson;
    if (!lesson) {
      errors.push(`[${course.slug}] ${file} 未导出 lesson`);
      continue;
    }
    allLessons.push(lesson);
    // 文件名即课时 slug（权威键，跨课程全局唯一约束也按它检查）
    const fileSlug = file.replace(/\.ts$/, "");
    fileSlugs.push(fileSlug);

    // —— 冗余元字段：声明了就不得写错（不声明即省略，合法） ——
    if (lesson.slug !== undefined && lesson.slug !== fileSlug) {
      errors.push(
        `[${course.slug}] ${file} 内 lesson.slug（${lesson.slug}）与文件名不一致`,
      );
    }
    if (lesson.courseSlug !== undefined && lesson.courseSlug !== course.slug) {
      errors.push(
        `[${course.slug}] ${file} 的 courseSlug 应为 ${course.slug}，实际 ${lesson.courseSlug}`,
      );
    }

    // —— 大纲↔课时文件一致性（大纲 LessonMeta 为权威） ——
    const meta = outlineMeta.get(fileSlug);
    if (!meta) {
      warnings.push(`[${course.slug}] ${fileSlug}：有内容文件但大纲未收录`);
    } else {
      if (lesson.title !== undefined && lesson.title !== meta.title) {
        errors.push(
          `[${course.slug}/${fileSlug}] 课时文件 title「${lesson.title}」与大纲「${meta.title}」不一致（以大纲为准）`,
        );
      }
      if (lesson.minutes !== undefined && lesson.minutes !== meta.minutes) {
        errors.push(
          `[${course.slug}/${fileSlug}] 课时文件 minutes=${lesson.minutes} 与大纲 ${meta.minutes} 不一致（以大纲为准）`,
        );
      }
      if (lesson.kind !== undefined && lesson.kind !== meta.kind) {
        errors.push(
          `[${course.slug}/${fileSlug}] 课时文件 kind=${lesson.kind} 与大纲 ${meta.kind} 不一致（以大纲为准）`,
        );
      }
    }

    // —— 正文结构检查 ——
    if (!lesson.blocks.length) {
      warnings.push(`[${course.slug}/${fileSlug}] 课时无内容块（blocks 为空）`);
    }
    for (const block of lesson.blocks) {
      if (block.type === "quiz") {
        if (
          !Number.isInteger(block.answer) ||
          block.answer < 0 ||
          block.answer >= block.options.length
        ) {
          errors.push(
            `[${course.slug}/${fileSlug}] quiz「${block.question.slice(0, 20)}…」answer=${block.answer} 越界（共 ${block.options.length} 个选项）`,
          );
        }
        if (block.options.length < 2) {
          warnings.push(`[${course.slug}/${fileSlug}] quiz 选项不足 2 个`);
        }
      }
    }

    // —— 行内 Markdown：块级记号 / 链接白名单 / 术语引用 ——
    for (const block of lesson.blocks) {
      walkLessonBlockMd(block, (field, value) => {
        checkNarrative(dir, `${fileSlug}(${block.type}.${field})`, value);
      });
      walkLessonBlockPlain(block, (field, value) => {
        if (hasInlineMarkers(value)) {
          warnings.push(
            `[${course.slug}/${fileSlug}] ${block.type}.${field} 是纯文本字段（不做 Markdown 渲染），出现记号会字面显示：「${snippet(value)}」——请去掉 **、反引号等标记`,
          );
        }
      });
    }
    if (lesson.summary && hasInlineMarkers(lesson.summary)) {
      warnings.push(
        `[${course.slug}/${fileSlug}] summary 是纯文本字段（不做 Markdown 渲染），出现记号会字面显示：「${snippet(lesson.summary)}」`,
      );
    }
  }
}

for (const dir of courseDirs) {
  const m = (await import(`../src/content/courses/${dir}/course.ts`)) as {
    course?: Course;
  };
  if (!m.course) continue;
  const full = m.course.chapters.flatMap((c) => c.lessons.map((l) => l.slug));
  const missing = full.filter((s) => !fileSlugs.includes(s));
  if (missing.length) {
    warnings.push(
      `[${m.course.slug}] 大纲中有 ${missing.length} 节占位课时（无内容文件）：${missing.slice(0, 6).join("、")}${missing.length > 6 ? "…" : ""}`,
    );
  }
}

// 术语表词条引用情况：零引用的词条给警告（提前建档属合法）
for (const dir of courseDirs) {
  const glossary = glossaries.get(dir);
  if (!glossary) continue;
  const used = referencedKeys.get(dir) ?? new Map<string, number>();
  for (const entry of glossary.entries) {
    if ((used.get(entry.key) ?? 0) === 0) {
      warnings.push(
        `[${dir}] 术语表词条「${entry.term}（glossary:${entry.key}）」尚无课时正文引用（提前建档是合法的，仅提醒）`,
      );
    }
  }
}

// 跨课程重复文件 slug（lessons 映射会静默覆盖；同课程内不可能重复）
const seen = new Map<string, number>();
for (const slug of fileSlugs) seen.set(slug, (seen.get(slug) ?? 0) + 1);
for (const [slug, n] of seen) {
  if (n > 1) errors.push(`跨课程重复课时 slug：${slug}（${n} 处）`);
}

console.log(
  `\n📚 内容校验完成：${courseCount} 门课程，${allLessons.length} 节有内容的课时`,
);
if (warnings.length) {
  console.log(`\n⚠️  警告（${warnings.length}）：`);
  warnings.forEach((w) => console.log(`  · ${w}`));
}
if (errors.length) {
  console.log(`\n❌ 错误（${errors.length}）：`);
  errors.forEach((e) => console.log(`  · ${e}`));
  console.log("\n请修复后重新运行 npm run validate\n");
  process.exit(1);
}
console.log(
  errors.length === 0 && warnings.length === 0
    ? "\n✅ 全部通过"
    : "\n✅ 无错误（有警告，见上）",
);
