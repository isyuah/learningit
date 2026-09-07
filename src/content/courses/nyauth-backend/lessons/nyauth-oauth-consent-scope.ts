/* ==================================================================
 * 课时：Scope、Claim 与 Consent（nyauth-oauth-consent-scope）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 事实基线：03-oauth-oidc.md、internal/settings/policies.go（OAuthPolicy）、
 * internal/client/service.go、internal/auth/consent.go。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-oauth-consent-scope",
  "courseSlug": "nyauth-backend",
  "title": "Scope、Claim 与 Consent",
  "summary": "分清「要什么权限」与「能返回哪些字段」，并理解同意界面里必需与可选、新追加 scope 的处理。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前两课回答「怎么走流程」，这一课回答「到底能拿到什么」。OAuth 里「权限」和「数据字段」是两层不同的东西，容易混。`scope` 是一组权限/资源集（客户端申请的范围）；`claim` 是令牌或 UserInfo 里的一个字段（如 `email`、`preferred_username`）。Nyauth 把「可用 scope」「可选 scope」「claim 映射」「客户端允许范围」分开管理，本课把这三层拆清楚。"
    },
    {
      "type": "definition",
      "term": "Scope（范围）",
      "definition": "客户端向授权服务器申请的权限/资源集合，例如 `profile`（基本资料）、`email`（邮箱）、`offline_access`（离线访问）。它们是「授予该客户端的访问能力」，决定它能代用户访问什么。"
    },
    {
      "type": "definition",
      "term": "Claim（声明）",
      "definition": "令牌或 UserInfo 中实际返回的一个字段，例如 `sub`、`name`、`email`、`email_verified`、`preferred_username`、`picture`、`role`。Claim 是「数据」，scope 是「权限」——scope 决定哪些 claim 会被包含进来。"
    },
    {
      "type": "heading",
      "text": "客户端的 scope 是一种「可申请上限」"
    },
    {
      "type": "paragraph",
      "text": "每个 OAuth Client 在注册时由管理员配置一张「允许的 scope」清单（`cl.Scopes`）。`/authorize` 里客户端请求的 scope 必须全部落在这张清单内，否则返回 `invalid_scope`。这张清单就是**请求上限**：客户端不能申请它没被登记过的 scope。而系统层面还有另一道边界——运行时的「Scope Catalog」（`OAuthPolicy.AllowedScopes` 等），它定义整个实例当前支持哪些 scope、各 scope 的展示名、描述和风险等级。客户端清单 ⊆ 运行目录，两层共同收敛。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "客户端的 scope 不能被前端单独控制",
      "body": "为什么？因为 scope 决定的是「这个应用代用户拿走的权限」，属于安全边界。如果前端能随意修改客户端登记的 scope，攻击者就能让一个无害应用声称拥有高级权限。Nyauth 在服务端（client service / handler）校验：请求的 scope 必须被该 client 的已登记清单与运行时目录都允许。前端只是展示、提交选择，授权与否的裁决永远在授权服务器一侧。"
    },
    {
      "type": "heading",
      "text": "Scopes、OptionalScopes、AllowedClaims 的语义"
    },
    {
      "type": "table",
      "caption": "三层配置在 /authorize 与 Consent 中的语义",
      "headers": ["配置", "含义", "在 Nyauth 中如何作用"],
      "rows": [
        ["Scopes（允许范围）", "该客户端可申请的 scope 集合（请求上限）", "/authorize 校验请求 scope ⊆ cl.Scopes；目录也须允许"],
        ["OptionalScopes（可选范围）", "允许范围内的一个子集，用户可在 Consent 里单独去掉", "consentPermissions 里 Required=!isOptional；openid 绝不能是可选"],
        ["AllowedClaims（允许的 claim）", "该客户端最终能拿到的字段白名单", "与 scope 推导的 claim 取交集；任意用户元数据不当 claim"],
        ["Scope Catalog（运行时目录）", "整个实例当前支持的 scope 与展示/风险元数据", "由 OAuthPolicy.AllowedScopes 等定义，决定 scopes_supported 与 Consent 展示"]
      ]
    },
    {
      "type": "paragraph",
      "text": "一次授权请求里，客户端请求了 N 个 scope。系统会把其中「既是客户端允许的、又在目录里、且被标记为 `OptionalScopes`（并且不是 `openid`）」的那部分标记为**可选**，其余为**必需**。Consent 上必需 scope 用户不能去掉，可选 scope 则可以勾选/取消（`GrantedOptionalScopes` 数组由前端提交、服务端在 `resolveGrantedScopes` 里逐项校验）。拒绝方式也不同：用户拒绝必需 scope = 拒绝整个授权（返回 `access_denied`）；只去掉某个可选 scope 则其余照常颁发。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "必需与可选在拒绝时的差别",
      "body": "记住一句话：**必需 scope 是授权的前提，可选 scope 是授权的调味料**。用户勾掉了某个可选 scope，剩下的 scope 照常换令牌；但一旦用户或管理员把某个必需 scope 拿掉，整个授权就不成立。Nyauth 在 consent.go 里用 `resolveGrantedScopes` 保证：可选的必须是已请求且非 openid 的子集，被勾选的必须真的属于可选集合，否则直接返回 `invalid_scope_selection`。"
    },
    {
      "type": "heading",
      "text": "Consent 如何记录变化：新增 scope、再次授权"
    },
    {
      "type": "paragraph",
      "text": "用户在 Consent 上的选择会被持久化为一条**授权记录**（Nyauth 的 `authorizationStore`，保存 user ↔ client 的 granted scopes 与 allowed claims）。下次同一个用户再次授权时，Nyauth 会读回这条记录做差值：`new_scopes = difference(请求的 scope, 上次已授予的 scope)`。Consent 界面上会把这些 scope 标成 `previously_granted`（上次已给）或 `newly_requested`（本次新增），让用户看清「这次多要了什么」。这既是对透明度的要求，也是防止客户端静默扩大权限的机制。"
    },
    {
      "type": "paragraph",
      "text": "同理，`new_claims` 是「本次新增的 claim」。客户端配置或管理员策略变动（identity/authorization revision）时，Consent 还会要求 `reauthorization_required`——因为客户端此前的授权授权依据已经变了，需要用户重新确认（`client_changed_restart_authorization`）。"
    },
    {
      "type": "heading",
      "text": "scope → claim 的映射"
    },
    {
      "type": "paragraph",
      "text": "claim 不是凭空来的。Nyauth 用一个映射把 scope 翻译成对应的 claim 集合：`openid` → `sub`；`profile` → `preferred_username`、`name`、`picture`；`email` → `email`、`email_verified`（consent.go 的 `claimsForScope`）。最终 `AllowedClaims` 是被授予 scope 推导出的 claim，再与客户端登记的 claim 白名单取交集。也就是说：**即使客户端登记了 `role`，如果请求里没有对应的 scope，也拿不到 `role`**——「用什么权限」决定「能读哪些字段」。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么任意用户 Metadata 不能原样变成 Claim",
      "body": "如果允许「用户想加什么字段就加什么字段」原样进 ID Token / UserInfo，就打开了随意要求敏感字段的口子，也让 claim 语义变得不可审计。Nyauth 的做法是：claim 必须先经过 scope 推导、再被客户端登记白名单和运行时策略双重收敛。数据库中甚至有约束：`sub` 必须配合 `openid`，`openid` 必须带 `sub`，未登记的 claim 不能写入（见 oauth_client_claims_integration_test.go）——把「谁能读什么」钉死在数据层。"
    },
    {
      "type": "quiz",
      "question": "用户可以在 Consent 界面上去掉某个 scope，但如果它不属于 OptionalScopes，会怎样？",
      "options": [
        "它照样会被纳入授权，前端只是显示为灰色",
        "它属于必需 scope，去掉它由服务端 resolveGrantedScopes 拒绝或整个授权不成立",
        "它会自动变成可选并保持授予",
        "它会被转成 claim 继续返回"
      ],
      "answer": 1,
      "explanation": "openid 与未标记为 optional 的 scope 是必需权限，不能由用户通过勾选去掉；一旦尝试去掉必需 scope，服务端会判定选择非法或视为拒绝整个授权。"
    },
    {
      "type": "exercise",
      "title": "读一段未授权的 claim 拦截",
      "description": "一个 client 登记了 scopes=[openid profile], allowed_claims=[sub, name, role]。它发起一次只含 openid 的授权请求。推演：哪些 claim 会被放进最终允许集？为什么 role 拿不到？如果把请求 scope 改成含 profile，result 会怎样变化？",
      "hint": "allowed_claims 只是白名单上限，实际 take 的是 scope 推导出的 claim 交集。single openid 只推 sub；含 profile 才多 name/picture，role 仍可能因无对应 scope 而缺席。"
    },
    {
      "type": "keypoints",
      "items": [
        "scope=权限/资源集，claim=令牌或 UserInfo 里的字段，两者是不同层",
        "客户端 scopes 是请求上限，运行时 Scope Catalog 是实例级目录，双重要求",
        "OptionalScopes ⊆ Scopes，用户可勾选去掉；openid 绝不能是可选",
        "必需 scope 被去=授权不成立；只去可选则其余照常",
        "Consent 用差值标记 newly_requested 与 previously_granted，客户端变化时要求重新授权",
        "claim 由 scope 推导并与登记白名单取交集；任意用户元数据不得原样变 claim",
        "scope/claim 的裁决只在服务端，前端只提交选择"
      ]
    }
  ]
};
