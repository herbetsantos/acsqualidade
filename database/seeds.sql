-- Usuários de TESTE LOCAL. Senha dos usuários de teste: 123456  (troque antes de ir para produção!)
INSERT OR IGNORE INTO profissionais (cpf, nome, senha_hash, perfil, cnes) VALUES
('11122233344', 'Gestor', 'pbkdf2$100000$diTFY/+F/zzqK3yuJ50C9w==$yx3iJ7/bbt+XW2Mm91X9FsCOB7pJkywai8JCAdq+sUE=', 'admin', '1234567'),
('55566677788', 'Operador ACS', 'pbkdf2$100000$diTFY/+F/zzqK3yuJ50C9w==$yx3iJ7/bbt+XW2Mm91X9FsCOB7pJkywai8JCAdq+sUE=', 'operador', '1234567'),
('22233344455', 'Gestor de Teste', 'pbkdf2$100000$diTFY/+F/zzqK3yuJ50C9w==$yx3iJ7/bbt+XW2Mm91X9FsCOB7pJkywai8JCAdq+sUE=', 'gestor', '1234567'),
('33344455566', 'Auditor de Teste', 'pbkdf2$100000$diTFY/+F/zzqK3yuJ50C9w==$yx3iJ7/bbt+XW2Mm91X9FsCOB7pJkywai8JCAdq+sUE=', 'auditor', '1234567');
