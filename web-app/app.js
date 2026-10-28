document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const irParaLogin = () => { window.location.replace('index.html' + window.location.hash); };

  // Sessão é um cookie HttpOnly: o JavaScript não lê o token, apenas pergunta ao servidor quem somos.
  let eu;
  try {
    const r = await fetch('/api/me');
    if (!r.ok) return irParaLogin();
    eu = await r.json();
  } catch { return irParaLogin(); }

  if (['admin', 'gestor', 'auditor'].includes(eu.perfil) && $('lnk-dashboard')) $('lnk-dashboard').classList.remove('hidden');
  if (eu.perfil === 'admin' && $('lnk-admin')) $('lnk-admin').classList.remove('hidden');
  if (eu.perfil === 'admin' && $('lnk-whats')) $('lnk-whats').classList.remove('hidden');

  $('btn-logout')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.href = 'index.html';
  });

  const form = $('form-inquerito');
  if (!form) return; // outras páginas só usam a parte de sessão acima

  const dadosDoContato = ['microarea', 'acs_nome', 'endereco_pec', 'responsavel_familiar', 'telefone_contato'];
  const respostas = ['status_ligacao', 'visita_registrada_pec', 'data_visita_pec', 'visita_relatada_paciente',
    'conhece_agente', 'nivel_satisfacao', 'observacoes'];
  const campos = [...dadosDoContato, ...respostas];

  let contatoAtual = null; // item do mailing em atendimento (null = modo manual)

  // Filtro do mailing: a microárea vem do mailing (e-SUS) e não é editada; serve para escolher o que atender.
  const CHAVE_FILTRO = 'inq_filtro_mailing';
  let opcoes = [];                          // campanhas ativas e seus territórios (GET /api/mailing/opcoes)
  let filtro = { campanha_id: null, todas: false, terr: [] }; // todas = sorteio entre todos os mailings em giro
  const VALOR_TODAS = 'todas';
  let campanhaAtualId = null;
  const chaveTerr = (t) => `${t.equipe || ''}|||${t.microarea || ''}`;
  const rotuloEquipe = (e) => e || 'Equipe não identificada';
  const rotuloMicro = (m) => (!m ? 'Microárea não identificada' : /^micro/i.test(m) ? m : `Microárea ${m}`);
  const lerFiltroSalvo = () => { try { return JSON.parse(localStorage.getItem(CHAVE_FILTRO) || 'null'); } catch { return null; } };
  const salvarFiltro = () => { try { localStorage.setItem(CHAVE_FILTRO, JSON.stringify(filtro)); } catch { /* sem armazenamento: segue sem lembrar */ } };

  // ---- WhatsApp: botão abre uma janela com a mensagem (editável) e o link wa.me ----
  // A mensagem padrão é definida pelo administrador (menu "Mensagem WhatsApp"); se o servidor não responder, usa esta.
  let templateWhats = 'Olá, {paciente}, me chamo {operador}, falo do Departamento de Atenção Primária, da Secretaria de Saúde de Cajamar, tudo bem?';
  try {
    const rc = await fetch('/api/config/whatsapp');
    if (rc.ok) templateWhats = (await rc.json()).mensagem || templateWhats;
  } catch { /* mantém a mensagem original */ }

  const primeiroNome = (n) => {
    const p = String(n || '').trim().split(/\s+/)[0] || '';
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
  };
  // Devolve o número no formato do wa.me (55 + DDD + celular de 9 dígitos) ou null se não for celular
  const numeroWhats = (tel) => {
    let d = String(tel || '').replace(/\D/g, '').replace(/^0+/, '');
    if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
    if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + '9' + d.slice(2); // celular antigo (8 dígitos)
    return d.length === 11 && d[2] === '9' ? '55' + d : null;
  };
  const montarMensagem = (paciente) => {
    const nome = primeiroNome(paciente);
    let t = String(templateWhats);
    t = nome ? t.replace(/\{paciente\}/g, () => nome) : t.replace(/,?\s*\{paciente\}/g, ''); // sem nome: remove o trecho
    return t.replace(/\{operador\}/g, () => eu.nome || '').replace(/^[,\s]+/, '').trim();
  };

  let whatsPadrao = '';
  const abrirModalWhats = () => { $('whats-modal').classList.remove('hidden'); $('whats-msg').focus(); };
  const fecharModalWhats = () => $('whats-modal')?.classList.add('hidden');
  const atualizarLinkWhats = () => {
    $('whats-abrir').href = `https://wa.me/${$('whats-numero').value}?text=${encodeURIComponent($('whats-msg').value)}`;
  };
  function limparWhats() {
    fecharModalWhats();
    $('btn-whats')?.classList.add('hidden');
    if ($('whats-aviso')) $('whats-aviso').textContent = '';
    if ($('whats-numero')) $('whats-numero').textContent = '';
    if ($('whats-msg')) $('whats-msg').value = '';
  }
  function mostrarWhats(telefones, paciente) {
    if (!$('btn-whats')) return;
    limparWhats();
    const vistos = new Set();
    telefones.forEach((t) => {
      const n = numeroWhats(t);
      if (!n || vistos.has(n)) return;
      vistos.add(n);
      const o = document.createElement('option');
      o.value = n; o.textContent = t;
      $('whats-numero').appendChild(o);
    });
    if (vistos.size) {
      whatsPadrao = montarMensagem(paciente);
      $('whats-msg').value = whatsPadrao;
      $('whats-numero-grupo').classList.toggle('hidden', vistos.size < 2);
      atualizarLinkWhats();
      $('btn-whats').classList.remove('hidden');
    } else if (telefones.length) {
      $('whats-aviso').textContent = 'Nenhum número de celular para WhatsApp neste contato.';
    }
  }
  $('btn-whats')?.addEventListener('click', abrirModalWhats);
  $('whats-fechar')?.addEventListener('click', fecharModalWhats);
  $('whats-modal')?.addEventListener('click', (e) => { if (e.target === $('whats-modal')) fecharModalWhats(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModalWhats(); });
  $('whats-msg')?.addEventListener('input', atualizarLinkWhats);
  $('whats-numero')?.addEventListener('change', atualizarLinkWhats);
  $('whats-restaurar')?.addEventListener('click', () => { $('whats-msg').value = whatsPadrao; atualizarLinkWhats(); });
  $('whats-abrir')?.addEventListener('click', () => setTimeout(fecharModalWhats, 200));


  const aviso = (texto, tipo = 'erro') => {
    const el = $('msg-form');
    if (!el) return;
    if (!texto) { el.classList.add('hidden'); return; }
    el.className = 'erro-msg' + (tipo === 'erro' ? '' : ' ' + tipo);
    el.textContent = texto;
  };

  const limparForm = () => {
    form.reset();
    if ($('tel-extra')) $('tel-extra').textContent = '';
    limparWhats();
  };

  function preencher(item) {
    limparForm();
    $('microarea').value = item.microarea || '';
    $('acs_nome').value = item.acs_nome || '';
    $('endereco_pec').value = item.endereco || '';
    $('responsavel_familiar').value = item.nome_paciente || '';
    const tels = item.telefones?.length ? item.telefones : (item.telefone ? [item.telefone] : []);
    $('telefone_contato').value = tels[0] || '';
    mostrarWhats(tels, item.nome_paciente);
    if ($('tel-extra')) $('tel-extra').textContent = tels.length > 1 ? 'Outro número: ' + tels.slice(1).join(' / ') : '';
    // Se o e-SUS tem data de última visita, ela vem preenchida (a pessoa confere na ligação)
    if (item.ultima_visita) {
      $('data_visita_pec').value = item.ultima_visita;
      $('visita_registrada_pec').value = 'true';
    }
  }

  function mostrarFila(r) {
    const barra = $('barra-mailing');
    if (!barra) return;
    if (!r.campanha) { barra.classList.add('hidden'); $('filtro-mailing')?.classList.add('hidden'); return; }
    campanhaAtualId = r.campanha.id;
    barra.classList.remove('hidden');
    barra.classList.toggle('mailing-bar--pausado', Boolean(r.campanha.interrompida));
    $('mailing-titulo').textContent = r.campanha.todas
      ? 'Todos os mailings ativos (ordem aleatória)'
      : r.campanha.nome + (r.campanha.interrompida ? ' — giro interrompido' : '');
    const escopo = filtro.terr.length ? `nas ${filtro.terr.length} microárea(s) escolhida(s)` : 'no total';
    $('mailing-info').textContent = r.campanha.interrompida
      ? 'Interrompido pelo administrador: nenhum novo contato será entregue.'
      : `${r.feitos} atendidos · ${r.pendentes} pendentes · ${r.total} ${escopo}`
        + (r.campanha.todas && r.item?.campanha_nome ? ` · Contato do mailing: ${r.item.campanha_nome}` : '');
    $('btn-pular').classList.toggle('hidden', !contatoAtual);
  }

  // ---- Filtro: escolha da campanha e das microáreas ----
  function renderTerritorios(campId, marcadas) {
    const box = $('f-territorios');
    box.textContent = '';
    if (campId === VALOR_TODAS) {
      box.textContent = 'No modo aleatório, os contatos vêm de todos os mailings em giro (não interrompidos) e o filtro por microárea fica desativado.';
      return;
    }
    const camp = opcoes.find((c) => c.id === campId);
    if (!camp || !camp.territorios.length) { box.textContent = 'Esta campanha ainda não tem contatos.'; return; }
    const porEquipe = new Map();
    camp.territorios.forEach((t) => { if (!porEquipe.has(t.equipe)) porEquipe.set(t.equipe, []); porEquipe.get(t.equipe).push(t); });
    for (const [equipe, lista] of porEquipe) {
      const grupo = document.createElement('div'); grupo.className = 'equipe';
      const tit = document.createElement('strong'); tit.textContent = rotuloEquipe(equipe);
      grupo.appendChild(tit);
      lista.sort((a, b) => a.microarea.localeCompare(b.microarea, undefined, { numeric: true })).forEach((t) => {
        const lab = document.createElement('label'); lab.className = 'check';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = chaveTerr(t); cb.checked = marcadas.has(cb.value);
        const cnt = document.createElement('span'); cnt.className = 'count'; cnt.textContent = t.pendentes;
        lab.append(cb, ' ' + rotuloMicro(t.microarea) + ' ', cnt);
        grupo.appendChild(lab);
      });
      box.appendChild(grupo);
    }
  }

  function renderFiltro() {
    const sel = $('f-campanha');
    if (!sel) return;
    sel.textContent = '';
    const emGiro = opcoes.filter((c) => !c.interrompida);
    if (emGiro.length) {
      const o = document.createElement('option');
      o.value = VALOR_TODAS;
      o.textContent = `Todos os mailings ativos — aleatório (${emGiro.reduce((n, c) => n + c.pendentes, 0)} pendentes)`;
      sel.appendChild(o);
    }
    opcoes.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = `${c.nome}${c.interrompida ? ' — interrompida' : ''} (${c.pendentes} pendentes)`;
      sel.appendChild(o);
    });
    const alvo = filtro.todas && emGiro.length ? VALOR_TODAS
      : opcoes.some((c) => c.id === filtro.campanha_id) ? filtro.campanha_id
      : opcoes.some((c) => c.id === campanhaAtualId) ? campanhaAtualId : opcoes[0]?.id;
    if (alvo != null) sel.value = alvo;
    const idSel = sel.value === VALOR_TODAS ? VALOR_TODAS : Number(sel.value);
    renderTerritorios(idSel, new Set(idSel === filtro.campanha_id ? filtro.terr : []));
  }

  async function carregarOpcoes() {
    try {
      const res = await fetch('/api/mailing/opcoes');
      if (res.status === 401) return irParaLogin();
      opcoes = res.ok ? ((await res.json()).campanhas || []) : [];
    } catch { opcoes = []; }
    // Descarta do filtro salvo o que não existe mais (campanha encerrada/excluída, microárea removida)
    const salvo = lerFiltroSalvo();
    const camp = opcoes.find((c) => c.id === salvo?.campanha_id);
    filtro = salvo?.todas && opcoes.some((c) => !c.interrompida)
      ? { campanha_id: null, todas: true, terr: [] }
      : camp
        ? { campanha_id: camp.id, todas: false, terr: (salvo.terr || []).filter((k) => camp.territorios.some((t) => chaveTerr(t) === k)) }
        : { campanha_id: null, todas: false, terr: [] };
  }

  const alternarFiltro = (abrir) => {
    const painel = $('filtro-mailing');
    if (!painel) return;
    const mostrar = abrir ?? painel.classList.contains('hidden');
    painel.classList.toggle('hidden', !mostrar);
    $('btn-filtro')?.setAttribute('aria-expanded', String(mostrar));
    if (mostrar) renderFiltro();
  };
  $('btn-filtro')?.addEventListener('click', () => alternarFiltro());
  $('f-campanha')?.addEventListener('change', () => {
    const v = $('f-campanha').value;
    const id = v === VALOR_TODAS ? VALOR_TODAS : Number(v);
    renderTerritorios(id, new Set(id === filtro.campanha_id ? filtro.terr : []));
  });
  $('f-limpar')?.addEventListener('click', () => {
    document.querySelectorAll('#f-territorios input:checked').forEach((cb) => { cb.checked = false; });
  });
  $('f-aplicar')?.addEventListener('click', async () => {
    const todas = $('f-campanha').value === VALOR_TODAS;
    const campanha_id = todas ? null : (Number($('f-campanha').value) || null);
    const terr = todas ? [] : [...document.querySelectorAll('#f-territorios input:checked')].map((cb) => cb.value);
    if (contatoAtual && $('status_ligacao').value && !confirm('Há uma ligação preenchida e não salva. Trocar o mailing descarta esses dados e devolve o contato à fila. Continuar?')) return;
    if (contatoAtual) {
      await fetch('/api/mailing/devolver', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: contatoAtual.id })
      }).catch(() => {});
    }
    filtro = { campanha_id, todas, terr };
    salvarFiltro();
    aviso('');
    const achou = await carregarProximo();
    if (achou) alternarFiltro(false);
  });

  async function carregarProximo() {
    try {
      const q = new URLSearchParams();
      if (filtro.todas) q.set('todas', '1');
      else if (filtro.campanha_id) q.set('campanha_id', filtro.campanha_id);
      filtro.terr.forEach((k) => q.append('terr', k));
      const res = await fetch('/api/mailing/proximo' + (q.toString() ? `?${q}` : ''));
      if (res.status === 401) return irParaLogin();
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { aviso(r.mensagem || `Não foi possível carregar o próximo contato (HTTP ${res.status}).`); return false; }
      // A campanha escolhida deixou de estar ativa: volta ao padrão e atualiza as opções
      if (!r.campanha && (filtro.campanha_id || filtro.todas)) {
        filtro = { campanha_id: null, todas: false, terr: [] };
        salvarFiltro();
        await carregarOpcoes();
        return carregarProximo();
      }
      contatoAtual = r.item || null;
      mostrarFila(r);
      if (contatoAtual) { preencher(contatoAtual); return true; }
      limparForm();
      if (r.campanha) aviso(r.mensagem || 'Não há mais contatos pendentes.', 'info');
      return false;
    } catch {
      aviso('Erro na comunicação com o servidor.');
      return false;
    }
  }

  // Modo manual: campos enviados pela extensão antiga (fragmento #...)
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const veioDaExtensao = dadosDoContato.some((c) => params.get(c));
  if (veioDaExtensao) {
    dadosDoContato.forEach((c) => { if ($(c)) $(c).value = params.get(c) || ''; });
    mostrarWhats(params.get('telefone_contato') ? [params.get('telefone_contato')] : [], params.get('responsavel_familiar'));
  }
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  if (!veioDaExtensao) { await carregarOpcoes(); await carregarProximo(); }

  $('btn-pular')?.addEventListener('click', async () => {
    if (!contatoAtual) return;
    await fetch('/api/mailing/devolver', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: contatoAtual.id })
    }).catch(() => {});
    aviso('');
    await carregarProximo();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = form.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(campos.map((c) => [c, $(c)?.value ?? '']));
    payload.microarea = String(payload.microarea || '').trim();
    if (contatoAtual) payload.mailing_id = contatoAtual.id;
    if (botao) botao.disabled = true;
    try {
      const res = await fetch('/api/inqueritos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { alert('Sessão expirada. Faça login novamente.'); return irParaLogin(); }
      if (!res.ok) { aviso('Erro ao salvar: ' + (data.mensagem || `HTTP ${res.status}`)); return; }

      if (contatoAtual) {
        const quem = contatoAtual.nome_paciente || contatoAtual.endereco || 'contato';
        const temProximo = await carregarProximo();
        if (temProximo) aviso(`Pesquisa de "${quem}" salva. Próximo contato carregado.`, 'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        aviso('Pesquisa registrada com sucesso!', 'ok');
        limparForm();
      }
    } catch {
      aviso('Erro na comunicação com o servidor.');
    } finally {
      if (botao) botao.disabled = false;
    }
  });
});
