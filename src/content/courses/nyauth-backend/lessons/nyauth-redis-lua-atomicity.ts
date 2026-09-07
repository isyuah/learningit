/* ==================================================================
 * 课时：Redis Lua 与 Refresh Token 原子轮换（nyauth-redis-lua-atomicity）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。
 * 权威来源：internal/session/store.go（rotateRefreshScript、
 * rotateRefreshWithAccessScript、RotateRefreshTokenAndStoreAccess）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-redis-lua-atomicity",
  "courseSlug": "nyauth-backend",
  "title": "Redis Lua 与 Refresh Token 原子轮换",
  "summary": "多条普通 redis 命令会交错；Lua 把整段操作变成 Redis 内的一个原子边界。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一章我们处理了 PostgreSQL 里的并发。这一章转到 Redis 侧的并发：如果一次刷新操作要「确认旧 token、删旧的、写新的、写 access 元数据、维护 family 索引」共五六个步骤，用普通 redis 命令逐个发会怎样？答案是——两个并发请求的命令会在 Redis 里互相交错，产生竞态。nyauth 把这一整套操作塞进一个 **Lua 脚本**，让 Redis 在脚本内部单线程、原子地执行，从而把竞态消除在数据结构层。"
    },
    {
      "type": "heading",
      "text": "为什么多条普通命令会交错"
    },
    {
      "type": "paragraph",
      "text": "Redis 是单线程执行命令的，但这不等于「一组命令原子」。两个客户端各发三条命令时，第 1 个客户端的第 2 条命令和第 2 个客户端的第 1 条命令很可能在 Redis 里交替执行。只要你的业务流程跨越了多条命令，它们就可能被别的客户端插进中间。Redis 的事务（MULTI/EXEC）能保证「整组排队执行、不被插入」，但那是「打包执行」，并不天然提供你要的 compare-and-swap 逻辑——你仍然要自己判断在执行期读到的值是否符合预期。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "Pipeline ≠ 原子性",
      "body": "Pipeline 只是「减少往返」（一次网络往返发多条命令），它不改变命令在服务端逐条执行的本质，也不提供任何业务级原子性。Lua 脚本才是「在 Redis 内、单线程地、原子地完成一组带判断逻辑的操作」的正确工具——它把 compare-and-swap、删除、转移、撤销一次完成。"
    },
    {
      "type": "heading",
      "text": "Redis 里用到的几类操作"
    },
    {
      "type": "paragraph",
      "text": "先建立一个操作词汇表，它们都是 Refresh Token 轮换的基础构件："
    },
    {
      "type": "table",
      "caption": "Refresh Token 相关的 Redis 操作",
      "headers": ["操作", "用途", "nyauth 中的体现"],
      "rows": [
        ["SET + TTL / PX", "存短期 secret / 元数据并自动过期", "refresh、token、code 的 key 都带 TTL"],
        ["Set（SADD / SMEMBERS / SREM）", "维护集合成员，快速遍历某个 family", "refresh-family:key 的成员集合"],
        ["DEL + SET 标记已用", "把旧 token 删除或标记为已用", "rotate 时 DEL 旧 key、SET refresh-used"],
        ["Sorted Set", "按过期时间排序、便于清理/统计", "需要按 TTL 清理的场景"],
        ["Pipeline", "减少往返，不提供业务原子性", "SaveRefreshToken 的批量 SET/SADD/EXPIRE"],
        ["Lua 脚本", "在 Redis 内原子完成带判断的多步操作", "rotateRefreshScript / rotateRefreshWithAccessScript"]
      ]
    },
    {
      "type": "heading",
      "text": "Refresh Token 轮换需要原子地做什么"
    },
    {
      "type": "paragraph",
      "text": "Refresh Token 轮换不是「换一把 token」那么简单，它同时要完成六件相互关联的事，任何一步被并发插队都会破坏安全语义。这正是 Lua 脚本一次完成的全部内容："
    },
    {
      "type": "list",
      "items": [
        "确认旧 token 仍是当前 token（读旧 key，compare 预期值）",
        "删除或标记旧 token 为已使用（DEL 旧 key、SET refresh-used）",
        "写入新的 refresh token",
        "写入关联的 access token 元数据",
        "维护 family 索引（从 family 集合移除旧、加入新）",
        "如果发现旧 token 被重用，撤销整个 family"
      ]
    },
    {
      "type": "code",
      "title": "rotateRefreshScript 的逻辑概览（忠实于源码结构，简化表示）",
      "language": "lua",
      "code": "-- KEYS[1]=旧 refresh key  KEYS[2]=新 refresh key\n-- KEYS[3]=used key       KEYS[4]=user-families set\nlocal current = redis.call(\"GET\", KEYS[1])\nif not current then\n    local used = redis.call(\"GET\", KEYS[3])\n    if not used then return {0, \"\"} end          -- 都不存在\n    if used ~= expected then return {-3, \"\"} end -- 绑定不匹配\n    return revokeFamily(used)                      -- 重用!撤销整个 family\nend\nif current ~= expected then return {-3, \"\"} end   -- 旧值不符\nif family 已被 revoked 标记 then return revokeFamily(current) end\nredis.call(\"SET\", KEYS[2], current, \"PX\", ttl)   -- 写新 token\nredis.call(\"SADD\", familySet, KEYS[2])\nredis.call(\"SREM\", familySet, KEYS[1])            -- 维护 family 索引\nredis.call(\"DEL\", KEYS[1])                        -- 删旧 key\nredis.call(\"SET\", KEYS[3], current, \"PX\", ttl)   -- 标记旧 token 已用\nreturn {1, current}"
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "为什么要撤销整个 family 而不是只拒绝这一次",
      "body": "Refresh Token 轮换是「一次性」凭证：正常使用后旧 token 立即失效并换新。如果攻击者已经偷走了某个旧 token 并抢先轮换，合法用户再用旧 token 时系统发现「旧 token 已用、且值与预期不符」——这说明有第二方在竞争这个 token，极可能被盗用。此时仅仅拒绝这一次是不安全的：正确的做法是撤销这个 token 所属的整个 family，让这一系列衍生 token 全部失效，迫使重新认证。Lua 脚本在检测到重用分支时会遍历 family 集合、DEL 所有成员并恢复 revoked 标记。"
    },
    {
      "type": "heading",
      "text": "为什么 Redis 元数据和 JWT 一起存在"
    },
    {
      "type": "paragraph",
      "text": "这呼应了数据归属一课的结论：Access Token 元数据的权威是「Redis + JWT」联合。JWT 让协议方无需回访即可离线验签，但它无法表达「已撤销」；Redis 里的 token 元数据（含 family key、auth_version、client 授权 revision）正是服务端在线判断撤销与策略的载体。一旦 family 被撤销，脚本会删除所有成员 key——旧与新 access 元数据一并失效，服务端据此拒绝后续请求。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么模拟器（mock）证明不了 Redis-Lua 的一致性",
      "body": "Redis Lua 的原子性来自「Redis 在单线程里执行整个脚本、期间不插入其它命令」这一运行时承诺。你用模拟 Redis（如 miniredis）或对它做单机 mock 测试，验证的是脚本的返回值逻辑，而不是真实 Redis 的原子执行语义——mock 单线程串行当然不出竞态。真正要证明并发安全，靠的是集成测试跑在真实 Redis 上、同时并发重放同一 token，证明只有一个轮换成功、其余走撤销分支。这也是项目把并发测试放在真实 Redis 上的原因。"
    },
    {
      "type": "paragraph",
      "text": "Go 侧用 `redis.NewScript(...)` 声明脚本，通过 `rotateRefreshWithAccessScript.Run(ctx, rdb, keys, args)` 执行，再把返回的状态码交给 `decodeRefreshRotationResult` 映射成语义化错误：`{0,-1,-2,-3}` 分别对应 `ErrNotFound`、`ErrRefreshTokenReuse`（family 已撤销）、`ErrInvalidTokenData`、`ErrTokenBindingMismatch`。这样一次调用就把「轮换 + access 元数据写入 + 复用检测 + family 撤销」作为一个原子单位返回给上层。"
    },
    {
      "type": "quiz",
      "question": "两个并发请求同时携带同一个 Refresh Token 去轮换。Lua 脚本内部会发生什么？",
      "options": [
        "两个请求都可能成功，各自得到新 token",
        "先执行的一个成功轮换并标记旧 token 已用；后执行的一个检测到旧值不符/已用，走 family 撤销分支",
        "两个请求都失败且什么都不改变",
        "Redis 会报错拒绝执行第二个脚本"
      ],
      "answer": 1,
      "explanation": "Lua 在 Redis 内单线程原子执行：第一个请求轮换成功后，旧 key 被标记已用；第二个请求读到旧 key 已不存在而 used 键存在且值不符，判定为重放并撤销整个 family。这正是一次性 token 的预期安全语义。"
    },
    {
      "type": "exercise",
      "title": "画出并发使用同一 Refresh Token 时 Redis 的 key 变化",
      "description": "设 refresh-family:F 初始只有成员 key R_old（值是 TokenData A）。现两个并发请求都携带 R_old 轮换。请逐步写出失败分支生效前后，下列 key 的变化：refresh:R_old（旧 token 键）、refresh-used:R_old、refresh:R_new1 / refresh:R_new2（两个新 token 键）、refresh-family:F 集合、refresh-revoked:F（family 撤销标记）。",
      "hint": "第一个请求：DEL refresh:R_old、写 refresh:R_new1、把 family 成员替换为 R_new1、SET refresh-used:R_old。第二个请求发现旧 key 不在→used 值不符→revokeFamily：遍历 F 删除成员（含 R_new1）、DEL family 集合、SET 撤销标记。"
    },
    {
      "type": "keypoints",
      "items": [
        "单条 Redis 命令是原子的，但一组命令会交错；业务多步操作需要原子边界",
        "Pipeline 只减少往返，不提供业务原子性；Pipeline ≠ 业务原子",
        "Lua 脚本让 Redis 单线程、原子地执行整套带判断的多步操作（CAS/删/写/转移/撤销）",
        "Refresh Token 轮换一次完成：确认旧值→删旧→写新 token→写 access 元数据→维护 family→复用检测",
        "检测到旧 token 重用会撤销整个 family，迫使重新认证",
        "Redis 元数据与 JWT 互补：JWT 离线可验签，Redis 支持在线撤销与策略检查",
        "模拟器证明不了真实 Redis 的原子性；并发安全要靠真实 Redis 上的集成测试"
      ]
    }
  ]
};
