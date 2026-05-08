'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const SCHEMA = process.env.DB_SCHEMA || 'clarice';

const pool = new Pool({
  host:     process.env.DB_HOST     || '172.21.0.158',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'automacao',
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max:               10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

// Testa a conexão na inicialização
pool.connect()
  .then(client => {
    console.log('[DB] Conexão com PostgreSQL estabelecida com sucesso.');
    client.release();
  })
  .catch(err => {
    console.error('[DB] FALHA ao conectar ao PostgreSQL:', err.message);
  });

module.exports = { pool, SCHEMA };
