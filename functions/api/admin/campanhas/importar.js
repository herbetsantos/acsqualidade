import { json, exigirPermissao } from '../../../_lib/auth.js';

const MAX_ITENS = 1000; // por requisição (a tela envia em lotes de 200)
const TAM_LOTE = 50;    // comandos por batch no D1
const txt = (v, max) => v == null || v === '' ? null : String(v).trim().slice(0, max);
const par = (s) => `${txt(s?.equipe, 160) || ''}|||${txt(s?.microarea, 40) || ''}`;

// Importa contatos para uma campanha (nova ou já existente).
// Duplicados são rejeitados: o índice único (campanha_id, chave_externa) garante um contato por casa do PEC.
// Contatos já existentes NUNCA são alterados (preserva status, operador e resultado da ligação).
export async function onRequestPost({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  const body = await request.json().catch(() => null);
  if (!body) return json({ mensagem: 'JSON inválido.' }, 400);
  const campanhaId = Number(body.campanha_id);
  const itens = Array.isArray(body.itens) ? body.itens.slice(0, MAX_ITENS) : [];
  if (!Number.isInteger(campanhaId) || campanhaId <= 0) return json({ mensagem: 'Campanha inválida.' }, 400);
  if (!itens.length) return json({ mensagem: 'Nenhum paciente recebido da extensão.' }, 400);

  const campanha = await env.DB.prepare('SELECT id, composicao_json FROM campanhas WHERE id = ?').bind(campanhaId).first();
  if (!campanha) return json({ mensagem: 'Campanha não encontrada.' }, 404);
  const comp = JSON.parse(campanha.composicao_json || '{}');
  if (!Array.isArray(comp.selecoes)) comp.selecoes = [];
  const conhecidas = new Set(comp.selecoes.map(par));

  // Ao complementar uma campanha, novas equipes/microáreas escolhidas passam a fazer parte da composição
  let mudou = false;
  if (Array.isArray(body.selecoes)) {
    for (const s of body.selecoes.slice(0, 500)) {
      if (!s || typeof s !== 'object') continue;
      const k = par(s);
      if (conhecidas.has(k)) continue;
      conhecidas.add(k);
      comp.selecoes.push({ equipe: txt(s.equipe, 160) || '', microarea: txt(s.microarea, 40) || '' });
      mudou = true;
    }
  }
  try {
    if (mudou) await env.DB.prepare('UPDATE campanhas SET composicao_json = ? WHERE id = ?').bind(JSON.stringify(comp), campanhaId).run();
  } catch (e) {
    console.error('importar: composição:', e);
    return json({ mensagem: 'Não foi possível atualizar a composição da campanha.' }, 500);
  }

  const vistos = new Set();
  const comandos = [];
  let fora = 0, semChave = 0, duplicados = 0, inseridos = 0;
  for (const item of itens) {
    const equipe = txt(item.equipe, 160) || '';
    const microarea = txt(item.microarea, 40) || '';
    if (conhecidas.size && !conhecidas.has(`${equipe}|||${microarea}`)) { fora++; continue; }
    const chave = txt(item.chave_externa || item.pec_url || item.cns || item.cpf || item.nome_paciente, 500);
    if (!chave) { semChave++; continue; }
    if (vistos.has(chave)) { duplicados++; continue; } // repetido dentro do próprio envio
    vistos.add(chave);
    comandos.push(env.DB.prepare(`
      INSERT OR IGNORE INTO campanha_mailing
      (campanha_id, chave_externa, nome_paciente, cns, cpf, data_nascimento, unidade,
       equipe, microarea, acs_nome, endereco, telefone, telefones_json, ultima_visita, pec_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      campanhaId, chave, txt(item.nome_paciente, 160), txt(item.cns, 40), txt(item.cpf, 20),
      txt(item.data_nascimento, 20), txt(item.unidade, 160), equipe || null, microarea || null,
      txt(item.acs_nome, 160), txt(item.endereco, 500), txt(item.telefone, 40),
      item.telefones ? JSON.stringify(item.telefones).slice(0, 4000) : null,
      txt(item.ultima_visita, 30), txt(item.pec_url, 1000)
    ));
  }

  // Em lotes (batch): evita estourar o limite de consultas por requisição do Workers/D1
  try {
    for (let i = 0; i < comandos.length; i += TAM_LOTE) {
      const res = await env.DB.batch(comandos.slice(i, i + TAM_LOTE));
      for (const r of res) { if (r.meta?.changes) inseridos++; else duplicados++; }
    }
  } catch (e) {
    console.error('importar: gravação:', e);
    return json({ mensagem: `Erro ao gravar o mailing: ${String(e?.message || e).slice(0, 160)}`, inseridos, duplicados }, 500);
  }

  const partes = [`${inseridos} contato(s) novo(s)`];
  if (duplicados) partes.push(`${duplicados} duplicado(s) rejeitado(s)`);
  if (fora) partes.push(`${fora} fora da composição`);
  if (semChave) partes.push(`${semChave} sem identificador`);
  return json({
    campanha_id: campanhaId, inseridos, duplicados, fora_composicao: fora, sem_chave: semChave,
    ignorados: duplicados + fora + semChave, mensagem: `Importação concluída: ${partes.join(' · ')}.`
  });
}
