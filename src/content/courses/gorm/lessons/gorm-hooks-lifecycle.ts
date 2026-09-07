/* ==================================================================
 * 课时：生命周期钩子：Before 与 After（gorm-hooks-lifecycle）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-hooks-lifecycle",
  "courseSlug": "gorm",
  "title": "生命周期钩子：Before 与 After",
  "summary": "在记录的增删改查前后注入逻辑，并让写入参与同一事务。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "很多时候，你希望在「保存一条记录之前」或「查出记录之后」自动做点什么——比如写密码前先哈希、创建时自动填一些默认字段、查出来后格式化时间或补全缓存。GORM 通过在模型结构体上定义钩子方法（Hook）来支持这一点：只要方法名符合约定，GORM 就会在对应的时机自动调用它。"
    },
    {
      "type": "heading",
      "text": "整套钩子是什么顺序"
    },
    {
      "type": "paragraph",
      "text": "GORM v2 为 Create / Update / Delete / Find 各定义了一套钩子。以 Create 为例，完整顺序是：`BeforeSave` → `BeforeCreate` → 真正写库 → `AfterCreate` → `AfterSave`。注意 `Save` 钩子对 Create 和 Update 都会触发，它相当于「保存」这一更宽泛的概念；`Create` / `Update` 专属钩子（如 `BeforeCreate`、`AfterUpdate`）则只在对应操作触发。"
    },
    {
      "type": "table",
      "caption": "GORM v2 主要钩子与触发时机",
      "headers": ["操作", "前置钩子", "后置钩子"],
      "rows": [
        ["Create", "BeforeSave → BeforeCreate", "AfterCreate → AfterSave"],
        ["Update", "BeforeSave → BeforeUpdate", "AfterUpdate → AfterSave"],
        ["Delete", "BeforeDelete", "AfterDelete"],
        ["Find（读取）", "—", "AfterFind"],
        ["单条查询后处理", "—", "AfterFind"]
      ]
    },
    {
      "type": "paragraph",
      "text": "需要区分的是 `Update` 钩子只有在「更新了字段」时才会触发；如果传进去的值没有变化，GORM 会跳过对应的 Update 钩子（返回 nil）。而 `BeforeFinding` 实际上不存在于 GORM 的钩子名里，读取类钩子主要就是 `AfterFind`——如果你需要自定义查询条件，正确途径是 Scopes 或 `Where` 条件，而不是钩子。"
    },
    {
      "type": "heading",
      "text": "钩子签名与「返回 error 中止」"
    },
    {
      "type": "paragraph",
      "text": "绝大多数钩子都是 `func (u *User) BeforeCreate(tx *gorm.DB) error` 这样的形式：方法接收者是指针，参数是事务句柄 `tx`。钩子返回 `error` 时，GORM 会中止当前操作：比如 `BeforeCreate` 返回错误，这条 Create 就不会执行；`AfterCreate` 返回错误会触发回滚。返回 nil 则继续。"
    },
    {
      "type": "code",
      "title": "持久化钩子方法的正确形状",
      "language": "go",
      "code": "// Create 前自动哈希密码\nfunc (u *User) BeforeCreate(tx *gorm.DB) error {\n    if u.Email == \"\" {\n        return errors.New(\"Email 不能为空\") // 中止这次创建\n    }\n    hashed, err := bcrypt.GenerateFromPassword([]byte(u.PasswordHash), bcrypt.DefaultCost)\n    if err != nil {\n        return err\n    }\n    u.PasswordHash = string(hashed)\n    return nil\n}\n\ndb.Create(&user) // 钩子会自动触发"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "钩子要修改字段，必须写在接收者（receiver）上",
      "body": "`BeforeCreate` 的 `u` 就是将要写入的那条记录本体。在钩子里通过 `u.PasswordHash = ...` 修改，写库时才会带上新值。如果只在方法参数或拷贝上改，对最终落库的数据没有任何影响。"
    },
    {
      "type": "heading",
      "text": "在钩子里用 tx 写入，参与同一事务"
    },
    {
      "type": "paragraph",
      "text": "钩子的参数 `tx *gorm.DB` 不只是摆设——它就是当前正在执行的操作所处的事务句柄。如果钩子需要联动写别的表（例如创建用户的同时记录一条审计日志），应该用 `tx.Create(...)`，这样关联写入会与主操作处于同一个事务里：主操作失败，审计随后也会一起回滚，不会留下孤儿数据。"
    },
    {
      "type": "code",
      "title": "用 tx 联动写入，保证原子性",
      "language": "go",
      "code": "func (u *User) AfterCreate(tx *gorm.DB) error {\n    // 记审计日志，与主创建同一事务\n    return tx.Create(&AuditLog{\n        Action: \"user.create\",\n        UserID: u.ID,\n    }).Error\n}"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "用 db 而不是 tx 写，绕开了事务边界",
      "body": "如果在钩子里用全局 `db` 去写（比如 `db.Create(&AuditLog{...})`），这条写入会走独立连接、独立事务，既不与主操作同生共死，也可能读不到主操作尚未提交的数据。统一用钩子的 `tx`，才能保持事务语义。"
    },
    {
      "type": "heading",
      "text": "AfterFind：查询结果的后处理"
    },
    {
      "type": "paragraph",
      "text": "`AfterFind` 在每次从数据库取出记录后触发，适合做纯展示层的后处理，如把时间按业务时区格式化、拼接完整图片 URL、把枚举数值翻译成可读文本。它也能用于按需延迟加载某些重量级字段。"
    },
    {
      "type": "code",
      "title": "AfterFind 后处理示例",
      "language": "go",
      "code": "func (u *User) AfterFind(tx *gorm.DB) error {\n    if u.Avatar != \"\" {\n        u.AvatarURL = cdnPrefix + u.Avatar // 拼上 CDN 域名\n    }\n    u.DisplayName = formatDisplayName(u.Name)\n    return nil\n}"
    },
    {
      "type": "heading",
      "text": "钩子里读写：正常操作即可，但注意触发点"
    },
    {
      "type": "paragraph",
      "text": "钩子内部想做查询或写操作都是允许的——只要用的是 `tx` 就行（如上节）。不过要时刻留意：一旦你在某个钩子内部又触发了「同一个」钩子，就可能进入无限递归。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "无限递归：在 AfterCreate 里再 Create 同一模型",
      "body": "假设你在 `func (u *User) AfterCreate(tx *gorm.DB) error` 内部又调用 `tx.Create(u)`——每次 Create 又会触发 AfterCreate，而触发后你又 Create……于是无限循环，最终程序会因递归过深而崩溃。若钩子确实需要再次保存该记录，要考虑用条件判断、`gorm.Model` 已有 ID 时直接 `Update`，或拆到另一个模型。"
    },
    {
      "type": "paragraph",
      "text": "另外要注意钩子与 `Save` 的区别：`Save` 会同时触发 Create 与 Update 的语义（根据主键是否存在判断），因此 `BeforeSave` / `AfterSave` 对新增和更新都会触发。如果你只想在「真正的新增」或「真正的更新」时做事，用带 `Create` / `Update` 字样的钩子。"
    },
    {
      "type": "code",
      "title": "区分 Save 与 Create / Update 钩子",
      "language": "go",
      "code": "func (u *User) BeforeSave(tx *gorm.DB) error {\n    // 新增和更新都会进来\n    return nil\n}\n\nfunc (u *User) BeforeCreate(tx *gorm.DB) error {\n    // 仅当真正创建记录时进来\n    u.Status = \"active\" // 设置默认状态\n    return nil\n}\n\nfunc (u *User) BeforeUpdate(tx *gorm.DB) error {\n    // 仅当真正更新记录时进来\n    return nil\n}"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "钩子的典型用途",
      "body": "写密码前哈希（BeforeCreate / BeforeUpdate）、创建时补默认值（BeforeCreate）、更新时间戳（Save/Update 钩子）、记录审计与历史（AfterCreate 用 tx 联动）、读出的字段格式化（AfterFind）。把这类横切逻辑收进模型，调用方代码就干净很多。"
    },
    {
      "type": "quiz",
      "question": "下面关于 GORM v2 钩子的说法，正确的是？",
      "options": [
        "钩子的签名必须是无参、无返回值的普通方法",
        "钩子返回 error 时，对应的操作会被中止或回滚",
        "AfterFind 在写入完成后触发",
        "钩子里只能读，不能写数据库"
      ],
      "answer": 1,
      "explanation": "钩子形如 func (u *User) BeforeCreate(tx *gorm.DB) error，返回 error 会中止当前操作或触发回滚；AfterFind 在读取后触发；钩子里可以用 tx 读写。"
    },
    {
      "type": "exercise",
      "title": "给支付记录加校验钩子",
      "description": "给 `Order` 模型加一个 `BeforeCreate` 钩子：Amount 必须大于 0，否则返回错误中止创建；再加一个 `AfterCreate` 钩子，用 tx 往一张 `PaymentLog` 表写入一条 `orderID` 对应该订单的记录。",
      "hint": "BeforeCreate 里校验 `o.Amount > 0`，不满足就 `return errors.New(...)`；AfterCreate 里 `return tx.Create(&PaymentLog{OrderID: o.ID}).Error`。"
    },
    {
      "type": "keypoints",
      "items": [
        "Create 全套顺序：BeforeSave → BeforeCreate → 写库 → AfterCreate → AfterSave",
        "钩子签名 func (u *T) Xxx(tx *gorm.DB) error，返回 error 中止操作",
        "钩子内改字段要改在接收者上",
        "钩子里用 tx 读写，参与同一事务",
        "Avoid infinite recursion：别在 AfterCreate 里再 Create 自己",
        "BeforeSave/AfterSave 属于创建和更新流程；删除只触发 BeforeDelete/AfterDelete"
      ]
    }
  ]
};
