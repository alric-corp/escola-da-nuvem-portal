// Links "Abrir no Canvas". O backend anota em cada atividade o item de módulo do Canvas
// (canvasUrl), lido pela API do curso configurado na turma (todo/12). Aqui só se valida
// que o endereço é mesmo um item de módulo do Canvas antes de exibi-lo.
const moduleItem = /^https:\/\/awsrestart\.instructure\.com\/courses\/\d+\/modules\/items\/\d+$/;

export function canvasActivityLink(activity) {
  if (!["pending", "completed"].includes(activity.state)) return null;
  const url = activity.canvasUrl;
  if (typeof url !== "string" || !moduleItem.test(url)) return null;
  return {
    url,
    label: activity.state === "completed"
      ? "Ver atividade no Canvas"
      : `Abrir ${activity.kind === "kc" ? "KC" : "LAB"} no Canvas`,
  };
}
