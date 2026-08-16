/* Reading the page out of the path, and writing it back.
 *
 * Two things live in the path: the language and the arena. Both have to be
 * separate documents to a search engine -- /fr/tokyo/ is not /tokyo/ and not
 * /fr/ -- and both are what someone pastes into a chat when they mean "look at
 * this one". The filters stay in the hash (see state.ts): they are a view of a
 * page, not a page of their own, and there is no useful search result for
 * "Tokyo with only the lootboxes ticked".
 *
 * The parser accepts only what the build emits and falls back rather than
 * throwing on anything else, because the one thing worse than landing on the
 * wrong arena is landing on a blank screen.
 */
import langs from "./i18n/langs.json";
import { arenaByPath, type Arena } from "./arenas";

const BASE = import.meta.env.BASE_URL; // "/wwzatlas/" on Pages, "/" in dev
const SEGS = new Set(langs.map((l) => l.seg).filter(Boolean));

export interface Route {
  /** the language segment, or null when the path named none -- which is
   *  English, and is also the state `preferredRedirect` is allowed to act on */
  seg: string | null;
  arena: Arena | null;
}

function parts(pathname: string): string[] {
  const rest = pathname.startsWith(BASE)
    ? pathname.slice(BASE.length)
    : pathname.replace(/^\//, "");
  return rest.split("/").filter(Boolean).map((s) => s.toLowerCase());
}

export function parseRoute(pathname: string = location.pathname): Route {
  const p = parts(pathname);
  const seg = p.length && SEGS.has(p[0]) ? p.shift()! : null;
  return { seg, arena: (p.length && arenaByPath(p[0])) || null };
}

/** Absolute path for a language and an arena. `seg` is "" for English; a null
 *  arena is the language root, which is a real page and not a redirect. */
export function hrefFor(
  seg: string,
  arena: Arena | null,
  hash: string = location.hash,
): string {
  return BASE + (seg ? seg + "/" : "") + (arena ? arena.path + "/" : "") + hash;
}
