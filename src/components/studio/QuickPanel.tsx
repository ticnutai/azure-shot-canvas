import { Keyboard, Zap, Cloud, Wand2 } from "lucide-react";

const shortcuts = [
  { keys: "⌘ ⇧ R", label: "התחל / עצור הקלטה" },
  { keys: "⌘ ⇧ P", label: "השהיה" },
  { keys: "⌘ ⇧ 4", label: "צילום אזור" },
  { keys: "⌘ ⇧ M", label: "השתקת מיקרופון" },
];

const stats = [
  { icon: Zap, label: "האצת חומרה", value: "פעילה" },
  { icon: Cloud, label: "העלאה אוטומטית", value: "ענן" },
  { icon: Wand2, label: "כתוביות AI", value: "עברית" },
];

export function QuickPanel() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="surface rounded-3xl p-5 lg:col-span-2">
        <h2 className="mb-4 flex items-center gap-2 text-base font-black">
          <Keyboard className="size-4 text-primary" /> קיצורי מקלדת
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {shortcuts.map((s) => (
            <div
              key={s.keys}
              className="hairline flex items-center justify-between rounded-2xl bg-card/50 px-4 py-3"
            >
              <span className="text-sm">{s.label}</span>
              <kbd className="rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-primary">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>

      <div className="surface flex flex-col gap-3 rounded-3xl p-5">
        <h2 className="text-base font-black">מצב המערכת</h2>
        {stats.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="hairline flex size-9 items-center justify-center rounded-xl bg-card/60">
              <Icon className="size-4 text-primary" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-[11px] text-muted-foreground">{value}</p>
            </div>
            <span className="size-2 rounded-full bg-primary" />
          </div>
        ))}
      </div>
    </div>
  );
}
