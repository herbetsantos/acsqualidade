import { json, exigirPermissao } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'gestao.visualizar');
  if (erro) return erro;

  try {
    const totais = await env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN visita_registrada_pec = 1 AND visita_relatada_paciente = 0 THEN 1 ELSE 0 END) AS divergencias,
             AVG(nivel_satisfacao) AS media
      FROM inqueritos`).first();

    const { results } = await env.DB.prepare(`
      SELECT COALESCE(acs_nome, '(sem nome)') AS acs_nome, COALESCE(microarea, '-') AS microarea,
             acs_nome AS acs_raw, microarea AS microarea_raw,
             COUNT(*) AS total,
             SUM(CASE WHEN visita_relatada_paciente = 1 THEN 1 ELSE 0 END) AS confirmadas,
             SUM(CASE WHEN visita_registrada_pec = 1 AND visita_relatada_paciente = 0 THEN 1 ELSE 0 END) AS divergencias,
             AVG(nivel_satisfacao) AS media
      FROM inqueritos GROUP BY acs_nome, microarea ORDER BY divergencias DESC, total DESC`).all();

    return json({
      totalInqueritos: totais?.total || 0,
      totalDivergencias: totais?.divergencias || 0,
      mediaSatisfacao: totais?.media != null ? Number(totais.media.toFixed(1)) : null,
      porAcs: results
    });
  } catch (err) {
    console.error('metricas:', err);
    return json({ mensagem: 'Erro ao consultar métricas.' }, 500);
  }
}
