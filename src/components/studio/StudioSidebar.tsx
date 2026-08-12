import {
  Clapperboard,
  Camera,
  Scissors,
  Library,
  Sparkles,
  Settings2,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { icon: Clapperboard, label: "הקלטה", active: true },
  { icon: Camera, label: "צילומי מסך" },
  { icon: Scissors, label: "עריכה" },
  { icon: Library, label: "ספרייה" },
  { icon: Sparkles, label: "אפקטים" },
  { icon: Settings2, label: "הגדרות" },
];

export function StudioSidebar() {
  return (
    <aside className="hidden w-[86px] shrink-0 flex-col items-center gap-2 border-l border-border bg-sidebar py-6 lg:flex">
      <div className="gold-fill mb-6 flex size-11 items-center justify-center rounded-2xl text-lg font-black shadow-[var(--shadow-gold)]">
        א
      </div>

      {items.map(({ icon: Icon, label, active }) => (
        <button
          key={label}
          className={cn(
            "group flex w-[70px] flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-[11px] font-semibold text-muted-foreground transition-all",
            "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            active && "bg-sidebar-accent text-primary hairline",
          )}
        >
          <Icon className="size-5 transition-transform group-hover:-translate-y-0.5" />
          {label}
        </button>
      ))}

      <div className="mt-auto">
        <button className="flex size-11 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground">
          <LifeBuoy className="size-5" />
        </button>
      </div>
    </aside>
  );
}
