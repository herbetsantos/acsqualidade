-- v2.8.8: mensagem padrão do WhatsApp (editável pelo administrador).
-- Rode no console do D1 (um comando por vez).

CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    atualizado_por INTEGER
);
