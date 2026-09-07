import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-create",
  courseSlug: "gorm",
  title: "创建记录：Create、批量插入与默认值",
  summary: "把结构体写入数据库，处理主键回填、批量边界、默认值、关联与 Upsert。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Create 的核心语义是把一个 Go 值交给 GORM 生成 INSERT，并在数据库执行后把可回填的值写回调用方。学习这节时要把三个问题分开：哪些字段参与 INSERT，数据库默认值何时接管，以及一批数据如何被拆成可控的写入批次。",
    },
    {
      type: "heading",
      text: "传统 API：指针、错误与主键回填",
    },
    {
      type: "code",
      title: "创建一条记录",
      language: "go",
      code: "u := User{Name: \"小吾\", Email: \"wu@example.com\", Age: 28}\nresult := db.Create(&u)\nif result.Error != nil {\n    return result.Error\n}\nfmt.Println(result.RowsAffected) // 1\nfmt.Println(u.ID)                // 自增主键通常已回填",
    },
    {
      type: "paragraph",
      text: "传统 API 返回一个带 Error 和 RowsAffected 的 *gorm.DB。传指针不是装饰：GORM 需要把自增主键、CreatedAt 等结果写回调用方持有的对象。业务代码应在终结操作后立刻检查 Error；RowsAffected 则用于判断条件更新或删除是否真的命中了记录。",
    },
    {
      type: "callout",
      variant: "note",
      title: "主键回填依赖方言能力",
      body: "不同数据库通过 RETURNING、LAST_INSERT_ID 或驱动能力回填结果。自增主键是最常见的可回填值；如果业务依赖插入后回填非主键列，应在目标方言和驱动上验证，不要把所有数据库的行为想成完全相同。",
    },
    {
      type: "heading",
      text: "批量插入：显式控制批次",
    },
    {
      type: "code",
      title: "Create 与 CreateInBatches",
      language: "go",
      code: "users := []User{\n    {Name: \"甲\", Email: \"a@example.com\"},\n    {Name: \"乙\", Email: \"b@example.com\"},\n    {Name: \"丙\", Email: \"c@example.com\"},\n}\n\n// 小批量；主键会回填到切片元素\nif err := db.Create(&users).Error; err != nil {\n    return err\n}\n\n// 需要可预测的 SQL 大小、锁持有和失败边界时显式分批\nif err := db.CreateInBatches(&users, 500).Error; err != nil {\n    return err\n}\n\n// 也可以在 Config 或 Session 中统一设置 CreateBatchSize",
    },
    {
      type: "paragraph",
      text: "不要依赖某个固定的“自动分批行数”。批次大小会受到数据库参数上限、单行列数、网络包和关联写入影响。生产批处理应结合目标方言压测，并决定单批失败时是整批回滚、记录失败项后继续，还是交给上层重试。",
    },
    {
      type: "heading",
      text: "Create 的零值与 default 标签",
    },
    {
      type: "paragraph",
      text: "不要把 Updates(struct) 的零值规则套到 Create。对没有 default 标签的普通可创建字段，Create 通常会把结构体里的零值写入 INSERT。字段带 gorm:\"default:18\" 时，零值则具有默认值语义，GORM 会让数据库默认接管。",
    },
    {
      type: "code",
      title: "区分未提供与显式零值",
      language: "go",
      code: "type Profile struct {\n    ID       uint\n    Age      int \x60gorm:\"default:18\"\x60\n    IsAdmin  bool\n    Nickname *string // nil 表示未提供，指针指向空串表示显式空串\n}\n\n// Age=0 会触发 default 标签的默认值语义\n// 需要表达三态输入时，使用指针或 sql.Null* 类型",
    },
    {
      type: "callout",
      variant: "warning",
      title: "default 标签不是“把零写成零”",
      body: "值类型配合 default 标签无法同时表达未提供和显式零值。若业务必须把 0、false 或空串当作真实输入，请用指针、sql.Null* 或显式的 Select/字段权限策略，并为目标数据库写集成测试。",
    },
    {
      type: "heading",
      text: "Select、Omit 与字段权限",
    },
    {
      type: "paragraph",
      text: "Select 是写入白名单，Omit 是黑名单。它们用于限制可写列、跳过数据库生成列、控制关联写入；模型标签还可以用 <-:create、-> 等权限声明强化边界。对外部请求优先使用请求 DTO，再显式映射到模型，避免把客户端字段原样交给 Create。",
    },
    {
      type: "code",
      title: "限制写入范围",
      language: "go",
      code: "u := User{Name: \"小吾\", Age: 0}\n\n// 只允许这几列参与创建\ndb.Select(\"Name\", \"Age\").Create(&u)\n\n// 跳过数据库生成列或全部关联\ndb.Omit(\"Email\").Create(&u)\ndb.Omit(clause.Associations).Create(&u)",
    },
    {
      type: "heading",
      text: "冲突处理与关联写入",
    },
    {
      type: "code",
      title: "使用 OnConflict 做幂等插入",
      language: "go",
      code: "err := db.Clauses(clause.OnConflict{\n    DoNothing: true,\n}).Create(&language).Error\n\nerr = db.Clauses(clause.OnConflict{\n    Columns:   []clause.Column{{Name: \"code\"}},\n    DoUpdates: clause.AssignmentColumns([]string{\"name\", \"updated_at\"}),\n}).Create(&language).Error",
    },
    {
      type: "paragraph",
      text: "带有关联字段的模型在 Create 时可能自动保存关联并维护外键；这不是把整个对象图无条件全量同步。用 Select/Omit 控制关联范围，复杂写入放进显式事务，并在数据库约束和业务幂等键上做最后保证。",
    },
    {
      type: "heading",
      text: "泛型 API 对照",
    },
    {
      type: "code",
      title: "v1.30+ 的泛型 Create",
      language: "go",
      code: "ctx, cancel := context.WithTimeout(ctx, 2*time.Second)\ndefer cancel()\n\nu := User{Name: \"小吾\", Email: \"wu@example.com\"}\nif err := gorm.G[User](db).Create(ctx, &u); err != nil {\n    return err\n}\n\nusers := []User{{Name: \"甲\"}, {Name: \"乙\"}}\nif err := gorm.G[User](db).CreateInBatches(ctx, &users, 100); err != nil {\n    return err\n}",
    },
    {
      type: "callout",
      variant: "tip",
      title: "把错误语义统一到调用层",
      body: "新代码可优先使用泛型 API，让 context 直接进入终结方法、错误直接返回；维护旧代码时继续检查传统 API 的 result.Error。不要在同一个函数里忽略一套 API 的错误，再期待另一套 API 帮你补救。",
    },
    {
      type: "quiz",
      question: "关于传统 API 的 db.Create 与零值，下列说法正确的是？",
      options: [
        "没有 default 标签的普通可创建字段，零值通常会进入 INSERT",
        "Create 与 Updates(struct) 一样，默认跳过所有零值",
        "只要加 default 标签，0 就一定会作为数值 0 写入",
        "传值而不是指针也能把主键回填到调用方变量",
      ],
      answer: 0,
      explanation: "普通 Create 与 Updates(struct) 的零值规则不同；default 标签会改变零值语义，传指针才有可回填的对象地址。",
    },
    {
      type: "exercise",
      title: "设计一个可重试的批量导入",
      description: "为 10 万条 Post 设计导入流程：选择批次大小，说明单批失败时的回滚边界，处理唯一键冲突，并决定是否使用 OnConflict。最后写出传统 API 与泛型 API 各自的错误检查方式。",
      hint: "不要先抄一个固定 batch size。先列出数据库参数上限、单批事务时间、幂等键和重试条件，再选择可验证的批次。",
    },
    {
      type: "keypoints",
      items: [
        "传统 Create 通过 *gorm.DB.Error/RowsAffected 返回执行结果；指针用于回填主键和自动字段。",
        "Create 的零值规则不能套用 Updates(struct)：普通字段通常写入零值，default 标签会改变语义。",
        "大批量写入使用 CreateInBatches 或 CreateBatchSize，批次大小要按目标方言和指标验证。",
        "Select/Omit 与字段权限共同决定可写列；外部输入优先经过 DTO 映射。",
        "OnConflict 是数据库级幂等工具，不能替代业务幂等键和事务设计。",
        "GORM v1.30+ 可用泛型 API 直接返回错误，并把 context 传给终结操作。",
      ],
    },
  ],
};
