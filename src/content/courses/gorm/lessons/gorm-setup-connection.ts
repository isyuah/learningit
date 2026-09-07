/* ==================================================================
 * 课时：安装与建立连接（gorm-setup-connection）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-setup-connection",
  courseSlug: "gorm",
  title: "安装、连接与启动验证",
  summary: "引入 GORM、配置 MySQL/SQLite、理解自动 Ping，并建立可运维的启动检查。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节我们建立了心智模型：GORM 是一层在 Go 结构体与数据库表之间做翻译的转换层。这一节把翻译层的「基础电路」接通——安装依赖、打开连接，并回答一个新手几乎都会踩的坑：为什么 `gorm.Open` 成功了，程序却可能根本没连上数据库。",
    },
    {
      type: "heading",
      text: "安装：两个包，一个都不能少",
    },
    {
      type: "paragraph",
      text: "GORM v2 采用「核心 + 驱动」的拆分设计。核心包 `gorm.io/gorm` 负责翻译与查询构建，而具体连什么数据库由对应的驱动包决定。SQLite 和 MySQL 各需要引入一个驱动。",
    },
    {
      type: "code",
      title: "安装核心与驱动",
      language: "bash",
      code: "# 核心库\n$ go get gorm.io/gorm\n\n# 选择一个（或都装)你需要的驱动\n$ go get gorm.io/driver/sqlite\n$ go get gorm.io/driver/mysql\n",
    },
    {
      type: "paragraph",
      text: "把驱动想成「方言适配器」：它负责把 GORM 生成的通用 SQL，转换成 MySQL / PostgreSQL / SQLite 各自能听懂的方言。所以换数据库时，核心代码不用改，只要换驱动和连接参数。",
    },
    {
      type: "callout",
      variant: "note",
      title: "关于版本的一点说明",
      body: "课程以现代 GORM v2 为前提，并把 `gorm.io/gorm` v1.30.0 作为泛型 API 的最低版本。本轮示例按 v1.31.2 的公开接口核对。真实项目应在 go.mod 中固定并审查具体版本，不要把“v2”误解成模块主版本号 v2。",
    },
    {
      type: "heading",
      text: "gorm.Open 的签名",
    },
    {
      type: "paragraph",
      text: "建立连接的入口只有一个函数 `gorm.Open`。它接收两个参数，返回 `*gorm.DB` 和 `error`。",
    },
    {
      type: "definition",
      term: "dialector（方言器）",
      definition: "第一个参数，由驱动包提供，例如 `sqlite.Open(dsn)` 或 `mysql.Open(dsn)`。它告诉 GORM 连的是什么数据库、用什么连接串。",
    },
    {
      type: "definition",
      term: "gorm.Config（配置）",
      definition: "第二个参数，可选但常用。它承载一批影响 GORM 行为的选项，如日志、是否跳过默认事务等。传 nil 就使用默认配置。",
    },
    {
      type: "paragraph",
      text: "返回值 `db` 是 GORM 的根数据库句柄：它持有方言、配置和底层连接池，而不是独占一条物理连接。应用通常长期复用根句柄，并在每次请求或事务中派生一次操作所需的 Statement。",
    },
    {
      type: "code",
      title: "打开 SQLite 连接",
      language: "go",
      code: `import (
    "gorm.io/gorm"
    "gorm.io/driver/sqlite"
)

var db *gorm.DB

func initDB() error {
    var err error
    // 对 SQLite，dsn 就是数据库文件的路径；":memory:" 表示纯内存库
    db, err = gorm.Open(sqlite.Open("blog.db"), &gorm.Config{})
    if err != nil {
        return err
    }
    return nil
}`,
    },
    {
      type: "heading",
      text: "打开 MySQL 连接",
    },
    {
      type: "paragraph",
      text: "MySQL 的 dsn 是一串形如 `user:pass@tcp(host:port)/dbname?参数` 的连接字符串。它遵循 Go 标准库 database/sql 的驱动格式。",
    },
    {
      type: "code",
      title: "打开 MySQL 连接",
      language: "go",
      code: `import (
    "gorm.io/gorm"
    "gorm.io/driver/mysql"
)

func initMySQL() error {
    dsn := "blog_user:blog_pass@tcp(127.0.0.1:3306)/blog?charset=utf8mb4&parseTime=True&loc=Local"
    var err error
    db, err = gorm.Open(mysql.Open(dsn), &gorm.Config{})
    if err != nil {
        return err
    }
    return nil
}`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把凭据写进源码",
      body: "示例把 DSN 写成字面量只是为了展示格式。真实应用应从受控配置或密钥系统读取，并确保错误与日志不会输出完整 DSN。使用 `gorm.io/driver/mysql` 的默认驱动时无需再手写 blank import；只有切换自定义 DriverName 时才按该驱动的要求注册。",
    },
    {
      type: "heading",
      text: "复用已有连接池（推荐做法）",
    },
    {
      type: "paragraph",
      text: "如果应用已经拥有 `*sql.DB`，可以把它交给 GORM；也可以先用 `gorm.Open`，再通过 `db.DB()` 取得底层池并调参。二者都是官方支持的入口。连接数没有通用模板，应结合数据库容量、实例数、请求并发和 `sql.DB.Stats()` 指标设定。",
    },
    {
      type: "code",
      title: "先配置连接池，再交给 GORM",
      language: "go",
      code: `import (
    "database/sql"
    "gorm.io/gorm"
    "gorm.io/driver/mysql"
)

func initWithPool() error {
    // 1. 先用标准库打开底层的 *sql.DB
    sqlDB, err := sql.Open("mysql", "blog_user:blog_pass@tcp(127.0.0.1:3306)/blog")
    if err != nil {
        return err
    }

    // 2. 示例值只表达 API；生产值必须按容量和指标计算
    sqlDB.SetMaxOpenConns(20)
    sqlDB.SetMaxIdleConns(5)
    sqlDB.SetConnMaxLifetime(30 * time.Minute)

    // 3. 把已配置好的 *sql.DB 交给 GORM
    db, err = gorm.Open(mysql.New(mysql.Config{Conn: sqlDB}), &gorm.Config{})
    return err
}`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "连接池属于进程级资源",
      body: "不要为每个请求调用一次 `gorm.Open`。根句柄与底层池应按应用生命周期创建、复用并在停机时关闭。每个请求只传 context 或派生查询；事务会从池中占用连接直到提交或回滚。",
    },
    {
      type: "heading",
      text: "gorm.Config 里的常用选项",
    },
    {
      type: "table",
      caption: "常见 gorm.Config 选项（其后章节会深入）",
      headers: ["选项", "作用", "说明"],
      rows: [
        ["Logger", "日志器", "控制 SQL 是否打印、打印到哪、慢查询阈值等"],
        ["SkipDefaultTransaction", "跳过默认事务", "是否让单条的 Create/Update/Delete 也包一层事务"],
        ["NamingStrategy", "命名策略", "自定义表名、列名的命名规则"],
      ],
    },
    {
      type: "paragraph",
      text: "这里只做初步认识。`SkipDefaultTransaction` 会改变写入的原子边界，不能只因为追求吞吐就全局关闭；`PrepareStmt` 会引入语句缓存及其资源管理成本。事务、Session 与性能章节会给出完整决策条件。",
    },
    {
      type: "heading",
      text: "验证连接真正可用",
    },
    {
      type: "paragraph",
      text: "`database/sql.Open` 本身通常延迟建立物理连接，但 GORM 默认会在初始化完成后调用底层 `Ping()`。因此在默认配置下，`gorm.Open` 返回 nil error 已经包含一次连通性验证；只有显式设置 `DisableAutomaticPing: true`，或后续网络状态发生变化时，才不能把启动成功当作当前可用性的持续保证。",
    },
    {
      type: "code",
      title: "真正测试连接是否可用",
      language: "go",
      code: `// 方式一：走 GORM 的一次真正查询
var n int
if err := db.Raw("SELECT 1").Scan(&n).Error; err != nil {
    log.Fatalf("connectivity failed: %v", err)
}

// 方式二：取回底层 *sql.DB 直接 Ping
sqlDB, err := db.DB()
if err != nil {
    log.Fatal(err)
}
defer sqlDB.Close()
if err := sqlDB.Ping(); err != nil {
    log.Fatalf("ping failed: %v", err)
}`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "启动 Ping 与持续健康不是一回事",
      body: "默认自动 Ping 只能证明启动时可连接，不能保证数据库之后一直健康。若你关闭自动 Ping，应在启动流程显式 Ping；运行期健康检查则应设置短超时并谨慎设计，避免数据库短暂抖动触发整个服务反复重启。AutoMigrate 还会修改 schema，不应被当作普通连通性探针。",
    },
    {
      type: "quiz",
      question: "下面哪种方式能最可靠地确认 GORM 已经真正连上了数据库？",
      options: [
        "默认配置下 gorm.Open 返回 nil；若关闭自动 Ping，则显式 sqlDB.PingContext 成功",
        "只要进程启动过一次，之后都不需要再处理数据库错误",
        "驱动包成功 import 且能编译通过",
        "定义好了 User 结构体",
      ],
      answer: 0,
      explanation: "GORM 默认在初始化后自动 Ping，所以 gorm.Open 的 nil error 包含启动时连通性验证；关闭 DisableAutomaticPing 后则必须显式 Ping。无论哪种方式，运行期仍要处理断连、超时等每次操作可能返回的错误。",
    },
    {
      type: "keypoints",
      items: [
        "GORM v2 是「核心 + 驱动」双包结构，驱动负责方言转换。",
        "gorm.Open(dialector, gorm.Config) 是唯一的连接入口。",
        "*gorm.DB 是长期复用的根句柄，底层连接由 database/sql 池化管理。",
        "既可把已有 *sql.DB 交给 GORM，也可通过 db.DB() 取得并配置底层池。",
        "GORM 默认自动 Ping；关闭自动 Ping 后，启动流程必须自己验证连通性。",
        "连接池参数来自容量与指标，不应复制固定的 MaxOpenConns 模板。",
      ],
    },
  ],
};
