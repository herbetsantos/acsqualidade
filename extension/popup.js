const $ = id => document.getElementById(id);
const status = msg => { $('status').textContent = msg; };

const INQUERITO = 'https://inquerito.pages.dev';
const FASES_ATIVAS = ['preparo', 'casa'];
// Coleta só é "ativa" se o laço deu sinal de vida recentemente (a página atualizada mata o laço sem avisar)
const ativa = (p) => !!p && FASES_ATIVAS.includes(p.phase) && Date.now() - (p.updatedAt || 0) < 90000;
let podeGerar = true;
let monitor;

// O servidor sempre confere o perfil na importação; aqui só evitamos trabalho à toa.
async function verificarPerfil() {
  try {
    const r = await fetch(INQUERITO + '/api/me', { credentials: 'include' });
    if (r.ok) {
      const me = await r.json();
      $('perfil').textContent = `${me.nome} (${me.perfil})`;
      if (me.perfil !== 'admin') {
        podeGerar = false;
        $('btnGerar').disabled = true; $('btnRetomar').disabled = true;
        status('Somente o perfil administrador gera o mailing. Entre como administrador na Pesquisa de Qualidade.');
      }
      return;
    }
    $('perfil').textContent = 'não confirmado';
    status('Entre como administrador em ' + INQUERITO.replace('https://', '') + '. A importação do mailing exige esse perfil.');
  } catch {
    $('perfil').textContent = 'não confirmado';
  }
}

async function executar(retomar = false) {
  if (!podeGerar) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { status('Nenhuma aba ativa.'); return; }
  const selecionadas = [...document.querySelectorAll('input[name="microarea"]:checked')].map(x => x.value);
  if (!selecionadas.length) { status('Selecione ao menos uma microárea.'); return; }
  if (!/^https:\/\/esus\.cajamar\.sp\.gov\.br\/gestaoCadastros\/acompanhamento-territorio/.test(tab.url || '')) {
    status('Abra o e-SUS na tela Acompanhamento do território.'); return;
  }
  const ctx = id => { const t = $(id).textContent; return /^(—|Não identificada)$/.test(t) ? '' : t; };
  $('btnGerar').disabled = true; $('btnRetomar').disabled = true;
  status('Iniciando a coleta…');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'START_SEQUENTIAL_CRAWL', tabId: tab.id, microareas: selecionadas, unidade: ctx('unidade'), equipe: ctx('equipe'), retomar });
    if (!r?.ok) { status('Falha ao iniciar: ' + (r?.mensagem || 'erro desconhecido')); $('btnGerar').disabled = false; $('btnRetomar').disabled = false; return; }
    monitorarColeta(r.jobId);
  } catch (e) { status('Não foi possível iniciar a coleta: ' + e.message); $('btnGerar').disabled = false; $('btnRetomar').disabled = false; }
}

// Executa NA PÁGINA do e-SUS: destaca em vermelho as casas que deram erro na coleta (autocontida)
async function marcarFalhasNaPagina(falhas, limpar) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const normMicro = (v) => norm(v).replace(/^microárea\s*/i, '').replace(/\s*\(\d+\)\s*$/, '').toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ROW = '[data-testid="MicroareaLogradouroListItemBody"]';
  const BTN = '[data-accordion-component="AccordionItemButton"]';
  const ITEM = '[data-accordion-component="AccordionItem"]';
  const ESTILO = 'inq-erro-style';
  if (window.__inqObs) { window.__inqObs.disconnect(); window.__inqObs = null; }
  document.querySelectorAll('[data-inq-erro]').forEach((e) => { e.removeAttribute('data-inq-erro'); e.removeAttribute('title'); });
  if (limpar) { document.getElementById(ESTILO)?.remove(); return { ok: true, limpo: true }; }
  if (!document.getElementById(ESTILO)) {
    const st = document.createElement('style'); st.id = ESTILO;
    st.textContent = '[data-inq-erro]{position:relative !important;outline:3px solid #d32f2f !important;outline-offset:-3px;background:#fff1f0 !important}' +
      '[data-inq-erro]::before{content:"⚠ ERRO NA COLETA: " attr(data-inq-erro);position:absolute;top:0;right:8px;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;z-index:5;background:#b71c1c;color:#fff;font:700 11px Arial,sans-serif;padding:2px 8px;border-radius:0 0 6px 6px}';
    document.head.appendChild(st);
  }
  const microAtiva = () => { const a = [...document.querySelectorAll('[role="tab"]')].find((e) => e.getAttribute('tabindex') === '0'); return a ? normMicro(a.textContent) : ''; };
  const aplicar = () => {
    const daAba = falhas.filter((f) => normMicro(f.micro) === microAtiva());
    const marcados = []; let naoLocalizados = 0;
    for (const f of daAba) {
      const g = [...document.querySelectorAll(ITEM)].find((el) => norm(el.querySelector(BTN)?.textContent) === f.titulo);
      const rows = g ? [...g.querySelectorAll(ROW)] : [];
      let row = rows[f.idx] && norm(rows[f.idx].innerText).startsWith(f.ver) ? rows[f.idx] : rows.find((r) => norm(r.innerText).startsWith(f.ver));
      if (!row) row = [...document.querySelectorAll(ROW)].find((r) => norm(r.innerText).startsWith(f.ver));
      if (row) { row.setAttribute('data-inq-erro', f.erro || 'erro'); row.title = f.erro || ''; marcados.push(row); } else naoLocalizados++;
    }
    return { daAba: daAba.length, marcados, naoLocalizados };
  };
  // Abre os grupos (ruas) fechados para as casas aparecerem
  for (let i = 0; i < 80; i++) {
    const h = [...document.querySelectorAll(BTN)].find((x) => x.getAttribute('aria-expanded') !== 'true');
    if (!h) break; h.click(); await sleep(350);
  }
  await sleep(300);
  const r = aplicar();
  r.marcados[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  // Se a tela se redesenhar (ou trocar de microárea), reaplica as marcas
  let t; window.__inqObs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(aplicar, 400); });
  window.__inqObs.observe(document.body, { childList: true, subtree: true });
  return { ok: true, microarea: microAtiva(), total: falhas.length, daAba: r.daAba, marcados: r.marcados.length, naoLocalizados: r.naoLocalizados };
}

async function atualizarFalhas() {
  const { crawlFalhas } = await chrome.storage.local.get('crawlFalhas');
  const n = (crawlFalhas || []).length;
  $('btnMarcar').style.display = n ? '' : 'none';
  $('btnDesmarcar').style.display = n ? '' : 'none';
  $('btnMarcar').textContent = `🔍 Marcar ${n} imóvel(is) com erro no PEC`;
  return crawlFalhas || [];
}

async function marcarNoPec(limpar) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/^https:\/\/esus\.cajamar\.sp\.gov\.br\/gestaoCadastros\/acompanhamento-territorio\/?$/.test(tab?.url || '')) {
    status('Volte à lista do Acompanhamento do território (fora da tela de uma casa) e tente de novo.'); return;
  }
  const falhas = await atualizarFalhas();
  status(limpar ? 'Removendo marcas…' : 'Marcando os imóveis…');
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: marcarFalhasNaPagina, args: [falhas, !!limpar] });
    if (result?.limpo) { status('Marcas removidas.'); return; }
    status(`Microárea ${result.microarea || '?'}: ${result.marcados} de ${result.daAba} imóvel(is) com erro marcados em vermelho.` +
      (result.naoLocalizados ? `\n${result.naoLocalizados} não apareceram na tela (clique de novo para reabrir as ruas).` : '') +
      `\nTotal com erro em todas as microáreas: ${result.total}. Ao trocar de microárea, clique de novo em Marcar.`);
  } catch (e) { status('Não foi possível marcar: ' + e.message); }
}

function resumo(p) {
  const partes = [`${p.coletados || 0} contatos com telefone`];
  if (p.semTelefone) partes.push(`${p.semTelefone} sem telefone (ignorados)`);
  if (p.errors) partes.push(`${p.errors} erro(s)${p.ultimoErro ? ': ' + p.ultimoErro : ''}`);
  return partes.join(' · ') + (p.aviso ? '\n' + p.aviso : '');
}

function monitorarColeta(jobId) {
  clearInterval(monitor);
  $('btnParar').style.display = '';
  monitor = setInterval(async () => {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'GET_CRAWL_PROGRESS' });
      const p = r?.crawlProgress;
      if (!p || (jobId && p.jobId !== jobId)) return;
      if (ativa(p)) {
        status(`${p.current || 'Processando…'}\n${p.processed || 0}/${p.total || 0} casas · ${resumo(p)}`);
        return;
      }
      clearInterval(monitor);
      atualizarFalhas();
      $('btnParar').style.display = 'none';
      $('btnGerar').disabled = !podeGerar; $('btnRetomar').disabled = !podeGerar;
      if (FASES_ATIVAS.includes(p.phase)) {
        status(`Coleta interrompida (a página foi atualizada ou travou). O que já foi lido está guardado.\nVolte à lista do Acompanhamento do território e clique em "Continuar coleta interrompida".\n${resumo(p)}`);
        return;
      }
      status(`${p.current || p.phase}\n${resumo(p)}${p.phase === 'concluido' || p.phase === 'cancelado' ? '\nAgora importe o mailing na página Mailing da Pesquisa de Qualidade.' : ''}`);
    } catch (_) {}
  }, 1200);
}

async function carregarContexto() {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (!tab?.id) { status('Nenhuma aba ativa.'); return; }
  try {
    const [{result}] = await chrome.scripting.executeScript({
      target:{tabId:tab.id},
      world:'MAIN',
      func:()=>{
        const txt=el=>el?.innerText?.trim()||el?.value?.trim()||'';
        const body=document.body?.innerText||'';
        const unidade=txt(document.querySelector('input[name="unidadeSaude"]')) ||
          txt(document.querySelector('[data-unidade-saude], .unidade-saude')) ||
          ((body.match(/Unidade(?: de saúde)?\s*:?\s*([^\n]+)/i)||[])[1]||'').trim();
        const equipe=txt(document.querySelector('input[name="equipe"]')) ||
          txt(document.querySelector('[data-equipe], .equipe')) ||
          ((body.match(/Equipe\s*:?\s*([^\n]+)/i)||[])[1]||'').trim();
        const tabs=[...document.querySelectorAll('[role="tab"]')].map(el=>txt(el)).filter(Boolean);
        const microareas=[...new Set(tabs.filter(t=>/^(microárea\s*)?\d{1,3}(\s*\(\d+\))?$/i.test(t)||/fora de área/i.test(t)))];
        return {unidade,equipe,microareas};
      }
    });
    $('unidade').textContent=result?.unidade||'Não identificada';
    $('equipe').textContent=result?.equipe||'Não identificada';
    const box=$('microareas'); box.innerHTML='';
    (result?.microareas||[]).forEach(m=>{
      const l=document.createElement('label'); l.className='micro';
      const input=document.createElement('input'); input.type='checkbox'; input.name='microarea'; input.value=m; input.checked=true;
      l.append(input,document.createTextNode(' '+m)); box.appendChild(l);
    });
    if(!result?.microareas?.length) box.textContent='Nenhuma microárea identificada nesta tela.';
    status(result?.microareas?.length ? 'Pronto para coletar.' : 'Abra Acompanhamento do território e selecione uma microárea.');
  } catch(e) {
    status('Abra o e-SUS na tela Acompanhamento do território.');
  }
}

$('btnMarcar').onclick=()=>marcarNoPec(false);
$('btnDesmarcar').onclick=()=>marcarNoPec(true);
$('btnTodos').onclick=()=>document.querySelectorAll('input[name="microarea"]').forEach(x=>x.checked=true);
$('btnGerar').onclick=()=>executar(false);
$('btnRetomar').onclick=()=>executar(true);
$('btnParar').onclick=async()=>{ await chrome.runtime.sendMessage({type:'STOP_CRAWL'}); status('Parando após a casa atual…'); };
$('status').style.whiteSpace='pre-line';
(async()=>{
  await carregarContexto();
  await verificarPerfil();
  await atualizarFalhas();
  // Se a coleta já estiver rodando (popup reaberto), volta a acompanhar
  const r=await chrome.runtime.sendMessage({type:'GET_CRAWL_PROGRESS'}).catch(()=>null);
  if(ativa(r?.crawlProgress)){ $('btnGerar').disabled=true; $('btnRetomar').disabled=true; monitorarColeta(r.crawlProgress.jobId); }
})();
