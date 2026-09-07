import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-security-sql-injection",
  courseSlug: "gorm",
  title: "SQL 注入、动态标识符与写保护",
  summary: "区分参数值与 SQL 结构，安全处理查询、排序、表名、Raw SQL、日志与批量写保护。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "ORM 不会自动消灭 SQL 注入。GORM 通过 database/sql 占位符安全绑定值，但列名、表名、排序方向和完整 SQL 片段属于语句结构，不能用 ? 参数化。只要把用户输入拼进结构位置，链式 API 和泛型 API 都一样危险。",
    },
    {
      type: "heading",
      text: "安全边界：值参数化，结构白名单化",
    },
    {
      type: "code",
      title: "同一个输入的安全与危险写法",
      language: "go",
      code: `// 安全：值通过占位符绑定
users, err := gorm.G[User](db).
    Where("name = ?", userInput).
    Find(ctx)

// 危险：输入成为 SQL 语法的一部分
users, err = gorm.G[User](db).
    Where(fmt.Sprintf("name = %s", userInput)).
    Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "占位符的作用不是简单地给字符串加引号，而是把 SQL 结构和参数值分开交给驱动。不要自己 Escape，不要用 fmt.Sprintf 生成条件，也不要把 Logger 打印出的插值 SQL 当作可安全重放的语句。",
    },
    {
      type: "heading",
      text: "动态排序必须做映射",
    },
    {
      type: "code",
      title: "把 API 排序选项映射到可信 SQL",
      language: "go",
      code: `var allowedSort = map[string]string{
    "newest": "created_at DESC",
    "oldest": "created_at ASC",
    "name":   "name ASC",
}

order, ok := allowedSort[request.Sort]
if !ok {
    return nil, ErrInvalidSort
}

users, err := gorm.G[User](db).
    Order(order).
    Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "Order、Select、Distinct、Group、Table、Joins 等 API 接收的字符串可能直接进入 SQL 结构。动态列名也要映射为预定义 clause.Column 或可信常量；正则过滤特殊字符不是可靠的 SQL 解析器。",
    },
    {
      type: "table",
      caption: "常见输入与处理方式",
      headers: ["输入", "能否用 ? 绑定", "正确处理"],
      rows: [
        ["name、状态、时间、ID", "可以", "Where/Raw 中作为参数"],
        ["排序方向", "不可以", "映射到 ASC/DESC 常量"],
        ["列名", "不可以", "白名单映射到 clause.Column/固定字符串"],
        ["表名/分表名", "不可以", "服务端路由规则生成，不接受原始用户输入"],
        ["IN 列表值", "可以", "Where(\"id IN ?\", ids)"],
        ["完整筛选表达式", "不可以直接信任", "解析成受控查询 DSL 或固定筛选项"],
      ],
    },
    {
      type: "heading",
      text: "主键快捷查询也要先解析类型",
    },
    {
      type: "code",
      title: "HTTP 路径 ID 先转成整数",
      language: "go",
      code: `id64, err := strconv.ParseUint(rawID, 10, 64)
if err != nil {
    return ErrInvalidID
}
user, err := gorm.G[User](db).
    Where("id = ?", uint(id64)).
    First(ctx)`,
    },
    {
      type: "paragraph",
      text: "传统 API 的 First(&user, userInput) 对字符串主键条件有额外风险。即使当前驱动会拒绝多语句，也不应依赖驱动配置作为防线；在进入数据层前把标识符解析成 uint/UUID，并继续参数绑定。",
    },
    {
      type: "heading",
      text: "Raw 与 Expr 的安全用法",
    },
    {
      type: "code",
      title: "Raw 中继续绑定参数",
      language: "go",
      code: `stats, err := gorm.G[AuthorStat](db).
    Raw(
        "SELECT user_id, COUNT(*) AS post_count "+
            "FROM posts WHERE created_at >= ? GROUP BY user_id",
        since,
    ).
    Find(ctx)

// gorm.Expr 的 SQL 字符串也必须来自可信代码
rows, err := gorm.G[Post](db).
    Where("id = ?", id).
    Update(ctx, "views", gorm.Expr("views + ?", 1))`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "把恶意输入放进 Expr 仍然会注入",
      body: "gorm.Expr 只是一段 SQL 表达式容器，不会替你审查 SQL 字符串。SQL 模板必须来自代码，动态值放 Vars；同样，Raw/Exec 的 SQL 字符串不可由客户端直接提供。",
    },
    {
      type: "heading",
      text: "全局写保护与多租户条件",
    },
    {
      type: "paragraph",
      text: "GORM 默认阻止没有 WHERE 的批量 Update/Delete，并返回 ErrMissingWhereClause。不要为了让脚本跑通就全局开启 AllowGlobalUpdate。需要全量动作时，使用显式恒真条件、独立运维入口、权限校验和审计，让危险意图在代码中可见。",
    },
    {
      type: "code",
      title: "租户条件与条件写",
      language: "go",
      code: `rows, err := gorm.G[Post](db).
    Where("tenant_id = ?", tenantID).
    Where("id = ?", postID).
    Delete(ctx)
if err != nil {
    return err
}
if rows != 1 {
    return ErrPostNotFound
}`,
    },
    {
      type: "paragraph",
      text: "全局写保护只能防止完全没有条件，不能判断你漏了 tenant_id。多租户隔离应集中在仓储、经过安全审计的 Scope/插件，或数据库行级安全策略中，并写跨租户负面测试。",
    },
    {
      type: "heading",
      text: "日志与隐私",
    },
    {
      type: "list",
      items: [
        "生产 Logger 可启用 ParameterizedQueries，避免把参数值写入 SQL 日志。",
        "不要记录完整 DSN、访问令牌、密码、私密正文或加密前数据。",
        "慢查询日志需要 query shape、耗时、rows、trace ID，而不是所有敏感参数。",
        "GORM 日志展示的 SQL 不保证像实际参数绑定那样安全转义，只用于诊断。",
      ],
    },
    {
      type: "quiz",
      question: "客户端传 sort=created_at desc; drop table users，哪种处理正确？",
      options: [
        "把 sort 映射到预定义排序选项，未知值拒绝",
        "直接 db.Order(sort)",
        "用 ? 占位符代替列名和 DESC",
        "删除分号后直接拼接",
      ],
      answer: 0,
      explanation: "排序是 SQL 结构，不能用值占位符。必须映射到服务端可信表达式，字符串清洗不足以代替白名单。",
    },
    {
      type: "exercise",
      title: "审计一个动态搜索接口",
      description: "接口支持字段筛选、模糊查询、排序、分页和导出。逐项标记哪些是值、哪些是 SQL 结构，设计白名单映射，并加入最大 limit、租户条件、全局写保护和敏感日志策略。",
      hint: "从 Select、Where、Order、Table、Raw、Expr 和 Logger 逐个检查用户输入能否到达 SQL 字符串。",
    },
    {
      type: "keypoints",
      items: [
        "占位符只能绑定值，列名、表名、排序方向等结构必须白名单映射。",
        "Order、Select、Group、Table、Joins、Raw、Exec、Expr 都可能接收未转义 SQL 结构。",
        "外部 ID 先解析成明确类型，再作为参数绑定。",
        "ErrMissingWhereClause 只防无条件全局写，不能自动补多租户条件。",
        "Raw/Expr 的 SQL 模板必须来自可信代码，动态数据放参数。",
        "生产日志优先参数化并最小化敏感数据，诊断 SQL 不用于复制执行。",
      ],
    },
  ],
};
