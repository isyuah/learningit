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
 *   [警告] 文件夹名与 course.slug 不一致
 *   [警告] 大纲有但无内容文件（占位课时，属正常）
 *   [警告] 有内容文件但大纲未收录
 *   [警告] 课时文件无任何内容块（blocks 为空）
 * 有错误时退出码为 1（可接入 CI）。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Course, Lesson, LessonMeta } from "../src/content/types.ts";

const coursesDir = join(process.cwd(), "src", "content", "courses");

const errors: string[] = [];
const warnings: string[] = [];

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
