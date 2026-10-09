window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'inquerito-admin') return;
  if (event.data.action === 'getMailingFromExtension') {
    chrome.runtime.sendMessage({type:'GET_MAILING'}, (res) => {
      window.postMessage({source:'inquerito-extension', action:'mailingResponse', payload:res || {ok:false}}, '*');
    });
  }
  if (event.data.action === 'clearMailing') {
    chrome.runtime.sendMessage({type:'CLEAR_MAILING'}, (res) => {
      window.postMessage({source:'inquerito-extension', action:'clearMailingResponse', payload:res || {ok:false}}, '*');
    });
  }
});
