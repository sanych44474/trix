// Injury area → label key (shared by the injury menu and the data export).
import type { t } from "../locales/i18n";

type TKey = Parameters<typeof t>[1];

export const INJURY_AREA_LABEL: Record<string, TKey> = {
  shoulder: "inj_area_shoulder", elbow: "inj_area_elbow", wrist: "inj_area_wrist",
  lower_back: "inj_area_lower_back", knee: "inj_area_knee", hip: "inj_area_hip",
  ankle: "inj_area_ankle", neck: "inj_area_neck",
};
export const areaLabelKey = (area: string): TKey => INJURY_AREA_LABEL[area] ?? "inj_area_shoulder";
