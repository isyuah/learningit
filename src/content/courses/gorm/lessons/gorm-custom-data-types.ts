import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-custom-data-types",
  courseSlug: "gorm",
  title: "自定义类型、Scanner/Valuer 与 Serializer",
  summary: "让 JSON、UUID、可空值、加密值和领域值对象正确跨越 Go 与数据库边界。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "真实模型不会永远只有 string、int 和 time.Time。JSON 配置、UUID、金额、地理位置、可空值和加密字段都需要明确的转换规则。GORM 不应该猜这些类型的含义；你要分别告诉 database/sql 如何读写值、告诉 Migrator 应建什么列，并说明序列化失败如何进入错误流。",
    },
    {
      type: "heading",
      text: "先分清三层职责",
    },
    {
      type: "table",
      caption: "自定义类型的三层契约",
      headers: ["层", "接口/机制", "负责什么"],
      rows: [
        ["database/sql", "sql.Scanner + driver.Valuer", "数据库驱动值与 Go 值互转"],
        ["GORM schema", "GormDataType / GormDBDataType", "通用类型语义与方言列类型"],
        ["GORM 写表达式", "GormValuerInterface", "按 context/方言生成 clause.Expr"],
        ["字段序列化", "serializer 标签或 SerializerInterface", "JSON、gob、unixtime 等编码"],
      ],
    },
    {
      type: "heading",
      text: "Scanner 与 Valuer：最稳定的底层边界",
    },
    {
      type: "code",
      title: "JSON 值对象",
      language: "go",
      code: `type JSON map[string]any

func (j *JSON) Scan(value any) error {
    if value == nil {
        *j = nil
        return nil
    }
    b, ok := value.([]byte)
    if !ok {
        return fmt.Errorf("scan JSON: expected []byte, got %T", value)
    }
    var decoded map[string]any
    if err := json.Unmarshal(b, &decoded); err != nil {
        return fmt.Errorf("scan JSON: %w", err)
    }
    *j = decoded
    return nil
}

func (j JSON) Value() (driver.Value, error) {
    if j == nil {
        return nil, nil
    }
    b, err := json.Marshal(j)
    if err != nil {
        return nil, fmt.Errorf("encode JSON: %w", err)
    }
    return b, nil
}`,
    },
    {
      type: "paragraph",
      text: "Scanner 必须处理驱动真正返回的类型和 NULL，Valuer 必须返回 driver.Value 支持的类型。不要吞掉反序列化错误或把坏数据静默替换为空对象，否则数据库腐坏会变成很难诊断的业务零值。",
    },
    {
      type: "heading",
      text: "告诉 Migrator 各方言的列类型",
    },
    {
      type: "code",
      title: "通用类型与方言类型",
      language: "go",
      code: `func (JSON) GormDataType() string {
    return "json"
}

func (JSON) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
    switch db.Dialector.Name() {
    case "postgres":
        return "JSONB"
    case "mysql", "sqlite":
        return "JSON"
    default:
        return ""
    }
}

type User struct {
    ID       uint
    Settings JSON
}`,
    },
    {
      type: "paragraph",
      text: "GormDataType 提供插件和 Hook 可识别的通用语义；GormDBDataType 用于迁移时选择方言列类型。返回类型正确仍不代表查询能力相同：JSON 路径、索引和比较运算符随数据库而异，复杂条件应使用方言感知的 Clause 或 datatypes helper。",
    },
    {
      type: "heading",
      text: "GormValuer：按 context 构造写表达式",
    },
    {
      type: "code",
      title: "地理位置写成数据库函数",
      language: "go",
      code: `type Location struct {
    X int
    Y int
}

func (Location) GormDataType() string { return "geometry" }

func (loc Location) GormValue(ctx context.Context, db *gorm.DB) clause.Expr {
    return clause.Expr{
        SQL:  "ST_PointFromText(?)",
        Vars: []any{fmt.Sprintf("POINT(%d %d)", loc.X, loc.Y)},
    }
}`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "context 值不是密钥仓库",
      body: "GormValuer 可以读取 tx.Statement.Context，但不要把长期加密主密钥明文塞进 context 或日志。context 适合携带请求范围的租户或密钥引用；真正密钥由受控密钥服务解析，并确保错误信息不泄露明文。",
    },
    {
      type: "heading",
      text: "Serializer：结构字段的便捷编码",
    },
    {
      type: "paragraph",
      text: "GORM 内置 json、gob、unixtime serializer，也允许注册自定义 SerializerInterface。把 []string、map 或结构体字段标记为 serializer:json 后，GORM 会在写入时编码、读取时解码。Serializer 适合把一个字段编码进单列，但不会让 JSON 内部字段自动获得关系约束和高效索引。",
    },
    {
      type: "code",
      title: "Serializer 的使用意图",
      language: "go",
      code: `type Profile struct {
    Roles        []string
    Preferences  map[string]any
    CreatedUnix int64
}

// 在模型字段上声明：
// Roles: serializer:json
// Preferences: serializer:json
// CreatedUnix: serializer:unixtime;type:time`,
    },
    {
      type: "heading",
      text: "可空、零值与领域值不是一回事",
    },
    {
      type: "table",
      caption: "如何表达缺失和值",
      headers: ["Go 表达", "能区分什么", "代价"],
      rows: [
        ["string/int/bool", "只有零值与非零值", "无法区分 NULL/未提供/显式零"],
        ["*T", "nil 与具体值", "需要指针处理，JSON API 也会反映差异"],
        ["sql.Null*", "值 + Valid", "类型较冗长但与 database/sql 对齐"],
        ["自定义值对象", "可编码业务不变量与格式", "必须实现转换、测试和迁移策略"],
      ],
    },
    {
      type: "paragraph",
      text: "选择类型时先确定领域状态。如果“没有生日”和“生日是零时间”不同，就不能用一个 time.Time 零值含糊处理。类型一旦进入模型、JSON API 和 schema，迁移成本会变高，因此应在边界处尽早明确。",
    },
    {
      type: "heading",
      text: "自定义类型要测试什么",
    },
    {
      type: "list",
      items: [
        "NULL、空值、正常值和损坏数据库值的 Scan 行为。",
        "Value 序列化失败是否返回带上下文但不泄密的错误。",
        "AutoMigrate 在每个支持方言上生成的真实列类型。",
        "Create、Update、查询条件和 Raw Scan 的往返结果。",
        "JSON/数组/地理类型的索引与查询是否使用目标方言正确语法。",
      ],
    },
    {
      type: "quiz",
      question: "一个 Settings JSON 字段需要在 PostgreSQL 迁移为 JSONB，并能正常 Scan/Value。最完整的组合是什么？",
      options: [
        "Scanner/Valuer 负责值转换，GormDBDataType 负责 PostgreSQL 列类型",
        "只实现 String()",
        "只加 type:jsonb 标签，忽略读写转换",
        "在每个查询后手工 json.Unmarshal，写入时直接 fmt.Sprintf",
      ],
      answer: 0,
      explanation: "值转换属于 database/sql 接口，方言列类型属于 GORM schema 接口；两者职责不同且都需要。",
    },
    {
      type: "exercise",
      title: "设计一个 Money 值对象",
      description: "实现 Money{Currency, MinorUnits} 的持久化方案。比较单列 JSON、两个普通列和数据库复合类型，说明精度、查询、索引、约束与跨方言代价，并选择一种用于博客付费订阅。",
      hint: "金额不要用 float。先确定是否需要按币种/金额查询和聚合，再决定是一个自定义字段还是拆成列。",
    },
    {
      type: "keypoints",
      items: [
        "Scanner/Valuer 负责驱动值与 Go 值互转，必须处理 NULL 和损坏数据。",
        "GormDataType/GormDBDataType 负责通用语义和方言迁移类型。",
        "GormValuer 可产生上下文相关 SQL 表达式，但 context 不是长期密钥存储。",
        "Serializer 适合单列编码，不会自动提供关系约束和高效查询。",
        "指针、sql.Null* 与值对象用于表达不同的缺失或零值语义。",
        "自定义类型必须在真实方言上验证迁移、往返、查询和索引。",
      ],
    },
  ],
};
