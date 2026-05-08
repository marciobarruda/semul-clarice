'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl } = require('../db');

router.post('/', async (req, res) => {
  const { prontuario, numeroprontuario, operacao } = req.body;
  const num = prontuario || numeroprontuario;

  if (!num) return res.status(400).json({ error: 'Prontuário obrigatório' });

  // Inserção
  if (operacao === 'inserir' || req.body.evolucaodescricao) {
    const { evolucaodata, evolucaodescricao, tecnica, funcao } = req.body;
    
    try {
      const sql = `
        INSERT INTO ${tbl('evolucao')} 
        (numeroprontuario, evolucaodata, evolucaodescricao, tecnica, funcao, createdat, updatedat)
        VALUES (@num, @data, @desc, @tecnica, @funcao, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
      `;
      const params = {
        num: String(num),
        data: evolucaodata || new Date().toISOString().split('T')[0],
        desc: evolucaodescricao,
        tecnica: tecnica || null,
        funcao: funcao || null
      };
      await dml(sql, params);
      return res.json({ success: true });
    } catch (err) {
      console.error('[BQ Evolucao Insert] Erro:', err);
      return res.status(500).json({ error: 'Erro ao inserir' });
    }
  }

  // Listagem
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

module.exports = router;
