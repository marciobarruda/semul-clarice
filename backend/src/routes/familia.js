'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl } = require('../db');
const fetch = require('node-fetch');

// Proxy para Composição Familiar Legada (n8n)
router.get('/legacy/:prontuario', async (req, res) => {
  const { prontuario } = req.params;
  const N8N_URL = 'https://webhook-n8n-dev-conectarecife.recife.pe.gov.br/webhook/composicaofamiliar';

  console.log(`[Legacy Familia Proxy] Solicitando prontuário: ${prontuario}`);
  
  try {
    const response = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeroprontuario: prontuario })
    });
    
    if (!response.ok) {
        console.error(`[Legacy Familia Proxy] Erro n8n: ${response.status}`);
        return res.json([]);
    }

    const data = await response.json();
    console.log(`[Legacy Familia Proxy] Recebidos ${Array.isArray(data) ? data.length : 0} membros`);
    res.json(data);
  } catch (err) {
    console.error('[Legacy Familia Proxy] Erro fatal:', err.message);
    res.json([]);
  }
});

// Listagem BigQuery (GET)
router.get('/', async (req, res) => {
  const num = req.query.prontuario || req.query.numeroprontuario;
  if (!num) return res.status(400).json({ error: 'Prontuário obrigatório' });

  try {
    const sql = `SELECT * FROM ${tbl('composicaofamiliar')} WHERE numeroprontuario = @num ORDER BY familianome ASC`;
    const rows = await query(sql, { num: String(num) });
    res.json(rows);
  } catch (err) {
    console.error('[BQ Familia List] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar família' });
  }
});

module.exports = router;
