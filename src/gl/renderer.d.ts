import type { MapDoc, Marker, ZoneLabel } from "../data/loader";

export interface CamReadout {
  az: number; // degrees
  el: number; // degrees
  dist: number; // metres
}

export interface RendererOptions {
  glCanvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  stage: HTMLElement;
  catBy: Record<string, { g: string; col: string }>;
  floorCol: Record<number, string>;
  zoneText: (z: ZoneLabel) => string;
  onHover?: (hit: Marker | null, x: number, y: number) => void;
  onCamera?: (cam: CamReadout) => void;
  /** how many collision volumes were dropped for sitting under the floor */
  onCull?: (culled: number) => void;
  onNoWebGL?: () => void;
}

export interface Renderer {
  setMap(doc: MapDoc, keepCamera?: boolean): void;
  setFloors(set: Iterable<number>): void;
  setCats(set: Iterable<string>): void;
  setNav(on: boolean): void;
  setZones(on: boolean): void;
  floors(): Set<number>;
  resetCam(): void;
  zoomBy(factor: number): void;
  flyTo(tx: number, ty: number, half: number): void;
  resize(): void;
  draw(): void;
  dispose(): void;
}

export function createRenderer(o: RendererOptions): Renderer;
