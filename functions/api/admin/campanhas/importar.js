import { json, exigirPermissao } from '../../../_lib/auth.js';

const MAX_ITENS = 10000;
const txt = (v, max) => v == null || v === '' ? null : String(v).trim().slice(0, max);

function normalizarSelecoes(composicao) {
  return new Set((composicao?.selecoes || []).map(s => `${String(s.equipe||'').trim()}|||${String(s.microarea||'').trim()}`));
}

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
  const selecoes = normalizarSelecoes(comp);

  let inseridos = 0, ignorados = 0;
  for (const item of itens) {
    const equipe = txt(item.equipe, 160) || '';
    const microarea = txt(item.microarea, 40) || '';
    if (selecoes.size && !selecoes.has(`${equipe}|||${microarea}`)) { ignorados++; continue; }
    const chave = txt(item.chave_externa || item.pec_url || item.cns || item.cpf || item.nome_paciente, 500);
    if (!chave) { ignorados++; continue; }
    const r = await env.DB.prepare(`
      INSERT OR IGNORE INTO campanha_mailing
      (campanha_id, chave_externa, nome_paciente, cns, cpf, data_nascimento, unidade,
       equipe, microarea, acs_nome, endereco, telefone, telefones_json, ultima_visita, pec_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      campanhaId, chave, txt(item.nome_paciente,160), txt(item.cns,40), txt(item.cpf,20),
      txt(item.data_nascimento,20), txt(item.unidade,160), equipe || null, microarea || null,
      txt(item.acs_nome,160), txt(item.endereco,500), txt(item.telefone,40),
      item.telefones ? JSON.stringify(item.telefones).slice(0,4000) : null,
      txt(item.ultima_visita,30), txt(item.pec_url,1000)
    ).run();
    if (r.meta?.changes) inseridos++; else ignorados++;
  }
  return json({ campanha_id: campanhaId, inseridos, ignorados, mensagem: `Importação concluída: ${inseridos} pacientes adicionados.` });
}
