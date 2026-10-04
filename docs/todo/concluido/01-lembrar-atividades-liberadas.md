# 01 · Lembrar as atividades liberadas entre importações

> Implementação conferida no repositório em 04/10/2026. Veja o [mapa de evidências](README.md). Datas, contagens e relatos de deploy abaixo registram a execução original; esta revisão não acessou produção.

**Status:** ✅ concluída · **Prioridade:** alta · **Esforço:** pequeno · **Área:** instrutor / backend

## Problema
Na primeira prévia de cada semana, `_preview` chama `parse_csv(csv, None)` e a seleção de atividades liberadas volta à heurística "≥ 5 notas preenchidas". O que o instrutor marcou na publicação anterior é ignorado. Uma atividade liberada com poucas notas pode sair do cálculo sem que ninguém perceba. O aviso "Atividades retiradas do cálculo" existe, mas fica recolhido.

## Proposta
- Em `Portal._preview` (`backend/portal.py`), quando `activeIds` não vier no corpo, usar como padrão as atividades ativas na publicação atual somadas às sugeridas pela heurística.
- Na prévia (`frontend/pages/import.js`), mostrar `activitiesPaused` como alerta visível, e não dentro de `<details>`.

## Critérios de aceite
- [x] Uma atividade ativa na publicação atual continua marcada na nova prévia, mesmo com menos de 5 notas.
- [x] Atividades novas continuam seguindo a heurística.
- [x] A retirada de uma atividade antes ativa aparece como alerta na prévia.
- [x] Testes em `backend/test_portal.py`.

## Como foi implementado
- `Portal._preview` (`backend/portal.py`): quando `activeIds` não vem no corpo (primeira prévia da semana), o snapshot recém-parseado tem marcadas como ativas também as atividades que já estavam ativas na publicação atual, além das sugeridas pela heurística de "≥ 5 notas". Uma seleção explícita do instrutor (`activeIds` presente) continua prevalecendo sem alteração.
- `frontend/pages/import.js`: `activitiesPaused` saiu do bloco recolhido de mudanças e passou a ser um alerta (`removal-warning`) sempre visível quando não vazio, com a lista das atividades retiradas.
- Testes novos em `backend/test_portal.py`: `test_preview_keeps_previously_active_activity_below_heuristic` e `test_preview_still_honors_explicit_selection`.
