'use strict';

const express = require('express');
const router = express.Router();
const { query, tbl } = require('../db');

router.get('/', async (req, res) => {
  const num = req.query.prontuario || req.query.numeroprontuario;
  console.log(`[API Anexos] Listando para o prontuário: "${num}"`);
  
  if (!num) return res.status(400).json({ error: 'Prontuário obrigatório' });

  try {
    const sql = `
      SELECT * FROM ${tbl('anexo')}
      WHERE numeroprontuario = @num
      ORDER BY dataupload DESC
    `;
    const rows = await query(sql, { num: String(num) });
    console.log(`[API Anexos] Encontrados ${rows.length} registros para "${num}"`);
    res.json(rows);
  } catch (err) {
    console.error('[API Anexos] Erro crítico ao listar:', err);
    res.status(500).json({ error: 'Erro ao listar anexos' });
  }
});

/**
 * Rota de visualização segura via URL assinada
 */
router.get('/view', async (req, res) => {
  const filePath = req.query.file; // idarquivoexterno
  if (!filePath) return res.status(400).send('Arquivo não especificado');

  try {
    const { getSignedUrl } = require('../storage');
    const signedUrl = await getSignedUrl(filePath);
    res.redirect(signedUrl);
  } catch (err) {
    console.error('[Storage View] Erro ao gerar URL:', err);
    res.status(500).send('Erro ao gerar link de visualização');
  }
});

module.exports = router;
