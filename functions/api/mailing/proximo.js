import { json, exigirPermissao } from '../../_lib/auth.js';

const COLS = 'id, campanha_id, nome_paciente, equipe, microarea, acs_nome, endereco, telefone, telefones_json, ultima_visita, pec_url';

// Entrega ao operador o próximo contato pendente da campanha ativa.
// Se o operador já tem um contato em andamento, devolve esse mesmo (não perde o que estava fazendo).
export async function onRequestGet({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'inquerito.registrar');
  if (erro) return erro;

  const u = new URL(request.url);
  const pedida = Number(u.searchParams.get('campanha_id')) || null;
  const camp = pedida
    ? await env.DB.prepare("SELECT id, nome FROM campanhas WHERE id = ? AND status = 'ativa'").bind(pedida).first()
    : await env.DB.prepare("SELECT id, nome FROM campanhas WHERE status = 'ativa' ORDER BY id DESC LIMIT 1").first();
  if (!camp) return json({ campanha: null, item: null, mensagem: 'Nenhuma campanha ativa no momento.' });

  // Contatos parados há mais de 30 min voltam para a fila
  await env.DB.prepare(
    "UPDATE campanha_mailing SET status = 'pendente', operador_id = NULL WHERE campanha_id = ? AND status = 'em_andamento' AND atualizado_em < datetime('now', '-30 minutes')"
  ).bind(camp.id).run();

  let item = await env.DB.prepare(
    `SELECT ${COLS} FROM campanha_mailing WHERE campanha_id = ? AND status = 'em_andamento' AND operador_id = ? ORDER BY atualizado_em LIMIT 1`
  ).bind(camp.id, usuario.id).first();

  // Reserva o próximo pendente; tenta de novo se outro operador pegou o mesmo ao mesmo tempo
  for (let t = 0; !item && t < 4; t++) {
    item = await env.DB.prepare(
      `UPDATE campanha_mailing SET status = 'em_andamento', operador_id = ?, atualizado_em = CURRENT_TIMESTAMP
       WHERE id = (SELECT id FROM campanha_mailing WHERE campanha_id = ? AND status = 'pendente' ORDER BY atualizado_em, id LIMIT 1)
         AND status = 'pendente'
       RETURNING ${COLS}`
    ).bind(usuario.id, camp.id).first();
    if (!item) {
      const resta = await env.DB.prepare("SELECT COUNT(*) AS n FROM campanha_mailing WHERE campanha_id = ? AND status = 'pendente'").bind(camp.id).first();
      if (!resta?.n) break;
    }
  }

  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status = 'pendente') AS pendentes,
            SUM(status IN ('concluido','nao_localizado','recusou','sem_cadastro','duplicado')) AS feitos
     FROM campanha_mailing WHERE campanha_id = ?`
  ).bind(camp.id).first();

  let telefones = [];
  try { telefones = item?.telefones_json ? JSON.parse(item.telefones_json) : []; } catch { /* ignora */ }
  if (item) delete item.telefones_json;

  return json({
    campanha: camp,
    item: item ? { ...item, telefones } : null,
    total: c?.total || 0,
    pendentes: c?.pendentes || 0,
    feitos: c?.feitos || 0,
    mensagem: item ? null : 'Não há mais contatos pendentes nesta campanha.'
  });
}
