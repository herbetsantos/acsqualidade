import { json, exigirAuth, exigirPermissao } from '../../_lib/auth.js';

// Mensagem padrão do WhatsApp. {paciente} = primeiro nome do responsável familiar; {operador} = nome de quem liga.
const PADRAO = 'Olá, {paciente}, me chamo {operador}, falo do Departamento de Atenção Primária, da Secretaria de Saúde de Cajamar, tudo bem?';
const CHAVE = 'whatsapp_mensagem';

async function lerSalva(env) {
  try {
    const r = await env.DB.prepare('SELECT valor FROM configuracoes WHERE chave = ?').bind(CHAVE).first();
    return r?.valor || null;
  } catch (e) {
    // Tabela ainda não criada (migração v2.8.8 pendente): usa a mensagem original.
    console.error('config whatsapp: leitura indisponível:', e);
    return null;
  }
}

// Qualquer usuário logado lê a mensagem (o operador precisa dela para montar o WhatsApp).
export async function onRequestGet({ request, env }) {
  const { erro } = await exigirAuth(request, env);
  if (erro) return erro;
  const salva = await lerSalva(env);
  return json({ mensagem: salva || PADRAO, padrao: PADRAO, personalizada: Boolean(salva) });
}

// Somente o administrador altera a mensagem padrão.
export async function onRequestPut({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  const body = await request.json().catch(() => null);
  const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';
  if (!mensagem) return json({ mensagem: 'A mensagem não pode ficar vazia.' }, 400);
  if (mensagem.length > 1000) return json({ mensagem: 'A mensagem pode ter no máximo 1000 caracteres.' }, 400);
  try {
    await env.DB.prepare(`
      INSERT INTO configuracoes (chave, valor, atualizado_em, atualizado_por)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = excluded.atualizado_por
    `).bind(CHAVE, mensagem, usuario.id).run();
  } catch (e) {
    console.error('config whatsapp: gravação:', e);
    return json({ mensagem: 'Não foi possível salvar. Rode a migração database/migracao-v2.8.8.sql no D1 (cria a tabela "configuracoes").' }, 500);
  }
  return json({ mensagem, ok: true });
}
