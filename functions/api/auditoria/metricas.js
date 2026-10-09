import { json, exigirPermissao } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'auditoria.visualizar');
  if (erro) return erro;

  try {
    const totais = await env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN visita_registrada_pec = 1 AND visita_relatada_paciente = 0 THEN 1 ELSE 0 END) AS divergencias
      FROM inqueritos`).first();

    const { results } = await env.DB.prepare(`
      SELECT COALESCE(acs_nome, '(sem nome)') AS acs_nome, COALESCE(microarea, '-') AS microarea,
             COUNT(*) AS total,
             SUM(CASE WHEN visita_relatada_paciente = 1 THEN 1 ELSE 0 END) AS confirmadas,
             SUM(CASE WHEN visita_registrada_pec = 1 AND visita_relatada_paciente = 0 THEN 1 ELSE 0 END) AS divergencias
      FROM inqueritos GROUP BY acs_nome, microarea ORDER BY divergencias DESC, total DESC`).all();

    return json({
      totalInqueritos: totais?.total || 0,
      totalDivergencias: totais?.divergencias || 0,
      porAcs: results
    });
  } catch (err) {
    console.error('auditoria metricas:', err);
    return json({ mensagem: 'Erro ao consultar dados de auditoria.' }, 500);
  }
}
