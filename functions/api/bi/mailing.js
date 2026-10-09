const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function autorizado(request, env) {
  const chave = env.BI_API_KEY; if (!chave) return false;
  const recebida = request.headers.get('X-BI-Key') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  return recebida === chave;
}
export async function onRequestGet({ request, env }) {
  if (!autorizado(request, env)) return json({mensagem:'Não autorizado.'}, 401);
  const url = new URL(request.url); const campanhaId=Number(url.searchParams.get('campanha_id'));
  const params=[]; const where=[];
  if (Number.isInteger(campanhaId) && campanhaId>0) { where.push('m.campanha_id=?'); params.push(campanhaId); }
  const { results } = await env.DB.prepare(`
    SELECT m.campanha_id, c.nome AS campanha_nome, c.unidade AS campanha_unidade,
           m.unidade, m.equipe, m.microarea, m.acs_nome, m.status,
           m.atualizado_em
    FROM campanha_mailing m JOIN campanhas c ON c.id=m.campanha_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.campanha_id, m.id
  `).bind(...params).all();
  return json({dataset:'mailing', versao:1, colunas:Object.keys(results[0] || {}), dados:results});
}
