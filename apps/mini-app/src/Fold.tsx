// A tool row that unfolds in place (More, Progress, Training). Its content mounts only while open,
// so a tool that fetches on mount loads nothing until someone opens it.
import { Icon } from "./icons";

export function Fold({ title, meta, open, onToggle, children }: { title: string; meta?: React.ReactNode; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className={open ? "card fold open" : "card fold"}>
    <button type="button" className="fold-head" aria-expanded={open} onClick={onToggle}>
      <span className="grow">{title}</span>{meta}<Icon name="chevron" size={20} className={open ? "row-chevron open" : "row-chevron"} />
    </button>
    {open && <div className="fold-body">{children}</div>}
  </section>;
}
