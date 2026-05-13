const express = require('express');
const router = express.Router();
const { BigQuery } = require('@google-cloud/bigquery');
const bigquery = new BigQuery();

const DATASET = 'clarice';
const TABLE = 'autoresviolencia';

// 1. Buscar do BigQuery
router.get('/', async (req, res) => {
  const { prontuario } = req.query;
  if (!prontuario) return res.status(400).json({ error: 'Prontuário é obrigatório' });

  try {
    const query = `SELECT * FROM \`automacao-de-processos-418519.${DATASET}.${TABLE}\` WHERE numeroprontuario = @prontuario`;
    const options = {
      query: query,
      params: { prontuario: prontuario },
    };
    const [rows] = await bigquery.query(options);
    res.json(rows);
  } catch (err) {
    console.error('[Autores BQ] Erro:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Proxy para Legado (n8n)
router.get('/legacy/:prontuario', async (req, res) => {
  const { prontuario } = req.params;
  const N8N_URL = 'https://webhook-n8n-dev-conectarecife.recife.pe.gov.br/webhook/dadosautor';

  console.log(`[Legacy Autores Proxy] Solicitando prontuário: ${prontuario}`);
  
  try {
    const response = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeroprontuario: prontuario })
    });
    
    if (!response.ok) {
        console.error(`[Legacy Autores Proxy] Erro n8n: ${response.status}`);
        return res.json([]);
    }

    const data = await response.json();
    console.log(`[Legacy Autores Proxy] Recebidos ${Array.isArray(data) ? data.length : 0} autores`);
    res.json(data);
  } catch (err) {
    console.error('[Legacy Autores Proxy] Erro fatal:', err.message);
    res.json([]);
  }
});

module.exports = router;
