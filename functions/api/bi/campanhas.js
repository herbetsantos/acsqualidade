const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function autorizado(request, env) {
  const chave = env.BI_API_KEY; if (!chave) return false;
  const recebida = request.headers.get('X-BI-Key') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return recebida === chave;
}
export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return json({mensagem:'Não autorizado.'}, 401);
  const { results } = await env.DB.prepare(`
    SELECT c.id AS campanha_id, c.nome AS campanha_nome, c.unidade, c.status,
           c.criado_em, p.nome AS criado_por_nome, c.total_esperado,
           c.total_coletado, c.total_duplicado, c.total_sem_cadastro,
           c.coleta_percentual, c.coleta_validada, c.coleta_validada_em,
           COUNT(m.id) AS mailing_total,
           SUM(CASE WHEN m.status='concluido' THEN 1 ELSE 0 END) AS concluidos,
           SUM(CASE WHEN m.status='pendente' THEN 1 ELSE 0 END) AS pendentes,
           SUM(CASE WHEN m.status='em_andamento' THEN 1 ELSE 0 END) AS em_andamento,
           SUM(CASE WHEN m.status='nao_localizado' THEN 1 ELSE 0 END) AS nao_localizados,
           SUM(CASE WHEN m.status='recusou' THEN 1 ELSE 0 END) AS recusas,
           SUM(CASE WHEN m.status='sem_cadastro' THEN 1 ELSE 0 END) AS sem_cadastro,
           SUM(CASE WHEN m.status='duplicado' THEN 1 ELSE 0 END) AS duplicados
    FROM campanhas c
    LEFT JOIN profissionais p ON p.id=c.criado_por
    LEFT JOIN campanha_mailing m ON m.campanha_id=c.id
    GROUP BY c.id ORDER BY c.id
  `).all();
  return json({dataset:'campanhas', versao:1, colunas:Object.keys(results[0] || {}), dados:results});
}
