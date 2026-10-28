-- v2.9: o administrador pode interromper (e retomar) o giro de um mailing.
-- Rode no console do D1, UM COMANDO POR VEZ, ANTES de publicar as novas funções.
-- Não altera a coluna "status" (que tem CHECK): usa colunas novas.

ALTER TABLE campanhas ADD COLUMN giro_interrompido INTEGER NOT NULL DEFAULT 0;

ALTER TABLE campanhas ADD COLUMN giro_interrompido_em TEXT;

ALTER TABLE campanhas ADD COLUMN giro_interrompido_por INTEGER;
