import { exigirPermissao } from '../../_lib/auth.js';
import { csvResponse, intParam } from '../../_lib/csv.js';

export async function onRequestGet({ request, env }) {
  const { erro, usuario } = await exigirPermissao(request, env, 'dados.exportar');
  if (erro) return erro;

  const url = new URL(request.url);
  const limite = intParam(url, 'limit', 50000, 1, 100000);
  const offset = intParam(url, 'offset', 0, 0, 10000000);
  const dataInicio = url.searchParams.get('data_inicio');
  const dataFim = url.searchParams.get('data_fim');
  const params = [];
  const filtros = [];
  if (dataInicio) { filtros.push('date(i.data_aplicacao) >= date(?)'); params.push(dataInicio); }
  if (dataFim) { filtros.push('date(i.data_aplicacao) <= date(?)'); params.push(dataFim); }

  const { results } = await env.DB.prepare(`
    SELECT i.id, i.data_aplicacao, i.profissional_id, p.nome AS profissional_nome,
           p.cpf AS profissional_cpf, p.cnes, p.equipe,
           i.microarea, i.acs_nome, i.endereco_pec, i.responsavel_familiar,
           i.telefone_contato, i.visita_registrada_pec, i.data_visita_pec,
           i.visita_relatada_paciente, i.status_ligacao, i.conhece_agente,
           i.nivel_satisfacao, i.observacoes
    FROM inqueritos i
    LEFT JOIN profissionais p ON p.id = i.profissional_id
    ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
    ORDER BY i.id DESC LIMIT ? OFFSET ?
  `).bind(...params, limite, offset).all();

  const columns = [
    ['id','ID'],['data_aplicacao','Data aplicação'],['profissional_id','ID profissional'],
    ['profissional_nome','Profissional'],['profissional_cpf','CPF profissional'],['cnes','CNES'],['equipe','Equipe'],
    ['microarea','Microárea'],['acs_nome','ACS'],['endereco_pec','Endereço PEC'],['responsavel_familiar','Responsável familiar'],
    ['telefone_contato','Telefone'],['visita_registrada_pec','Visita registrada PEC'],['data_visita_pec','Data visita PEC'],
    ['visita_relatada_paciente','Visita relatada pelo paciente'],['status_ligacao','Status ligação'],['conhece_agente','Conhece agente'],
    ['nivel_satisfacao','Nível satisfação'],['observacoes','Observações']
  ].map(([key,label]) => ({key,label}));

  return csvResponse(results, columns, `inqueritos-${new Date().toISOString().slice(0,10)}-${usuario.perfil}.csv`);
}
