'use strict';

/**
 * routes/evolucoes.js
 * POST /api/evolucoes  → equivale ao webhook "evolucoes" do n8n
 * Suporta operações de leitura e inserção de evoluções
 */

const express = require('express');
const router  = express.Router();
const { pool, SCHEMA } = require('../db');

// ── POST /api/evolucoes ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { prontuario, numeroprontuario, operacao } = req.body;
  const num = prontuario || numeroprontuario;

  if (!num) {
    return res.status(400).json({ error: 'Parâmetro "prontuario" é obrigatório.' });
  }

  // Operação de inserção
  if (operacao === 'inserir' || req.body.evolucaodata) {
    const { evolucaodata, evolucaodescricao, tecnica, funcao } = req.body;

    if (!evolucaodescricao) {
      return res.status(400).json({ error: 'Parâmetro "evolucaodescricao" é obrigatório.' });
    }

    try {
      const result = await pool.query(
        `INSERT INTO ${SCHEMA}.evolucao
           (numeroprontuario, evolucaodata, evolucaodescricao, tecnica, funcao)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          String(num).trim(),
          evolucaodata || new Date().toISOString().substring(0, 10),
          evolucaodescricao,
          tecnica || null,
          funcao  || null,
        ]
      );
      return res.json({ success: true, evolucao: result.rows[0] });
    } catch (err) {
      console.error('[evolucoes] Erro ao inserir:', err.message);
      return res.status(500).json({ error: 'Erro ao inserir evolução', detail: err.message });
    }
  }

  // Operação padrão: listar evoluções do prontuário
  try {
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.evolucao
       WHERE numeroprontuario = $1
       ORDER BY evolucaodata DESC, createdat DESC`,
      [String(num).trim()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[evolucoes] Erro ao listar:', err.message);
    res.status(500).json({ error: 'Erro ao buscar evoluções', detail: err.message });
  }
});

module.exports = router;
