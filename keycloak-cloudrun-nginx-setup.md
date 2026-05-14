# Guia: Keycloak + Cloud Run + Nginx Proxy Manager

Guia prático para expor um serviço do Google Cloud Run em um sub-caminho de domínio (ex: `https://dominio.gov.br/meu-app`) com autenticação via Keycloak SSO.

---

## Arquitetura

```
Usuário → dominio.gov.br/meu-app  →  NPM (192.x.x.x:443)  →  Cloud Run (*.run.app)
                                           ↕
                              login.recife.pe.gov.br (Keycloak)
```

---

## 1. Nginx Proxy Manager (NPM)

Acesse o proxy host do domínio no NPM e cole o bloco abaixo na aba **Advanced**.

### Template genérico

```nginx
# Redireciona sem barra e preserva query params (ex: ?code= do Keycloak)
location = /MEU-APP {
    return 301 https://MEU-DOMINIO/MEU-APP/$is_args$args;
}

# Roteamento principal para o Cloud Run
location ^~ /MEU-APP/ {
    proxy_pass https://NOME-DO-SERVICO-922301589213.us-west1.run.app;

    proxy_http_version 1.1;
    proxy_set_header Connection "";

    # Obrigatório para Cloud Run identificar o serviço via TLS SNI
    proxy_ssl_server_name on;
    proxy_ssl_name NOME-DO-SERVICO-922301589213.us-west1.run.app;
    proxy_set_header Host NOME-DO-SERVICO-922301589213.us-west1.run.app;

    # Blinda a porta para nunca vazar a porta interna do Docker (4443)
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host MEU-DOMINIO;
    proxy_set_header X-Forwarded-Port 443;
}
```

### Atenção: barra no proxy_pass

| Situação | proxy_pass | Efeito |
|---|---|---|
| App serve em `/` (raiz) | `https://servico.run.app/` ← **com barra** | Nginx corta o prefixo `/meu-app/` antes de enviar |
| App serve em `/meu-app/` | `https://servico.run.app` ← **sem barra** | Nginx envia o path completo `/meu-app/...` |

### Por que o $is_args$args no redirect?

O Keycloak retorna o usuário para `https://dominio.gov.br/meu-app?code=ABC`. Sem `$is_args$args`, o Nginx redireciona para `/meu-app/` descartando `?code=ABC` e o login falha silenciosamente.

### Exemplos reais

**gokremprel** (app serve em `/gokr/`):
```nginx
location = /gokr {
    return 301 https://secti.recife.pe.gov.br/gokr/$is_args$args;
}
location ^~ /gokr/ {
    proxy_pass https://remix-gokr-emprel-922301589213.us-west1.run.app;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_ssl_server_name on;
    proxy_ssl_name remix-gokr-emprel-922301589213.us-west1.run.app;
    proxy_set_header Host remix-gokr-emprel-922301589213.us-west1.run.app;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host secti.recife.pe.gov.br;
    proxy_set_header X-Forwarded-Port 443;
}
```

**redeclaricelispector** (app serve em `/`, proxy_pass com barra):
```nginx
location = /redeclaricelispector-prontuario {
    return 301 https://semul.recife.pe.gov.br/redeclaricelispector-prontuario/$is_args$args;
}
location ^~ /redeclaricelispector-prontuario/ {
    proxy_pass https://semul-clarice-922301589213.us-west1.run.app/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_ssl_server_name on;
    proxy_ssl_name semul-clarice-922301589213.us-west1.run.app;
    proxy_set_header Host semul-clarice-922301589213.us-west1.run.app;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host semul.recife.pe.gov.br;
    proxy_set_header X-Forwarded-Port 443;
}
```

---

## 2. Keycloak — Configuração do Client

Acesse: `https://login.recife.pe.gov.br/auth/admin` → Realm **prefeitura** → **Clients** → selecione o client da aplicação.

### Campos obrigatórios

| Campo | Valor |
|---|---|
| **Client ID** | ex: `gokrplanejamento` |
| **Access Type** | `confidential` |
| **Valid Redirect URIs** | `https://MEU-DOMINIO/MEU-APP` e `https://MEU-DOMINIO/MEU-APP/*` |
| **Web Origins** | `https://MEU-DOMINIO` |

### Valid Redirect URIs — exemplo gokremprel

```
https://secti.recife.pe.gov.br/gokr
https://secti.recife.pe.gov.br/gokr/*
```

O Keycloak valida o `redirect_uri` enviado pelo servidor **exatamente** contra essa lista. Se não estiver cadastrado, retorna `Parâmetro inválido: redirect_uri`.

---

## 3. Variáveis de Ambiente no Cloud Run

Acesse: [console.cloud.google.com/run](https://console.cloud.google.com/run) → serviço → **Edit & Deploy New Revision** → aba **Variables & Secrets**.

| Variável | Valor | Descrição |
|---|---|---|
| `APP_BASE_URL` | `https://MEU-DOMINIO/MEU-APP` | URL pública do app — usada como `redirect_uri` no Keycloak |
| `KEYCLOAK_BASE_URL` | `https://login.recife.pe.gov.br/auth` | Base URL do Keycloak |
| `KEYCLOAK_REALM` | `prefeitura` | Nome do realm |
| `KEYCLOAK_CLIENT_ID` | ex: `gokrplanejamento` | Client ID do Keycloak |
| `KEYCLOAK_CLIENT_SECRET` | `****` | Secret do client (aba Credentials no Keycloak) |
| `JWT_SECRET` | string aleatória segura | Assina os tokens internos da aplicação |

> `APP_BASE_URL` deve ser a URL **pública** (via proxy), não a URL do Cloud Run.

---

## 4. Fluxo de Autenticação (Authorization Code Flow)

```
1. Usuário clica em "Entrar"
   → GET /meu-app/api/keycloak/login

2. Servidor redireciona para Keycloak
   → GET https://login.recife.pe.gov.br/auth/realms/prefeitura/protocol/openid-connect/auth
       ?client_id=MEUAPP
       &redirect_uri=https://MEU-DOMINIO/MEU-APP    ← deve estar no Keycloak
       &response_type=code
       &scope=openid email profile

3. Usuário loga no Keycloak
   → Keycloak redireciona de volta
   → GET https://MEU-DOMINIO/MEU-APP?code=ABC123

4. Nginx recebe /MEU-APP?code=ABC123
   → 301 para /MEU-APP/?code=ABC123  (preservado via $is_args$args)

5. SPA carrega em /MEU-APP/ e lê ?code= da URL
   → POST /meu-app/api/keycloak/exchange  { code: "ABC123" }

6. Servidor troca o code pelo access_token
   → POST https://login.recife.pe.gov.br/.../token
       grant_type=authorization_code
       code=ABC123
       redirect_uri=https://MEU-DOMINIO/MEU-APP    ← deve ser IDÊNTICO ao passo 2
       client_id=MEUAPP
       client_secret=****

7. Servidor retorna JWT interno → usuário autenticado
```

---

## 5. Problemas Comuns

### Erro: `Parâmetro inválido: redirect_uri`
**Causa:** A URL enviada como `redirect_uri` não está registrada no Keycloak.  
**Fix:** Adicionar a URL pública nas Valid Redirect URIs do client no Keycloak.

### Erro: `redirect_uri=http://localhost:3000`
**Causa:** Variável `APP_BASE_URL` não definida no Cloud Run — cai no fallback `localhost`.  
**Fix:** Definir `APP_BASE_URL=https://MEU-DOMINIO/MEU-APP` nas env vars do Cloud Run.

### Erro: `ERR_CONNECTION_TIMED_OUT` com porta 4443 na URL
**Causa:** NPM roda em Docker com porta interna 4443. Quando o app ou Keycloak gera um redirect, usa a porta real do container em vez da 443 pública.  
**Fix:** Usar `X-Forwarded-Port 443` e `X-Forwarded-Proto https` nos headers do Nginx. Usar URL completa no `return 301` em vez de path relativo.

### Login completa mas `?code=` some e usuário fica na tela de login
**Causa:** O `return 301 /meu-app/` descarta os query params.  
**Fix:** Usar `return 301 https://DOMINIO/MEU-APP/$is_args$args;`

### Google 404: `The requested URL /meu-app was not found`
**Causa:** Nginx enviando `Host: dominio.gov.br` para o Cloud Run — o Cloud Run não reconhece esse host e retorna 404.  
**Fix:** `proxy_set_header Host NOME-DO-SERVICO.run.app` + `proxy_ssl_server_name on` + `proxy_ssl_name NOME-DO-SERVICO.run.app`.

### Cache do navegador com porta 4443
Após corrigir o redirect, limpe o cache ou abra janela anônima — o Chrome memoriza redirecionamentos 301 permanentemente.
