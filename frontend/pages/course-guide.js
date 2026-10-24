import { courseGuideContent as content } from "../course-guide-content.js";
import { state } from "../state.js";
import { e, heading, icon } from "../ui.js";

const external = (url, label, className = "text-link") =>
  `<a class="${className}" href="${e(url)}" target="_blank" rel="noopener noreferrer" aria-label="${e(label)} (abre em nova aba)">${e(label)} ${icon("external", 16)}</a>`;
const documentLink = (document, className = "text-link") =>
  external(document.url, `${document.label} (${document.format})`, className);
const paragraphs = (items) => items.map((text) => `<p>${e(text)}</p>`).join("");
const disclosures = (items) => `<div class="cg-details">${items.map((item) => `<details><summary>${e(item.title)}</summary><div class="cg-detail-body">${paragraphs(item.paragraphs)}</div></details>`).join("")}</div>`;

function rules() {
  return `<p class="cg-scope">${e(content.scope)}</p>
    <section class="cg-section" aria-labelledby="cg-graduation"><h2 id="cg-graduation">Requisitos de graduação</h2>
      <dl class="cg-requirements">${content.graduation.map((item) => `<div><dt>${e(item.title)}</dt><dd>${e(item.text)}</dd></div>`).join("")}</dl>
      <p class="cg-emphasis">${e(content.kcReminder)}</p>
      <p class="small">${e(content.graduationContext)}</p>
    </section>
    <section class="cg-section" aria-labelledby="cg-voucher"><h2 id="cg-voucher">Requisitos para o voucher AWS</h2><ul class="cg-list">${content.voucher.map((text) => `<li>${e(text)}</li>`).join("")}</ul><p class="small">${e(content.voucherNote)}</p></section>
    <section class="cg-section" aria-labelledby="cg-orientations"><h2 id="cg-orientations">Orientações complementares</h2>${disclosures(content.orientations)}</section>`;
}

function support() {
  return `<p class="cg-timezone">${icon("clock", 16)} ${e(content.metadata.timeZoneLabel)}</p><div class="cg-card-grid">${content.support.map((item) => `<article class="cg-card" aria-labelledby="cg-${item.id}"><h2 id="cg-${item.id}">${e(item.title)}</h2><p>${e(item.description)}</p>${item.complement ? `<p class="small">${e(item.complement)}</p>` : ""}${item.schedule.length ? `<ul class="cg-schedule">${item.schedule.map((text) => `<li>${e(text)}</li>`).join("")}</ul>` : ""}<div class="cg-card-action">${external(item.url, item.action, "button primary")}</div></article>`).join("")}</div>`;
}

function requests() {
  return `<ol class="cg-steps">${content.requestSteps.map((item, index) => `<li><article class="cg-card" aria-labelledby="cg-request-${index}"><span class="cg-step-number" aria-hidden="true">${index + 1}</span><h2 id="cg-request-${index}">${e(item.title)}</h2><p>${e(item.description)}</p><p class="small">${e(item.note)}</p><div class="cg-card-action">${external(item.url, item.action, "button primary")}${index === 1 ? documentLink(content.documents.normative) : ""}</div>${item.availabilityNote ? `<p class="small">${e(item.availabilityNote)}</p>` : ""}</article></li>`).join("")}</ol>
    <section class="cg-section" aria-labelledby="cg-videos"><h2 id="cg-videos">Vídeos de orientação</h2><ul class="cg-videos">${content.videos.map((video) => `<li>${external(video.url, video.title)}</li>`).join("")}</ul></section>
    <section class="cg-section" aria-labelledby="cg-before-request"><h2 id="cg-before-request">Leia antes de solicitar</h2><ul class="cg-list">${content.normativeSummary.map((text) => `<li>${e(text)}</li>`).join("")}</ul><div class="cg-document">${documentLink(content.documents.normative, "button secondary")}<p class="small">${e(content.documents.normative.description)}</p></div>${disclosures(content.normativeSections)}</section>`;
}

// Conteúdo informativo não depende da turma, do relatório acadêmico ou de rede.
export function courseGuidePage() {
  const selected = content.tabs.some((tab) => tab.id === state.guideTab) ? state.guideTab : "rules";
  const panels = { rules: rules(), support: support(), requests: requests() };
  return `<div class="course-guide">${heading("", content.title, content.description)}
    <div class="cg-tabs" role="tablist" aria-label="Seções do Guia do curso" aria-orientation="horizontal">${content.tabs.map((tab) => `<button type="button" role="tab" id="guide-tab-${tab.id}" data-guide-tab="${tab.id}" aria-controls="guide-panel-${tab.id}" aria-selected="${selected === tab.id}" tabindex="${selected === tab.id ? "0" : "-1"}">${e(tab.label)}</button>`).join("")}</div>
    ${content.tabs.map((tab) => `<section class="cg-panel" role="tabpanel" id="guide-panel-${tab.id}" aria-labelledby="guide-tab-${tab.id}" tabindex="0"${selected === tab.id ? "" : " hidden"}>${panels[tab.id]}</section>`).join("")}
  </div>`;
}
