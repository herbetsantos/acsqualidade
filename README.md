# Pesquisa de Qualidade - Agente Comunitário de Saúde

Cloudflare Pages + Pages Functions + D1.

## Rodar localmente
```bash
cp .dev.vars.example .dev.vars   # defina JWT_SECRET (string longa e aleatória)
npx wrangler d1 execute inquerito-db --local --file=database/schema.sql
npx wrangler d1 execute inquerito-db --local --file=database/seeds.sql
npx wrangler pages dev web-app --d1 DB=<database_id do wrangler.toml>
```
Usuários de teste (senha `123456`): admin `11122233344`, operador `55566677788`, gestor `22233344455`, auditor `33344455566`.

## Produção

**IMPORTANTE:** o arquivo `database/schema.sql` deste ZIP não é a fonte de verdade da base D1 de produção. Não execute esse SQL remotamente. A produção deve seguir exclusivamente o `schema.sql` isolado fornecido para a base D1.

```bash
npx wrangler pages secret put JWT_SECRET
```
Crie os usuários reais gerando o hash: `node scripts/hash.mjs "senha"` e inserindo em `profissionais`.
**Não use os seeds de teste em produção.**

## Segurança
- Senhas: PBKDF2-SHA256. Sessão: JWT HS256 em cookie `HttpOnly; SameSite=Strict; Secure` (8 h).
- Limite de 5 tentativas erradas / 15 min por CPF + IP.
- Dados do paciente trafegam da extensão para o app no fragmento da URL (`#`), que não vai ao servidor.
- A extensão só lê a página do e-SUS quando o usuário clica no ícone (permissão `activeTab`).


## Mailing territorial — extensão + administrador
1. No e-SUS PEC, abra **Acompanhamento do território**.
2. Clique na extensão e selecione a equipe/microáreas desejadas.
3. Use **Gerar mailing das microáreas selecionadas**.
4. Na Pesquisa de Qualidade, entre em **Administração → Mailing territorial**.
5. Clique em **Importar mailing da extensão**, revise a composição por equipe/microárea e crie a campanha.
6. O servidor grava a população da campanha no D1 e deduplica os registros pelo link/identificador externo.

A extensão mantém temporariamente o mailing no `chrome.storage.local`. A importação para o servidor ocorre somente quando o administrador solicita na tela da Pesquisa de Qualidade.

## Extensão 2.4 — varredura completa do território
A extensão agora tenta, nesta ordem:
1. selecionar cada microárea marcada;
2. aguardar carregamento dinâmico da listagem;
3. aumentar automaticamente a quantidade de itens por página quando o controle estiver disponível;
4. percorrer paginação até a última página, evitando loops por assinatura repetida;
5. fazer rolagem para carregar listas virtualizadas/infinite scroll;
6. capturar links de cidadão/paciente/família/domicílio/imóvel e dados presentes na linha;
7. abrir automaticamente os grupos de imóveis (acordeões por endereço) da tela de acompanhamento, pois os links de imóveis não ficam visíveis enquanto os grupos estão fechados;\n8. observar respostas JSON/XHR carregadas pelo próprio PEC no **mundo principal da página**, quando disponíveis, para localizar dados estruturados que não estejam diretamente expostos no DOM;
9. deduplicar por chave externa antes de salvar o mailing.

A extensão não altera o PEC nem envia dados para fora do navegador durante a coleta. Os dados ficam no armazenamento local da extensão até serem importados para uma campanha.

### Limitação importante
A estrutura do PEC pode mudar e diferentes telas podem usar endpoints/rotas diferentes. Por isso a extensão mantém uma camada híbrida DOM + respostas JSON/XHR. O hook de rede roda no mundo principal da página, porque um script isolado não substitui o `fetch` usado pelo JavaScript da própria aplicação. A extensão também registra a rota específica do e-SUS Cajamar usada pelo acompanhamento territorial. A confirmação de 100% da população deve ser feita comparando o total exibido pelo próprio PEC para cada microárea com o total coletado pela extensão.

## Exportação CSV e BI

Os perfis `admin`, `gestor` e `auditor` possuem a permissão `dados.exportar`.

Endpoints de exportação autenticados pela sessão:
- `GET /api/export/inqueritos.csv?data_inicio=AAAA-MM-DD&data_fim=AAAA-MM-DD`
- `GET /api/export/campanhas.csv`
- `GET /api/export/mailing.csv?campanha_id=ID`

A camada de BI é somente leitura e não usa a sessão do usuário. Configure o segredo `BI_API_KEY` no ambiente do Cloudflare Pages/Functions. Os endpoints são:
- `GET /api/bi/inqueritos`
- `GET /api/bi/campanhas`
- `GET /api/bi/mailing?campanha_id=ID`

A chave pode ser enviada no header `X-BI-Key` ou `Authorization: Bearer ...`. O parâmetro `?key=` também é aceito para integrações que não permitem headers, mas o header é preferível. A API de BI não retorna CPF, CNS, telefone, endereço, nome de paciente ou observações de atendimento.

Para o Looker Studio, a recomendação é usar um Community Connector/Apps Script que consulte esses endpoints com `BI_API_KEY`, mantendo a chave fora da URL pública do relatório. O campo `versao` do dataset deve ser usado para versionar alterações futuras do contrato.

Para publicar a chave do BI em produção, use `npx wrangler pages secret put BI_API_KEY` e depois configure um Community Connector do Looker Studio para consultar os endpoints descritos em `docs/looker-studio.md`.

## Fluxo do mailing (v2.8)

1. **Administrador** — no e-SUS (Acompanhamento do território), abre a extensão, escolhe as microáreas e clica em
   *Gerar mailing*. A extensão abre uma casa por vez (clica na lupa, lê telefone, última visita, equipe e ACS, volta
   para a lista). Pode parar e depois usar *Continuar coleta interrompida*.
2. **Administrador** — em *Mailing* na Pesquisa de Qualidade: importa o mailing da extensão, marca equipes/microáreas e cria a campanha.
3. **Operador** — não precisa da extensão. Ao abrir *Registrar ligação*, o sistema entrega o próximo contato pendente
   da campanha ativa; ao salvar, grava a resposta e já carrega o seguinte. *Pular contato* devolve o atual ao fim da fila.
   Contatos parados há mais de 30 minutos voltam para a fila.

Bancos criados antes da v2.8: rode `database/migracao-v2.8.sql` (um comando por vez).

## WhatsApp (v2.8.8)
Na tela *Registrar ligação*, quando o contato tem **celular**, aparece o **logotipo do WhatsApp** à direita do telefone. Ao clicar nele, abre uma janela com a
mensagem inicial, que o operador pode **editar** (vale só para aquele contato) ou restaurar, e o botão *Abrir no WhatsApp*
abre a conversa (`wa.me`). Contatos com mais de um celular ganham um seletor de número; telefones fixos não recebem o botão.

A **mensagem padrão** é definida pelo administrador no menu superior **Mensagem WhatsApp** (`mensagem-whatsapp.html`) e vale
para todos os operadores. Variáveis: `{paciente}` (primeiro nome do responsável familiar no e-SUS; se não houver nome, o
trecho é removido) e `{operador}` (nome do usuário logado). Texto original: *"Olá, {paciente}, me chamo {operador}, falo do
Departamento de Atenção Primária, da Secretaria de Saúde de Cajamar, tudo bem?"*.

Banco: rode `database/migracao-v2.8.8.sql` (cria a tabela `configuracoes`). Enquanto não rodar, o sistema usa a mensagem
original e a tela de edição avisa que não foi possível salvar.
