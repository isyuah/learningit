/* ==================================================================
 * 课时：Secrets、日志脱敏与审计（nyauth-secrets-audit-logging）
 * ----------------------------------------------------------------
 * slug 必须与 course.ts 大纲一致。块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-secrets-audit-logging",
  "courseSlug": "nyauth-backend",
  "title": "Secrets、日志脱敏与审计",
  "summary": "哪些秘密绝不能进日志/响应/审计，信封加密与明文加密的区别，以及审计与日志为什么不同。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "安全链的最后两环是「撤销/轮换」与「审计/告警」。它们共同依赖一条硬规则：**秘密绝不进入日志、API 响应或审计 details**。否则审计系统本来是拿来发现入侵的，结果反而成了把钥匙交出去的出口。这一课把「哪些值算秘密」「如何存放」「如何观察」讲清楚，并厘清一个常见混淆：审计（security accountability）与日志（debugging）是两种不同用途。"
    },
    {
      "type": "heading",
      "text": "铁律：秘密不落任何可被旁观的表面",
    },
    {
      "type": "paragraph",
      "text": "判断一个值是否敏感，不是看字段名是否叫 password，而是看它「能否直接认证一个实体」。只要答案是「能」，它就是一等秘密：不该进日志、不该进 API JSON、不该进审计 details、不该进指标 label。Nyauth 把这份清单显式编码在 `audit/helpers.go` 的 `sensitiveAuditDetailKey` 里（password/secret/token/cookie/csrf/nonce/authorization_code/code_verifier/passphrase/credential/recovery_code/private_key/api_key/ciphertext/totp_seed/totp_secret 等），写入时校验、读取时 `RedactDetails` 二次兜底并输出 `[REDACTED]`——包括嵌套 map 与数组。"
    },
    {
      "type": "list",
      "items": [
        "密码与口令哈希（原文绝不出现）",
        "Session Cookie 值",
        "Access Token / Refresh Token / ID Token",
        "OAuth Client Secret",
        "PKCE code_verifier",
        "OIDC Provider（第三方登录）Token",
        "TOTP Secret（seed）",
        "恢复码明文",
        "邮件正文里的一次性 Token / 验证链接 token"
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "一个值可以「可被查到」但绝不「被返回/被记录」",
      "body": "例如密码哈希、TOTP seed 信封、Passkey 凭据、Provider Secret、SMTP 密码都**必须能由服务解密使用**，但任何一条都不该出现在日志里，也不该在 API 响应里被回显。API 返回的是「已配置否」这类布尔状态，而不是值本身。这便是「收藏钥匙」与「把钥匙挂墙上」的区别。"
    },
    {
      "type": "heading",
      "text": "信封加密 vs 明文加密",
    },
    {
      "type": "definition",
      "term": "信封加密（Envelope Encryption）",
      "definition": "用一个受控的 master key（主密钥，进程内存里的 32 字节）封装实际加解密，对每个数据记录用 AES-256-GCM 加密，并在密文前缀附上版本、keyID、purpose，把非密钥上下文（version/keyID/purpose/业务 AAD）作为附加认证数据（AAD）参与校验。好处是：可按 keyID 轮换主密钥、可绑定用途与上下文（防止密文被挪到另一个字段/实体使用）、Master key 不用为每条记录单独派生。"
    },
    {
      "type": "table",
      "caption": "信封加密 vs 简单对称加密",
      "headers": ["维度", "信封加密（Nyauth）", "简单的 AES 一把通钥"],
      "rows": [
        ["密钥管理", "带 keyID 的多主钥，可按 keyID 独立轮换", "单把密钥难以安全轮换"],
        ["用途约束", "purpose + AAD 绑定上下文，密文不可跨用途/跨实体挪动", "密文本身不携带绑定信息"],
        ["失效边界", "keyID 缺失即 ErrUnknownEnvelopeKey，立刻暴露配置错误", "钥不匹配只会解密失败，不易定位"],
        ["灾备验证", "VerifyStoredSecrets 可遍历校验还原性", "无此能力"]
      ]
    },
    {
      "type": "paragraph",
      "text": "在 Nyauth 里，信封加密用于所有「需要可逆存储」的敏感值：TOTP seed（`mfa.totp.secret`）、Passkey 凭据（`mfa.passkey.credential`）、Provider 的 client secret（`providerSecretPurpose`）、SMTP 密码（`mail-runtime-smtp-password`）、JWK 私钥、注册/动作 token 等；它们的 AAD 各绑定了不同的上下文（如 userID、rpID、providerName、kid）。这样即便某个密文被复制，也解不开别的实体/用途的数据。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "口令不是用加密，而是用慢哈希",
      "body": "信封加密用于需要「可逆」的场景（TOTP seed 要在验证时用、凭据要解密校验）。口令不同——它永远不需要还原，所以用 Argon2id 单向慢哈希，根本不存可逆形态。选哪条路径取决于是否必须解密回来，而不是统一都用加密。"
    },
    {
      "type": "heading",
      "text": "API 只返回状态，不返回值",
    },
    {
      "type": "paragraph",
      "text": "对外契约上，Nyauth 遵循「已配置否」而非「给值」的原则。例如 SMTP 密码用了之后，接口/settings 返回 `password_configured: true` 这样的布尔，而不是把密码回传给前端；MFA 的 `Status` 返回 `totp_enrolled`、`recovery_codes_remaining`、`passkeys_enrolled`，绝不返回 TOTP 明文或恢复码原文。用户在需要时通过安全流程重新输入/生成，而不是读回旧值。"
    },
    {
      "type": "heading",
      "text": "审计记录“谁对什么做了什么”，而不是复制秘密",
    },
    {
      "type": "paragraph",
      "text": "一次有意义的审计事件应回答：谁（actor，谁发起的）、何时、对什么对象（target type/id）、做了什么（event）、结果（success/failure）、风险（risk level）、来源（IP/UA）。Nyauth 的 `AuditLog`/outbox 正是这个模型，审计 details 里存的是**计数、ID、布尔、方法名**这类非秘密元数据（例如 `recovery_codes: 10`、`method: \"totp\"`、`clone_warning: true`、`session_id`），而绝不复制密码、token、恢复码明文。它是「事件记录」，不是「凭据副本」。"
    },
    {
      "type": "table",
      "caption": "日志 vs 审计",
      "headers": ["用途", "回答的问题", "典型消费者", "错误形态"],
      "rows": [
        ["日志（debug）", "系统在做什么、哪里报错", "工程师排查运行时问题", "高基数 label、偶然打了敏感字段会无人在意地泄露"],
        ["审计（security accountability）", "谁对哪个对象做了什么，结果与风险", "安全团队、合规、攻击溯源", "把凭据当成 details 记录 = 把审计变成泄密出口"]
      ]
    },
    {
      "type": "heading",
      "text": "可观测性：高基数 vs 低基数",
    },
    {
      "type": "paragraph",
      "text": "指标是聚合统计，不是事件流，因此对基数（cardinality）很敏感。Nyauth 遵循：**指标 label 里不放用户 ID、邮箱等无限增长的高基数标识**，否则内存与 TSDB 会被打爆，而且这类 label 本身就是敏感个人数据。指标应保持低基数：操作名（来自权威 catalog）、成功/失败、risk level、auth method 类别等有限的维度。用户级粒度交给审计（按 target aggregator 落库、按 UTC 月分区做保留期管理），而不是塞进指标。一句话：指标回答「整体趋势」，审计回答「具体某次谁做了某件事」。"
    },
    {
      "type": "exercise",
      "title": "判断给定值能否写入日志/指标/审计，并脱敏",
      "description": "对下面每个值，逐个回答：能否进 (1) 调试日志、(2) 指标 label、(3) 审计 details？不能就给出应替换成的安全表示。候选：用户邮箱；Refresh Token；`totp_enrolled=true`；恢复码数量 10；恢复码明文；`clone_warning=true`；凭据 credential_id；一次邮件重置链接里的一次性 token。",
      "hint": "邮箱和 credential_id 是高基数个人标识，适度用于审计可接受但不要进指标 label；token/恢复码明文/一次性 token 属一等秘密，一律不进任何表面，只留 ID/布尔/计数。"
    },
    {
      "type": "quiz",
      "question": "为什么审计 details 里不能放 Refresh Token 的原文？",
      "options": [
        "因为审计数据库空间不够",
        "因为审计是事件记录而非凭据副本，放凭据原文会把审计系统变成泄露出口，且违背“秘密不进表面”的铁律",
        "因为审计只能存数字",
        "因为 Refresh Token 不需要被记录"
      ],
      "answer": 1,
      "explanation": "审计用于回答“谁对什么做了什么、结果与风险”，它记录事件与元数据；凭据原文一旦落入审计，任何读取审计的人就拿到了可认证的钥匙。"
    },
    {
      "type": "keypoints",
      "items": [
        "铁律：密码、cookie、access/refresh token、client secret、PKCE verifier、provider token、TOTP seed、恢复码明文、邮件一次性 token 绝不进日志/响应/审计",
        "secret 的判定标准是“能否直接认证一个实体”，不是字段名",
        "Nyauth 把敏感键清单硬编码在 sensitiveAuditDetailKey，写入校验 + RedactDetails 兜底",
        "需要可逆存储的敏感值用信封加密（master key + keyID + purpose + AAD），支持按 keyID 轮换与上下文绑定",
        "口令不需要可逆，用 Argon2id 慢哈希而不是加密",
        "API 只返回 password_configured 等状态布尔，不回传值",
        "审计记录谁/何时/对什么/做什么/结果/风险，是事件记录不是凭据副本",
        "日志用于调试、审计用于安全问责，二者不同",
        "指标用低基数 label（不放 user ID/email），高粒度交给审计按分区落库"
      ]
    }
  ]
};
