/* ==================================================================
 * 课时：Refresh Token family：轮换与重用检测（nyauth-refresh-family-rotation）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-refresh-family-rotation",
  "courseSlug": "nyauth-backend",
  "title": "Refresh Token family：轮换与重用检测",
  "summary": "每次刷新都换一个新令牌，并发现旧令牌是否被再次使用——这是检测令牌被盗的关键机制。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "Refresh Token 生命周期很长，一旦泄露，攻击者就可能在很长一段时间里源源不断地换取有效的 Access Token。仅靠过期并不能堵住这个口子。于是业界采用「轮换」(rotation)：每次用 Refresh Token 换取新令牌时，旧令牌作废、发一个新的。但轮换本身还不够——如果攻击者偷走了刷新令牌，他也能让一次合法的轮换发生。真正有用的是一层额外的检测：重用检测(reuse detection)。这一课我们看 Nyauth 如何用「family（令牌族）」和 Redis 原子脚把这个机制做扎实。"
    },
    {
      "type": "heading",
      "text": "为什么轮换"
    },
    {
      "type": "paragraph",
      "text": "不轮换的 Refresh Token 就像一把永远有效的万能钥匙：只要泄露一次，就能无限续期。轮换把「泄露面」压缩到「一次使用窗口」：每个刷新令牌只被允许成功兑换一次，兑换完就作废并换新。这样，令牌被盗的后果变成「仅当攻击者真的去用那一次，才可能被发现」，而且一旦发现就能打击整族。轮换的代价是客户端每次刷新都要妥善保存新的刷新令牌，并正确处理「多设备 / 多客户端同时刷新」的场景。"
    },
    {
      "type": "heading",
      "text": "family：一族令牌共享一个血缘"
    },
    {
      "type": "paragraph",
      "text": "一次授权的生命周期里，不断被轮换出来的 Refresh Token 属于同一个「族」(family)。在 Nyauth 的 Redis session store（`internal/session/store.go`）里，每个令牌对应的 `TokenData` 带有 `FamilyID`/`FamilyKey`/`UserKey`，一个 family 用一条 Redis Set 记录它当前所有的成员（当前的 refresh 记录、以及它派生出的 access-token 元数据记录）。所以一个家庭要么完好存在，要么整体撤销——不存在「族里一半令牌有效、一半失效」的中间态。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "user_key：把族收拢到具体用户",
      "body": "除了 family 外，令牌还带 `user_key`，授权服务器用 `userRefreshFamiliesPrefix + digest(userKey)` 这种结构维护「某个用户当前拥有的所有 family」。这样当用户改了密码、失去某项授权、或会话被批量撤销时，可以顺着 user 索引把该用户的全部 refresh family 一起撤销，而不是逐条去翻。auth/session 版本变化会让既有凭据直接失效——这正是「JWT + 服务端状态」相比纯无状态 JWT 的重要优势。"
    },
    {
      "type": "heading",
      "text": "重用检测的不变量"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 的核心不变量是：一个 Refresh Token 只允许成功使用一次。如果用过的（已经轮换过的）旧令牌再次出现——无论它来自哪里——都意味着「有人拿着一个本应失效的令牌在试图续期」。这通常是一个强信号：要么是攻击者重放偷来的旧令牌，要么是两个设备在竞争同一族。Nyauth 的裁决是保守且强硬的：一旦检出重用，就撤销整条 family，并让与该 family 关联的 access-token 元数据一并失效（`ErrRefreshTokenReuse`）。这就是「重用检测不只撤销那一个令牌，而是撤销整个族」。"
    },
    {
      "type": "list",
      "items": [
        "确认旧令牌确实是「当前」的令牌（仍是 $current，未被换掉）",
        "删除/标记旧令牌已使用（把它记入 used，用于后续重用检测）",
        "写入新令牌，并写入其关联的 access-token 元数据",
        "维护 family 索引：把新成员加入 family Set，移除旧成员",
        "若检出重用：撤销整个 family 及其全部成员，写撤销标记"
      ]
    },
    {
      "type": "code",
      "title": "rotateRefreshWithAccessScript 的执行要点（store.go 中的 Lua）",
      "language": "text",
      "code": "输入：旧令牌 key、新令牌 key、used key、access 元数据 key、user families key\n\n1) 读 KEYS[1] 的当前值：\n   - 若已不存在：查 used。若 used 存在且匹配 -> 发现重用 -> revokeFamily(used)\n     （旧令牌又一次出现 = 重用 = 撤销整族）\n   - 若 used 不匹配 -> 返回 -3（绑定不匹配）\n\n2) 校验当前值与 expected 一致；不一致 -> -3\n\n3) 若 family 已被撤销（存在 revoked 标记）-> revokeFamily(current)\n\n4) 正常轮换（原子完成，一气呵成）：\n   - SET 新令牌 key = current\n   - SET access 元数据 key = access payload\n   - SADD 新成员进 family Set，SREM 旧成员\n   - 设置 family Set 的 TTL\n   - 把旧 token 记入 used（用于以后的重用检测）\n   - DEL 旧令牌 key\n\n返回 {1, current} 表示成功"
    },
    {
      "type": "paragraph",
      "text": "上面的脚本和上一章读过的 Redis 知识呼应：为什么必须用 Lua 脚本而不是几条普通命令？因为轮换是一个多步「先比较后写」(compare-and-swap) 的过程，中间还牵扯删除与撤销。如果拆成多条普通命令，两个并发请求可能交错执行：请求 A 读到当前令牌、请求 B 也读到同一个当前令牌，然后各自都以为「我是当前持有者」，最终两个都成功——重用就漏检了。Lua 把「确认当前 → 写入新 → 记录 used → 维护 family → 可能删除整族」包进同一个原子边界（`RotateRefreshTokenAndStoreAccess` 调用 `rotateRefreshWithAccessScript`），保证同一时刻只有一个请求能成功消费那个当前令牌。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "轮换能检测什么、不能检测什么",
      "body": "能检测：有人拿着一个「已经被轮换掉」的旧令牌再次试图续期——重放、两个客户端竞争用完同一个令牌等。它不能检测：一个「从未使用过的」刷新令牌被偷去抢先使用。换句话说，如果攻击者偷走令牌后在合法程序之前第一次使用了它，那个令牌本来就是要用的，轮换机制无法区分「合法者」和「抢先的盗贼」——它能做的，是当旧令牌第二次出现时，把整个 family 一锅端。所以不要宣称「轮换能发现所有盗窃」，要准确表述为「轮换 + 重用检测能在旧令牌二次出现时撤销整族，从而把损失限制在单次使用」。（这句话背后的 reasoning 属于工程推导，结合 Nyauth 的行为是可靠的。）"
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "双并发使用同一个 Refresh Token 的结果",
      "body": "客户端 A 和 B 几乎同时用同一个刷新令牌向 /token 发起刷新。Lua 脚本的原子性保证：第一个到达的请求成功消费当前令牌，写入新令牌与新的 access 元数据，并把旧令牌记入 used；第二个请求到达时发现「当前令牌已经不存在，而是出现在 used 里」→ 判定重用 → 撤销整个 family（连同新写的 access 元数据）→ 返回 `ErrRefreshTokenReuse`。测试代码（`store_redis_integration_test.go`）正是用两个并发刷新断言「1 成功、1 重用」，并确认 family 在重用后已不可复活。"
    },
    {
      "type": "heading",
      "text": "为什么 JWT 仍要服务端元数据"
    },
    {
      "type": "paragraph",
      "text": "面试里最容易被追问的一句是「JWT 是无状态的，为什么还要 Redis」。答案是：Nyauth 需要「可撤销、可做策略检查、可跨会话失效」的控制面，而这些纯无状态 JWT 给不了。Access Token 虽然也是 RS256 签名，但 Nyauth 把它的元数据（用户、scope、auth_version、授权版本等）写进 Redis，`ValidateAccessToken` 在验签之后还要比对服务端元数据并做授权/策略检查，从而支持撤销、权限变化与重用检测。你可以在不放弃紧凑签名令牌的前提下，换来完整的状态控制。"
    },
    {
      "type": "quiz",
      "question": "两个并发请求几乎同时用同一个 Refresh Token 刷新，Nyauth（Redis Lua 原子脚本）的预期结果是？",
      "options": [
        "两个请求都成功，各得到一组新令牌",
        "两个请求都失败，family 完全不动",
        "恰好一个成功、另一个检出重用并撤销整个 family",
        "一个成功，另一个静默返回旧令牌而不做任何处理"
      ],
      "answer": 2,
      "explanation": "Lua 脚本的原子性保证只有一个请求能成功消费当前令牌；第二个请求发现当前令牌已转到 used，触发重用检测，撤销整条 family（连同关联的 access 元数据）。测试也断言了「1 成功、1 重用」。"
    },
    {
      "type": "exercise",
      "title": "画出双使用同一个 Refresh Token 的 Redis state 变化",
      "description": "设想客户端 A、B 同时用同一个 Refresh Token T0 刷新。请画出 Redis 中 family Set、当前 refresh key、used key、access 元数据 key 这四个状态在你的两次「操作区间」里的变化：第一个操作成功后各 key 是什么；第二个操作发现什么并如何改变各 key（包括 family Set、used、以及新写的 access 元数据）。最后说明为什么原子性是达成这个结果的前提。",
      "hint": "先写 T0 的当前状态；第一个操作把 T1 写入当前位、把 T0 记入 used、把新 access 元数据加入 family；第二个操作发现当前位已不是 T0 而是转到了 used，于是触发 revokeFamily——清空 family Set 里的所有成员（包括刚刚写入的 access 元数据）并写撤销标记。"
    },
    {
      "type": "keypoints",
      "items": [
        "轮换：每次刷新作废旧令牌、签发新令牌，压缩泄露面",
        "family：一族令牌共享 FamilyKey，单次授权生命周期内要么完好要么整体撤销",
        "重用检测：旧令牌二次出现 = 疑似盗窃，撤销整个 family 及其 access 元数据",
        "原子性：用 Redis Lua 一次性完成确认/写入/删除/撤销，杜绝并发双双成功",
        "JWT + 服务端元数据：支持撤销、策略检查与按 user/auth 版本整体失效",
        "认清边界：轮换能发现旧令牌重用，但无法区分「抢先使用未用令牌」的合法者与盗贼"
      ]
    }
  ]
};
