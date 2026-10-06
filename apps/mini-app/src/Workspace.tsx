import { useState } from "react";
import { t } from "./i18n";
import { workspaceSpaces, type Space } from "./logic/workspace";
import type { WorkspaceProps } from "./workspace/shared";
import { OwnerWorkspace } from "./workspace/OwnerWorkspace";
import { SocialWorkspace } from "./workspace/SocialWorkspace";
import { TrainerWorkspace } from "./workspace/TrainerWorkspace";

export function WorkspaceView({ dashboard, lang, onOpenPlan }: WorkspaceProps) {
  const spaces = workspaceSpaces(dashboard.viewer.role, !!dashboard.owner);
  const [space, setSpace] = useState<Space>(spaces[0].id);
  const active = spaces.some((s) => s.id === space) ? space : spaces[0].id;
  return <div className="view-stack">
    {spaces.length > 1 && <div className="button-row tabs">
      {spaces.map((s) => <button key={s.id} className={active === s.id ? "button button-primary" : "button button-ghost"} onClick={() => setSpace(s.id)}>{t(lang, s.label)}</button>)}
    </div>}
    {active === "owner" && <OwnerWorkspace lang={lang} />}
    {active === "trainer" && <TrainerWorkspace dashboard={dashboard} lang={lang} onOpenPlan={onOpenPlan} />}
    {active === "social" && <SocialWorkspace lang={lang} role={dashboard.viewer.role} />}
  </div>;
}
