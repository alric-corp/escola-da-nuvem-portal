// Formato comum aos simulados. Conteúdo e gabaritos ficam nos arquivos de cada conjunto.
// Algumas páginas de produto sob /pt/ ainda servem inglês. Nesses casos, usar o manual PT-BR.
const localizedPages = {
  "https://aws.amazon.com/pt/aws-cost-management/aws-cost-explorer/": "https://docs.aws.amazon.com/pt_br/cost-management/latest/userguide/ce-what-is.html",
  "https://aws.amazon.com/pt/vpn/site-to-site-vpn/": "https://docs.aws.amazon.com/pt_br/vpn/latest/s2svpn/VPC_VPN.html",
  "https://aws.amazon.com/pt/vpn/client-vpn/": "https://docs.aws.amazon.com/pt_br/vpn/latest/clientvpn-admin/what-is.html",
  "https://aws.amazon.com/pt/managed-services/benefits/": "https://aws.amazon.com/pt/managed-services/",
  "https://aws.amazon.com/pt/developer/tools/": "https://docs.aws.amazon.com/pt_br/sdkref/latest/guide/overview.html",
  "https://aws.amazon.com/pt/aws-cost-management/aws-pricing-calculator/": "https://docs.aws.amazon.com/pt_br/pricing-calculator/latest/userguide/what-is-pricing-calculator.html",
  "https://aws.amazon.com/pt/quicksight/": "https://aws.amazon.com/pt/quick/quicksight/",
};
export function ptBrSource(value) {
  const url = new URL(value);
  if (url.hostname === "aws.amazon.com" && !url.pathname.startsWith("/pt/")) url.pathname = `/pt${url.pathname}`;
  if (url.hostname === "docs.aws.amazon.com" && !url.pathname.startsWith("/pt_br/")) {
    url.pathname = `/pt_br${url.pathname.replace(/^\/(?:en_us|en_en)\//, "/")}`;
  }
  return localizedPages[url.href] || url.href;
}
export const aws = (service) => `https://aws.amazon.com/pt/${service}/`;
export const shared = aws("compliance/shared-responsibility-model");
export const caf = "https://docs.aws.amazon.com/pt_br/whitepapers/latest/overview-aws-cloud-adoption-framework/foundational-capabilities.html";
export const wa = aws("architecture/well-architected");
export const q = (id, task, prompt, correct, labels, explanations, source, note = "") => ({
  id, task, domain: task[0], prompt, correct: correct.split(""),
  options: labels.map((text, index) => ({ id: "ABCDE"[index], text, explanation: explanations[index] })),
  source: ptBrSource(source), note,
});
