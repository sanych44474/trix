// Weekly training load on a body silhouette (react-body-highlighter, MIT): front and back views,
// each region coloured by where its weekly working sets sit against MEV/MAV. Tap a muscle to see
// that region's numbers. The bars below it stay the precise view; this is the at-a-glance one.
import { useState } from "react";
import Model, { type IMuscleStats } from "react-body-highlighter";
import { t, type Key, type Lang } from "./i18n";
import { bodyMapData, regionOfMuscle, type Region } from "./logic/bodyMap";

// Index = zone frequency - 1: below MEV, in range, above MAV.
const ZONE_COLORS = ["#6b7488", "#ff5f3d", "#ffb020"];

export function BodyMap({ lang, volume }: { lang: Lang; volume: Array<{ group: string; sets: number; mev: number; mav: number; zone: string }> }) {
  const [picked, setPicked] = useState<Region | null>(null);
  const data = bodyMapData(volume);
  const onClick = (stats: IMuscleStats) => setPicked(regionOfMuscle(stats.muscle));
  const row = picked ? volume.find((v) => v.group === picked) : undefined;
  const common = { data, highlightedColors: ZONE_COLORS, bodyColor: "var(--body-map-base)", onClick, svgStyle: { width: "100%", height: "auto" } };
  return (
    <div className="body-map">
      <div className="body-map-figures">
        <figure><Model {...common} type="anterior" /><figcaption>{t(lang, "body_map_front")}</figcaption></figure>
        <figure><Model {...common} type="posterior" /><figcaption>{t(lang, "body_map_back")}</figcaption></figure>
      </div>
      <div className="body-map-legend">
        {(["below", "optimal", "above"] as const).map((zone, i) => (
          <span key={zone}><i style={{ background: ZONE_COLORS[i] }} />{t(lang, `zone_${zone}` as Key)}</span>
        ))}
      </div>
      <p className="muted body-map-detail">
        {picked
          ? row
            ? t(lang, "body_map_detail", { group: t(lang, `mg_${picked}` as Key), n: row.sets, mev: row.mev, mav: row.mav })
            : t(lang, "body_map_untrained", { group: t(lang, `mg_${picked}` as Key) })
          : t(lang, "body_map_hint")}
      </p>
    </div>
  );
}
