'use strict';

/**
 * routes/anexos.js
 * GET /api/anexos?prontuario=X  → equivale ao webhook "recupera-arquivos" do n8n
 */

const express = require('express');
const router  = express.Router();
const { pool, SCHEMA } = require('../db');

// ── GET /api/anexos?prontuario=... ────────────────────────────────────────────
router.get('/', async (req, res) => {
  const num = req.query.prontuario || req.query.numeroprontuario;

  if (!num) {
    return res.status(400).json({ error: 'Parâmetro "prontuario" é obrigatório.' });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.anexo
       WHERE numeroprontuario = $1
       ORDER BY dataupload DESC`,
      [String(num).trim()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[anexos] Erro ao listar:', err.message);
    res.status(500).json({ error: 'Erro ao buscar anexos', detail: err.message });
  }
});

module.exports = router;
