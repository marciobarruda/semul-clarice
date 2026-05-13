'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl } = require('../db');
const fetch = require('node-fetch');

// Proxy para evoluções legadas (n8n) para evitar problemas de CORS
router.get('/legacy/:prontuario', async (req, res) => {
  const { prontuario } = req.params;
  const N8N_URL = 'https://webhook-n8n-dev-conectarecife.recife.pe.gov.br/webhook/evolucoes';

  try {
    const response = await fetch(N8N_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeroprontuario: prontuario })
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[Legacy Evolucoes Proxy] Erro:', err.message);
    res.json([]);
  }
});

// Listagem (GET)
router.get('/', async (req, res) => {
  const num = req.query.prontuario || req.query.numeroprontuario;
  if (!num) return res.status(400).json({ error: 'Prontuário obrigatório' });

  try {
    const sql = `
      SELECT * FROM ${tbl('evolucao')}
      WHERE numeroprontuario = @num
      ORDER BY evolucaodata DESC, createdat DESC
    `;
    const rows = await query(sql, { num: String(num) });
    res.json(rows);
  } catch (err) {
    console.error('[BQ Evolucao List] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar' });
  }
});

// Inserção (POST)
router.post('/', async (req, res) => {
  const { numeroprontuario, evolucaodescricao, tecnica, funcao, evolucaodata } = req.body;

  if (!numeroprontuario || !evolucaodescricao) {
    return res.status(400).json({ error: 'Dados obrigatórios ausentes' });
  }

  try {
    const sql = `
      INSERT INTO ${tbl('evolucao')} 
      (numeroprontuario, evolucaodata, evolucaodescricao, tecnica, funcao, createdat, updatedat)
      VALUES (@num, @data, @desc, @tecnica, @funcao, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `;
    const params = {
      num: String(numeroprontuario),
      data: evolucaodata || new Date().toISOString().split('T')[0],
      desc: evolucaodescricao,
      tecnica: tecnica || 'Sistema',
      funcao: funcao || 'Atendimento'
    };
    await dml(sql, params);
    res.json({ success: true });
  } catch (err) {
    console.error('[BQ Evolucao Insert] Erro:', err);
    res.status(500).json({ error: 'Erro ao inserir' });
  }
});

module.exports = router;
