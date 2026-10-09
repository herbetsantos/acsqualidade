const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

function autorizado(request, env) {
  const chave = env.BI_API_KEY;
  if (!chave) return false;
  const recebida = request.headers.get('X-BI-Key') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return recebida === chave;
}

export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return json({mensagem:'Não autorizado.'}, 401);
  const url = new URL(request.url);
  const inicio = url.searchParams.get('data_inicio');
  const fim = url.searchParams.get('data_fim');
  const params=[]; const filtros=[];
  if (inicio) { filtros.push('date(i.data_aplicacao) >= date(?)'); params.push(inicio); }
  if (fim) { filtros.push('date(i.data_aplicacao) <= date(?)'); params.push(fim); }
  const { results } = await env.DB.prepare(`
    SELECT i.id AS inquerito_id, i.data_aplicacao, i.profissional_id,
           p.nome AS profissional_nome, p.cnes, p.equipe,
           i.microarea, i.acs_nome, i.visita_registrada_pec,
           i.data_visita_pec, i.visita_relatada_paciente, i.status_ligacao,
           i.conhece_agente, i.nivel_satisfacao,
           CASE WHEN i.visita_registrada_pec = 1 AND i.visita_relatada_paciente = 0 THEN 1 ELSE 0 END AS tem_divergencia
    FROM inqueritos i LEFT JOIN profissionais p ON p.id = i.profissional_id
    ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ORDER BY i.id
  `).bind(...params).all();
  return json({dataset:'inqueritos', versao:1, colunas:Object.keys(results[0] || {}), dados:results});
}
