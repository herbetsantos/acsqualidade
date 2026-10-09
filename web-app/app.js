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
  };

  function preencher(item) {
    limparForm();
    $('microarea').value = item.microarea || '';
    $('acs_nome').value = item.acs_nome || '';
    $('endereco_pec').value = item.endereco || '';
    $('responsavel_familiar').value = item.nome_paciente || '';
    const tels = item.telefones?.length ? item.telefones : (item.telefone ? [item.telefone] : []);
    $('telefone_contato').value = tels[0] || '';
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
    if (!r.campanha) { barra.classList.add('hidden'); return; }
    barra.classList.remove('hidden');
    $('mailing-titulo').textContent = r.campanha.nome;
    $('mailing-info').textContent = `${r.feitos} atendidos · ${r.pendentes} pendentes · ${r.total} no total`;
    $('btn-pular').classList.toggle('hidden', !contatoAtual);
  }

  async function carregarProximo() {
    try {
      const res = await fetch('/api/mailing/proximo');
      if (res.status === 401) return irParaLogin();
      const r = await res.json().catch(() => ({}));
      if (!res.ok) { aviso(r.mensagem || `Não foi possível carregar o próximo contato (HTTP ${res.status}).`); return false; }
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
  }
  if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  if (!veioDaExtensao) await carregarProximo();

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
        if (temProximo) aviso(`Inquérito de "${quem}" salvo. Próximo contato carregado.`, 'ok');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        aviso('Inquérito registrado com sucesso!', 'ok');
        limparForm();
      }
    } catch {
      aviso('Erro na comunicação com o servidor.');
    } finally {
      if (botao) botao.disabled = false;
    }
  });
});
