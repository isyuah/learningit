import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export function NotFoundPage() {
  return (
    <div className="wrap py-24">
      <EmptyState
        title="404 · 页面不存在"
        description="你访问的地址不存在或已被移动。检查链接，或回到首页继续。"
        action={
          <LinkButton to="/" variant="secondary">
            返回首页
          </LinkButton>
        }
      />
    </div>
  );
}
