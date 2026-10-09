import { json, exigirPermissao, gerarHash } from '../../_lib/auth.js';

const PERFIS_VALIDOS = new Set(['admin', 'gestor', 'auditor', 'operador']);
const CPF_RE = /^\d{11}$/;

function normalizarCpf(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function validarDados({ cpf, nome, perfil, cnes, equipe, senha }, exigirSenha = false) {
  const erros = [];
  if (!CPF_RE.test(cpf)) erros.push('CPF deve conter 11 dígitos.');
  if (!String(nome || '').trim()) erros.push('Nome é obrigatório.');
  if (!PERFIS_VALIDOS.has(perfil)) erros.push('Perfil inválido.');
  if (exigirSenha && String(senha || '').length < 6) erros.push('Senha deve ter pelo menos 6 caracteres.');
  if (!exigirSenha && senha !== undefined && senha !== null && senha !== '' && String(senha).length < 6) {
    erros.push('Senha deve ter pelo menos 6 caracteres.');
  }
  return erros;
}

async function garantirAdmin(request, env) {
  return exigirPermissao(request, env, 'usuarios.gerenciar');
}

export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'usuarios.visualizar');
  if (erro) return erro;
  try {
    const { results } = await env.DB.prepare(`
      SELECT id, cpf, nome, perfil, cnes, equipe, ativo, criado_em
      FROM profissionais
      ORDER BY nome`).all();
    return json({ profissionais: results });
  } catch (err) {
    console.error('admin profissionais GET:', err);
    return json({ mensagem: 'Erro ao consultar usuários.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { erro } = await garantirAdmin(request, env);
  if (erro) return erro;
  try {
    const body = await request.json().catch(() => ({}));
    const cpf = normalizarCpf(body.cpf);
    const nome = String(body.nome || '').trim();
    const perfil = String(body.perfil || 'operador').trim().toLowerCase();
    const cnes = body.cnes ? String(body.cnes).trim() : null;
    const equipe = body.equipe ? String(body.equipe).trim() : null;
    const senha = String(body.senha || '');
    const erros = validarDados({ cpf, nome, perfil, senha }, true);
    if (erros.length) return json({ mensagem: erros.join(' ') }, 400);

    const existente = await env.DB.prepare('SELECT id FROM profissionais WHERE cpf = ?').bind(cpf).first();
    if (existente) return json({ mensagem: 'Já existe um usuário cadastrado com este CPF.' }, 409);

    const senhaHash = await gerarHash(senha);
    const result = await env.DB.prepare(`
      INSERT INTO profissionais (cpf, nome, senha_hash, perfil, cnes, equipe, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .bind(cpf, nome, senhaHash, perfil, cnes, equipe).run();

    return json({ mensagem: 'Usuário criado com sucesso.', id: result.meta?.last_row_id }, 201);
  } catch (err) {
    console.error('admin profissionais POST:', err);
    return json({ mensagem: 'Erro ao criar usuário.' }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const { usuario, erro } = await garantirAdmin(request, env);
  if (erro) return erro;
  try {
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ mensagem: 'ID de usuário inválido.' }, 400);

    const atual = await env.DB.prepare('SELECT id, cpf, nome, perfil, cnes, equipe, ativo FROM profissionais WHERE id = ?').bind(id).first();
    if (!atual) return json({ mensagem: 'Usuário não encontrado.' }, 404);

    const cpf = normalizarCpf(body.cpf ?? atual.cpf);
    const nome = String(body.nome ?? atual.nome).trim();
    const perfil = String(body.perfil ?? atual.perfil).trim().toLowerCase();
    const cnes = body.cnes !== undefined ? (body.cnes ? String(body.cnes).trim() : null) : atual.cnes;
    const equipe = body.equipe !== undefined ? (body.equipe ? String(body.equipe).trim() : null) : atual.equipe;
    const ativo = body.ativo === undefined ? Number(atual.ativo) : (body.ativo ? 1 : 0);
    const senha = body.senha === undefined ? '' : String(body.senha);

    if (id === Number(usuario.id) && !ativo) return json({ mensagem: 'Você não pode inativar o próprio usuário.' }, 400);
    if (id === Number(usuario.id) && perfil !== 'admin') return json({ mensagem: 'Você não pode remover o próprio perfil de administrador.' }, 400);

    const erros = validarDados({ cpf, nome, perfil, senha });
    if (erros.length) return json({ mensagem: erros.join(' ') }, 400);

    const duplicado = await env.DB.prepare('SELECT id FROM profissionais WHERE cpf = ? AND id <> ?').bind(cpf, id).first();
    if (duplicado) return json({ mensagem: 'Já existe outro usuário cadastrado com este CPF.' }, 409);

    if (senha) {
      const senhaHash = await gerarHash(senha);
      await env.DB.prepare(`
        UPDATE profissionais
        SET cpf = ?, nome = ?, perfil = ?, cnes = ?, equipe = ?, ativo = ?, senha_hash = ?
        WHERE id = ?`)
        .bind(cpf, nome, perfil, cnes, equipe, ativo, senhaHash, id).run();
    } else {
      await env.DB.prepare(`
        UPDATE profissionais
        SET cpf = ?, nome = ?, perfil = ?, cnes = ?, equipe = ?, ativo = ?
        WHERE id = ?`)
        .bind(cpf, nome, perfil, cnes, equipe, ativo, id).run();
    }

    return json({ mensagem: 'Usuário atualizado com sucesso.' });
  } catch (err) {
    console.error('admin profissionais PUT:', err);
    return json({ mensagem: 'Erro ao atualizar usuário.' }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const { usuario, erro } = await garantirAdmin(request, env);
  if (erro) return erro;
  try {
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return json({ mensagem: 'ID de usuário inválido.' }, 400);
    if (id === Number(usuario.id)) return json({ mensagem: 'Você não pode inativar o próprio usuário.' }, 400);

    const result = await env.DB.prepare('UPDATE profissionais SET ativo = 0 WHERE id = ?').bind(id).run();
    if (!result.meta?.changes) return json({ mensagem: 'Usuário não encontrado.' }, 404);
    return json({ mensagem: 'Usuário inativado com sucesso.' });
  } catch (err) {
    console.error('admin profissionais DELETE:', err);
    return json({ mensagem: 'Erro ao inativar usuário.' }, 500);
  }
}
