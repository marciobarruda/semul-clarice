'use strict';

require('dotenv').config();

const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT  = process.env.GCP_PROJECT  || 'automacao-de-processos-418519';
const DATASET  = process.env.BQ_DATASET   || 'clarice';
const LOCATION = process.env.BQ_LOCATION  || 'southamerica-east1';

// Autenticação automática via Application Default Credentials
// No Cloud Run: usa a Service Account do serviço automaticamente
// Em dev local: usa GOOGLE_APPLICATION_CREDENTIALS ou `gcloud auth application-default login`
const bigquery = new BigQuery({ projectId: PROJECT, location: LOCATION });

/** Referência completa da tabela: `project.dataset.table` */
const tbl = (table) => `\`${PROJECT}.${DATASET}.${table}\``;

/** Executa uma query e retorna as linhas */
async function query(sql, params = {}, types = {}) {
  const opts = { query: sql, location: LOCATION };
  if (Object.keys(params).length > 0) {
    opts.params = params;
    if (Object.keys(types).length > 0) opts.types = types;
  }
  const [rows] = await bigquery.query(opts);
  return rows;
}

/** Executa uma DML (INSERT/UPDATE/DELETE/MERGE) sem retornar linhas */
async function dml(sql, params = {}, types = {}) {
  return query(sql, params, types);
}

module.exports = { bigquery, PROJECT, DATASET, LOCATION, tbl, query, dml };
