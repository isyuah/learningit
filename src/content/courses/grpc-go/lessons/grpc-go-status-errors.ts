import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-status-errors",
  courseSlug: "grpc-go",
  title: "状态码与可处理的错误",
  summary:
    "用 gRPC status code 表达机器可判断的失败，并区分业务拒绝、调用取消、暂时不可用和真正的传输问题。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "客户端不应该通过解析错误字符串来决定是否重试、是否提示用户或是否报警。gRPC 提供了一组跨语言的 status code；服务端用它表达失败类别，客户端用 status.Code 读取类别，再按方法语义采取行动。",
    },
    {
      type: "heading",
      text: "从业务错误到 status",
    },
    {
      type: "code",
      title: "服务端返回可判断的错误",
      language: "go",
      code: 'func (s *catalogServer) GetBook(ctx context.Context, req *pb.GetBookRequest) (*pb.Book, error) {\n  if req.GetIsbn() == "" {\n    return nil, status.Error(codes.InvalidArgument, "isbn is required")\n  }\n\n  book, err := s.repo.Find(ctx, req.GetIsbn())\n  if errors.Is(err, ErrBookNotFound) {\n    return nil, status.Error(codes.NotFound, "book not found")\n  }\n  if err != nil {\n    return nil, status.Error(codes.Internal, "catalog repository failed")\n  }\n  return book, nil\n}',
    },
    {
      type: "paragraph",
      text: "对外返回的 message 应该足够帮助调用方处理，但不能把数据库连接串、堆栈或内部表名泄露给客户端。详细原因写入受控日志，status message 保持稳定、简洁并避免敏感数据。",
    },
    {
      type: "table",
      caption: "常见 status code 的决策含义",
      headers: ["code", "适合表达", "通常的客户端动作"],
      rows: [
        ["InvalidArgument", "请求字段或组合不合法", "修正请求，不要盲目重试"],
        ["NotFound", "目标资源不存在", "按产品语义提示或走创建流程"],
        ["Unauthenticated", "没有有效身份凭证", "刷新或补充凭证，再决定是否重试"],
        ["PermissionDenied", "身份存在但无权限", "不要自动重试，记录授权问题"],
        ["AlreadyExists", "创建目标已存在", "按幂等或冲突策略处理"],
        ["ResourceExhausted", "配额、限流或资源不足", "退避、降载或等待配额恢复"],
        ["Unavailable", "暂时不可用或连接路径失败", "仅在方法可重试时退避重试"],
        ["DeadlineExceeded", "调用预算耗尽", "检查依赖延迟和预算，不要机械重试"],
      ],
    },
    {
      type: "heading",
      text: "客户端要读取 code，而不是比较字符串",
    },
    {
      type: "code",
      title: "按错误类别分支",
      language: "go",
      code: 'book, err := client.GetBook(ctx, req)\nif err != nil {\n  switch status.Code(err) {\n  case codes.NotFound:\n    return showMissingBook()\n  case codes.InvalidArgument:\n    return fmt.Errorf("caller bug: %w", err)\n  case codes.DeadlineExceeded, codes.Unavailable:\n    return retryOrDegrade(ctx, err)\n  default:\n    return err\n  }\n}\nreturn render(book)',
    },
    {
      type: "paragraph",
      text: "status.Code 可以处理服务端返回的 status error，也能把某些 context 错误映射为 Canceled 或 DeadlineExceeded。不要把所有 Unknown 都当成网络断开：它可能是服务端返回了未分类的普通 error，也可能是中间层没有正确保留 status。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Internal 不是“所有异常”的垃圾桶",
      body: "Internal 适合表达服务内部故障，但输入不合法要用 InvalidArgument，资源不存在要用 NotFound，暂时过载要用 ResourceExhausted 或 Unavailable。分类越准确，客户端越能做出安全动作，监控也越有意义。",
    },
    {
      type: "heading",
      text: "错误码不是业务状态的全部",
    },
    {
      type: "paragraph",
      text: "一个订单被拒绝可能是 PermissionDenied，也可能需要在响应消息中给出字段级校验结果；一次批量上传可能整体返回 OK，但每条记录各有 accepted 或 rejected。status code 表达这次 RPC 的整体结果，细粒度业务结果仍应由 proto 消息建模。",
    },
    {
      type: "quiz",
      question: "客户端收到 InvalidArgument 时，最合理的默认动作是什么？",
      options: [
        "立即用相同请求无限重试",
        "把错误当作网络断开并切换 DNS",
        "修正调用方请求或报告参数问题，而不是盲目重试",
        "把错误改成 Internal 再返回",
      ],
      answer: 2,
      explanation:
        "InvalidArgument 表示请求本身不符合服务契约，重复发送相同请求不会修复它。客户端应定位参数问题或向用户展示可行动信息。",
    },
    {
      type: "exercise",
      title: "为错误分类",
      description:
        "为“ISBN 为空”“书不存在”“凭证过期”“仓库连接池耗尽”“批量中第 3 条记录格式错误”选择 status code 或响应消息设计，并说明客户端是否应该重试。",
      hint:
        "先判断是请求整体失败、身份/权限问题、暂时资源问题还是逐条业务结果，再选择表达方式。",
    },
    {
      type: "keypoints",
      items: [
        "status code 是跨语言、机器可判断的错误分类，不要解析错误字符串。",
        "服务端要把输入、资源、身份、权限、暂时不可用和内部故障区分开。",
        "status code 表达 RPC 整体结果，逐条业务结果应由消息建模。",
        "重试不是 code 的直接映射，还要结合幂等性、deadline 和负载。",
      ],
    },
  ],
};
