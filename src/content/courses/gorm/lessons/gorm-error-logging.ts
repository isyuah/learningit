/* ==================================================================
 * 课时：错误处理与日志（gorm-error-logging）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-error-logging",
  "courseSlug": "gorm",
  "title": "错误处理与日志",
  "summary": "集中式检查 .Error、读懂 ErrRecordNotFound，并让每条 SQL 都可通过日志观察。",
  "minutes": 16,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "GORM 的错误传播方式是「不 panic，而是把错误挂在 `db.Error` 上」——每次操作之后，你通过 `.Error` 拿到结果。这套约定如果利用得当，可以让错误检查既集中又不会漏；而配合日志，则能让每一条 SQL 的耗时与失败都可见。这一节把它们串起来。"
    },
    {
      "type": "heading",
      "text": "集中式错误检查：.Error 与一小段 helper"
    },
    {
      "type": "paragraph",
      "text": "几乎每一个 GORM 调用都以 `.Error` 结尾。与其在每个调用点写一大堆 `if err != nil { return err }`，不如写一个小的检查 helper——它既统一错误处理，也让业务代码更聚焦。"
    },
    {
      "type": "code",
      "title": "一个小的错误处理 helper",
      "language": "go",
      "code": "// 统一检查并包装错误，附上操作上下文\nfunc must(err error, op string) error {\n    if err != nil {\n        return fmt.Errorf(\"%s 失败: %w\", op, err)\n    }\n    return nil\n}\n\nif err := must(db.Create(&user).Error, \"创建用户\"); err != nil {\n    return err\n}\nif err := must(db.Model(&user).Update(\"name\", \"新名\").Error, \"更新用户名\"); err != nil {\n    return err\n}"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别把错误吞掉",
      "body": "最常见的错误是 `_ = db.Create(&user)` 连 `.Error` 都不看。一旦插入失败，程序继续往下走，数据处在未知状态，排错时也看不到任何痕迹。至少要做到：检查 `.Error`，带上下文包装错误，并让日志记录下出错时的 SQL 与阶段。"
    },
    {
      "type": "heading",
      "text": "gorm.ErrRecordNotFound 与 errors.Is"
    },
    {
      "type": "paragraph",
      "text": "`First`、`Last`、`Take` 之类在「查不到记录」时会返回 `gorm.ErrRecordNotFound`。判断它不要用 `==` 直接比，而要用 `errors.Is(err, gorm.ErrRecordNotFound)`——因为错误可能被 wrap 过，`errors.Is` 能沿着包装链找到原始错误，`==` 则不能。"
    },
    {
      "type": "code",
      "title": "区分「没找到」与「真出错」",
      "language": "go",
      "code": "var u User\nif err := db.Where(\"email = ?\", email).First(&u).Error; err != nil {\n    if errors.Is(err, gorm.ErrRecordNotFound) {\n        // 业务上的「不存在」，通常是 404 / 正常分支\n        return nil, nil\n    }\n    // 数据库层面的真错误，交给上层统一处理\n    return nil, fmt.Errorf(\"查询用户: %w\", err)\n}\nreturn &u, nil"
    },
    {
      "type": "paragraph",
      "text": "初学者常犯的错是把 `ErrRecordNotFound` 当成真正的异常到处抛。实际上「查无此记录」在很多业务里是正常情况（登录查不到用户 → 返回「用户名或密码错误」），用 `errors.Is` 判断后走业务分支才是正解。"
    },
    {
      "type": "heading",
      "text": "TranslateError：让数据库错误更友好"
    },
    {
      "type": "paragraph",
      "text": "默认情况下，数据库返回的底层错误（比如唯一键冲突）会是驱动原生的、对上层不友好的形式。在 `gorm.Config` 里开 `TranslateError: true` 后，GORM 会把常见的数据库错误翻译成标准错误，例如 `gorm.ErrDuplicatedKey`（唯一键冲突）、`gorm.ErrForeignKeyViolated`（外键约束违反）等，配合 `errors.Is` 就能按业务处理，而不是去解析数据库错误字符串。"
    },
    {
      "type": "code",
      "title": "开启 TranslateError 并处理唯一键冲突",
      "language": "go",
      "code": "db, _ := gorm.Open(mysql.Open(dsn), &gorm.Config{\n    TranslateError: true,\n})\n\nerr := db.Create(&User{Email: \"a@example.com\"}).Error\nif errors.Is(err, gorm.ErrDuplicatedKey) {\n    // Email 有 uniqueIndex，重复时走这里\n    return fmt.Errorf(\"该邮箱已被注册: %w\", err)\n}"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "先想想要不要把底层错误暴露给用户",
      "body": "TranslateError 让程序能像处理业务错误一样处理数据库错误，但并不意味着该把内部错误原文返回给客户端。安全实践是：对外返回统一、无敏感信息的错误信息，把带堆栈的细节留在服务端日志里。"
    },
    {
      "type": "heading",
      "text": "配置 Logger：级别与输出"
    },
    {
      "type": "paragraph",
      "text": "GORM 自带一个结构化 Logger，可通过 `gorm.Config{Logger: logger.Default.LogMode(...)}` 配置。级别从静默到最详细：`logger.Silent`（不输出）、`logger.Warn`（只警告）、`logger.Error`（只错误）、`logger.Info`（全部，含每条 SQL）。开发期常用 Info 观察实际执行的 SQL，生产常用 Error/Warn 减少噪音。"
    },
    {
      "type": "code",
      "title": "设置日志级别",
      "language": "go",
      "code": "import (\n    \"gorm.io/gorm/logger\"\n)\n\ndb, _ := gorm.Open(mysql.Open(dsn), &gorm.Config{\n    Logger: logger.Default.LogMode(logger.Info),\n})\n\ndb.Create(&user) // SQL 与参数会被打印出来"
    },
    {
      "type": "paragraph",
      "text": "GORM Logger 默认打印的内容包括：SQL 语句、执行时间、错误与受影响行数。它的阈值是「慢查询」——超过 `SlowThreshold` 的查询会以 Warn 级别记录，方便你发现性能异常。"
    },
    {
      "type": "heading",
      "text": "自定义 Logger 与 db.Debug()"
    },
    {
      "type": "paragraph",
      "text": "如果你想接入团队统一的日志库（如 zap / slog），可以实现 `logger.Interface` 接口并在 `gorm.Config{Logger: ...}` 里替换。接口会收到记录元数据（查询、耗时、错误、行数）与对应的日志级别、上下文，通常是件一次性工作，建议做但不必过度设计。"
    },
    {
      "type": "code",
      "title": "接入自定义 logger（示意）",
      "language": "go",
      "code": "// CustomLogger 实现 logger.Interface 的关键方法，用 zap 输出\ntype CustomLogger struct {\n    zap *zap.Logger\n}\n\nfunc (l *CustomLogger) Error(ctx context.Context, msg string, data ...interface{}) {\n    l.zap.Error(msg, zap.Any(\"data\", data))\n}\n// ... 其余方法（Trace / Warn / Info / LogMode 等）按需实现\n\ndb, _ := gorm.Open(mysql.Open(dsn), &gorm.Config{\n    Logger: &CustomLogger{zap: zapL},\n})"
    },
    {
      "type": "paragraph",
      "text": "`db.Debug()` 则为「单条链」临时打开 Info 日志：把它放在链的开头，这条查询的 SQL 就会打印出来，而不影响全局配置。它是排错时最顺手的小工具。"
    },
    {
      "type": "code",
      "title": "用 Debug 观察单条 SQL",
      "language": "go",
      "code": "// 只对这条链打印 SQL，便于排错\nvar users []User\ndb.Debug().\n    Preload(\"Orders\").\n    Where(\"balance > ?\", 100).\n    Find(&users)"
    },
    {
      "type": "heading",
      "text": "DryRun：只拼 SQL，不真正执行"
    },
    {
      "type": "paragraph",
      "text": "当你只想看 GORM 会生成什么样的 SQL、又不想真的打数据库时，用 `db.Session(&gorm.Session{DryRun: true})`。DryRun 会把整条链的 SQL 组装好并写入 `.Statement.SQL` 与参数，而不向数据库发起执行——常用于审查、对比或生成报表用的语句。"
    },
    {
      "type": "code",
      "title": "DryRun 预览将执行的 SQL",
      "language": "go",
      "code": "var users []User\nstmt := db.Session(&gorm.Session{DryRun: true}).\n    Where(\"balance > ?\", 100).\n    Order(\"created_at DESC\").\n    Find(&users).Statement\n\nfmt.Println(stmt.SQL.String()) // 打印拼好的 SQL\nfmt.Println(stmt.Vars)        // 参数值"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "DryRun 不执行，别指望它有副作用",
      "body": "DryRun 会话只是组装 SQL 并停在执行之前，`users` 切片不会被填充，也不会真正读写数据库。它解决的是「想确认 SQL 长什么样」的问题，不是「想干一次却偷偷不干」。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "日志要有上下文：SQL + 耗时 + 错误",
      "body": "只记「SQL 失败」没有意义。理想日志应包含：完整 SQL（或摘要）、执行耗时、错误详情、以及发起请求的标识（请求 ID / 用户）。GORM Logger 默认输出 SQL、耗时、行数、错误；在自定义日志器中把这些与业务上下文拼起来，才能快速定位问题。"
    },
    {
      "type": "quiz",
      "question": "判断「查询没有记录」时，标准做法是？",
      "options": [
        "直接比较 err == gorm.ErrRecordNotFound",
        "用 errors.Is(err, gorm.ErrRecordNotFound)，因为错误可能被 wrap 过",
        "只要 err != nil 就一定是记录不存在",
        "忽略 err，直接使用空结果"
      ],
      "answer": 1,
      "explanation": "错误可能被包装，errors.Is 会沿包装链判断是否是 RecordNotFound；且 err 非空也可能是真实数据库错误，需要分开处理。"
    },
    {
      "type": "exercise",
      "title": "让日志告诉你发生了什么",
      "description": "写一个返回 {sql, duration, err} 的小函数，用它包住一次 `db.Where(...).First(...)`：打印 SQL、耗时与错误（若有）。再尝试把同一条查询用 `db.Debug()` 跑一遍，观察与手动日志的区别。",
      "hint": "查询前后记录 time.Now()，结束时用 logger.Info 输出 stmt.SQL 与耗时；Debug 会直接打印 GORM 自己的日志。"
    },
    {
      "type": "keypoints",
      "items": [
        "GORM 不 panic，错误挂在 .Error，务必检查并带上下文包装",
        "用 errors.Is(err, gorm.ErrRecordNotFound) 判断「查无记录」（正常分支）",
        "TranslateError: true 把数据库错误翻译成标准错误（ErrDuplicatedKey 等）",
        "logger.Default.LogMode(Info/Warn/Error) 配置日志级别",
        "db.Debug() 对单条链打印 SQL；DryRun 只拼 SQL 不执行",
        "日志要有 SQL、耗时、错误与请求上下文"
      ]
    }
  ]
};
