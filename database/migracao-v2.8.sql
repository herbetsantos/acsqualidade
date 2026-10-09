-- Rode cada comando separadamente no console do D1.
-- (As tabelas de campanha/mailing só são criadas se ainda não existirem.)

CREATE TABLE IF NOT EXISTS campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    unidade TEXT,
    composicao_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','encerrada')),
    criado_por INTEGER NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    total_esperado INTEGER DEFAULT 0,
    total_coletado INTEGER DEFAULT 0,
    total_duplicado INTEGER DEFAULT 0,
    total_sem_cadastro INTEGER DEFAULT 0,
    coleta_percentual REAL DEFAULT 0,
    coleta_validada INTEGER DEFAULT 0,
    coleta_validada_em TEXT,
    FOREIGN KEY (criado_por) REFERENCES profissionais(id)
);

CREATE TABLE IF NOT EXISTS campanha_mailing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campanha_id INTEGER NOT NULL,
    chave_externa TEXT NOT NULL,
    nome_paciente TEXT,
    cns TEXT,
    cpf TEXT,
    data_nascimento TEXT,
    unidade TEXT,
    equipe TEXT,
    microarea TEXT,
    acs_nome TEXT,
    endereco TEXT,
    telefone TEXT,
    telefones_json TEXT,
    ultima_visita TEXT,
    pec_url TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluido','nao_localizado','recusou','sem_cadastro','duplicado')),
    operador_id INTEGER,
    atualizado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campanha_id) REFERENCES campanhas(id) ON DELETE CASCADE,
    FOREIGN KEY (operador_id) REFERENCES profissionais(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campanha_mailing ON campanha_mailing(campanha_id, chave_externa);

CREATE INDEX IF NOT EXISTS idx_campanha_mailing_campanha ON campanha_mailing(campanha_id, status);

CREATE INDEX IF NOT EXISTS idx_campanha_mailing_territorio ON campanha_mailing(campanha_id, equipe, microarea);

ALTER TABLE inqueritos ADD COLUMN mailing_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_inqueritos_mailing ON inqueritos(mailing_id);
