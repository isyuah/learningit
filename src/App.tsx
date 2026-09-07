import { useEffect } from "react";
import { Route, Routes, useLocation, useParams } from "react-router-dom";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { HomePage } from "@/pages/home";
import { CoursePage } from "@/pages/course";
import { LessonPage } from "@/pages/lesson";
import { ComponentsPage } from "@/pages/components";
import { GuidePage } from "@/pages/guide";
import { NotFoundPage } from "@/pages/not-found";

/** 路由切换时回到顶部（或滚动到 #hash 锚点） */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash);
      if (el) {
        window.scrollTo({ top: (el as HTMLElement).offsetTop - 88, behavior: "smooth" });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollManager />
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

function CoursePageRoute() {
  const { courseSlug } = useParams();
  return <CoursePage courseSlug={courseSlug ?? ""} />;
}

function LessonPageRoute() {
  const { courseSlug, lessonSlug } = useParams();
  return <LessonPage courseSlug={courseSlug ?? ""} lessonSlug={lessonSlug ?? ""} />;
}

export default function App() {
  return (
    <PageShell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/courses/:courseSlug" element={<CoursePageRoute />} />
        <Route
          path="/courses/:courseSlug/lessons/:lessonSlug"
          element={<LessonPageRoute />}
        />
        <Route path="/components" element={<ComponentsPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </PageShell>
  );
}
