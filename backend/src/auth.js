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

const fetch = require('node-fetch');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// ── Configuração do Keycloak ─────────────────────────────────────────────────
const KC = {
  // Configurações padrão conforme seus dados
  authUrl: process.env.KC_AUTH_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/auth',
  tokenUrl: process.env.KC_TOKEN_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/token',
  userinfoUrl: process.env.KC_USERINFO_URL || 'https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/userinfo',
  clientId: process.env.KC_CLIENT_ID || 'portal-crcl',
  clientSecret: process.env.KC_CLIENT_SECRET || '7b2f103c-09ef-4315-89e3-323fcf503f93',
  // APP_URL deve ser https://semul.recife.pe.gov.br/redeclaricelispector-prontuario
  redirectUri: process.env.APP_URL || process.env.KC_REDIRECT_URI || 'https://semul.recife.pe.gov.br/redeclaricelispector-prontuario',
};

// Lista de usuários autorizados (preferred_username, minúsculas)
const ALLOWED_USERS = [
  'marcio.arruda',
  ...(process.env.ALLOWED_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean)
];

// Cache para a lista de usuários do SESUITE
let sesuiteCache = {
  users: [], // Armazenará objetos completos { login, nome, funcao }
  lastFetch: 0,
  ttl: 5 * 60 * 1000 // 5 minutos
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extrai o token do cookie (mesma lógica do nó "Code in JavaScript" do n8n) */
function extractToken(req) {
  // 1. Cookie "portal_clarice_token"
  if (req.cookies?.portal_clarice_token) {
    return req.cookies.portal_clarice_token;
  }

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
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
      'Cookie': 'KEYCLOAK_LOCALE=pt-BR',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
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

/** Monta a URL de login do Keycloak */
function buildLoginUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: KC.clientId,
    redirect_uri: KC.redirectUri,
    scope: 'openid',
  });
  return `${KC.authUrl}?${params.toString()}`;
}

/** Busca a lista de usuários do SESUITE e atualiza o cache */
async function fetchSesuiteList() {
  const now = Date.now();
  // Consulta a API do SESUITE
  try {
    const url = process.env.SESUITE_API_URL || 'https://sesuite.recife.pe.gov.br/apigateway/v1/dataset-integration/equiperedeclarice';
    const token = process.env.SESUITE_API_TOKEN;

    console.log(`[Auth] Consultando lista completa do SESUITE...`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token
      },
      body: JSON.stringify({}),
      timeout: 10000,
      agent: new https.Agent({ rejectUnauthorized: false })
    });

    if (!res.ok) {
      console.error(`[Auth] Erro na API do SESUITE (${res.status})`);
      return sesuiteCache.users;
    }

    const data = await res.json();

    // Tenta encontrar o array na resposta
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.data)) list = data.data;
    else if (data && Array.isArray(data.records)) list = data.records;
    else if (data && Array.isArray(data.items)) list = data.items;
    else if (data && typeof data === 'object') {
      const arrayKey = Object.keys(data).find(key => Array.isArray(data[key]));
      if (arrayKey) list = data[arrayKey];
    }

    // Normaliza e DEDUPLICA a lista (mantém o primeiro registro de cada login)
    const seen = new Set();
    const normalizedUsers = [];

    for (const u of list) {
      const login = String(u.login || u.LOGIN || u.idlogin || u.IDLOGIN || u.username || u.USERNAME || '').toLowerCase();
      if (login && !seen.has(login)) {
        seen.add(login);
        normalizedUsers.push({
          login: login,
          nome: u.tecnica || u.nome || u.NOME || u.name || login,
          funcao: u.funcao || u.FUNCAO || u.role || 'Técnica',
          unidade: u.unidade || u.UNIDADE || u.unit || ''
        });
      }
    }

    sesuiteCache = {
      users: normalizedUsers,
      lastFetch: now,
      ttl: 5 * 60 * 1000
    };

    console.log(`[Auth] Cache do SESUITE atualizado com ${normalizedUsers.length} usuários.`);
    return normalizedUsers;
  } catch (err) {
    console.error('[Auth] Falha crítica ao consultar SESUITE:', err.message);
    return sesuiteCache.users;
  }
}

/** Retorna a lista completa de usuários do SESUITE (com cache) */
async function getSesuiteUsers() {
  const now = Date.now();
  if (sesuiteCache.users.length === 0 || (now - sesuiteCache.lastFetch > sesuiteCache.ttl)) {
    await fetchSesuiteList();
  }
  return sesuiteCache.users;
}

/** Verifica se o usuário tem acesso via API do SESUITE e retorna seus dados */
async function checkSesuiteAccess(username) {
  // 1. Se o usuário estiver na lista estática ALLOWED_USERS, libera direto (sem dados extras de função)
  if (ALLOWED_USERS.length > 0 && ALLOWED_USERS.includes(username.toLowerCase())) {
    // Tenta encontrar o nome real na lista do SESUITE mesmo sendo admin estático
    const users = await getSesuiteUsers();
    const found = users.find(u => u.login === username.toLowerCase());
    
    return { 
      login: username, 
      nome: found ? found.nome : username, 
      funcao: found ? found.funcao : 'Administrador', 
      unidade: found ? found.unidade : 'Sede' 
    };
  }

  // 2. Tenta carregar do cache ou atualiza
  const users = await getSesuiteUsers();
  const userFound = users.find(u => u.login === username.toLowerCase());

  if (userFound) {
    console.log(`[Auth] Usuário ${username} autorizado pelo SESUITE! (Função: ${userFound.funcao}, Unidade: ${userFound.unidade})`);
    return userFound;
  } else {
    console.warn(`[Auth] Usuário ${username} NÃO encontrado na lista do SESUITE.`);
    return null;
  }
}

/** Página de acesso negado */
function deniedPage(username, fullName = '') {
  const nameToDisplay = fullName || username;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acesso Restrito - Clarice Lispector</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
  <style>
    body { background: #f8f9fa; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    .card { border: none; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); max-width: 480px; width: 90%; }
    .icon-box { width: 80px; height: 80px; background: #fff5f5; color: #dc3545; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 40px; margin: 0 auto 20px; }
    .btn-primary { background-color: #b366a6; border-color: #b366a6; border-radius: 10px; padding: 12px; font-weight: 600; transition: all 0.3s; }
    .btn-primary:hover { background-color: #9b59b6; border-color: #9b59b6; transform: translateY(-2px); }
  </style>
</head>
<body>
  <div class="card p-4 p-md-5 text-center">
    <div class="icon-box">
      <i class="bi bi-shield-lock"></i>
    </div>
    <h2 class="fw-bold mb-3">Acesso Não Autorizado</h2>
    <p class="text-muted mb-4">
      Olá <strong>${nameToDisplay}</strong>, seu usuário está autenticado, mas você ainda não possui permissão para acessar este portal.
    </p>
    <div class="alert alert-warning border-0 small mb-4 py-3">
      <i class="bi bi-info-circle-fill me-2"></i>
      Por favor, procure um <strong>usuário habilitado (gestor)</strong> para solicitar a liberação do seu acesso no SESUITE.
    </div>
    <a href="/logout" class="btn btn-primary w-100 shadow-sm">
      <i class="bi bi-box-arrow-left me-2"></i>Sair e trocar de usuário
    </a>
  </div>
</body>
</html>`;
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
      // O redirect_uri na troca do token deve ser IDÊNTICO ao usado no login (Passo 6 do guia)
      const tokenData = await exchangeCode(req.query.code);

      // Grava o cookie na raiz do domínio da prefeitura
      res.cookie('portal_clarice_token', tokenData.access_token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: (tokenData.expires_in || 3600) * 1000
      });

      console.log(`[Auth] Código trocado por token. Redirecionando para a URL pública.`);

      // Redireciona para a URL com barra final para satisfazer o redirecionamento 301 do Nginx (Passo 4 do guia)
      const finalRedirect = KC.redirectUri.endsWith('/') ? KC.redirectUri : `${KC.redirectUri}/`;
      return res.redirect(finalRedirect);
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
  console.log(`[Auth] Validando usuário no SESUITE. Keycloak devolveu preferred_username: "${username}"`);

  // Valida acesso dinâmico (SESUITE) ou estático (ALLOWED_USERS)
  const sesuiteUser = await checkSesuiteAccess(username);
  if (!sesuiteUser) {
    return res.status(403).send(deniedPage(username, userInfo.name));
  }

  // Mescla informações do Keycloak e SESUITE
  req.user = {
    ...userInfo,
    nome: sesuiteUser.nome || userInfo.name || username,
    funcao: sesuiteUser.funcao || 'Técnica',
    unidade: sesuiteUser.unidade || ''
  };
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
  console.log(`[ApiAuth] Extração de token: ${token ? 'Token encontrado' : 'Token ausente'}`);
  if (!token) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  const userInfo = await getUserInfo(token);
  if (!userInfo) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }

  const username = (userInfo.preferred_username || '').toLowerCase();
  const sesuiteUser = await checkSesuiteAccess(username);
  if (!sesuiteUser) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  req.user = {
    ...userInfo,
    nome: sesuiteUser.nome || userInfo.name || username,
    funcao: sesuiteUser.funcao || 'Técnica',
    unidade: sesuiteUser.unidade || ''
  };
  next();
}

module.exports = { requireAuth, requireApiAuth, getSesuiteUsers };
