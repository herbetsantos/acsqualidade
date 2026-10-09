import { exigirPermissao } from '../../_lib/auth.js';
import { csvResponse, intParam } from '../../_lib/csv.js';

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'dados.exportar');
  if (erro) return erro;
  const url = new URL(request.url);
  const campanhaId = Number(url.searchParams.get('campanha_id'));
  if (!Number.isInteger(campanhaId) || campanhaId <= 0) return new Response('campanha_id inválido', {status:400});
  const limite = intParam(url, 'limit', 100000, 1, 200000);
  const offset = intParam(url, 'offset', 0, 0, 10000000);
  const { results } = await env.DB.prepare(`
    SELECT m.id, m.campanha_id, c.nome AS campanha_nome, c.unidade AS campanha_unidade,
           m.chave_externa, m.nome_paciente, m.cns, m.cpf, m.data_nascimento,
           m.unidade, m.equipe, m.microarea, m.acs_nome, m.endereco, m.telefone,
           m.telefones_json, m.ultima_visita, m.pec_url, m.status, m.operador_id,
           p.nome AS operador_nome, m.atualizado_em
    FROM campanha_mailing m
    LEFT JOIN campanhas c ON c.id = m.campanha_id
    LEFT JOIN profissionais p ON p.id = m.operador_id
    WHERE m.campanha_id = ? ORDER BY m.id LIMIT ? OFFSET ?
  `).bind(campanhaId, limite, offset).all();
  const keys = ['id','campanha_id','campanha_nome','campanha_unidade','chave_externa','nome_paciente','cns','cpf','data_nascimento','unidade','equipe','microarea','acs_nome','endereco','telefone','telefones_json','ultima_visita','pec_url','status','operador_id','operador_nome','atualizado_em'];
  return csvResponse(results, keys.map(key => ({key,label:key})), `mailing-campanha-${campanhaId}.csv`);
}
