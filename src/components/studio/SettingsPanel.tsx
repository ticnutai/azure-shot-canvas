import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HardDrive, Palette, Volume2, Crop } from "lucide-react";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <Label className="text-sm font-semibold">{label}</Label>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Picker({ items, value }: { items: string[]; value: string }) {
  return (
    <Select defaultValue={value}>
      <SelectTrigger className="w-[150px] rounded-xl border-border bg-card/60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i} value={i}>
            {i}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SettingsPanel() {
  return (
    <aside className="surface rounded-3xl p-5">
      <Tabs defaultValue="video">
        <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-secondary/60 p-1">
          <TabsTrigger value="video" className="rounded-xl text-xs font-bold">
            וידאו
          </TabsTrigger>
          <TabsTrigger value="audio" className="rounded-xl text-xs font-bold">
            אודיו
          </TabsTrigger>
          <TabsTrigger value="shot" className="rounded-xl text-xs font-bold">
            צילום
          </TabsTrigger>
        </TabsList>

        <TabsContent value="video" className="mt-4 divide-y divide-border">
          <Row label="רזולוציה" hint="איכות הפלט הסופי">
            <Picker items={["4K UHD", "1440p", "1080p", "720p"]} value="4K UHD" />
          </Row>
          <Row label="קצב פריימים">
            <Picker items={["24 fps", "30 fps", "60 fps", "120 fps"]} value="60 fps" />
          </Row>
          <Row label="פורמט">
            <Picker items={["MP4", "WebM", "MOV", "GIF"]} value="MP4" />
          </Row>
          <div className="py-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>ביטרייט</span>
              <span className="text-primary">24 Mbps</span>
            </div>
            <Slider defaultValue={[24]} max={80} step={2} />
          </div>
          <Row label="מצלמה מרחפת" hint="בועה עגולה על גבי המסך">
            <Switch defaultChecked />
          </Row>
          <Row label="זום אוטומטי לקליקים">
            <Switch defaultChecked />
          </Row>
        </TabsContent>

        <TabsContent value="audio" className="mt-4 divide-y divide-border">
          <Row label="מקור מיקרופון">
            <Picker items={["מיקרופון מובנה", "אוזניות USB", "ממשק אודיו"]} value="אוזניות USB" />
          </Row>
          <Row label="קול מערכת">
            <Switch defaultChecked />
          </Row>
          <div className="py-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Volume2 className="size-4 text-primary" /> עוצמת מיקרופון
              </span>
              <span className="text-primary">72%</span>
            </div>
            <Slider defaultValue={[72]} max={100} />
          </div>
          <Row label="ביטול רעשי רקע" hint="עיבוד חכם בזמן אמת">
            <Switch defaultChecked />
          </Row>
          <Row label="הסרת שתיקות">
            <Switch />
          </Row>
        </TabsContent>

        <TabsContent value="shot" className="mt-4 divide-y divide-border">
          <Row label="סוג לכידה">
            <Picker items={["אזור נבחר", "מסך מלא", "גלילה מלאה", "אלמנט"]} value="אזור נבחר" />
          </Row>
          <Row label="פורמט קובץ">
            <Picker items={["PNG", "JPG", "WEBP", "PDF"]} value="PNG" />
          </Row>
          <Row label="רקע מעוצב" hint="מסגרת גרדיאנט וצל">
            <Switch defaultChecked />
          </Row>
          <Row label="טשטוש מידע רגיש">
            <Switch defaultChecked />
          </Row>
          <div className="py-4">
            <div className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Crop className="size-4 text-primary" /> עיגול פינות
              </span>
              <span className="text-primary">18px</span>
            </div>
            <Slider defaultValue={[18]} max={48} />
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="hairline rounded-2xl bg-card/50 p-3">
          <HardDrive className="mb-2 size-4 text-primary" />
          <p className="text-xs text-muted-foreground">שטח פנוי</p>
          <p className="text-sm font-bold">128 GB</p>
        </div>
        <div className="hairline rounded-2xl bg-card/50 p-3">
          <Palette className="mb-2 size-4 text-primary" />
          <p className="text-xs text-muted-foreground">ערכת מותג</p>
          <p className="text-sm font-bold">זהב · נייבי</p>
        </div>
      </div>
    </aside>
  );
}
