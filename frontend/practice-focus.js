// A navegação é a mesma do portal. O dialog nativo cuida da modalidade, Escape e Tab.
// Abrir/fechar não chama render nem toca no modelo da tentativa.
export function mountPracticeNavigation() {
  const dialog = document.getElementById("practice-navigation");
  const trigger = document.getElementById("practice-menu-toggle");
  if (!dialog || !trigger) return;
  dialog.append(document.querySelector(".layout > .sidebar"));
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
