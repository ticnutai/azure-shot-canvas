import { Bell, Search, ChevronDown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeSwitcher } from "./ThemeSwitcher";

export function TopBar() {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 md:px-8">
      <div className="flex items-center gap-3">
        <div className="gold-fill flex size-9 items-center justify-center rounded-xl text-sm font-black lg:hidden">
          א
        </div>
        <div>
          <h1 className="text-lg font-black leading-none">
            אורום <span className="gold-text">סטודיו</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">הקלטת מסך, מצלמה וצילומים — בשליטה מלאה</p>
        </div>
      </div>

      <div className="order-3 flex w-full items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-muted-foreground md:order-none md:mx-auto md:w-auto md:min-w-[320px]">
        <Search className="size-4" />
        <input
          placeholder="חיפוש בהקלטות, קליפים ותבניות…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[10px] md:inline">
          ⌘K
        </kbd>
      </div>

      <div className="ms-auto flex items-center gap-2">
        <Badge className="gold-fill hidden border-0 px-3 py-1 text-[11px] font-bold sm:inline-flex">
          <Sparkles className="me-1 size-3" /> PRO
        </Badge>
        <ThemeSwitcher />
        <Button variant="ghost" size="icon" className="rounded-xl">
          <Bell className="size-4" />
        </Button>
        <button className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-2 py-1.5 text-sm">
          <span className="gold-fill flex size-7 items-center justify-center rounded-lg text-xs font-bold">
            ד
          </span>
          <span className="hidden sm:inline">דניאל</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}
