// Uso: node scripts/hash.mjs "minhaSenha"   -> imprime o hash para colocar em profissionais.senha_hash
import { gerarHash } from '../functions/_lib/auth.js';
console.log(await gerarHash(process.argv[2] || ''));
