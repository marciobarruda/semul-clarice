'use strict';

require('dotenv').config();

const express      = require('express');
const cookieParser = require('cookie-parser');
const helmet       = require('helmet');
const cors         = require('cors');
const path         = require('path');

const { requireAuth, requireApiAuth } = require('./auth');

// ── Rotas da API ──────────────────────────────────────────────────────────────
const prontuariosRouter = require('./routes/prontuarios');
const evolucoesRouter   = require('./routes/evolucoes');
const anexosRouter      = require('./routes/anexos');
const familiaRouter     = require('./routes/familia');
const autoresRouter     = require('./routes/autores');
const auxiliarRouter    = require('./routes/auxiliar');

// ── App ───────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', true);

// ── Middlewares globais ───────────────────────────────────────────────────────
// app.use(helmet({
//   contentSecurityPolicy: false, // index.html usa CDNs externos (Bootstrap, etc.)
// }));

app.use((req, res, next) => {
  // Caso o Nginx não remova o subcaminho, o backend faz isso para não quebrar as rotas do Express
  if (req.url.startsWith('/redeclaricelispector-prontuario')) {
    req.url = req.url.replace('/redeclaricelispector-prontuario', '');
    if (req.url === '') req.url = '/';
  }

  const hasToken = !!(req.cookies?.portal_clarice_token);
  console.log(`[Request] ${req.method} ${req.originalUrl} - HasToken: ${hasToken}`);
  console.log(`[Headers] ${JSON.stringify(req.headers)}`);
  next();
});

app.use(cors({
  origin:      process.env.CORS_ORIGIN || true,
  credentials: true,
}));

app.use(express.json({ limit: '20mb' }));          // anexos em base64 podem ser grandes
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// ── Health check (obrigatório pelo Cloud Run) ─────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'clarice-portal', ts: new Date().toISOString() });
});

// ── Dados do Usuário ──────────────────────────────────────────────────────────
app.get('/api/me', requireApiAuth, (req, res) => {
  res.json(req.user);
});

// ── Logout ────────────────────────────────────────────────────────────────────
app.get('/logout', (req, res) => {
  res.clearCookie('portal_clarice_token');
  res.redirect('/');
});

// ── API routes (protegidas por token Keycloak) ────────────────────────────────
app.use('/api', requireApiAuth);
app.use('/api/prontuarios', prontuariosRouter);
app.use('/api/evolucoes',   evolucoesRouter);
app.use('/api/familia',     familiaRouter);
app.use('/api/autores',     autoresRouter);
app.use('/api/anexos',      anexosRouter);
app.use('/api',             auxiliarRouter);   // nacionalidades, naturalidades, rpa

// ── Servir index.html (protegido por autenticação Keycloak) ───────────────────
// Qualquer GET que não seja /api ou /health serve o portal
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Inicialização ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Clarice Portal rodando na porta ${PORT}`);
  console.log(`[Server] Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Keycloak Client ID: ${process.env.KC_CLIENT_ID || '⚠️  NÃO CONFIGURADO (modo dev)'}`);
});

module.exports = app;
