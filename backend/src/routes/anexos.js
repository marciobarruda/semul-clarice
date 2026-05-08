'use strict';

const express = require('express');
const router = express.Router();
const { query, tbl } = require('../db');

router.get('/', async (req, res) => {
  const num = req.query.prontuario || req.query.numeroprontuario;
  if (!num) return res.status(400).json({ error: 'Prontuário obrigatório' });

  try {
    const sql = `
      SELECT * FROM ${tbl('anexo')}
      WHERE numeroprontuario = @num
      ORDER BY dataupload DESC
    `;
    const rows = await query(sql, { num: String(num) });
    res.json(rows);
  } catch (err) {
    console.error('[BQ Anexos] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar anexos' });
  }
});

module.exports = router;
