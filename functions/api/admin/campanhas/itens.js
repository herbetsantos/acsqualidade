import { json, exigirPermissao } from '../../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'usuarios.visualizar');
  if (erro) return erro;
  const u = new URL(request.url);
  const campanhaId = Number(u.searchParams.get('campanha_id'));
  if (!Number.isInteger(campanhaId) || campanhaId <= 0) return json({ mensagem: 'Campanha inválida.' }, 400);
  const limit = Math.min(Math.max(Number(u.searchParams.get('limit') || 50),1),500);
  const offset = Math.max(Number(u.searchParams.get('offset') || 0),0);
  const { results } = await env.DB.prepare(`
    SELECT id, nome_paciente, cns, cpf, data_nascimento, unidade, equipe, microarea,
           acs_nome, endereco, telefone, telefones_json, ultima_visita, pec_url, status, operador_id, atualizado_em
    FROM campanha_mailing WHERE campanha_id = ? ORDER BY id LIMIT ? OFFSET ?
  `).bind(campanhaId,limit,offset).all();
  return json({ itens: results, limit, offset });
}
