# Integração com Looker Studio

> O banco de produção é o `schema.sql` isolado fornecido para o ambiente implantado. O `database/schema.sql` do projeto não é usado como fonte de verdade para alterações no D1 de produção.

A aplicação expõe uma camada de BI somente leitura em `/api/bi/*`.

## Configuração do segredo

Não coloque a chave no Git nem em `wrangler.toml`.

Em produção, configure uma chave longa e aleatória como segredo do Cloudflare Pages:

```bash
npx wrangler pages secret put BI_API_KEY
```

A mesma chave deve ser usada pelo conector do Looker Studio.

## Datasets

- `/api/bi/inqueritos`
- `/api/bi/campanhas`
- `/api/bi/mailing?campanha_id=ID`

Autenticação recomendada:

```text
X-BI-Key: <BI_API_KEY>
```

Também é aceito `Authorization: Bearer <BI_API_KEY>`.

A chave deve ser enviada somente em header (`X-BI-Key` ou `Authorization: Bearer`). Não use chave em query string.

## Contrato

Cada resposta JSON contém:

```json
{
  "dataset": "inqueritos",
  "versao": 1,
  "colunas": ["..."],
  "dados": [{"...": "..."}]
}
```

O campo `versao` permite evoluir o contrato sem quebrar relatórios existentes.

## Segurança

A camada de BI não retorna CPF/CNS de pacientes, telefone, endereço, nome de paciente ou observações. Ela foi desenhada para indicadores e dimensões analíticas.

A exportação operacional em CSV continua protegida pela sessão normal do sistema e pela permissão `dados.exportar`.
