import { useEffect, useState } from "react";
import { t, type Lang } from "../i18n";
import type { ExerciseImageMatch } from "../logic/exerciseImages";

// Start and end frames of the exercise (free-exercise-db, Unlicense) above the technique notes.
// The id index and the name table (~30 KB) load on the first info-panel open, not with the logger.
type Matcher = { match: (name: string, canonicalName?: string) => ExerciseImageMatch | null; urls: (id: string) => string[] };
let matcher: Promise<Matcher> | null = null;
function loadMatcher(): Promise<Matcher> {
  matcher ??= Promise.all([import("../data/freeExerciseIds"), import("../logic/exerciseImages")]).then(([data, lib]) => ({
    match: lib.makeImageMatcher(data.FREE_EXERCISE_IDS),
    urls: (id: string) => lib.exerciseImageUrls(id, data.FREE_EXERCISE_DB_COMMIT),
  }));
  return matcher;
}

export function TechniqueFrames({ lang, name, canonicalName }: { lang: Lang; name: string; canonicalName?: string }) {
  const [found, setFound] = useState<{ match: ExerciseImageMatch; urls: string[] } | null>(null);
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let live = true;
    setFound(null);
    setFailed(0);
    loadMatcher()
      .then(({ match, urls }) => {
        const m = match(name, canonicalName);
        if (live && m) setFound({ match: m, urls: urls(m.id) });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [name, canonicalName]);

  // Hide the block rather than show broken images (offline, CDN blocked).
  if (!found || failed >= found.urls.length) return null;
  return (
    <figure className="technique-frames">
      <div>
        {found.urls.map((url, i) => (
          <img key={url} src={url} alt={`${found.match.title} — ${i + 1}/2`} loading="lazy" decoding="async" onError={() => setFailed((n) => n + 1)} />
        ))}
      </div>
      <figcaption>
        {t(lang, found.match.exact ? "technique_frames_exact" : "technique_frames_similar", { name: found.match.title })}
      </figcaption>
    </figure>
  );
}
