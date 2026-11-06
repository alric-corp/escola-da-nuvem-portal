// A navegação é a mesma do portal. O dialog nativo cuida da modalidade, Escape e Tab.
// Abrir/fechar não chama render nem toca no modelo da tentativa.
export function mountPracticeNavigation() {
  const dialog = document.getElementById("practice-navigation");
  const trigger = document.getElementById("practice-menu-toggle");
  if (!dialog || !trigger) return;
  dialog.append(document.querySelector(".layout > .sidebar"));
  // O painel é modal: circular entre os controles evita que Tab leve o foco à barra do navegador.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !dialog.open) return;
    const controls = [...dialog.querySelectorAll("a[href], button, select, input, [tabindex]")]
      .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener("close", () => {
    trigger.setAttribute("aria-expanded", "false");
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  });
}
export function openPracticeNavigation() {
  const dialog = document.getElementById("practice-navigation");
  if (!dialog || dialog.open) return;
  dialog.showModal();
  document.getElementById("practice-menu-toggle").setAttribute("aria-expanded", "true");
  dialog.querySelector("[data-practice-menu-close]").focus({ preventScroll: true });
}
export function closePracticeNavigation() {
  document.getElementById("practice-navigation")?.close();
}
