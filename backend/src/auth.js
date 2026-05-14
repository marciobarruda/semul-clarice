'use strict';

/**
 * auth.js
 * Implementa o fluxo OAuth2 Authorization Code do Keycloak,
 * replicando exatamente a lógica que o n8n executava:
 *
 * 1. Lê o token do cookie "token" (mesma prioridade do n8n)
 * 2. Sem token → gera nonce+state → redireciona para Keycloak
 * 3. Callback (?code=...) → troca code por access_token (HTTP Basic Auth)
 *    → Set-Cookie: token=<access_token> → redireciona para /
 * 4. Token presente → valida via /userinfo do Keycloak
 * 5. Verifica se preferred_username está em ALLOWED_USERS
 */

const fetch   = require('node-fetch');
const { v4: uuidv4 } = require('uuid');

// ── Configuração do Keycloak ─────────────────────────────────────────────────
const KC = {
  authUrl:      process.env.KC_AUTH_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/auth',
  tokenUrl:     process.env.KC_TOKEN_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/token',
  userinfoUrl:  process.env.KC_USERINFO_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/userinfo',
  clientId:     process.env.KC_CLIENT_ID || 'portal-crcl',
  clientSecret: process.env.KC_CLIENT_SECRET || 'c6b83877-54cd-4b57-8df5-aa78d2c40e79',
  redirectUri:  process.env.KC_REDIRECT_URI || 'https://semul.recife.pe.gov.br/redeclaricelispector-prontuario',
};

// Lista de usuários autorizados (preferred_username, minúsculas)
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
  .split(',')
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);

// Cache para a lista de usuários do SESUITE
let sesuiteCache = {
  users: [],
  lastFetch: 0,
  ttl: 5 * 60 * 1000 // 5 minutos
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extrai o token do cookie (mesma lógica do nó "Code in JavaScript" do n8n) */
function extractToken(req) {
  // 1. Cookie "token" (prioridade máxima – é como o n8n salvava)
  if (req.cookies?.token) return req.cookies.token;

  // 2. Query ?authorization=
  if (req.query?.authorization) {
    return req.query.authorization.replace(/^bearer\s+/i, '').trim();
  }

  // 3. Header Authorization
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    return authHeader.replace(/^bearer\s+/i, '').trim();
  }

  return null;
}

/** Valida o token com o endpoint /userinfo do Keycloak */
async function getUserInfo(token) {
  try {
    const res = await fetch(KC.userinfoUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Troca o authorization code por access_token (Basic Auth com client_id:secret) */
async function exchangeCode(code) {
  const credentials = Buffer.from(`${KC.clientId}:${KC.clientSecret}`).toString('base64');
  const res = await fetch(KC.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
      'Cookie':        'KEYCLOAK_LOCALE=pt-BR',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: KC.redirectUri,
    }),
    timeout: 10_000,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Keycloak token exchange failed (${res.status}): ${body}`);
  }
  return await res.json();
}

/** Monta a URL de login do Keycloak com nonce + state */
function buildLoginUrl() {
  const nonce = uuidv4();
  const state = uuidv4();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     KC.clientId,
    redirect_uri:  KC.redirectUri,
    nonce,
    state,
    scope: 'openid',
  });
  return `${KC.authUrl}?${params.toString()}`;
}

/** Verifica se o usuário tem acesso via API do SESUITE */
async function checkSesuiteAccess(username) {
  // 1. Se o usuário estiver na lista estática ALLOWED_USERS, libera direto
  if (ALLOWED_USERS.length > 0 && ALLOWED_USERS.includes(username.toLowerCase())) {
    return true;
  }

  // 2. Tenta carregar do cache se for recente
  const now = Date.now();
  if (sesuiteCache.users.length > 0 && (now - sesuiteCache.lastFetch < sesuiteCache.ttl)) {
    return sesuiteCache.users.includes(username.toLowerCase());
  }

  // 3. Consulta a API do SESUITE
  try {
    const url = process.env.SESUITE_API_URL || 'https://sesuite.recife.pe.gov.br/apigateway/v1/dataset-integration/equiperedeclarice';
    const token = process.env.SESUITE_API_TOKEN;

    console.log(`[Auth] Consultando SESUITE para autorização do usuário: ${username}`);
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token // O usuário forneceu o token completo para o header Authorization
      },
      body: JSON.stringify({}),
      timeout: 10000
    });

    if (!res.ok) {
      console.error(`[Auth] Erro na API do SESUITE (${res.status})`);
      // Em caso de erro na API, se tivermos cache antigo, usamos ele como fallback
      if (sesuiteCache.users.length > 0) return sesuiteCache.users.includes(username.toLowerCase());
      return false;
    }

    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);
    
    // Extrai os logins e atualiza o cache
    const authorizedLogins = list.map(u => String(u.login || '').toLowerCase()).filter(Boolean);
    
    sesuiteCache = {
      users: authorizedLogins,
      lastFetch: now,
      ttl: 5 * 60 * 1000
    };

    console.log(`[Auth] Cache do SESUITE atualizado com ${authorizedLogins.length} usuários.`);
    return authorizedLogins.includes(username.toLowerCase());

  } catch (err) {
    console.error('[Auth] Falha crítica ao consultar SESUITE:', err.message);
    if (sesuiteCache.users.length > 0) return sesuiteCache.users.includes(username.toLowerCase());
    return false;
  }
}

/** Página de acesso negado */
function deniedPage(username) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Acesso Negado</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f7f6;}
.box{text-align:center;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);}
h2{color:#e74c3c;}a{color:#9b59b6;}</style></head>
<body><div class="box">
<h2>⛔ Acesso Negado</h2>
<p>O usuário <strong>${username}</strong> não tem permissão para acessar este portal.</p>
<p><a href="/logout">Sair e tentar com outro usuário</a></p>
</div></body></html>`;
}

// ── Middleware para páginas HTML (redireciona para Keycloak) ─────────────────

async function requireAuth(req, res, next) {
  // Verificar configuração do Keycloak
  if (!KC.clientId || !KC.clientSecret) {
    console.warn('[Auth] KC_CLIENT_ID / KC_CLIENT_SECRET não configurados. Pulando autenticação.');
    req.user = { preferred_username: 'dev', name: 'Dev Mode' };
    return next();
  }

  // Callback OAuth2: ?code=...
  if (req.query.code) {
    try {
      const tokenData = await exchangeCode(req.query.code);
      const isProd = process.env.NODE_ENV === 'production';

      res.cookie('token', tokenData.access_token, {
        httpOnly: true,
        secure:   isProd,
        sameSite: 'Lax',
        maxAge:   (tokenData.expires_in || 300) * 1000,
      });

      console.log('[Auth] Código trocado por token com sucesso.');
      return res.redirect('/');
    } catch (err) {
      console.error('[Auth] Falha ao trocar código Keycloak:', err.message);
      return res.status(401).send(
        '<h2>Falha na autenticação</h2><p><a href="/">Tentar novamente</a></p>'
      );
    }
  }

  // Verifica token existente
  const token = extractToken(req);
  if (!token) {
    return res.redirect(buildLoginUrl());
  }

  const userInfo = await getUserInfo(token);
  if (!userInfo) {
    res.clearCookie('token');
    return res.redirect(buildLoginUrl());
  }

  const username = (userInfo.preferred_username || '').toLowerCase();

  // Valida acesso dinâmico (SESUITE) ou estático (ALLOWED_USERS)
  const isAuthorized = await checkSesuiteAccess(username);
  if (!isAuthorized) {
    return res.status(403).send(deniedPage(username));
  }

  req.user = userInfo;
  next();
}

// ── Middleware para rotas /api/* (retorna JSON) ───────────────────────────────

async function requireApiAuth(req, res, next) {
  // Modo dev: sem Keycloak configurado
  if (!KC.clientId || !KC.clientSecret) {
    req.user = { preferred_username: 'dev', name: 'Dev Mode' };
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const userInfo = await getUserInfo(token);
  if (!userInfo) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const username = (userInfo.preferred_username || '').toLowerCase();
  const isAuthorized = await checkSesuiteAccess(username);
  if (!isAuthorized) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  req.user = userInfo;
  next();
}

module.exports = { requireAuth, requireApiAuth };
