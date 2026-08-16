/* The viewport: two stacked canvases, the control legend, the zoom buttons and
 * the hover tooltip.
 *
 * Preact owns none of the drawing. It creates the renderer once, hands it the
 * canvases, and afterwards only pushes state into it -- which arena, which
 * floors, which categories. Everything the renderer wants to say back (a marker
 * under the cursor, how many volumes it dropped) comes out as a callback and
 * lands in ordinary component state.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { createRenderer } from "../gl/renderer.js";
import type { Renderer } from "../gl/renderer";
import type { MapDoc, Marker } from "../data/loader";
import { CAT_BY, FLOOR_COL, prettyZone } from "../catalog";
import { t } from "../i18n";

interface Props {
  doc: MapDoc | null;
  cats: Set<string>;
  floors: Set<number>;
  nav: boolean;
  zones: boolean;
  onNoWebGL: () => void;
}

interface Hover {
  hit: Marker;
  x: number;
  y: number;
}

/** What the tooltip is allowed to grow to; mirrors `.tip` in style.css. */
const TIP_W = 300;
const tipWidth = (el: HTMLElement | null) =>
  Math.min(TIP_W, (el?.clientWidth ?? TIP_W) - 16);

export function Stage(p: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const glc = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const rend = useRef<Renderer | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  // Callbacks the renderer holds for its whole life, so they must not close
  // over props that change. Everything they touch is a setState or a ref.
  const cbs = useRef(p);
  cbs.current = p;

  useEffect(() => {
    const r = createRenderer({
      glCanvas: glc.current!,
      overlay: overlay.current!,
      stage: stage.current!,
      catBy: CAT_BY,
      floorCol: FLOOR_COL,
      zoneText: (z) => prettyZone(z.z),
      onHover: (hit, x, y) => setHover(hit ? { hit, x, y } : null),
      // onCamera is left unsubscribed on purpose: nothing shows the azimuth and
      // distance any more, and taking them would re-render the component on
      // every frame of a drag to update something nobody reads.
      onNoWebGL: () => cbs.current.onNoWebGL(),
    });
    rend.current = r;
    r.resize();
    const ro = new ResizeObserver(() => r.resize());
    ro.observe(stage.current!);
    return () => { ro.disconnect(); r.dispose(); rend.current = null; };
  }, []);

  // A new arena resets the renderer's floor set to everything it has, so the
  // filters go in after it, never before.
  useEffect(() => {
    if (!p.doc || !rend.current) return;
    const r = rend.current;
    r.setMap(p.doc);
    r.setFloors(p.floors);
    r.setCats(p.cats);
    r.setNav(p.nav);
    r.setZones(p.zones);
    setHover(null);
  }, [p.doc]);

  useEffect(() => { rend.current?.setCats(p.cats); }, [p.cats]);
  useEffect(() => { rend.current?.setFloors(p.floors); }, [p.floors]);
  useEffect(() => { rend.current?.setNav(p.nav); }, [p.nav]);
  useEffect(() => { rend.current?.setZones(p.zones); }, [p.zones]);

  // A category the catalog does not know about still has to say something, and
  // the raw id from the level is more useful than a missing-key placeholder.
  const catLabel = (id: string) => (CAT_BY[id] ? t("cat." + id) : id);

  return (
    <div class="stage" ref={stage}>
      <canvas id="gl" ref={glc} />
      <canvas id="cv" ref={overlay} />

      {/* Names the arena on screen, and is the page's h2. It reads as a caption
          and it is also the phrase someone searching for this one arena would
          type -- the two wants happen to be the same sentence. */}
      {p.doc && (
        <h2 class="stagehead">
          {t("seo.mapHeading", { name: t("map." + p.doc.key) })}
        </h2>
      )}

      {hover && (
        <div
          class="tip"
          // Down-right of the pointer, but never off the stage: on a phone the
          // tooltip is nearly as wide as the viewport and a tap near the right
          // edge or near the bottom would otherwise put it out of reach. TIP_W
          // has to match the max-width in the stylesheet.
          style={{
            left: Math.max(
              8,
              Math.min(
                hover.x + 16,
                (stage.current?.clientWidth ?? 0) - tipWidth(stage.current) - 8,
              ),
            ),
            top:
              hover.y + 16 > (stage.current?.clientHeight ?? 0) - 140
                ? Math.max(8, hover.y - 132)
                : hover.y + 16,
          }}
        >
          <b>
            {catLabel(hover.hit.c)}
            {hover.hit.k && hover.hit.k > 1 ? ` ×${hover.hit.k}` : ""}
          </b>
          {hover.hit.n && (
            <div class="tipname">
              {hover.hit.n}
              {hover.hit.k && hover.hit.k > 1
                ? ", " + t("tip.andOthers", { n: hover.hit.k - 1 })
                : ""}
            </div>
          )}
          <div>
            <i>{t("tip.zone")}</i> {hover.hit.z0 ? prettyZone(hover.hit.z0) : "-"}
            &nbsp;&nbsp;<i>{t("tip.level")}</i> {hover.hit.f}
          </div>
          <div>
            <i>X</i> {hover.hit.x.toFixed(1)} <i>Y</i> {(hover.hit.y ?? 0).toFixed(1)}{" "}
            <i>Z</i> {hover.hit.zz.toFixed(1)}
          </div>
        </div>
      )}

      <div class="zoomers">
        <button title={t("hud.zoomIn")} onClick={() => rend.current?.zoomBy(1 / 1.3)}>
          +
        </button>
        <button title={t("hud.zoomOut")} onClick={() => rend.current?.zoomBy(1.3)}>
          −
        </button>
        <button class="wide" onClick={() => rend.current?.resetCam()}>
          {t("hud.recenter")}
        </button>
      </div>

      {/* How to move the map, in the corner where the camera readout used to be.
          The readout was three numbers that told a visitor nothing they could
          act on; what nobody guesses on their own is that the right button
          turns the view and that a marker can be clicked. Both pointers get the
          same four lines, worded for the device actually in use. */}
      <div class="hud">
        <div class="gestures bymouse">
          {["pan", "zoom", "tilt", "click"].map((k) => (
            <p key={k}>{t("mouse." + k)}</p>
          ))}
        </div>
        <div class="gestures bytouch">
          {["pan", "zoom", "tilt", "tap"].map((k) => (
            <p key={k}>{t("touch." + k)}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
