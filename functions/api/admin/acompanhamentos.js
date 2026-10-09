import { json, exigirPermissao } from '../../_lib/auth.js';

// Exclui todos os inquéritos (entrevistas) de um grupo ACS x microárea do "Acompanhamento por Agente".
// Ação irreversível, restrita a quem possui 'usuarios.gerenciar' (administrador).
// O parâmetro "esperado" (quantidade exibida na tela) impede exclusão sobre dados que mudaram desde a consulta.
export async function onRequestDelete({ request, env }) {
  const { usuario, erro } = await exigirPermissao(request, env, 'usuarios.gerenciar');
  if (erro) return erro;
  try {
    const u = new URL(request.url);
    const acs = u.searchParams.get('acs_nulo') === '1' ? null : u.searchParams.get('acs_nome');
    const micro = u.searchParams.get('microarea_nula') === '1' ? null : u.searchParams.get('microarea');
    const esperado = Number(u.searchParams.get('esperado'));
    if (acs === undefined || micro === undefined || (acs === null && u.searchParams.get('acs_nulo') !== '1') ||
        (micro === null && u.searchParams.get('microarea_nula') !== '1')) {
      return json({ mensagem: 'Parâmetros do acompanhamento incompletos.' }, 400);
    }
    if (!Number.isInteger(esperado) || esperado <= 0) return json({ mensagem: 'Quantidade esperada inválida.' }, 400);

    const atual = (await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM inqueritos WHERE acs_nome IS ? AND microarea IS ?'
    ).bind(acs, micro).first())?.n || 0;
    if (atual === 0) return json({ mensagem: 'Nenhum inquérito encontrado para este acompanhamento.' }, 404);
    if (atual !== esperado) {
      return json({ mensagem: `Os dados mudaram desde a consulta (${atual} registro(s) agora, ${esperado} exibido(s)). Atualize a página e tente novamente.`, atual }, 409);
    }

    const r = await env.DB.prepare('DELETE FROM inqueritos WHERE acs_nome IS ? AND microarea IS ?').bind(acs, micro).run();
    const excluidos = r.meta?.changes ?? atual;
    console.log(`acompanhamento excluído: acs=${acs ?? 'NULL'} microarea=${micro ?? 'NULL'} inqueritos=${excluidos} usuario=${usuario.id}`);
    return json({ mensagem: `${excluidos} inquérito(s) excluído(s).`, excluidos });
  } catch (err) {
    console.error('exclusao acompanhamento:', err);
    return json({ mensagem: `Erro ao excluir acompanhamento: ${String(err?.message || err).slice(0, 200)}` }, 500);
  }
}
