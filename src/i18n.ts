// Minimal inline localisation. Each user-facing string is written at its call
// site as tr("English", "한국어"); the active language picks which to show.
// More languages can be added later by widening Lang and the tr signature.
export type Lang = "en" | "ko";

let current: Lang =
  typeof localStorage !== "undefined" && localStorage.getItem("pg-lang") === "en" ? "en" : "ko";

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem("pg-lang", lang);
  } catch {
    // storage may be unavailable; the choice just won't persist
  }
}

/** Returns the string for the active language. */
export function tr(en: string, ko: string): string {
  return current === "ko" ? ko : en;
}
