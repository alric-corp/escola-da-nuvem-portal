// Teste isolado com API fictícia. Nunca abre Canvas nem acessa dados AWS.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve("frontend/dist");
const previewDir = path.join(os.tmpdir(), "avanca-preview");
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    res.setHeader("Content-Type", ({ ".js": "text/javascript", ".json": "application/json", ".html": "text/html", ".css": "text/css" })[path.extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let role = "student", focus = { activityIds: [], version: null }, saved = 0;
  const activity = (id, name, kind, state, percent = null) => ({id,name,kind,state,percent,active:state !== "unreleased",points:"100"});
  const activities = [
    activity("linux", "226-LX-KC - Uma introdução ao Linux", "kc", "pending"),
    activity("network", "254-NF- KC Introdução à rede", "kc", "pending"),
    activity("python", "119- PF -KC - Introdução ao Python", "kc", "pending"),
    activity("cert", "195-CERT-KC -Preparação da Certificação do Cenário de Avaliação", "kc", "pending"),
    activity("zero", "10- CF - KC — Introdução ao Amazon S3", "kc", "completed", 0),
    activity("lowlab", "11--Lab - Introdução ao Amazon EC2", "lab", "completed", 94),
    activity("ok", "12- CF -KC — Introdução ao Amazon EC2", "kc", "completed", 70),
    activity("future", "225--Lab - Introdução ao Linux", "lab", "unreleased", 0),
    activity("exempt", "227--Lab - Linha de comando do Linux", "lab", "exempt", 0),
    activity("unknown", "999-KC - Atividade de teste sem módulo", "kc", "completed", 100),
  ];
  const student = {id:"1",name:"Ana Teste",email:"ana@example.test",kc:70,lab:94,total:82,completed:4,pending:4,progress:50,status:"attention",activities};
  const publication = {id:"p1",publishedAt:"2026-09-24T12:00:00Z"};
  await page.addInitScript(() => localStorage.setItem("avanca.session", JSON.stringify({accessToken:"test",expires:Date.now()+3600000})));
  await page.route("**/config.json", route=>route.fulfill({json:{apiUrl:origin+"/api"}}));
  await page.route("**/api/**", async route=>{
    const endpoint=new URL(route.request().url()).pathname.slice(4);
    let data;
    if (endpoint === "/me") data={roles:[role],email:role+"@example.test"};
    else if (endpoint === "/cohorts") data={cohorts:["BRSA0267","BRSA0257"].map(code=>({code,canTeach:role === "instructor"}))};
    else if (endpoint.endsWith("/report")) data={student,students:[student],activities,publication,history:[],focus};
    else if (endpoint.endsWith("/focus-activities")) {
      const body=route.request().postDataJSON();
      assert.equal(body.expectedCurrent,"p1");
      assert.equal(body.expectedVersion,focus.version);
      assert.ok(body.activityIds.length<=3);
      focus={activityIds:body.activityIds,version:"v"+(++saved)};
      data={focus};
    } else throw new Error(endpoint);
    await route.fulfill({json:data});
  });
  await page.goto(origin);
  await page.getByRole("heading",{name:"Por onde começar",exact:true}).waitFor();
  assert.equal(await page.locator(".next-steps .activity-card").count(),3);
  assert.equal(await page.locator(".activity-link").count(),3); // linux, network e python têm correspondência no catálogo 4436
  assert.ok(!(await page.locator(".next-steps").innerText()).includes("Certificação do Cenário"));
  await page.getByRole("button",{name:"Revisar resultados · 2",exact:true}).click();
  assert.equal(await page.locator(".activity-card").count(),2);
  assert.equal(await page.locator(".review-hint").count(),2);
  assert.match(await page.locator(".activity-module summary").innerText(),/2 com nota · 0 sem nota · 2 para revisar/);
  await page.getByLabel("Tipo de atividade").selectOption("lab");
  assert.equal(await page.locator(".activity-card").count(),1);
  await page.getByRole("button",{name:"Todas",exact:true}).click();
  await page.getByLabel("Módulo",{exact:true}).selectOption("Linux");
  assert.equal(await page.locator(".activity-card").count(),2); // não liberada e dispensada, ambas LAB
  await page.getByRole("button",{name:"Revisar resultados",exact:true}).click();
  assert.equal(await page.locator(".activity-card").count(),0);
  await page.getByRole("button",{name:"Limpar filtros",exact:true}).click();
  assert.equal(await page.locator(".activity-card").count(),10);
  await page.getByLabel("Módulo",{exact:true}).selectOption("Preparação para certificação");
  await page.getByLabel("Buscar atividade").fill("certificacao");
  assert.equal(await page.locator(".activity-card").count(),1);
  await page.reload();
  await page.getByRole("heading",{name:"Minhas atividades",exact:true}).waitFor();
  assert.equal(await page.getByLabel("Módulo",{exact:true}).inputValue(),"Preparação para certificação");
  assert.equal(await page.locator(".activity-card").count(),1);
  await page.locator("#cohort").selectOption("BRSA0257");
  await page.getByRole("button",{name:"Minhas atividades",exact:true}).click();
  assert.equal(await page.getByLabel("Módulo",{exact:true}).inputValue(),"all");
  assert.equal(await page.getByLabel("Módulo",{exact:true}).locator('option[value="Linux"]').count(),0);
  assert.equal(await page.getByLabel("Módulo",{exact:true}).locator('option[value="Outras atividades"]').count(),1);
  await page.locator("#cohort").selectOption("BRSA0267");
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.getByRole("button",{name:"Meu desempenho",exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`${previewDir}/student-next-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:"Minhas atividades",exact:true}).click();
    const summary=page.locator(".activity-module summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".activity-module").first().getAttribute("open"),null);
    await page.keyboard.press("Enter");
    assert.notEqual(await page.locator(".activity-module").first().getAttribute("open"),null);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:`${previewDir}/student-modules-${width}.png`,fullPage:true});
  }
  role="instructor";
  await page.reload();
  await page.getByRole("button",{name:"Painel do instrutor",exact:true}).click();
  await page.getByRole("button",{name:"Ver por atividade",exact:true}).click();
  await page.getByRole("heading",{name:"Visão por atividade",exact:true}).waitFor();
  assert.equal(await page.locator("tbody tr").count(),9); // "future" não liberada fica de fora
  await page.locator('[data-add-focus="cert"]').click();
  await page.locator('[data-add-focus="zero"]').click();
  await page.locator('[data-add-focus="ok"]').click();
  assert.equal(await page.locator('[data-add-focus]').count(),6); // 3 viraram "No foco"
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole("button",{name:"Voltar ao painel",exact:true}).click();
  await page.getByRole("heading",{name:"Painel da BRSA0267",exact:true}).waitFor();
  await page.locator(".focus-editor summary").click();
  assert.equal(await page.locator(".focus-list li").count(),3);
  await page.getByRole("button",{name:"Salvar foco da turma",exact:true}).click();
  await page.getByText("Foco da BRSA0267 atualizado.",{exact:true}).waitFor();
  assert.equal(saved,1);
  assert.deepEqual(focus.activityIds,["cert","zero","ok"]);
  role="student";
  await page.reload();
  await page.getByRole("heading",{name:"Foco indicado pelo instrutor",exact:true}).waitFor();
  assert.equal(await page.locator(".next-steps .activity-card").count(),2);
  assert.match(await page.locator(".next-steps .activity-card").first().innerText(),/195-CERT/);
  assert.equal(await page.locator(".next-steps .review-hint").count(),1);
  assert.equal(await page.locator("#focus-form").count(),0);
  assert.deepEqual(errors,[]);
  console.log("Aluno: início compacto, foco do instrutor, módulos, revisão, limites, filtros, teclado e celular OK.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
