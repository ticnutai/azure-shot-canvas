import { useEffect, useState } from "react";
import {
  Play,
  Square,
  Pause,
  Monitor,
  AppWindow,
  Chrome,
  Video,
  Mic,
  MicOff,
  Camera,
  MousePointer2,
  Timer,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const sources = [
  { icon: Monitor, label: "מסך מלא" },
  { icon: AppWindow, label: "חלון" },
  { icon: Chrome, label: "לשונית" },
  { icon: Video, label: "מצלמה" },
];

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function CaptureStage() {
  const [source, setSource] = useState("מסך מלא");
  const [state, setState] = useState<"idle" | "recording" | "paused">("idle");
  const [seconds, setSeconds] = useState(0);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);

  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  return (
    <section className="surface relative overflow-hidden rounded-3xl">
      {/* source picker */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        {sources.map(({ icon: Icon, label }) => (
          <button
            key={label}
            onClick={() => setSource(label)}
            className={cn(
              "flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-all hover:text-foreground",
              source === label && "gold-fill border-transparent shadow-[var(--shadow-gold)]",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
        <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Timer className="size-4" />
          ספירה לאחור 3 שניות
        </div>
      </div>

      {/* preview */}
      <div className="relative aspect-video w-full bg-[var(--gradient-navy)]">
        <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_left,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:44px_44px]" />

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="hairline flex size-16 items-center justify-center rounded-2xl bg-card/70">
            <Monitor className="size-7 text-primary" />
          </div>
          <p className="text-sm font-semibold">תצוגה מקדימה — {source}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            בחר מקור קליטה, כוון את ההגדרות בצד ולחץ על הקלטה כדי להתחיל
          </p>
        </div>

        {/* status chips */}
        <div className="absolute start-4 top-4 flex items-center gap-2">
          {state === "recording" && (
            <Badge className="border-0 bg-destructive px-3 py-1 text-[11px] font-bold text-destructive-foreground">
              <span className="live-dot me-1.5 inline-block size-2 rounded-full bg-destructive-foreground" />
              מקליט
            </Badge>
          )}
          <Badge variant="outline" className="border-border bg-card/70 px-3 py-1 text-[11px]">
            4K · 60fps
          </Badge>
          <Badge variant="outline" className="border-border bg-card/70 px-3 py-1 text-[11px]">
            {formatTime(seconds)}
          </Badge>
        </div>

        <button className="hairline absolute end-4 top-4 flex size-9 items-center justify-center rounded-xl bg-card/70 text-muted-foreground transition-colors hover:text-foreground">
          <Maximize2 className="size-4" />
        </button>

        {/* camera bubble */}
        {cam && (
          <div className="hairline absolute bottom-5 end-5 flex size-24 items-center justify-center rounded-full bg-card/80 backdrop-blur">
            <Camera className="size-6 text-primary" />
          </div>
        )}

        {/* audio meter */}
        <div className="absolute bottom-5 start-5 flex items-end gap-1">
          {[6, 14, 22, 12, 18, 9, 16].map((h, i) => (
            <span
              key={i}
              className="wave-bar w-1.5 rounded-full bg-primary/80"
              style={{ height: h + 8, animationDelay: `${i * 0.09}s` }}
            />
          ))}
        </div>
      </div>

      {/* transport */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <Button
          size="lg"
          className={cn(
            "rounded-2xl px-6 font-bold",
            state === "idle" ? "gold-fill hover:opacity-90" : "",
          )}
          variant={state === "idle" ? "default" : "destructive"}
          onClick={() => {
            if (state === "idle") {
              setSeconds(0);
              setState("recording");
            } else {
              setState("idle");
            }
          }}
        >
          {state === "idle" ? (
            <>
              <Play className="me-2 size-4" /> התחל הקלטה
            </>
          ) : (
            <>
              <Square className="me-2 size-4" /> עצור
            </>
          )}
        </Button>

        <Button
          variant="secondary"
          size="lg"
          className="rounded-2xl"
          disabled={state === "idle"}
          onClick={() => setState((s) => (s === "recording" ? "paused" : "recording"))}
        >
          <Pause className="me-2 size-4" />
          {state === "paused" ? "המשך" : "השהה"}
        </Button>

        <div className="ms-auto flex items-center gap-2">
          <ToggleChip active={mic} onClick={() => setMic(!mic)} icon={mic ? Mic : MicOff}>
            מיקרופון
          </ToggleChip>
          <ToggleChip active={cam} onClick={() => setCam(!cam)} icon={Camera}>
            מצלמה
          </ToggleChip>
          <ToggleChip active icon={MousePointer2}>
            הדגשת עכבר
          </ToggleChip>
        </div>
      </div>
    </section>
  );
}

function ToggleChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold transition-all",
        active ? "border-primary/40 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}
