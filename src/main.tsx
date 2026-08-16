import { render } from "preact";
import { App } from "./app";
import { currentLang, preferredRedirect, t } from "./i18n";
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
  // the build already stamps this into each shell; set it again so `npm run
  // dev`, which serves the untouched template, shows the same thing
  document.title = t("seo.h1") + " - " + t("app.title");
  render(<App />, document.getElementById("root")!);
}
