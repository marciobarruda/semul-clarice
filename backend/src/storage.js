'use strict';

const { Storage } = require('@google-cloud/storage');
const path = require('path');

const PROJECT = process.env.GCP_PROJECT || 'automacao-de-processos-418519';
const BUCKET_NAME = 'clarice-lispector';

const storage = new Storage({ projectId: PROJECT });
const bucket = storage.bucket(BUCKET_NAME);

/**
 * Faz upload de um buffer (ou base64) para o GCS
 * @param {Buffer|string} content - Conteúdo do arquivo
 * @param {string} destination - Caminho no bucket (ex: arquivos/123/foto.jpg)
 * @param {string} contentType - Tipo MIME do arquivo
 */
async function uploadFile(content, destination, contentType) {
  const file = bucket.file(destination);
  
  const buffer = Buffer.isBuffer(content) 
    ? content 
    : Buffer.from(content.replace(/^data:.*;base64,/, ''), 'base64');

  await file.save(buffer, {
    metadata: { contentType: contentType },
    resumable: false
  });

  // Retorna a URL pública ou o caminho no GCS
  // Se o bucket for público, podemos retornar a URL direta
  return `https://storage.googleapis.com/${BUCKET_NAME}/${destination}`;
}

/**
 * Gera uma URL assinada para download privado (válida por 15 minutos)
 */
async function getSignedUrl(destination) {
  const file = bucket.file(destination);
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + 15 * 60 * 1000, // 15 minutos
  });
  return url;
}

module.exports = { uploadFile, getSignedUrl, BUCKET_NAME };
