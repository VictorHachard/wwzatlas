import { render } from "preact";
import { App } from "./app";
import { currentLang, preferredRedirect } from "./i18n";
import "./style.css";

/* A visitor landing on the English root who reads something else should get
   their language, once. The redirect only fires when the URL carries no
   language of its own and the visitor has never picked one explicitly, so it
   can never fight a shared link or a deliberate choice. */
const to = preferredRedirect();
if (to) {
  location.replace(to);
} else {
  const lang = currentLang();
  document.documentElement.lang = lang.tag;

  /* The build writes a readable version of this page into #root: the heading,
     the five arenas as links, what the atlas is. It is there for whoever reads
     the page without running the script -- a crawler that does not render, a
     preview card, a browser still fetching 700 kB of geometry -- and the app
     says the same things once it is up. Clearing it first means Preact starts
     from an empty container instead of appending underneath the copy. */
  const root = document.getElementById("root")!;
  root.textContent = "";
  render(<App />, root);
}
