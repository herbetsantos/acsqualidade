import { json, cookieLimpo } from '../_lib/auth.js';
export async function onRequestPost({ request }) {
  return json({ mensagem: 'Sessão encerrada.' }, 200, { 'Set-Cookie': cookieLimpo(request) });
}
