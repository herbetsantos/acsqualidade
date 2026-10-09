import { exigirPermissao } from '../../_lib/auth.js';
import { csvResponse } from '../../_lib/csv.js';

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'dados.exportar');
  if (erro) return erro;
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.nome, c.unidade, c.status, c.criado_por, p.nome AS criado_por_nome,
           c.criado_em, c.total_esperado, c.total_coletado, c.total_duplicado,
           c.total_sem_cadastro, c.coleta_percentual, c.coleta_validada, c.coleta_validada_em,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id) AS mailing_total,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id AND m.status='concluido') AS concluidos,
           (SELECT COUNT(*) FROM campanha_mailing m WHERE m.campanha_id = c.id AND m.status='pendente') AS pendentes
    FROM campanhas c LEFT JOIN profissionais p ON p.id = c.criado_por ORDER BY c.id DESC
  `).all();
  const keys = ['id','nome','unidade','status','criado_por','criado_por_nome','criado_em','total_esperado','total_coletado','total_duplicado','total_sem_cadastro','coleta_percentual','coleta_validada','coleta_validada_em','mailing_total','concluidos','pendentes'];
  return csvResponse(results, keys.map(key => ({key,label:key})), `campanhas-${new Date().toISOString().slice(0,10)}.csv`);
}
