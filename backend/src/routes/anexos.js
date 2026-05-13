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
      WHERE TRIM(numeroprontuario) = TRIM(@num)
      ORDER BY dataupload DESC
    `;
    const cleanNum = String(num).trim();
    const rows = await query(sql, { num: cleanNum });
    console.log(`[API Anexos] Query executada para: "${cleanNum}". Linhas encontradas: ${rows.length}`);
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
  const forceDownload = req.query.download === 'true';
  
  if (!filePath) return res.status(400).send('Arquivo não especificado');

  try {
    const { BUCKET_NAME, storage } = require('../storage');
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(filePath);

    // Verificar se o arquivo existe e obter metadados
    const [exists] = await file.exists();
    if (!exists) return res.status(404).send('Arquivo não encontrado no storage');

    const [metadata] = await file.getMetadata();
    
    // Configurar headers para o navegador
    res.setHeader('Content-Type', metadata.contentType || 'application/octet-stream');
    
    if (forceDownload) {
      const fileName = filePath.split('/').pop();
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    } else {
      res.setHeader('Content-Disposition', 'inline');
    }

    // Fazer o pipe do stream do GCS diretamente para a resposta do Express
    console.log(`[API Anexos] Servindo arquivo via stream: ${filePath}`);
    file.createReadStream()
      .on('error', (err) => {
        console.error('[Storage Stream] Erro no stream:', err);
        if (!res.headersSent) res.status(500).send('Erro ao ler arquivo');
      })
      .pipe(res);

  } catch (err) {
    console.error('[API Anexos View] Erro crítico:', err);
    res.status(500).send('Erro interno ao processar arquivo');
  }
});

module.exports = router;
