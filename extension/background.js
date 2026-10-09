// Coleta do mailing por NAVEGAÇÃO: a extensão clica na lupa de cada casa, lê a página que abre
// (telefone, última visita, equipe, ACS) e volta para a lista. O laço roda dentro da aba do e-SUS,
// então não depende do service worker ficar acordado; o progresso fica em chrome.storage.

// Executa NA PÁGINA do e-SUS (mundo isolado, com acesso a chrome.storage). Precisa ser autocontida.
async function crawlNaPagina(cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const normMicro = (v) => norm(v).replace(/^microárea\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').toLowerCase();
  const LISTA = /acompanhamento-territorio\/?$/;
  const CASA = /visualizarImovel\/(\d+)/;
  const ROW = '[data-testid="MicroareaLogradouroListItemBody"]';
  const BTN_GRUPO = '[data-accordion-component="AccordionItemButton"]';
  const store = (o) => chrome.storage.local.set(o);

  const prog = { type: 'CRAWL_PROGRESS', jobId: cfg.jobId, phase: 'preparo', current: '', total: 0, processed: 0, coletados: 0, semTelefone: 0, errors: 0, ultimoErro: '' };
  const salvarProg = (extra = {}) => { Object.assign(prog, extra, { updatedAt: Date.now() }); return store({ crawlProgress: prog }); };

  const esperar = async (cond, ms = 10000, passo = 150) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const v = cond(); if (v) return v; } catch { /* tenta de novo */ }
      await sleep(passo);
    }
    return null;
  };

  // Lê "rótulo → valor" (o valor é o elemento irmão seguinte do rótulo)
  const valor = (rotulo, raiz = document) => {
    const alvo = rotulo.toLowerCase();
    for (const e of raiz.querySelectorAll('span,div,p,dt,th,label')) {
      if (e.children.length) continue;
      if (norm(e.textContent).replace(/:$/, '').toLowerCase() !== alvo) continue;
      const v = norm(e.nextElementSibling?.textContent);
      if (v) return v;
    }
    return '';
  };
  const semCodigo = (s) => norm(s).replace(/\s*-\s*\d{5,}\s*$/, '');
  const tel = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? norm(s) : ''; };
  const iso = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };

  const abaDe = (micro) => [...document.querySelectorAll('[role="tab"]')].find((e) => normMicro(e.textContent) === normMicro(micro));
  const grupos = () => [...document.querySelectorAll('[data-accordion-component="AccordionItem"]')]
    .map((el) => ({ el, titulo: norm(el.querySelector(BTN_GRUPO)?.textContent) }));

  async function garantirMicro(micro) {
    const aba = await esperar(() => abaDe(micro), 8000);
    if (!aba) return false;
    if (aba.getAttribute('tabindex') !== '0') { aba.click(); await sleep(900); }
    await esperar(() => document.querySelector(ROW) || document.querySelector(BTN_GRUPO), 8000);
    return true;
  }
  async function abrirGrupos() {
    // Reconsulta a tela a cada clique: se a tela se redesenhar, os botões antigos deixam de valer
    for (let i = 0; i < 80; i++) {
      const h = [...document.querySelectorAll(BTN_GRUPO)].find((x) => x.getAttribute('aria-expanded') !== 'true');
      if (!h) break;
      h.click();
      await sleep(350);
    }
    await sleep(300);
  }
  async function voltarParaLista() {
    for (let i = 0; i < 3 && !LISTA.test(location.pathname); i++) {
      history.back();
      await esperar(() => LISTA.test(location.pathname), 6000);
    }
    return LISTA.test(location.pathname);
  }
  async function prepararLista(micro) {
    if (!LISTA.test(location.pathname)) await voltarParaLista();
    const aba = abaDe(micro);
    if (!aba || aba.getAttribute('tabindex') !== '0') await garantirMicro(micro);
    if (!document.querySelector(ROW) || document.querySelector(`${BTN_GRUPO}[aria-expanded="false"]`)) {
      await abrirGrupos();
      await esperar(() => document.querySelector(ROW), 8000);
    }
  }
  const linhaDe = (titulo, idx, ver) => {
    const g = grupos().find((x) => x.titulo === titulo);
    if (!g) return null;
    const rows = [...g.el.querySelectorAll(ROW)];
    if (rows[idx] && norm(rows[idx].innerText).startsWith(ver)) return rows[idx];
    return rows.find((r) => norm(r.innerText).startsWith(ver)) || null;
  };

  // Página da casa (aba "Informações cadastrais")
  function lerCasa() {
    const h1 = norm(document.querySelector('h1')?.textContent);
    const cab = document.querySelector('main header') || document;
    const cep = [...cab.querySelectorAll('span,div,p')].find((e) => !e.children.length && /\d{5}-\d{3}/.test(e.textContent));
    let acs = '';
    const cbo = [...document.querySelectorAll('span,p,div')].find((e) => !e.children.length && norm(e.textContent).toUpperCase() === 'CBO');
    if (cbo) {
      let c = cbo;
      for (let i = 0; i < 8 && c; i++) { c = c.parentElement; if (c && /Unidade de saúde/i.test(c.textContent)) break; }
      if (c) acs = norm([...c.querySelectorAll('span')].find((s) => !s.children.length && !/^(CBO|Equipe|Unidade de saúde)$/i.test(norm(s.textContent)))?.textContent);
    }
    return {
      microarea: valor('Microárea'),
      telefone_contato: valor('Telefone de contato'),
      telefone_residencial: valor('Telefone residencial'),
      ultima_visita: valor('Última visita'),
      equipe: semCodigo(valor('Equipe')),
      unidade: semCodigo(valor('Unidade de saúde')),
      acs,
      endereco: [h1, norm(cep?.textContent)].filter(Boolean).join(' — ')
    };
  }

  let itens = [];
  let semTelSigs = [];
  let falhas = []; // imóveis que deram erro: guardados para o botão "Marcar imóveis com erro no PEC"
  const persistir = () => store({ mailing: { savedAt: new Date().toISOString(), itens: [...new Map(itens.map((x) => [x.chave_externa, x])).values()], contexto: { unidade: cfg.unidade || '', equipe: cfg.equipe || '', semTelSigs } }, crawlFalhas: falhas });
  const terminar = async (fase, msg) => { await persistir(); await salvarProg({ phase: fase, current: msg, coletados: new Set(itens.map((x) => x.chave_externa)).size }); };

  try {
    if (cfg.retomar) {
      const salvo = await chrome.storage.local.get(['mailing', 'crawlFalhas']);
      const ant = salvo.mailing;
      falhas = salvo.crawlFalhas || [];
      itens = ant?.itens || [];
      semTelSigs = ant?.contexto?.semTelSigs || [];
      prog.semTelefone = semTelSigs.length;
    }
    const feitas = new Set([...itens.map((x) => x.sig), ...semTelSigs]);

    // 1) Planejamento: quantas casas há em cada microárea
    await salvarProg({ phase: 'preparo', current: 'Contando as casas…' });
    const plano = [];
    for (const micro of cfg.microareas) {
      await salvarProg({ current: `Contando as casas da microárea ${micro}…` });
      if (!(await garantirMicro(micro))) { prog.errors++; prog.ultimoErro = `Aba da microárea ${micro} não encontrada.`; continue; }
      await abrirGrupos();
      for (const g of grupos()) {
        [...g.el.querySelectorAll(ROW)].forEach((row, idx) => {
          const ver = norm(row.innerText).slice(0, 100);
          plano.push({ micro, titulo: g.titulo, idx, ver, resp: valor('Responsável familiar', row), sig: `${micro}|${g.titulo}|${idx}|${ver}` });
        });
      }
    }
    prog.total = plano.length;
    if (!plano.length) { await terminar('erro', 'Nenhuma casa encontrada nas microáreas escolhidas.'); return; }

    // 2) Visita cada casa
    let n = 0;
    for (const alvo of plano) {
      n++;
      if (feitas.has(alvo.sig)) { prog.processed = n; continue; }
      if ((await chrome.storage.local.get('crawlCancel')).crawlCancel === cfg.jobId) { await terminar('cancelado', 'Coleta interrompida. O que já foi lido foi guardado.'); return; }
      await salvarProg({ phase: 'casa', processed: n - 1, current: `Microárea ${alvo.micro}: casa ${n} de ${plano.length}` });
      try {
        await prepararLista(alvo.micro);
        // A lista pode demorar a redesenhar ao voltar da casa: tenta por alguns segundos e, se preciso, reabre os grupos
        let row = await esperar(() => linhaDe(alvo.titulo, alvo.idx, alvo.ver), 4000);
        if (!row) { await abrirGrupos(); row = await esperar(() => linhaDe(alvo.titulo, alvo.idx, alvo.ver), 6000); }
        if (!row) throw new Error('Linha da casa não encontrada na lista.');
        row.querySelector('button')?.click();
        const abriu = await esperar(() => CASA.test(location.pathname) && valor('Microárea'), 12000);
        if (!abriu) throw new Error('A casa não abriu na mesma aba.');
        await sleep(250);
        const id = location.pathname.match(CASA)[1];
        falhas = falhas.filter((f) => f.sig !== alvo.sig);
        const d = lerCasa();
        const url = `${location.origin}/gestaoCadastros/acompanhamento-territorio/visualizarImovel/${id}`;
        const tels = [...new Set([tel(d.telefone_contato), tel(d.telefone_residencial)].filter(Boolean))];
        if (!tels.length) {
          prog.semTelefone++; semTelSigs.push(alvo.sig);
        } else {
          itens.push({
            chave_externa: url, pec_url: url,
            nome_paciente: alvo.resp && !/n[ãa]o informado/i.test(alvo.resp) ? alvo.resp : '',
            unidade: d.unidade || cfg.unidade || '', equipe: d.equipe || cfg.equipe || '',
            microarea: d.microarea || alvo.micro, acs_nome: d.acs, endereco: d.endereco,
            telefone: tels[0], telefones: tels, ultima_visita: iso(d.ultima_visita), sig: alvo.sig
          });
        }
      } catch (e) {
        prog.errors++; prog.ultimoErro = e.message;
        const g = grupos().find((x) => x.titulo === alvo.titulo);
        const diag = g ? ` [grupo achado; ${g.el.querySelectorAll(ROW).length} linhas na tela; esperada a nº ${alvo.idx + 1}]` : ` [grupo não achado; ${grupos().length} grupos na tela]`;
        falhas = falhas.filter((f) => f.sig !== alvo.sig);
        falhas.push({ sig: alvo.sig, micro: alvo.micro, titulo: alvo.titulo, idx: alvo.idx, ver: alvo.ver, erro: e.message + diag });
      }
      await persistir(); // salva a cada casa: se a página travar, o "Continuar" retoma daqui
      await voltarParaLista();
      await esperar(() => document.querySelector(ROW), 8000);
    }
    prog.processed = plano.length;
    await terminar('concluido', `Coleta concluída: ${new Set(itens.map((x) => x.chave_externa)).size} contatos com telefone.`);
  } catch (e) {
    await terminar('erro', 'Falha na coleta: ' + e.message);
  }
}

async function iniciarColeta(msg) {
  if (!msg.tabId) return { ok: false, mensagem: 'Aba do e-SUS não informada.' };
  const microareas = (msg.microareas || []).filter(Boolean);
  if (!microareas.length) return { ok: false, mensagem: 'Selecione ao menos uma microárea.' };
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cfg = { jobId, microareas, unidade: msg.unidade || '', equipe: msg.equipe || '', retomar: Boolean(msg.retomar) };
  await chrome.storage.local.remove(cfg.retomar ? ['crawlCancel'] : ['crawlCancel', 'crawlFalhas']);
  await chrome.storage.local.set({ crawlProgress: { type: 'CRAWL_PROGRESS', jobId, phase: 'preparo', current: 'Iniciando…', total: 0, processed: 0, coletados: 0, semTelefone: 0, errors: 0, updatedAt: Date.now() } });
  // Não aguarda o fim: o laço roda na aba e informa o progresso pelo storage
  chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: crawlNaPagina, args: [cfg] })
    .catch((e) => chrome.storage.local.set({ crawlProgress: { type: 'CRAWL_PROGRESS', jobId, phase: 'erro', current: 'Não foi possível iniciar: ' + e.message, total: 0, processed: 0, coletados: 0, semTelefone: 0, errors: 1 } }));
  return { ok: true, jobId };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'START_SEQUENTIAL_CRAWL') {
    iniciarColeta(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, mensagem: e.message }));
    return true;
  }
  if (msg?.type === 'STOP_CRAWL') {
    chrome.storage.local.get('crawlProgress').then(({ crawlProgress }) => {
      const p = crawlProgress;
      const viva = p && ['preparo', 'casa'].includes(p.phase) && Date.now() - (p.updatedAt || 0) < 90000;
      // Se o laço morreu (página atualizada/travada), ninguém vai ler o cancelamento: encerra o estado aqui
      if (p && ['preparo', 'casa'].includes(p.phase) && !viva) {
        return chrome.storage.local.set({ crawlProgress: { ...p, phase: 'cancelado', current: 'Coleta interrompida. O que já foi lido foi guardado.', updatedAt: Date.now() } });
      }
      return chrome.storage.local.set({ crawlCancel: p?.jobId || 'x' });
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'GET_CRAWL_PROGRESS') {
    chrome.storage.local.get(['crawlProgress', 'mailing']).then((data) => sendResponse({ ok: true, ...data }));
    return true;
  }
  if (msg?.type === 'SAVE_MAILING') {
    chrome.storage.local.set({ mailing: { savedAt: new Date().toISOString(), itens: Array.isArray(msg.itens) ? msg.itens : [], contexto: msg.contexto || {} } })
      .then(() => sendResponse({ ok: true, total: msg.itens?.length || 0 })).catch((err) => sendResponse({ ok: false, mensagem: err.message }));
    return true;
  }
  if (msg?.type === 'GET_MAILING') {
    chrome.storage.local.get('mailing').then((data) => sendResponse({ ok: true, mailing: data.mailing || null })).catch((err) => sendResponse({ ok: false, mensagem: err.message }));
    return true;
  }
  if (msg?.type === 'CLEAR_MAILING') {
    chrome.storage.local.remove(['mailing', 'crawlResult', 'crawlProgress', 'crawlCancel', 'crawlFalhas']).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, mensagem: err.message }));
    return true;
  }
});
