// Catálogo dos simulados. Para adicionar um conjunto, crie seu arquivo e registre-o aqui.
import { exam as exam01 } from "./practice-exams/clf-c02-01.js";
import { exam as exam02 } from "./practice-exams/clf-c02-02.js";

export const practiceMetadata = {
  title: "AWS Cloud Practitioner", code: "CLF-C02", minutes: 90,
  guideUrl: "https://docs.aws.amazon.com/pt_br/aws-certification/latest/cloud-practitioner-02/cloud-practitioner-02.html",
};
export const practiceDomains = [
  { id: "1", title: "Conceitos de nuvem", weight: 24 },
  { id: "2", title: "Segurança e conformidade", weight: 30 },
  { id: "3", title: "Tecnologia e serviços da nuvem", weight: 34 },
  { id: "4", title: "Cobrança, preços e suporte", weight: 12 },
];
export const practiceExams = [exam01, exam02];
export const defaultPracticeExamId = exam01.id;
export const practiceExamById = (id) => practiceExams.find((exam) => exam.id === id);
