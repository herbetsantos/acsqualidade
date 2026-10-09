import { json, exigirAuth } from '../_lib/auth.js';
export async function onRequestGet({ request, env }) {
  const { usuario, erro } = await exigirAuth(request, env);
  if (erro) return erro;
  return json({ nome: usuario.nome, perfil: usuario.perfil });
}
