import { MSG } from "./messages";

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { position: fixed; inset: 0; z-index: 2147483000; background: #0b0b0c; color: #f4f4f5;
  font: 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  display: flex; flex-direction: column; }
.stage { position: relative; flex: 1; overflow: hidden; }
.mirror { position: absolute; inset: 0; transform: scaleX(-1); }
.mirror video, .mirror canvas, .mirror .debug { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.mirror .debug { pointer-events: none; }
.status { position: absolute; left: 50%; top: 18px; transform: translateX(-50%); max-width: calc(100% - 96px);
  background: rgba(0,0,0,.55); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  padding: 8px 14px; border-radius: 999px; font-size: 14px; text-align: center; transition: opacity .2s; }
.status:empty { opacity: 0; }
.error { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; padding: 32px; text-align: center; }
.error.on { display: flex; }
.error p { max-width: 340px; margin: 0; font-size: 16px; }
.close { position: absolute; top: 12px; right: 12px; width: 40px; height: 40px; border-radius: 50%; border: 0;
  background: rgba(0,0,0,.55); color: #fff; font-size: 22px; line-height: 40px; cursor: pointer; }
.close:focus-visible, button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.bar { padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #0b0b0c; display: flex; flex-direction: column; gap: 10px; }
.title { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.chip { flex: none; padding: 7px 12px; border-radius: 999px; border: 1px solid #3f3f46; background: transparent; color: #e4e4e7; font-size: 13px; cursor: pointer; }
.chip[aria-pressed="true"] { border-color: #fff; background: #fff; color: #0b0b0c; }
.actions { display: flex; gap: 10px; }
.btn { flex: 1; padding: 12px; border-radius: 10px; border: 1px solid #3f3f46; background: transparent; color: #fff; font-size: 15px; cursor: pointer; }
.btn.primary { background: var(--vm-accent, #fff); color: var(--vm-accent-text, #0b0b0c); border-color: transparent; font-weight: 600; }
.btn[disabled] { opacity: .5; cursor: default; }
.note { font-size: 12px; color: #a1a1aa; }
.note a { color: #e4e4e7; }
.stats { position: absolute; left: 8px; bottom: 8px; font: 11px/1.3 ui-monospace, Menlo, monospace; background: rgba(0,0,0,.6); padding: 6px 8px; border-radius: 6px; white-space: pre; }
@media (min-width: 900px) { .root { padding: 24px; background: rgba(0,0,0,.85); }
  .stage, .bar { max-width: 960px; width: 100%; margin: 0 auto; } .stage { border-radius: 14px 14px 0 0; } .bar { border-radius: 0 0 14px 14px; } }
`;

export interface Ui {
  host: HTMLElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  debugCanvas: HTMLCanvasElement;
  setStatus(text: string): void;
  showError(text: string): void;
  setStats(text: string | null): void;
  setVariants(items: { key: string; label: string; selected: boolean }[], onPick: (key: string) => void): void;
  setGlassesToggle(visible: boolean): void;
  setCart(state: "hidden" | "idle" | "busy" | "done" | "error", cartUrl?: string): void;
  onClose(fn: () => void): void;
  onToggleGlasses(fn: () => void): void;
  onAddToCart(fn: () => void): void;
  destroy(): void;
}

export function createUi(opts: { productTitle: string; accentColor?: string; accentTextColor?: string }): Ui {
  const host = document.createElement("div");
  host.setAttribute("data-virtual-mirror", "");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="root" role="dialog" aria-modal="true" aria-label="${MSG.title}">
      <div class="stage">
        <div class="mirror">
          <video muted playsinline autoplay></video>
          <canvas class="gl"></canvas>
          <canvas class="debug" hidden></canvas>
        </div>
        <div class="status" role="status" aria-live="polite"></div>
        <div class="error" role="alert"><p></p></div>
        <div class="stats" hidden></div>
        <button class="close" type="button" aria-label="${MSG.close}">×</button>
      </div>
      <div class="bar">
        <div class="title"></div>
        <div class="chips" role="group" aria-label="Colours"></div>
        <div class="actions">
          <button class="btn toggle" type="button">${MSG.hide}</button>
          <button class="btn primary cart" type="button">${MSG.addToCart}</button>
        </div>
        <div class="note">${MSG.disclaimer} <span class="cartlink"></span></div>
      </div>
    </div>`;
  const $ = <T extends Element>(sel: string) => shadow.querySelector(sel) as T;
  const root = $<HTMLDivElement>(".root");
  if (opts.accentColor) root.style.setProperty("--vm-accent", opts.accentColor);
  if (opts.accentTextColor) root.style.setProperty("--vm-accent-text", opts.accentTextColor);
  $<HTMLDivElement>(".title").textContent = opts.productTitle;

  const status = $<HTMLDivElement>(".status");
  const error = $<HTMLDivElement>(".error");
  const stats = $<HTMLDivElement>(".stats");
  const chips = $<HTMLDivElement>(".chips");
  const toggle = $<HTMLButtonElement>(".toggle");
  const cart = $<HTMLButtonElement>(".cart");
  const cartLink = $<HTMLSpanElement>(".cartlink");
  const close = $<HTMLButtonElement>(".close");

  const previousOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  document.body.appendChild(host);
  close.focus();

  const closeHandlers: (() => void)[] = [];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeHandlers.forEach((f) => f());
  };
  window.addEventListener("keydown", onKey);
  close.addEventListener("click", () => closeHandlers.forEach((f) => f()));

  return {
    host,
    video: $<HTMLVideoElement>("video"),
    canvas: $<HTMLCanvasElement>("canvas.gl"),
    debugCanvas: $<HTMLCanvasElement>("canvas.debug"),
    setStatus: (t) => (status.textContent = t),
    showError(t) {
      error.querySelector("p")!.textContent = t;
      error.classList.add("on");
      status.textContent = "";
    },
    setStats(t) {
      stats.hidden = t === null;
      stats.textContent = t ?? "";
    },
    setVariants(items, onPick) {
      chips.replaceChildren(
        ...items.map((it) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.textContent = it.label;
          b.setAttribute("aria-pressed", String(it.selected));
          b.addEventListener("click", () => onPick(it.key));
          return b;
        }),
      );
      chips.hidden = items.length < 2;
    },
    setGlassesToggle: (visible) => (toggle.textContent = visible ? MSG.hide : MSG.show),
    setCart(state, cartUrl) {
      cart.hidden = state === "hidden";
      cart.disabled = state === "busy" || state === "done";
      cart.textContent = state === "busy" ? MSG.adding : state === "done" ? MSG.added : MSG.addToCart;
      cartLink.replaceChildren();
      if (state === "done" && cartUrl) {
        const a = document.createElement("a");
        a.href = cartUrl;
        a.textContent = MSG.viewCart;
        cartLink.append(a);
      }
      if (state === "error") cartLink.textContent = MSG.errors.cartFailed;
    },
    onClose: (fn) => closeHandlers.push(fn),
    onToggleGlasses: (fn) => toggle.addEventListener("click", fn),
    onAddToCart: (fn) => cart.addEventListener("click", fn),
    destroy() {
      window.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = previousOverflow;
      host.remove();
    },
  };
}
