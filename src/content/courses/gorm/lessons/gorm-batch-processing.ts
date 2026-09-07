import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-batch-processing",
  courseSlug: "gorm",
  title: "批处理、FindInBatches 与资源释放",
  summary: "用受控批次处理大数据量，设计事务、进度、重试、内存与连接占用边界。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "一次把百万行 Find 进内存，或者在一个事务里更新几个小时，都不是“代码短”就能掩盖的工程问题。批处理的目标是建立可控边界：每批数据量、单批事务时间、失败恢复位置、连接占用和进度记录都必须可以解释。",
    },
    {
      type: "heading",
      text: "泛型 FindInBatches",
    },
    {
      type: "code",
      title: "逐批归档旧文章",
      language: "go",
      code: `func ArchiveOldPosts(ctx context.Context, db *gorm.DB, cutoff time.Time) error {
    return gorm.G[Post](db).
        Where("status = ? AND created_at < ?", "published", cutoff).
        Order("id").
        FindInBatches(ctx, 500, func(posts []Post, batch int) error {
            ids := make([]uint, 0, len(posts))
            for _, post := range posts {
                ids = append(ids, post.ID)
            }

            rows, err := gorm.G[Post](db).
                Where("id IN ? AND status = ?", ids, "published").
                Update(ctx, "status", "archived")
            if err != nil {
                return fmt.Errorf("archive batch %d: %w", batch, err)
            }
            if rows != len(ids) {
                return fmt.Errorf("batch %d changed concurrently", batch)
            }
            return nil
        })
}`,
    },
    {
      type: "paragraph",
      text: "回调返回 error 会停止后续批次。每一批 Find 结束后才能释放该查询占用的资源；回调里如果再做慢网络调用，会拉长整体任务并占用工作连接。大批任务通常把外部副作用拆成独立队列，而不是在数据库遍历回调里同步执行。",
    },
    {
      type: "heading",
      text: "传统 API 的批处理语义",
    },
    {
      type: "code",
      title: "传统 FindInBatches",
      language: "go",
      code: `var posts []Post
result := db.WithContext(ctx).
    Where("status = ?", "draft").
    FindInBatches(&posts, 500, func(tx *gorm.DB, batch int) error {
        // posts 是当前批次；tx.RowsAffected 是当前查询批次
        // result.RowsAffected 在结束后表示总查询行数
        return process(posts)
    })
if result.Error != nil {
    return result.Error
}`,
    },
    {
      type: "paragraph",
      text: "泛型回调直接收到 []T，传统回调通过外部切片接收数据。无论哪种 API，都不要把切片元素地址长期保存后假设下一批不会复用内存；需要跨批保留时复制必要字段。",
    },
    {
      type: "heading",
      text: "批次不等于事务",
    },
    {
      type: "table",
      caption: "常见事务边界",
      headers: ["策略", "优点", "风险/适用范围"],
      rows: [
        ["整个任务一个事务", "全局原子", "长事务、锁和 undo 膨胀，只适合很小任务"],
        ["每批一个事务", "失败定位清晰，锁持有短", "任务整体部分成功，需要可恢复进度"],
        ["每行一个事务", "失败隔离最细", "吞吐差、连接和事务开销大"],
        ["只读扫描 + 异步任务", "数据库遍历快，外部副作用解耦", "需要队列幂等和投递一致性设计"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要用 OFFSET 做无限增长表的长期进度",
      body: "数据同时插入、删除或状态变化时，OFFSET 可能跳行或重复，而且越往后扫描成本越高。长期任务优先使用稳定排序键做 keyset：WHERE id > last_id ORDER BY id LIMIT N，并持久化 last_id。",
    },
    {
      type: "heading",
      text: "可恢复批任务需要进度与幂等",
    },
    {
      type: "code",
      title: "Keyset 进度模型",
      language: "go",
      code: `for {
    posts, err := gorm.G[Post](db).
        Where("id > ? AND status = ?", lastID, "draft").
        Order("id").
        Limit(500).
        Find(ctx)
    if err != nil {
        return err
    }
    if len(posts) == 0 {
        break
    }

    if err := processIdempotently(ctx, posts); err != nil {
        return err
    }
    lastID = posts[len(posts)-1].ID
    if err := saveCheckpoint(lastID); err != nil {
        return err
    }
}`,
    },
    {
      type: "paragraph",
      text: "检查点保存也会失败，因此 processIdempotently 必须允许同一批重放。常见做法是用唯一业务键、处理状态和条件更新避免重复副作用。仅在内存记录 batch 编号无法支持进程崩溃后的恢复。",
    },
    {
      type: "heading",
      text: "Rows 流式扫描何时适用",
    },
    {
      type: "paragraph",
      text: "Rows 适合需要完全自定义扫描、每行处理很轻且能快速释放连接的场景。它要求手动 Close 和 rows.Err，并且整个遍历期间通常占用一个连接。FindInBatches 在每批之间释放查询结果，更容易控制内存、检查点和重试，是业务批任务更稳妥的默认选择。",
    },
    {
      type: "heading",
      text: "批次大小如何确定",
    },
    {
      type: "list",
      items: [
        "记录宽度与关联数量：同样 500 行，字段和对象图大小可能差十倍。",
        "数据库参数/包大小上限：INSERT/IN 列表过大会失败或解析缓慢。",
        "单批事务时长与锁冲突：以 P95/P99 而不是本地平均值判断。",
        "应用内存和 GC：观察峰值驻留与分配，不只看吞吐。",
        "失败重试成本：批次越大，失败后的重复工作越多。",
      ],
    },
    {
      type: "quiz",
      question: "一个会持续有新数据写入的百万行表，需要可恢复地顺序处理，优先采用哪种分页？",
      options: [
        "按稳定主键做 keyset，并持久化 last_id",
        "不断增加 OFFSET",
        "一次 Find 全表",
        "不排序，每次随机 Limit",
      ],
      answer: 0,
      explanation: "稳定 keyset 避免 OFFSET 的扫描成本和并发变化导致的跳行，并能形成可持久化检查点。",
    },
    {
      type: "exercise",
      title: "设计评论反垃圾回扫任务",
      description: "对 5000 万条 Comment 重新计算 spam_score。要求任务可暂停、可恢复、可水平分片，单批失败可重试，且不长时间持有事务。写出排序键、检查点、幂等更新、监控指标和限速策略。",
      hint: "先选不可变或单调的分片/排序键，再把扫描、计算、条件写和检查点拆成独立责任。",
    },
    {
      type: "keypoints",
      items: [
        "FindInBatches 用受控内存处理大结果；回调 error 会停止后续批次。",
        "批次边界与事务边界是两个决策，长任务通常采用每批短事务。",
        "无限增长表优先 keyset 分页，检查点需要持久化。",
        "可恢复任务必须允许检查点写入失败后的批次重放，因此处理要幂等。",
        "Rows 会长期占用连接并要求手动释放，业务批任务通常优先 FindInBatches。",
        "批次大小由方言限制、内存、锁、延迟和重试成本共同决定。",
      ],
    },
  ],
};
