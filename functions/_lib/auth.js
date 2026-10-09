// Utilitários de autenticação para Cloudflare Workers (WebCrypto, sem dependências).
const enc = new TextEncoder();
const ITERACOES = 100000; // máximo suportado pelo PBKDF2 no Workers

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = (s) => deB64(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));

export function json(corpo, status = 200, extra = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  return new Response(JSON.stringify(corpo), { status, headers });
}

// ---------- Senhas: formato "pbkdf2$iteracoes$salt$hash" ----------
async function derivar(senha, salt, iteracoes) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteracoes }, chave, 256);
}

export async function gerarHash(senha) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACOES}$${b64(salt)}$${b64(await derivar(senha, salt, ITERACOES))}`;
}

export async function verificarSenha(senha, armazenado) {
  const [tipo, it, salt, hash] = (armazenado || '').split('$');
  if (tipo !== 'pbkdf2' || !it || !salt || !hash) return false;
  const calc = new Uint8Array(await derivar(senha, deB64(salt), parseInt(it, 10)));
  const esperado = deB64(hash);
  if (calc.length !== esperado.length) return false;
  let dif = 0; // comparação em tempo constante
  for (let i = 0; i < calc.length; i++) dif |= calc[i] ^ esperado[i];
  return dif === 0;
}

// ---------- JWT HS256 ----------
async function chaveHmac(segredo) {
  return crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function assinarJWT(payload, segredo, expiraEmSeg = 8 * 3600) {
  const agora = Math.floor(Date.now() / 1000);
  const corpo = { ...payload, iat: agora, exp: agora + expiraEmSeg };
  const cab = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const pay = b64url(enc.encode(JSON.stringify(corpo)));
  const sig = await crypto.subtle.sign('HMAC', await chaveHmac(segredo), enc.encode(`${cab}.${pay}`));
  return `${cab}.${pay}.${b64url(sig)}`;
}

export async function verificarJWT(token, segredo) {
  try {
    const [cab, pay, sig] = token.split('.');
    if (!cab || !pay || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await chaveHmac(segredo), deB64url(sig), enc.encode(`${cab}.${pay}`));
    if (!ok) return null;
    const dados = JSON.parse(new TextDecoder().decode(deB64url(pay)));
    if (!dados.exp || dados.exp < Math.floor(Date.now() / 1000)) return null;
    return dados;
  } catch {
    return null;
  }
}

// ---------- Sessão por cookie HttpOnly (não acessível por JavaScript → protege contra XSS) ----------
export const COOKIE = 'inq_sessao';
const HORAS = 8;

export function cookieSessao(token, request) {
  const seguro = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${HORAS * 3600}${seguro}`;
}
export function cookieLimpo(request) {
  const seguro = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${seguro}`;
}
export const HORAS_SESSAO = HORAS;

// Matriz de autorização centralizada.
// O frontend pode ocultar funcionalidades, mas a autorização efetiva
// permanece sempre no servidor por meio de exigirPermissao().
export const PERMISSOES = Object.freeze({
  admin: Object.freeze([
    'inquerito.registrar',
    'gestao.visualizar',
    'auditoria.visualizar',
    'usuarios.visualizar',
    'usuarios.gerenciar',
    'dados.exportar'
  ]),
  gestor: Object.freeze([
    'inquerito.registrar',
    'gestao.visualizar',
    'dados.exportar'
  ]),
  auditor: Object.freeze([
    'inquerito.registrar',
    'auditoria.visualizar',
    'dados.exportar'
  ]),
  operador: Object.freeze([
    'inquerito.registrar'
  ])
});

export function perfilTemPermissao(perfil, permissao) {
  return Boolean(PERMISSOES[perfil]?.includes(permissao));
}

function lerCookie(request, nome) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? m[1] : null;
}

// Exige sessão válida (cookie ou "Authorization: Bearer"). Retorna { usuario } ou { erro: Response }.
export async function exigirAuth(request, env, perfisPermitidos = null) {
  if (!env.JWT_SECRET) return { erro: json({ mensagem: 'JWT_SECRET não configurado no servidor.' }, 500) };

  // Proteção CSRF extra: requisições que alteram dados só valem se vierem do mesmo site
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origem = request.headers.get('Origin');
    if (origem && origem !== new URL(request.url).origin) {
      return { erro: json({ mensagem: 'Origem não permitida.' }, 403) };
    }
  }

  const token = lerCookie(request, COOKIE) || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const usuario = token ? await verificarJWT(token, env.JWT_SECRET) : null;
  if (!usuario) return { erro: json({ mensagem: 'Sessão inválida ou expirada.' }, 401) };
  if (perfisPermitidos && !perfisPermitidos.includes(usuario.perfil)) {
    return { erro: json({ mensagem: 'Acesso negado para o seu perfil.' }, 403) };
  }
  return { usuario };
}

// Autorização por permissão funcional. Mantém exigirAuth() compatível com APIs existentes.
export async function exigirPermissao(request, env, permissao) {
  const { usuario, erro } = await exigirAuth(request, env);
  if (erro) return { erro };
  if (!perfilTemPermissao(usuario.perfil, permissao)) {
    return { erro: json({ mensagem: 'Acesso negado para o seu perfil.' }, 403) };
  }
  return { usuario };
}
