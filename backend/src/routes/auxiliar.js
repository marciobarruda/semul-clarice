'use strict';

/**
 * routes/auxiliar.js
 *
 * Rotas auxiliares que funcionam como proxy para o n8n
 * (naturalidades e RPA continuam usando n8n conforme definido).
 *
 * O backend faz a chamada internamente para evitar problemas
 * de CORS no browser quando o domínio muda para Cloud Run.
 *
 *   GET  /api/nacionalidades   → lista de países (JSON estático embutido)
 *   POST /api/naturalidades    → proxy → n8n/listarnaturalidades
 *   POST /api/rpa              → proxy → n8n/rpa-portal-coleta-residuos
 */

const express = require('express');
const router  = express.Router();
const fetch   = require('node-fetch');

const N8N_BASE = (process.env.N8N_BASE_URL || 'https://webhook-n8n-dev-conectarecife.recife.pe.gov.br/webhook').replace(/\/$/, '');

// ── GET /api/nacionalidades ───────────────────────────────────────────────────
// Lista estática de nacionalidades (evita dependência externa para dado imutável)
const NACIONALIDADES = [
  'Brasileira', 'Afegã', 'Albanesa', 'Alemã', 'Angolana', 'Argeliana', 'Argentina',
  'Armênia', 'Australiana', 'Austríaca', 'Azerbaijana', 'Bangladeshiana', 'Belga',
  'Boliviana', 'Bósnia', 'Botsuanesa', 'Britânica', 'Búlgara', 'Camaronesa',
  'Canadense', 'Cazaquistanesa', 'Chilena', 'Chinesa', 'Colombiana', 'Congolesa',
  'Coreana do Norte', 'Coreana do Sul', 'Croata', 'Cubana', 'Dinamarquesa',
  'Egípcia', 'Equatoriana', 'Eslovaca', 'Eslovênia', 'Espanhola', 'Estadunidense',
  'Etíope', 'Filipina', 'Finlandesa', 'Francesa', 'Ganense', 'Grega', 'Guatemalteca',
  'Guianesa', 'Haitiana', 'Holandesa', 'Hondurenha', 'Húngara', 'Indiana', 'Indonésia',
  'Iraniana', 'Iraquiana', 'Irlandesa', 'Israelense', 'Italiana', 'Jamaicana',
  'Japonesa', 'Jordaniana', 'Keniata', 'Kosovar', 'Libanesa', 'Liberiana', 'Líbia',
  'Malaiana', 'Marroquina', 'Mexicana', 'Moçambicana', 'Moçambicana', 'Nepalesa',
  'Nicaraguense', 'Nigeriana', 'Norueguesa', 'Paquistanesa', 'Paraguaia', 'Peruana',
  'Polonesa', 'Portuguesa', 'Romênia', 'Russa', 'Salvadorenha', 'Senegalesa',
  'Síria', 'Somaliana', 'Sueca', 'Suíça', 'Tailandesa', 'Tanzaniana', 'Turca',
  'Ucraniana', 'Ugandesa', 'Uruguaia', 'Venezuelana', 'Vietnamita', 'Zambiana',
  'Zimbabuense', 'Outra',
];

router.get('/nacionalidades', (req, res) => {
  res.json(NACIONALIDADES);
});

// ── POST /api/naturalidades → proxy n8n ───────────────────────────────────────
router.post('/naturalidades', async (req, res) => {
  try {
    const response = await fetch(`${N8N_BASE}/listarnaturalidades`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
      timeout: 10_000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro no serviço de naturalidades.' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[auxiliar/naturalidades] Erro:', err.message);
    res.status(502).json({ error: 'Serviço de naturalidades indisponível.', detail: err.message });
  }
});

// ── POST /api/rpa → proxy n8n ─────────────────────────────────────────────────
router.post('/rpa', async (req, res) => {
  try {
    const response = await fetch(`${N8N_BASE}/rpa-portal-coleta-residuos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body),
      timeout: 10_000,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Erro no serviço de RPA.' });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[auxiliar/rpa] Erro:', err.message);
    res.status(502).json({ error: 'Serviço de RPA indisponível.', detail: err.message });
  }
});

module.exports = router;
