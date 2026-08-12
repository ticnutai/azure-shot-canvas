import { Play, MoreHorizontal, Clock, Scissors, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const clips = [
  { title: "אונבורדינג למוצר", time: "04:12", tag: "וידאו", date: "היום" },
  { title: "באג בתשלום — שחזור", time: "01:48", tag: "וידאו", date: "אתמול" },
  { title: "דשבורד אנליטיקס", time: "PNG", tag: "צילום", date: "אתמול" },
  { title: "סקירת עיצוב חדש", time: "12:05", tag: "וידאו", date: "יום ג׳" },
];

export function LibraryStrip() {
  return (
    <section className="surface rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-black">הקלטות אחרונות</h2>
          <p className="text-xs text-muted-foreground">4 פריטים · מסונכרן</p>
        </div>
        <button className="text-xs font-bold text-primary">כל הספרייה</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {clips.map((c) => (
          <article key={c.title} className="group cursor-pointer">
            <div className="hairline relative aspect-video overflow-hidden rounded-2xl bg-[var(--gradient-navy)]">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_30%_20%,var(--color-gold),transparent_55%)]" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-card/70 backdrop-blur transition-transform group-hover:scale-110">
                  <Play className="size-4 text-primary" />
                </span>
              </div>
              <Badge
                variant="outline"
                className="absolute bottom-2 start-2 border-border bg-card/80 px-2 py-0.5 text-[10px]"
              >
                {c.time}
              </Badge>
            </div>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold leading-tight">{c.title}</h3>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock className="size-3" /> {c.date} · {c.tag}
                </p>
              </div>
              <div className="flex gap-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                <Scissors className="size-3.5" />
                <Share2 className="size-3.5" />
                <MoreHorizontal className="size-3.5" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
