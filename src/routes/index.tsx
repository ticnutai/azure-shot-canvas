import { createFileRoute } from "@tanstack/react-router";
import { StudioSidebar } from "@/components/studio/StudioSidebar";
import { TopBar } from "@/components/studio/TopBar";
import { CaptureStage } from "@/components/studio/CaptureStage";
import { SettingsPanel } from "@/components/studio/SettingsPanel";
import { LibraryStrip } from "@/components/studio/LibraryStrip";
import { QuickPanel } from "@/components/studio/QuickPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "אורום סטודיו — סטודיו הקלטת מסך ווידאו" },
      {
        name: "description",
        content:
          "סטודיו מקצועי להקלטת מסך, מצלמה וצילומי מסך: 4K, 60fps, אודיו חכם, קיצורי מקלדת וספריית קליפים.",
      },
      { property: "og:title", content: "אורום סטודיו — סטודיו הקלטת מסך ווידאו" },
      {
        property: "og:description",
        content: "סטודיו מקצועי להקלטת מסך, מצלמה וצילומי מסך: 4K, 60fps, אודיו חכם, קיצורי מקלדת וספריית קליפים.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Studio,
});

function Studio() {
  return (
    <div className="flex min-h-screen">
      <StudioSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="grid flex-1 gap-5 p-5 md:p-8 xl:grid-cols-[1fr_360px]">
          <div className="flex min-w-0 flex-col gap-5">
            <CaptureStage />
            <LibraryStrip />
            <QuickPanel />
          </div>
          <SettingsPanel />
        </main>
      </div>
    </div>
  );
}
