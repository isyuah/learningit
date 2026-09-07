/* ==================================================================
 * 课时：密码、TOTP、恢复码与 Passkey（nyauth-password-mfa-passkey）
 * ----------------------------------------------------------------
 * slug 必须与 course.ts 大纲一致。块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-password-mfa-passkey",
  "courseSlug": "nyauth-backend",
  "title": "密码、TOTP、恢复码与 Passkey",
  "summary": "每种认证凭据如何存储与验证、各防御什么，以及「绝不能让自己无法登录」的不变量与 break-glass 重置。",
  "minutes": 26,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "「身份认证」这一环由具体的凭据实现。这一课逐个拆解 Nyauth 的四类凭据：口令（密码）、TOTP 动态码、恢复码、Passkey/WebAuthn。重点不是「用什么算法」这一句话，而是：每个凭据***怎么存***、***怎么验***、***防住了什么***、以及***失败行为***。面试最常在这层连问，因为它同时覆盖密码存储、MFA、WebAuthn 和并发一致性。"
    },
    {
      "type": "heading",
      "text": "密码：慢哈希与不可枚举",
    },
    {
      "type": "paragraph",
      "text": "密码绝不能明文或普通 SHA-256 存储。Nyauth 用 Argon2id 慢哈希：`HashPassword` 生成 16 字节随机盐并设 m=65536/64MiB、t=1、p=4，输出 `$argon2id$...` 编码串；验证时解析参数、用同一盐重算并做恒定时间比较。选择慢哈希（而非 SHA-256）的原因是：一旦哈希库泄露，攻击者只能离线暴力破解，慢哈希大幅拉高了每次猜测的成本。Argon2id 进程级限并发（默认 4 个槽，可配置），避免大量验证请求把 CPU 打满。"
    },
    {
      "type": "list",
      "items": [
        "明文存储：数据库被拖走 = 密码全泄露，绝不接受。",
        "普通 SHA-256/MD5：即使加盐也极快，GPU 可秒级遍历，不适合密码。",
        "Argon2id：慢、内存硬（memory-hard），把单次暴力破解成本抬到足够高。",
        "恒定时间比较：避免按前缀逐位比较造成时序侧信道。",
        "统一错误信息：登录失败一律返回「凭据无效」，不区分「用户不存在 / 密码错误」，防止枚举用户名存在性。"
      ]
    },
    {
      "type": "code",
      "title": "Argon2id 哈希形态",
      "language": "text",
      "code": "$argon2id$v=19$m=65536,t=1,p=4$<base64salt>$<base64hash>\n\n# 语义：argon2id 版本19，内存 65536 KiB，迭代 1，并行 4\n# 盐随机，结果含盐，可自解析后重算比对"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "只在“低熵密码”上用一个结果：客户端密钥另当别论",
      "body": "服务端生成的高熵 Client Secret（256-bit 随机）不能当密码处理——它不需要慢哈希。Nyauth 对这类值用 `HashClientSecret`（SHA-256）一次性摘要即可，因为它的熵足够高、不怕快速暴力。慢哈希是为用户可记忆的低熵密码准备的。用错方向才是问题：把用户密码存成 SHA-256 是漏洞，把高熵 secret 硬套慢哈希只会拖慢系统且无安全收益。"
    },
    {
      "type": "paragraph",
      "text": "改密码不是「replace 一个字段」那么简单：`ChangePassword`/`SetPassword` 之后，Nyauth 会提升 `auth_version`（`revokeUserSecurityState`），让所有持有旧 `auth_version` 的会话/令牌立即失效，并做会话轮换。这样「密码被改」这个安全事件就传播到了每个已签发的凭据——攻击者即便之前拿到过旧会话，也无法再借它进入。"
    },
    {
      "type": "heading",
      "text": "TOTP：共享密钥 + 时间步验证",
    },
    {
      "type": "paragraph",
      "text": "TOTP 是「共享密钥 + 当前时间步」计算出的短验证码，遵循 RFC 6238：SHA-1、30 秒一步、6 位数字。Nyauth 的 `totp.go` 用 20 字节随机基密钥，`matchTOTP` 在 ±1 窗口（当前步及前后各 1 步）内匹配，以容忍时钟漂移；`VerifyTOTP` 会比对 `last_used_step`，拒绝同一时间步被重复使用。这是 TOTP 最容易被忽略的两个要求：**既要有时间漂移容忍，又要有防重放（anti-replay）**。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "漂移容忍 ≠ 可以重放",
      "body": "±1 窗口让「时钟略差 1 步」的用户仍能通过；但同一时间步的验证码是固定的，若没有防重放，攻击者截获一个码就能反复使用。因此 Nyauth 在 `user_totp_credentials.last_used_step` 记录已用步，若 `matchedStep <= last_used_step` 就返回 `ErrCodeReplayed`。它是在 `FOR UPDATE` 锁定的行内、同一事务里更新与判断的，所以两个并发请求不会同时通过——权威约束在数据库行锁上。"
    },
    {
      "type": "paragraph",
      "text": "TOTP 的密钥（seed）不是明文存储：`BeginEnrollment` 用 `EncryptEnvelope`（master key 信封加密）保存，service 里用 `totpEnvelopePurpose` 绑定用途、用 userID 作为 AAD。`VerifyStoredSecrets` 能遍历每条 TOTP 信封并解密校验而不返回明文，用于灾备验证——一个从备份恢复的库若 master key 不匹配，立刻能被发现，不会「看起来健康」。"
    },
    {
      "type": "paragraph",
      "text": "还有一条重要语义：enrollment 未完成（`confirmed_at IS NULL`）时，凭据不算已绑定。Nyauth 的 `Status` 只统计 `confirmed_at IS NOT NULL` 的 TOTP；未确认的 enrollment 不能被当作可用的登录因子，也不计入 MFA 是否满足。"
    },
    {
      "type": "heading",
      "text": "恢复码：selector + 慢哈希，一次性",
    },
    {
      "type": "paragraph",
      "text": "恢复码是 TOTP 丢失时的逃生门，但它本身也是敏感凭据。Nyauth 生成的恢复码形如 `<selector>-<secret>`（各 base32），只在**创建时一次**把明文给用户，此后数据库只存：selector 的 SHA-256 摘要（用于**快速查找**哪条码）和完整码的 Argon2id 哈希（用于**慢速验证**）。消费时 `SELECT ... WHERE selector_hash=$ AND used_at IS NULL ... FOR UPDATE` 锁定行，再用 `VerifyPassword` 慢哈希比对，通过后置 `used_at`。"
    },
    {
      "type": "table",
      "caption": "存储/验证要点：selector 与 code_hash 各司其职",
      "headers": ["字段", "存的是什么", "作用"],
      "rows": [
        ["selector_hash", "selector 部分的 SHA-256", "在数据库里快速定位哪一条恢复码（高熵，无需慢哈希）"],
        ["code_hash", "完整恢复码的 Argon2id 哈希", "验证时才做慢哈希比对，离线破解昂贵"],
        ["used_at", "消费时间或 NULL", "一次性：`IS NULL` 才可消费，避免重放"]
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "恢复码的原文只在生成那一刻出现",
      "body": "生成/重塑时把 10 个明文书签返回给用户一次，之后数据库只有哈希。审计里只记录 recovery_code_id（UUID）与数量，绝不记录明文。恢复码出现过的每个承载点（响应、邮件、日志）都按秘密对待。"
    },
    {
      "type": "heading",
      "text": "Passkey / WebAuthn：非对称密钥与 ceremony",
    },
    {
      "type": "paragraph",
      "text": "Passkey 不是「把密码换成一串更长的字符串」。浏览器/认证器生成一对非对称密钥，私钥永远留在认证器里，服务器只保存**公钥凭据**与一次 ceremony 的状态。Nyauth 用 `go-webauthn`，把 WebAuthn 凭据对象也做**信封加密**（`passkeyEnvelopePurpose`，AAD 含 rpID、rowID、userID、credentialID）后落库。它强制 resident key（discoverable credential）并要求 user verification（`VerificationRequired`），ceremony 状态有 5 分钟 TTL。"
    },
    {
      "type": "table",
      "caption": "WebAuthn 机制 -> 各防止什么",
      "headers": ["机制", "防止的威胁"],
      "rows": [
        ["challenge 随机 + 一次性", "重放攻击：把之前捕获的 assertion 再提交"],
        ["origin 校验", "别的网站冒充本站点使用你的凭据（跨站使用）"],
        ["RP ID 限定", "把凭据的作用域锁到本站点，防止凭据被用于另一站点"],
        ["user verification", "设备上是否完成了本地用户验证（指纹/PIN），提升面对设备被盗时的强度"],
        ["sign count / clone warning", "认证器被克隆（clone）：签名计数器异常回退即报警"],
        ["backup state / backup eligible", "凭据是否被同步/备份到云端，用于风险与安全策略判断"]
      ]
    },
    {
      "type": "paragraph",
      "text": "在 Nyauth，WebAuthn 不只发生在浏览器登录界面：`FinishKnownPasskeyAuthentication`（已登录用户的第二因子 / 重认证）与 `FinishDiscoverablePasskeyLogin`（无用户名直登的 discoverable 登录）都走同一套 challenge/origin/RP 校验，并都经 `ValidateLogin` 检查 sign count 与 clone warning——登录后若 `credential.Authenticator.CloneWarning` 为真，审计风险等级直接标成 `high`。Discoverable 登录用 `ValidatePasskeyLogin(resolver, ...)` 在事务里按 userHandle + rawID 解析用户，保证凭据找到的用户与 assertion 声称一致。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "WebAuthn 也必须内建于失败语义",
      "body": "Passkey 验证失败会返回 `ErrInvalidPasskey`（响应被统一成「无效凭据」，不泄露细节）；registration/authentication 都在事务里锁定用户认证状态（`lockAuthenticationState` 校验 auth/session version），并有 `ChallengeCommitGate` 把「Redis 消费 ceremony」与「PostgreSQL 提交」绑定在同一个提交边界——Redis 失败则回滚已做的数据库写入。这样断网/时序异常不会留下语义不一致的半状态。"
    },
    {
      "type": "heading",
      "text": "不变量：绝不能让账户失去登录手段",
    },
    {
      "type": "paragraph",
      "text": "认证系统的第一不变量是：任何时刻，一个账户至少保留一种可用的认证方式。Nyauth 在删除凭据的路径里强制检查这一点。例如 `DeletePasskey`：若这是仅剩的 Passkey 且用户没有密码、没有可用的已启用 identity，则拒绝返回 `ErrLastAuthenticationMethod`——否则用户会把自己锁在门外。TPO安全策略同样作用于此：管理员强制 MFA 时不能把最后的因子删掉，否则返回 `ErrRequiredByPolicy` / `ErrLoginMFAFactorRequired`。"
    },
    {
      "type": "heading",
      "text": "break-glass：MFA 重置 CLI 的语义",
    },
    {
      "type": "paragraph",
      "text": "用户丢失所有 TOTP/恢复码/Passkey 时，走 `ResetForRecovery`（`recovery_reset.go`）这条 break-glass 路径。它是一个**审计过的、有边界**的管理操作，不是普通接口：必须有范围（all / totp / passkeys）、必须有理由（3–500 字符）、必须指定 actorName；用 `LockSecurityExclusive` 做全局互斥并在单个事务内完成。它本身也维护「不能锁死」不变量：若重置会把最后一种主认证方式删掉（无密码、无启用 identity、且无可保留的 Passkey）则拒绝 `ErrRecoveryPrimaryMethodNeeded`；若目标是启用的管理员且强制管理员 MFA，除非显式带 `-disable-admin-mfa-requirement`，否则拒绝 `ErrRecoveryAdminPolicyConflict`。重置之后 auth_version 递增，使旧会话/令牌失效，并写入 critical 级审计。"
    },
    {
      "type": "definition",
      "term": "ChallengeCommitGate",
      "definition": "把「MFA 因子的一次性消费」绑定到创建 challenge 时所捕获的认证状态（AuthVersion/SessionVersion）上，并在 PostgreSQL 事务提交前、Redis 消费之前调用 Consume 的提交闸门。作用：一旦因子被使用，即便后续 Redis 失败，也会回滚数据库写入，避免凭据被用但状态不一致。verifyTOTP、恢复码、Passkey 都接了这个 gate。"
    },
    {
      "type": "exercise",
      "title": "区分 auth_version 与 session_version 各自撤销什么",
      "description": "分别列出下面两类操作各自会让什么失效：(a) 用户改密码、绑定/解除 TOTP、删除 Passkey；(b) 管理员调用 RevokeSessions 重置该用户全部会话。解释为什么第 (a) 类走 auth_version、第 (b) 类走 session_version，并指出二者在请求路径上如何被逐请求比对，进而让旧会话失效。再列出 WebAuthn 校准中你要求必须拒绝的状态（challenge 过期/重复、origin 不匹配、RP ID 不符、clone warning、sign count 回退、用户未做 verify）。",
      "hint": "session.go 的 CreateSession 把 AuthVersion/SessionVersion 拷进 SessionData；middleware 的 userAuthMiddleware 每次 get current 后比对 current.AuthVersion/SessionVersion 与会话里的值，不一致即销毁会话。"
    },
    {
      "type": "quiz",
      "question": "TOTP 的 ±1 窗口与防重放（anti-replay）分别解决什么问题？",
      "options": [
        "窗口防止时钟漂移导致验证码对不上；防重放防止同一时间步的码被反复使用",
        "窗口防止暴力破解；防重放防止验证码被猜出",
        "两者是一回事，都用于加快验证",
        "窗口防止 secret 泄露；防重放防止 secret 被备份"
      ],
      "answer": 0,
      "explanation": "漂移容忍解决「设备时钟与服务器略有偏差」；防重放解决「同一固定时间步的验证码重放」。二者都要，缺一不可，且由 last_used_step 在行锁事务内保证。"
    },
    {
      "type": "quiz",
      "question": "删除一个用户的最后一个 Passkey 时，Nyauth 会怎样？",
      "options": [
        "总是允许删除，服务器不关心后续登录",
        "若该用户没有密码也没有可用的启用的 identity，则拒绝（ErrLastAuthenticationMethod），因为不能让账户失去最后一种登录手段",
        "自动帮用户新建一个密码",
        "删除成功并清空该用户的所有会话"
      ],
      "answer": 1,
      "explanation": "认证系统的不变量是账户至少保留一种可用认证方式；删除会把最后手段移除时会被拒绝，这也是 break-glass 重置里同样被反复校验的约束。"
    },
    {
      "type": "keypoints",
      "items": [
        "密码用 Argon2id 慢哈希；不用普通 SHA-256；恒定时间比对 + 统一错误信息防枚举",
        "改密码/换 MFA 会提升 auth_version，使旧会话与令牌立即失效",
        "TOTP：RFC 6238 SHA-1/30s/6位，±1 窗口 + last_used_step 防重放，seed 用 master key 信封加密",
        "未确认的 enrollment 不算已绑定因子",
        "恢复码：selector 用 SHA-256 定位、完整码用 Argon2id 验证，used_at 保证一次性",
        "Passkey/WebAuthn：非对称密钥，服务器只存公钥凭据；challenge 防重放、origin 防跨站、RP ID 限站点、user verification、sign count/clone warning/backup state",
        "不变量：账户绝不能失去最后一种认证手段",
        "break-glass MFA 重置有范围/理由/actor，且拒绝把管理员锁死，除非显式 -disable-admin-mfa-requirement",
        "ChallengeCommitGate 把因子一次性消费绑定到事务提交边界，保证一致性"
      ]
    }
  ]
};
