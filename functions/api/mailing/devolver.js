import { json, exigirPermissao } from '../../_lib/auth.js';

// O operador devolve o contato à fila (ele vai para o fim, para não voltar logo em seguida).
export async function onRequestPost({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'inquerito.registrar');
  if (erro) return erro;
  const d = await request.json().catch(() => null);
  const id = Number(d?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ mensagem: 'Contato inválido.' }, 400);
  const r = await env.DB.prepare(
    "UPDATE campanha_mailing SET status = 'pendente', operador_id = NULL, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND operador_id = ? AND status = 'em_andamento'"
  ).bind(id, usuario.id).run();
  return json({ devolvido: Boolean(r.meta?.changes) });
}
