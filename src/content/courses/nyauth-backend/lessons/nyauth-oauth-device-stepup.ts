/* ==================================================================
 * 课时：Device Authorization 与 RFC 9470 Step-Up（nyauth-oauth-device-stepup）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 事实基线：03-oauth-oidc.md、internal/auth/device_authorization.go、
 * internal/oauthstepup/acr.go、internal/auth/consent.go、RFC 8628 / RFC 9470。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-oauth-device-stepup",
  "courseSlug": "nyauth-backend",
  "title": "Device Authorization 与 RFC 9470 Step-Up",
  "summary": "一台没有键盘的电视如何安全登录，以及当业务 API 要求更高认证等级时如何升级认证。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "这一课讲两个面向真实世界的协议：**Device Authorization（RFC 8628）** 解决「输入受限的设备怎么登录」，**Step-Up（RFC 9470）** 解决「业务 API 在权限不足时如何要求用户提升认证等级」。两者都容易讲浅，本课把它们讲实：设备码不是无脑二维码登录，Step-Up 也不是服务端单方面拍板。"
    },
    {
      "type": "heading",
      "text": "Device Authorization：给没有键盘的电视一个登录口"
    },
    {
      "type": "paragraph",
      "text": "智能电视、机顶盒、CLI 这类设备不方便输入用户名密码，但它可以显示一个 `user_code`，让用户用手机/电脑浏览器到 `verification_uri` 确认。Nyauth 的实现（internal/auth/device_authorization.go）完全遵循 RFC 8628：设备先 POST /device_authorization 领到 `device_code`、`user_code`、`verification_uri`、`verification_uri_complete`、`expires_in`、`interval`。随后设备用 `device_code` 按 `interval` 反复轮询 /token，直到用户确认或超时。"
    },
    {
      "type": "list",
      "ordered": true,
      "items": [
        "设备（client）POST /device_authorization，声明想用的 scope，领回 device_code 与 user_code",
        "设备把 user_code 和 verification_uri 显示在屏幕上，并开始按 interval 轮询 /token",
        "用户用另一台设备的浏览器访问 verification_uri，登录并输入 user_code",
        "Nyauth 匹配 pending 的 device record，创建 consent challenge（与 Code 流向同一套 Consent）",
        "用户确认后，approve_with_authentication 记录授权；设备端轮询从 authorization_pending 变为成功",
        "轮询换到 Access/ID（如需）/Refresh Token，此 device_code 一次性消费"
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "轮询的三种状态你必须分得清",
      "body": "设备 /token 轮询时，Nyauth 会按 RFC 8628 返回：`authorization_pending`（用户还没授权，保持按 interval 轮询）、`slow_down`（你轮得太勤了，Nyauth 会把 interval 变大，见 Retry-After）、`access_denied`（用户点了拒绝）、`expired_token`（device_code 失效）。每种都对应一个明确的进展，客户端必须照做，而不是乱撞。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "设备码流程依然是真实认证流，不是不安全的二维码登录",
      "body": "一个常见误解是把设备码当成「扫码就登进去」的黑箱。实际上它走了完整链路：设备必须已经被授予 `device_code` grant、scope 必须落在允许集、user_code 与 device_code 必须是 pending 且一次性、批准动作发生在**已认证用户的浏览器会话**里并附带上其认证上下文（acr/amr/auth_time）。也就是说，最终授权来自一个真实登录过的用户，而不是一个匿名扫码动作。"
    },
    {
      "type": "heading",
      "text": "Step-Up：业务 API 要求更高认证等级"
    },
    {
      "type": "paragraph",
      "text": "业务 Resource Server 校验 Access Token 时，可能发现当前令牌的认证等级不够（例如要改密码、转账、查看敏感数据）。RFC 9470 定义了这套词汇：客户端在 /authorize 里用 `acr_values` 表达**期望的认证等级偏好**，用 `max_age` 表达**认证新鲜度要求**；而服务器的回应里，`acr` 是**实际达到的等级**，`amr` 是**实际使用的认证方法**，`auth_time` 是**认证发生的时间**。这套值随令牌传给 Resource Server 做策略判断。"
    },
    {
      "type": "table",
      "caption": "RFC 9470 / OIDC 认证上下文参数语义",
      "headers": ["参数/字段", "含义", "Nyauth 中的处理"],
      "rows": [
        ["acr_values（请求）", "客户端期望/偏好的认证等级", "ParseACRValues，只接受 urn:nyauth:loa:1 与 loa:2，最多 4 个且有序取第一个支持的"],
        ["max_age（请求）", "要求最近一次认证不超过该秒数", "ParseMaxAge（非负、上限 30 天）；不满意则强制重新登录"],
        ["acr（响应/令牌）", "实际达到的认证等级", "AuthenticationContext：loa:2 才是 2，空/未知按 loa:1 兼容"],
        ["amr（响应/令牌）", "实际使用的认证方法（如口令、TOTP、Passkey）", "AuthenticationMethods 一并写入令牌上下文"],
        ["auth_time（响应/令牌）", "认证实际发生的时间", "AuthenticatedAt 传播到授权码与令牌，供 max_age 判定新鲜度"]
      ]
    },
    {
      "type": "paragraph",
      "text": "Nyauth 只暴露它定义的两个保证等级：`urn:nyauth:loa:1`（默认/普通登录）和 `urn:nyauth:loa:2`（例如要求更强的第二因素认证步骤）。`acr_values` 按客户端偏好**有序**排列，Nyauth 取第一个它支持的值作为 `required`（参见 oauthstepup/acr.go 的 `RequiredContext`）——所以一个「必须 loa:2」的客户端，不能因为把 loa:1 排在前面就悄悄降级，它必须只请求 loa:2。"
    },
    {
      "type": "heading",
      "text": "会话不满足时：提升，而不是降级"
    },
    {
      "type": "paragraph",
      "text": "当用户当前的会话等级不满足 `acr_values` 或新鲜度不满足 `max_age` 时，Nyauth **不会强行发令牌或偷偷降级**。它保留 consent challenge，并在 Consent 数据里标记 `step_up_required` 与 `required_acr`，引导用户先完成更高级别或更近期的认证（重新登录/附加第二因素），认证上下文升级后再回来。`consentAuthenticationSatisfies` 会反复核对当前会话是否已满足必需等级与 max_age——除非满足，否则 `AcceptConsent` 会被回以 `unmet_authentication_requirements`。这保证了「等级只会升，不会静默降」。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "协议边界：授权服务器侧 vs 资源服务器侧",
      "body": "Nyauth 做的是 **Authorization Server 侧的 Step-Up**：在签发令牌前，它确保用户的认证上下文达到所请求的 acr/max_age。但 Nyauth 不替你保护业务 API。当业务 Resource Server 在本地发现令牌权限不足或认证等级不够时，它必须按照 RFC 9470 自己返回 `insufficient_user_authentication` 挑战，把用户导回 Nyauth 做升级认证。这是两边各自的职责，不要混为一谈。"
    },
    {
      "type": "quiz",
      "question": "一个客户端请求 acr_values=urn:nyauth:loa:2，但当前用户只完成了普通口令登录，Nyauth 会怎么做？",
      "options": [
        "直接签发一个 loa:2 的 Access Token",
        "保留 consent challenge、标记 step_up_required 并引导用户先完成更高等级认证，满足前不签发",
        "悄悄把等级降为 loa:1 继续签发",
        "忽略 acr_values，按默认等级签发"
      ],
      "answer": 1,
      "explanation": "只有 loa:2 才算满足 loa:2；consentAuthenticationSatisfies 不通过时 AcceptConsent 返回 unmet_authentication_requirements，等级只升不降。"
    },
    {
      "type": "exercise",
      "title": "构造一个升档场景并说明协议双方各做什么",
      "description": "业务系统要求修改手机号必须认证等级至少 loa:2。请描述：① Resource Server 如何把用户送回 Nyauth（它应返回什么）；② Nyauth 侧的 authoriz 请求如何表达 loa:2；③ 用户完成 MFA 后，令牌里哪些字段会携带这次认证上下文；④ 写出 Resource Server 在本地校验不通过时应返回的 RFC 9470 挑战名。",
      "hint": "③看 acr/amr/auth_time 随令牌传播；④是 insufficient_user_authentication。前两步分别站在 Resource Server 与 AS 两侧，别混淆边界。"
    },
    {
      "type": "keypoints",
      "items": [
        "Device（RFC 8628）：device_code 轮询换令牌，user_code 交用户在浏览器确认",
        "轮询状态：authorization_pending / slow_down / access_denied / expired_token，各对应明确动作",
        "设备码是真实认证流：需 device grant、scope 受限、一次性与用户已认证会话",
        "Step-Up（RFC 9470）词汇：acr_values/max_age 是请求，acr/amr/auth_time 是结果",
        "Nyauth 只定义 loa:1 与 loa:2；acr_values 有序取第一个支持的",
        "会话不满足时不降级：保留 consent、标记 step_up_required，重新认证后再签发",
        "边界：Nyauth 做 AS 侧升级；Resource Server 本地不足时自己回 insufficient_user_authentication"
      ]
    }
  ]
};
