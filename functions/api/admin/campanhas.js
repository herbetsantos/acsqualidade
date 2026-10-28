import { json, exigirPermissao } from '../../_lib/auth.js';

const txt = (v, max) => v == null || v === '' ? null : String(v).trim().slice(0, max);

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'usuarios.visualizar');
  if (erro) return erro;
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.nome, c.unidade, c.status, c.criado_em, p.nome AS criado_por_nome,
           c.giro_interrompido, c.giro_interrompido_em,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id) AS total,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id AND m.status='concluido') AS concluidos,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id AND m.status='pendente') AS pendentes,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id AND m.status='em_andamento') AS em_andamento
    FROM campanhas c
    LEFT JOIN profissionais p ON p.id = c.criado_por
    ORDER BY c.id DESC
  `).all();
  return json({ campanhas: results });
}

export async function onRequestPost({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  const body = await request.json().catch(() => null);
  if (!body) return json({ mensagem: 'JSON inválido.' }, 400);
  const nome = txt(body.nome, 160);
  const unidade = txt(body.unidade, 160);
  const composicao = body.composicao && typeof body.composicao === 'object' ? body.composicao : null;
  if (!nome) return json({ mensagem: 'Nome da campanha é obrigatório.' }, 400);
  if (!composicao || !Array.isArray(composicao.selecoes)) return json({ mensagem: 'Composição territorial inválida.' }, 400);
  const result = await env.DB.prepare(`
    INSERT INTO campanhas (nome, unidade, composicao_json, criado_por)
    VALUES (?, ?, ?, ?)
  `).bind(nome, unidade, JSON.stringify(composicao), usuario.id).run();
  return json({ id: result.meta?.last_row_id, mensagem: 'Campanha criada com sucesso.' }, 201);
}

// Interrompe ou retoma o giro do mailing. Interromper NÃO apaga nada: apenas deixa de entregar
// novos contatos aos operadores. Quem já está com um contato aberto consegue salvar a pesquisa.
// Body: { id, interromper: true|false }
export async function onRequestPatch({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  const d = await request.json().catch(() => null);
  const id = Number(d?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ mensagem: 'Campanha inválida.' }, 400);
  if (typeof d?.interromper !== 'boolean') return json({ mensagem: 'Informe "interromper" como true ou false.' }, 400);

  const camp = await env.DB.prepare('SELECT id, nome, status FROM campanhas WHERE id = ?').bind(id).first();
  if (!camp) return json({ mensagem: 'Campanha não encontrada.' }, 404);

  const r = d.interromper
    ? await env.DB.prepare('UPDATE campanhas SET giro_interrompido = 1, giro_interrompido_em = CURRENT_TIMESTAMP, giro_interrompido_por = ? WHERE id = ?').bind(usuario.id, id).run()
    : await env.DB.prepare('UPDATE campanhas SET giro_interrompido = 0, giro_interrompido_em = NULL, giro_interrompido_por = NULL WHERE id = ?').bind(id).run();
  console.log(`campanha ${id} (${camp.nome}): giro ${d.interromper ? 'interrompido' : 'retomado'} por usuário ${usuario.id}`);
  return json({
    id, giro_interrompido: d.interromper, alteradas: r.meta?.changes || 0,
    mensagem: d.interromper ? 'Giro interrompido. Nenhum novo contato será entregue aos operadores.' : 'Giro retomado.'
  });
}

// Exclusão de campanha e de todo o seu mailing (dados pessoais: nome, CNS, CPF, telefone, endereço).
// Os inquéritos já registrados são preservados; apenas o vínculo (mailing_id) é desfeito.
// Se houver inquéritos vinculados, exige confirmação explícita (forcar=true).
export async function onRequestDelete({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const u = new URL(request.url);
    const id = Number(u.searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) return json({ mensagem: 'Campanha inválida.' }, 400);
    const forcar = u.searchParams.get('forcar') === 'true';

    const camp = await env.DB.prepare('SELECT id, nome FROM campanhas WHERE id = ?').bind(id).first();
    if (!camp) return json({ mensagem: 'Campanha não encontrada.' }, 404);

    // Tolerante a bancos em que a coluna inqueritos.mailing_id ainda não foi criada (migração pendente).
    let temVinculo = true;
    let vinculados = 0;
    try {
      const vinc = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM inqueritos WHERE mailing_id IN (SELECT id FROM campanha_mailing WHERE campanha_id = ?)'
      ).bind(id).first();
      vinculados = vinc?.n || 0;
    } catch (e) {
      temVinculo = false;
      console.error('exclusao: coluna inqueritos.mailing_id indisponível:', e);
    }
    if (vinculados > 0 && !forcar) {
      return json({
        mensagem: `A campanha possui ${vinculados} pesquisa(s) vinculada(s). Confirme para excluir o mailing e manter as pesquisas sem vínculo com o contato.`,
        requer_confirmacao: true,
        inqueritos_vinculados: vinculados
      }, 409);
    }

    // Operação atômica: desvincula inquéritos (se aplicável), remove mailing e campanha.
    const ops = [];
    if (temVinculo) {
      ops.push(env.DB.prepare('UPDATE inqueritos SET mailing_id = NULL WHERE mailing_id IN (SELECT id FROM campanha_mailing WHERE campanha_id = ?)').bind(id));
    }
    ops.push(env.DB.prepare('DELETE FROM campanha_mailing WHERE campanha_id = ?').bind(id));
    ops.push(env.DB.prepare('DELETE FROM campanhas WHERE id = ?').bind(id));
    await env.DB.batch(ops);
    console.log(`campanha ${id} (${camp.nome}) excluída por usuário ${usuario.id}`);
    return json({ mensagem: 'Campanha e mailing excluídos.', inqueritos_desvinculados: vinculados });
  } catch (err) {
    console.error('exclusao campanha:', err);
    return json({ mensagem: `Erro ao excluir campanha: ${String(err?.message || err).slice(0, 200)}` }, 500);
  }
}
