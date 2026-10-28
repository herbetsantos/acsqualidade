import { json, exigirPermissao } from '../../_lib/auth.js';

const COLS = 'id, campanha_id, nome_paciente, equipe, microarea, acs_nome, endereco, telefone, telefones_json, ultima_visita, pec_url';
const MAX_TERRITORIOS = 90; // o D1 aceita até 100 parâmetros por consulta

// Entrega ao operador o próximo contato pendente da campanha escolhida (ou da campanha ativa mais recente).
// Filtros opcionais: campanha_id e terr (repetível), onde terr = "equipe|||microarea" (mesma chave da composição da campanha).
// Se o operador já tem um contato em andamento dentro do filtro, devolve esse mesmo (não perde o que estava fazendo).
// Modo aleatório (todas=1): sorteia entre os pendentes de TODAS as campanhas ativas e não interrompidas
// (o filtro por microárea não se aplica nesse modo).
// Se o administrador interrompeu o giro da campanha, nenhum contato novo é entregue.
export async function onRequestGet({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'inquerito.registrar');
  if (erro) return erro;

  const u = new URL(request.url);
  const todas = u.searchParams.get('todas') === '1';
  const pedida = Number(u.searchParams.get('campanha_id')) || null;
  const terr = todas ? [] : [...new Set(u.searchParams.getAll('terr').map((s) => String(s).slice(0, 220)))].slice(0, MAX_TERRITORIOS);
  const filtro = terr.length
    ? ` AND (COALESCE(equipe, '') || '|||' || COALESCE(microarea, '')) IN (${terr.map(() => '?').join(',')})`
    : '';

  let campanha, escopo, bindEscopo, ordem, interrompida = false;
  if (todas) {
    // Só entram campanhas ativas e em giro; interrompidas ficam de fora
    escopo = "campanha_id IN (SELECT id FROM campanhas WHERE status = 'ativa' AND giro_interrompido = 0)";
    bindEscopo = [];
    ordem = 'RANDOM()';
    campanha = { id: null, nome: 'Todos os mailings ativos', todas: true, interrompida: false };
  } else {
    // Sem campanha escolhida: prefere a mais recente que NÃO esteja interrompida
    const camp = pedida
      ? await env.DB.prepare("SELECT id, nome, giro_interrompido FROM campanhas WHERE id = ? AND status = 'ativa'").bind(pedida).first()
      : await env.DB.prepare("SELECT id, nome, giro_interrompido FROM campanhas WHERE status = 'ativa' ORDER BY giro_interrompido, id DESC LIMIT 1").first();
    if (!camp) return json({ campanha: null, item: null, mensagem: 'Nenhuma campanha ativa no momento.' });
    interrompida = Boolean(camp.giro_interrompido);
    escopo = 'campanha_id = ?';
    bindEscopo = [camp.id];
    ordem = 'atualizado_em, id';
    campanha = { id: camp.id, nome: camp.nome, interrompida };
  }

  let item = null;
  if (!interrompida) {
    // Contatos parados há mais de 30 min voltam para a fila
    await env.DB.prepare(
      `UPDATE campanha_mailing SET status = 'pendente', operador_id = NULL WHERE ${escopo} AND status = 'em_andamento' AND atualizado_em < datetime('now', '-30 minutes')`
    ).bind(...bindEscopo).run();

    item = await env.DB.prepare(
      `SELECT ${COLS} FROM campanha_mailing WHERE ${escopo} AND status = 'em_andamento' AND operador_id = ?${filtro} ORDER BY atualizado_em LIMIT 1`
    ).bind(...bindEscopo, usuario.id, ...terr).first();

    // Reserva o próximo pendente; tenta de novo se outro operador pegou o mesmo ao mesmo tempo
    for (let t = 0; !item && t < 4; t++) {
      item = await env.DB.prepare(
        `UPDATE campanha_mailing SET status = 'em_andamento', operador_id = ?, atualizado_em = CURRENT_TIMESTAMP
         WHERE id = (SELECT id FROM campanha_mailing WHERE ${escopo} AND status = 'pendente'${filtro} ORDER BY ${ordem} LIMIT 1)
           AND status = 'pendente'
         RETURNING ${COLS}`
      ).bind(usuario.id, ...bindEscopo, ...terr).first();
      if (!item) {
        const resta = await env.DB.prepare(`SELECT COUNT(*) AS n FROM campanha_mailing WHERE ${escopo} AND status = 'pendente'${filtro}`).bind(...bindEscopo, ...terr).first();
        if (!resta?.n) break;
      }
    }
  }

  // Os números refletem o recorte escolhido pelo operador
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(status = 'pendente') AS pendentes,
            SUM(status IN ('concluido','nao_localizado','recusou','sem_cadastro','duplicado')) AS feitos
     FROM campanha_mailing WHERE ${escopo}${filtro}`
  ).bind(...bindEscopo, ...terr).first();

  // No modo aleatório o contato pode vir de qualquer campanha: informa de qual
  if (item) {
    const dono = await env.DB.prepare('SELECT nome FROM campanhas WHERE id = ?').bind(item.campanha_id).first();
    item.campanha_nome = dono?.nome || null;
  }

  let telefones = [];
  try { telefones = item?.telefones_json ? JSON.parse(item.telefones_json) : []; } catch { /* ignora */ }
  if (item) delete item.telefones_json;

  let mensagem = null;
  if (!item) {
    mensagem = todas
      ? 'Não há contatos pendentes nos mailings em giro. Mailings interrompidos pelo administrador não entram.'
      : interrompida
      ? 'O administrador interrompeu o giro deste mailing. Aguarde a retomada ou escolha outro mailing no filtro.'
      : terr.length ? 'Não há mais contatos pendentes neste filtro.' : 'Não há mais contatos pendentes nesta campanha.';
  }

  return json({
    campanha,
    item: item ? { ...item, telefones } : null,
    total: c?.total || 0,
    pendentes: c?.pendentes || 0,
    feitos: c?.feitos || 0,
    mensagem
  });
}
