const RUNTIME_EVENT = "biblioteca:mensaje";

export function announceRuntimeMessage(message: string, tone: "success" | "error" = "success") {
  document.dispatchEvent(new CustomEvent(RUNTIME_EVENT, { detail: { message, tone } }));
}

export function initializeDomRuntime() {
  const root = document.querySelector<HTMLElement>("#root");
  if (!root) return () => undefined;

  document.querySelectorAll("[data-runtime-toast]").forEach((node) => node.remove());
  root.setAttribute("data-runtime-personalization", "active");
  root.classList.add("runtime-ready");

  const onMessage = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string; tone: "success" | "error" }>).detail;
    document.querySelectorAll("[data-runtime-toast]").forEach((node) => node.remove());

    const toast = document.createElement("div");
    toast.classList.add("runtime-toast", `runtime-toast--${detail.tone}`);
    toast.setAttribute("role", detail.tone === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("data-runtime-toast", "true");
    toast.textContent = detail.message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  };

  const onClick = (event: Event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
    if (!button) return;
    document.querySelectorAll("button[data-dom-active='true']").forEach((node) => {
      node.classList.remove("dom-active");
      node.removeAttribute("data-dom-active");
    });
    button.classList.add("dom-active");
    button.setAttribute("data-dom-active", "true");
  };

  document.addEventListener(RUNTIME_EVENT, onMessage);
  root.addEventListener("click", onClick);

  return () => {
    document.removeEventListener(RUNTIME_EVENT, onMessage);
    root.removeEventListener("click", onClick);
    root.classList.remove("runtime-ready");
    root.removeAttribute("data-runtime-personalization");
    document.querySelectorAll("[data-runtime-toast]").forEach((node) => node.remove());
  };
}
