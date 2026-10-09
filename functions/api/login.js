import { json, verificarSenha, assinarJWT, cookieSessao, HORAS_SESSAO } from '../_lib/auth.js';

const MAX_FALHAS = 5;       // tentativas erradas permitidas...
const JANELA_MIN = 15;      // ...dentro desta janela (por CPF + IP)

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ mensagem: 'Banco D1 não vinculado (binding DB).' }, 500);
    if (!env.JWT_SECRET) return json({ mensagem: 'JWT_SECRET não configurado.' }, 500);

    const { usuario, senha } = await request.json().catch(() => ({}));
    const cpf = String(usuario || '').replace(/\D/g, ''); // aceita 111.222.333-44
    if (!cpf || !senha) return json({ mensagem: 'CPF e senha são obrigatórios.' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const desde = `-${JANELA_MIN} minutes`;

    // Limite de tentativas (força bruta)
    const f = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_falhas WHERE cpf = ? AND ip = ? AND criado_em > datetime('now', ?)"
    ).bind(cpf, ip, desde).first();
    if ((f?.n || 0) >= MAX_FALHAS) {
      return json({ mensagem: `Muitas tentativas. Aguarde ${JANELA_MIN} minutos e tente novamente.` }, 429);
    }

    const user = await env.DB.prepare(
      'SELECT id, cpf, nome, senha_hash, perfil FROM profissionais WHERE cpf = ? AND ativo = 1'
    ).bind(cpf).first();

    // Mesma resposta para "não existe" e "senha errada" (evita enumerar CPFs)
    if (!user || !(await verificarSenha(senha, user.senha_hash))) {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO login_falhas (cpf, ip) VALUES (?, ?)').bind(cpf, ip),
        env.DB.prepare("DELETE FROM login_falhas WHERE criado_em < datetime('now', '-1 day')")
      ]);
      return json({ mensagem: 'CPF ou senha inválidos.' }, 401);
    }

    await env.DB.prepare('DELETE FROM login_falhas WHERE cpf = ?').bind(cpf).run();

    const token = await assinarJWT({ id: user.id, nome: user.nome, perfil: user.perfil }, env.JWT_SECRET, HORAS_SESSAO * 3600);
    return json({ perfil: user.perfil, nome: user.nome }, 200, { 'Set-Cookie': cookieSessao(token, request) });
  } catch (err) {
    console.error('login:', err);
    return json({ mensagem: 'Erro interno no servidor.' }, 500);
  }
}
