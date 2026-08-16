/* Eleven locales, one flat dictionary each, resolved at build time.
 *
 * The set matches the languages World War Z itself ships in, so a player
 * reading the atlas sees the same words the game uses. English is the
 * fallback for any key a translation has not caught up with yet.
 *
 * Language lives in the URL path (/fr/, /pt-br/ ...), not in a query string
 * or in storage, because that is what search engines index and what people
 * paste to each other. Switching language is a real navigation; the map state
 * rides along in the hash, which survives it.
 */
import langs from "./langs.json";
import { hrefFor, parseRoute } from "../route";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import es from "./locales/es.json";
import it from "./locales/it.json";
import pl from "./locales/pl.json";
import ptBR from "./locales/pt-br.json";
import ru from "./locales/ru.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zhHans from "./locales/zh-hans.json";

export type Dict = Record<string, string>;

/** `tag` is the BCP-47 tag for <html lang> and Intl; `seg` is the URL segment. */
export interface Lang {
  seg: string;
  tag: string;
  name: string;
  dict: Dict;
}

/* langs.json is the one list of languages this site has. The build reads it
   too, to emit a shell page and an hreflang set per language, so adding a
   locale means adding a line there and a file in locales/ -- and nothing else
   can silently disagree about which languages exist. The dictionaries are
   still imported statically, because the bundler has to see them. */
const DICTS: Record<string, Dict> = {
  "": en, fr, de, es, it, pl, "pt-br": ptBR, ru, ja, ko, "zh-hans": zhHans,
};

export const LANGS: Lang[] = langs.map((l) => {
  const dict = DICTS[l.seg];
  if (!dict) throw new Error(`langs.json lists "${l.seg}" with no dictionary`);
  return { ...l, dict };
});

/** Best match for what the browser asks for: exact tag, then bare language. */
function segFromNavigator(): string | null {
  for (const pref of navigator.languages ?? [navigator.language]) {
    const low = pref.toLowerCase();
    const exact = LANGS.find((l) => l.tag.toLowerCase() === low);
    if (exact) return exact.seg;
    const bare = low.split("-")[0];
    // pt on its own goes to pt-BR: it is the only Portuguese we have
    const loose = LANGS.find((l) => l.tag.toLowerCase().split("-")[0] === bare);
    if (loose) return loose.seg;
  }
  return null;
}

export function currentLang(): Lang {
  const seg = parseRoute().seg;
  if (seg !== null) return LANGS.find((l) => l.seg === seg)!;
  return LANGS[0];
}

/** Where a visitor with no language in the URL would rather be, or null. */
export function preferredRedirect(): string | null {
  if (parseRoute().seg !== null) return null;
  if (localStorage.getItem("lang.pinned")) return null;
  const seg = segFromNavigator();
  return seg ? urlFor(seg) : null;
}

/** Absolute path for a language, staying on the arena and the filters the
 *  visitor is looking at: changing language is a full page load, and landing
 *  back on the default arena would throw away what they came for. */
export function urlFor(seg: string): string {
  return hrefFor(seg, parseRoute().arena, location.hash);
}

const dict = currentLang().dict as Dict;

/** Look up a key, substituting {name} placeholders. Missing keys fall back to
 *  English, then to the key itself so a gap is visible rather than blank. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? (en as Dict)[key] ?? key;
  if (vars) {
    for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  }
  return s;
}

/** Numbers read very differently across these eleven locales; let Intl do it. */
const nf = new Intl.NumberFormat(currentLang().tag);
export const num = (n: number) => nf.format(n);
