// Redefine a senha do usuário "admin" para 1806, sem mexer em mais nada do data.json.
// Uso (com o sistema PARADO), na pasta do sistema:  node redefinir-admin.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQUIVO = path.resolve(__dirname, process.env.ARQUIVO_DADOS || 'data.json');
const NOVA_SENHA = '1806';

const gerarHashSenha = (s) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(s), salt, 64).toString('hex')}`;
};

const data = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
if (!Array.isArray(data.usuarios)) data.usuarios = [];
if (!Array.isArray(data.sessoes)) data.sessoes = [];

fs.copyFileSync(ARQUIVO, `${ARQUIVO}.antes-redefinir-${Date.now()}.bak`);

let u = data.usuarios.find((x) => String(x.usuario || '').toLowerCase() === 'admin');
if (!u) {
  u = { id: crypto.randomUUID(), nome: 'Administrador', usuario: 'admin', perfil: 'admin', loja: null, criadoEm: Date.now(), ultimoAcessoEm: null };
  data.usuarios.push(u);
}
u.senhaHash = gerarHashSenha(NOVA_SENHA);
u.perfil = 'admin';
u.loja = null;
u.ativo = true;
u.precisaTrocarSenha = false;
data.sessoes = data.sessoes.filter((s) => s.usuarioId !== u.id);

fs.writeFileSync(ARQUIVO, JSON.stringify(data, null, 2));
console.log('Pronto: usuário "admin" com a senha nova. Backup criado ao lado do data.json.');
