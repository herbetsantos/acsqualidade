import { json, exigirPermissao } from '../../_lib/auth.js';

// Opções do filtro do operador: campanhas ativas e, em cada uma, as equipes/microáreas com o que ainda está pendente.
// A microárea vem do mailing (e-SUS); aqui ela só serve para escolher com qual parte do mailing trabalhar.
export async function onRequestGet({ request, env }) {
  const { erro } = await exigirPermissao(request, env, 'inquerito.registrar');
  if (erro) return erro;

  const { results: camps } = await env.DB.prepare(
    "SELECT id, nome, giro_interrompido FROM campanhas WHERE status = 'ativa' ORDER BY giro_interrompido, id DESC"
  ).all();
  if (!camps.length) return json({ campanhas: [] });

  const { results: terr } = await env.DB.prepare(
    `SELECT campanha_id, COALESCE(equipe, '') AS equipe, COALESCE(microarea, '') AS microarea,
            COUNT(*) AS total, SUM(status = 'pendente') AS pendentes
     FROM campanha_mailing
     WHERE campanha_id IN (SELECT id FROM campanhas WHERE status = 'ativa')
     GROUP BY campanha_id, 2, 3
     ORDER BY 2, 3`
  ).all();

  const campanhas = camps.map((c) => {
    const territorios = terr.filter((t) => t.campanha_id === c.id)
      .map((t) => ({ equipe: t.equipe, microarea: t.microarea, total: t.total || 0, pendentes: t.pendentes || 0 }));
    return {
      id: c.id,
      nome: c.nome,
      interrompida: Boolean(c.giro_interrompido),
      total: territorios.reduce((s, t) => s + t.total, 0),
      pendentes: territorios.reduce((s, t) => s + t.pendentes, 0),
      territorios
    };
  });
  return json({ campanhas });
}
