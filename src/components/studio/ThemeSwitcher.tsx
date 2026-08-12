import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const THEMES = [
  { id: "midnight", name: "נייבי זהב", swatches: ["#141b2e", "#e0b657", "#ffffff"] },
  { id: "porcelain", name: "פורצלן בהיר", swatches: ["#fbfaf7", "#d0a34e", "#2b3550"] },
  { id: "sky", name: "תכלת שמיים", swatches: ["#f0f6fd", "#3f74c9", "#2a3a5e"] },
  { id: "sand", name: "חול חמים", swatches: ["#f9f3e8", "#c07a45", "#4a3a2c"] },
  { id: "mint", name: "מנטה רענן", swatches: ["#f0faf6", "#3fa88c", "#25443f"] },
] as const;

const STORAGE_KEY = "aurum-theme";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<string>("midnight");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setTheme(saved);
      applyTheme(saved);
    }
  }, []);

  function applyTheme(id: string) {
    const root = document.documentElement;
    if (id === "midnight") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", id);
  }

  function pick(id: string) {
    setTheme(id);
    applyTheme(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-xl" aria-label="ערכות נושא">
          <Palette className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-2xl">
        <DropdownMenuLabel className="text-xs text-muted-foreground">ערכות נושא</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => pick(t.id)}
            className="flex cursor-pointer items-center gap-3 rounded-xl py-2"
          >
            <span className="flex gap-1">
              {t.swatches.map((c) => (
                <span
                  key={c}
                  className="size-3.5 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: c }}
                />
              ))}
            </span>
            <span className="flex-1 text-sm font-semibold">{t.name}</span>
            {theme === t.id && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
