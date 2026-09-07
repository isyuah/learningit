/* ==================================================================
 * 课时：性能优化与避免 N+1（gorm-performance）
 * ----------------------------------------------------------------
 * slug 与 course.ts 大纲一致；内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-performance",
  courseSlug: "gorm",
  title: "性能优化与避免 N+1",
  summary: "定位查询变慢的根源：索引、列裁剪、批量操作与 N+1，以及如何用 DryRun 观察生成的 SQL。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "功能写对了，不代表就能上线。真实后端里，一条慢查询可能拖垮整个接口，而大多数慢查询的根源就那么几类：缺索引导致全表扫描、把不需要的列全查回来、逐行执行 INSERT 或 SELECT、以及「1 + N」的查询风暴。这一课我们逐个拆解，并给出可对照的 before/after 写法。",
    },
    {
      type: "heading",
      text: "先定位，再优化",
    },
    {
      type: "paragraph",
      text: "优化的第一原则永远是「先测量，再动手」。在没有数据支撑的情况下凭空猜哪里慢，常常改错地方——你优化了一个根本没被命中的查询，真正的浪费还在那里。GORM 提供两个非常实用的能力来观察请求实际生成的 SQL：",
    },
    {
      type: "list",
      items: [
        "db.Debug()：在链式调用前加上它，会把本次执行生成的 SQL 与参数打印出来，适合开发时临时观察。",
        "db.Session(&gorm.Session{DryRun: true})：DryRun 模式只生成 SQL 但不真正执行，配合不带最终执行方法的链式调用，可以在不碰数据库的情况下看到会执行什么查询。",
      ],
    },
    {
      type: "code",
      title: "用 DryRun 观察一条查询会生成什么 SQL",
      language: "go",
      code: "// DryRun：只生成 SQL，不执行，不读库\nstmt := db.Session(&gorm.Session{DryRun: true}).\n    Model(&Order{}).\n    Where(\"user_id = ?\", 42).\n    Order(\"id DESC\").\n    Limit(10).\n    Find(&[]Order{})\n\n// 生成的 SQL 与参数可以从 stmt.Statement 里看到\nfmt.Println(stmt.Statement.SQL.String())\nfmt.Println(stmt.Statement.Vars)",
    },
    {
      type: "callout",
      variant: "tip",
      title: "优化的最小闭环",
      body: "写一个慢查询修复时的做法：先 Debug/DryRun 看 SQL，再 EXPLAIN 确认执行计划是否走索引，改完后用真实数据量重新计时对比。没有前后对比的「优化」，只能算猜测。",
    },
    {
      type: "heading",
      text: "缺索引：全表扫描的最大元凶",
    },
    {
      type: "paragraph",
      text: "当 WHERE、ORDER BY、JOIN 的字段上没有索引时，数据库只能把整张表读一遍逐行匹配。对几百万行的表，这可能是毫秒级与秒级的差别。索引可以用 GORM 的模型标签声明，由 AutoMigrate 负责创建。",
    },
    {
      type: "code",
      title: "用标签声明单一索引与复合索引",
      language: "go",
      code: "type Order struct {\n    ID    uint\n    UserID uint `gorm:\"index\"`            // 普通单列索引\n    Status string `gorm:\"index\"`          // 普通单列索引\n    Amount int64\n}\n\n// 复合索引：按 (user_id, status) 顺序建索引，并显式指定 name/priority\ntype OrderV2 struct {\n    ID     uint\n    UserID uint   `gorm:\"index:idx_user_status,priority:1\"`\n    Status string `gorm:\"index:idx_user_status,priority:2\"`\n    Amount int64  `gorm:\"index\"`\n}\n\n// 唯一索引（Email 在共享模型 User 上）\ntype User struct {\n    ID    uint\n    Email string `gorm:\"uniqueIndex\"`\n}",
    },
    {
      type: "definition",
      term: "复合索引 priority",
      definition: "当多个字段共用同一个索引名时，priority 决定它们在索引中的先后顺序。索引最左前缀原则决定了查询必须从最左侧字段开始才能用上这个索引，所以（user_id, status）与（status, user_id）适用的查询并不相同。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "索引有写成本",
      body: "索引不是越多越好。每次 INSERT / UPDATE / DELETE 都要同步维护索引，占磁盘也占内存。正确姿势是根据真实查询模式按需建索引，而不是把每个字段都加上 index。永远「先测量」。",
    },
    {
      type: "heading",
      text: "别把不需要的列全部查回来",
    },
    {
      type: "paragraph",
      text: "用结构体接收查询结果时，GORM 默认会 SELECT 该结构体的所有字段。如果你的列表接口只展示标题和创建时间，却把整行文本（Body）也读回内存，既浪费网络带宽又浪费内存。用 Select 显式裁剪列，是成本最低、收益最直接的一类优化。",
    },
    {
      type: "code",
      title: "用 Select 限制返回列",
      language: "go",
      code: "// 只需要标题和创建时间，别把整个 Body 拖回来\ntype PostSummary struct {\n    Title     string\n    CreatedAt time.Time\n}\n\nvar summaries []PostSummary\nif err := db.Model(&Post{}).\n    Select(\"title\", \"created_at\").\n    Limit(100).\n    Find(&summaries).Error; err != nil {\n    // 处理错误\n}",
    },
    {
      type: "heading",
      text: "批量操作：别一条一条来",
    },
    {
      type: "paragraph",
      text: "逐行 INSERT 是最常见的性能坑之一：每条记录都意味着一个独立的网络往返与一次提交。把数据聚合成一个切片一次插入，通常能带来数量级的提升。GORM 的 Create 传入结构体切片时会自动生成一条多值 INSERT。",
    },
    {
      type: "code",
      title: "批量插入 + 批量分割处理",
      language: "go",
      code: "// 一次性插入一整批记录\norders := make([]Order, 0, 5000)\n// ...往 orders 里填充 5000 条订单...\n\nif err := db.Create(&orders).Error; err != nil {\n    // 处理错误\n}\n\n// 读取时：逐条处理会触发大量小查询，\n// 用 FindInBatches 按块扫描并回调处理\ndb.Model(&Post{}).\n    FindInBatches(&posts, 500, func(tx *gorm.DB, batch int) error {\n        // 每 500 条回调一次，tx 是当前批次的作用域\n        for _, p := range posts {\n            summarize(p) // 在这里处理当前批次\n        }\n        return nil\n    })",
    },
    {
      type: "definition",
      term: "FindInBatches",
      definition: "把查询结果分批取出并逐批回调处理，避免一次性把百万条记录全部加载进内存。每批用一个回调闭包处理，非常适合批量导出、数据迁移、列表对账等场景。",
    },
    {
      type: "heading",
      text: "UPSERT：存在则更新，否则插入",
    },
    {
      type: "paragraph",
      text: "面对「有重复就覆盖、没有才新建」的业务，最差的做法是先查询一遍再决定 INSERT 还是 UPDATE——两个请求 + 一个竞态窗口。GORM 支持通过 clause.OnConflict 把这条逻辑下推到数据库，一条语句完成。",
    },
    {
      type: "code",
      title: "用 OnConflict 实现 upsert",
      language: "go",
      code: "import (\n    \"gorm.io/gorm\"\n    \"gorm.io/gorm/clause\"\n)\n\n// Email 唯一；若冲突，则整行覆盖更新\ndb.Clauses(clause.OnConflict{\n    UpdateAll: true,\n}).Create(&users)\n\n// 或只更新指定列\ndb.Clauses(clause.OnConflict{\n    Columns:   []clause.Column{{Name: \"email\"}},\n    DoUpdates: clause.AssignmentColumns([]string{\"name\", \"age\"}),\n}).Create(&users)",
    },
    {
      type: "heading",
      text: "避免 N+1：预加载回顾",
    },
    {
      type: "paragraph",
      text: "N+1 是联表场景最经典的性能问题：先查一次拿到 N 条用户，再为每个用户各查一次它的帖子，累计发出 1 + N 条 SQL。GORM 用 Preload 在一条逻辑内一次性把关联数据查回来，把 N 次查询压到固定次数。",
    },
    {
      type: "code",
      title: "Preload 消除 N+1（before/after）",
      language: "go",
      code: "var users []User\n\n// 低效：先查 users，再对每个 user 查一次 posts（1+N 条 SQL）\n// for 循环里手动 db.Where(\"user_id = ?\", u.ID).Find(&posts)\n\n// 高效：一条 FIND + 关联数据按 user_id IN(...) 批量查出，共 2~3 条 SQL\ndb.Preload(\"Posts\").Find(&users)",
    },
    {
      type: "table",
      caption: "常见慢查询与对策速查",
      headers: ["症状", "常见原因", "GORM 对策"],
      rows: [
        ["按某列过滤很慢", "该列没有索引", "加 index / uniqueIndex 标签"],
        ["多条件组合查询慢", "缺少复合索引", "用同索引名 + priority 建复合索引"],
        ["内存/网络占用高", "把整行都查了回来", "Select 只取需要的列"],
        ["插入大批量数据慢", "逐条 Create", "Create(切片) 一次批量插入"],
        ["处理后端大数据集 OOM", "一次全量加载", "FindInBatches 分批处理"],
        ["关联数据出现 1+N", "循环内逐条查询", "Preload / Joins 预加载"],
      ],
    },
    {
      type: "quiz",
      question: "关于 FindInBatches，下列说法正确的是？",
      options: [
        "FindInBatches 一定比一次性 Find 更快，因为它会自动加索引",
        "FindInBatches 把结果分批取出并逐批回调处理，适合处理无法一次性装入内存的大数据集",
        "FindInBatches 只能用于 INSERT，不能用于查询",
        "FindInBatches 会自动提交事务，因此必须放在事务外使用",
      ],
      answer: 1,
      explanation: "FindInBatches 的分批是「分批取出、逐批处理」，主要解决大数据集的一次性内存占用问题，而非自动建索引或处理写入；它常与批量数据处理搭配，但本身不负责提交事务。",
    },
    {
      type: "exercise",
      title: "对一个慢查询做最小修复",
      description:
        "假设 Post 表有数十万行，接口需要按 user_id 过滤并只返回 title、created_at 两个字段，且要有分页。给出：(1) 结构体上的索引标签；(2) 结合 Select 与 Limit/Offset 的查询写法；(3) 说明你为什么加索引、为什么裁剪列。",
      hint: "想象一个高频的“用户列表页”：先想清楚这个查询的 WHERE 从哪个字段开始，再决定复合索引的 priority 顺序，最后用 Select 只带显示的列。",
    },
    {
      type: "keypoints",
      items: [
        "优化必须先测量：用 Debug / DryRun 看真实 SQL，用 EXPLAIN 看执行计划",
        "索引加速读但拖慢写，按真实查询模式按需建立，复合索引注意最左前缀",
        "Select 只取需要的列；Create(切片) 批量插入；FindInBatches 分批处理大结果集",
        "upsert 用 clause.OnConflict 下推到数据库，避免先查再写的两段式",
        "N+1 用 Preload 预加载消除，把 N 次查询压到固定次数",
      ],
    },
  ],
};
