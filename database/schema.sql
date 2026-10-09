CREATE TABLE IF NOT EXISTS profissionais (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL DEFAULT 'operador' CHECK (perfil IN ('admin','operador','auditor','gestor')),
    cnes TEXT,
    equipe TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inqueritos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profissional_id INTEGER,
    microarea TEXT,
    acs_nome TEXT,
    endereco_pec TEXT,
    responsavel_familiar TEXT,
    telefone_contato TEXT,
    visita_registrada_pec INTEGER,      -- 1 = e-SUS registra visita
    data_visita_pec TEXT,               -- AAAA-MM-DD
    visita_relatada_paciente INTEGER,   -- 1 = paciente confirma a visita
    status_ligacao TEXT NOT NULL,
    conhece_agente INTEGER,
    nivel_satisfacao INTEGER CHECK (nivel_satisfacao IS NULL OR nivel_satisfacao BETWEEN 0 AND 10),
    observacoes TEXT,
    data_aplicacao TEXT DEFAULT CURRENT_TIMESTAMP,
    mailing_id INTEGER,                 -- contato do mailing que originou o inquérito
    FOREIGN KEY (profissional_id) REFERENCES profissionais(id)
);

CREATE INDEX IF NOT EXISTS idx_inqueritos_profissional ON inqueritos(profissional_id);
CREATE INDEX IF NOT EXISTS idx_inqueritos_acs ON inqueritos(acs_nome);

-- Controle de tentativas de login (limite por CPF + IP)
CREATE TABLE IF NOT EXISTS login_falhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT NOT NULL,
    ip TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_falhas ON login_falhas(cpf, ip, criado_em);


-- Campanhas e mailing territorial
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
