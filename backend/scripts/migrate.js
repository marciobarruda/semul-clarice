'use strict';

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');

const PROJECT = process.env.GCP_PROJECT || 'automacao-de-processos-418519';
const DATASET = process.env.BQ_DATASET || 'clarice';

const bigquery = new BigQuery({ projectId: PROJECT });
const dataset = bigquery.dataset(DATASET);

const SQL_FILE = path.join(__dirname, '../../automacao.sql');

/**
 * Converte array do Postgres "{a,b}" para array JS ["a", "b"]
 */
function parsePgArray(str) {
  if (!str || str === 'NULL' || str === '{}') return [];
  // Remove as chaves { }
  let s = str.substring(1, str.length - 1);
  if (!s) return [];

  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
}

/**
 * Limpa valor do SQL para formato BigQuery
 */
function cleanValue(val, type, mode) {
  if (val === 'NULL' || val === undefined || val === null) return null;
  
  // Remove aspas simples do início e fim
  let s = val.trim();
  if (s.startsWith("'") && s.endsWith("'")) {
    s = s.substring(1, s.length - 1).replace(/''/g, "'");
  }

  if (mode === 'REPEATED') {
    return parsePgArray(s);
  }

  if (type === 'INT64') return parseInt(s, 10) || null;
  if (type === 'BOOL') return s === '1' || s === 'true' || s === 't';
  if (type === 'DATE') return s || null;
  if (type === 'TIMESTAMP') return s || null;

  return s;
}

async function migrate() {
  console.log(`[Migrate] Lendo ${SQL_FILE}...`);
  
  const fileStream = fs.createReadStream(SQL_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentTable = null;
  let currentColumns = [];
  let batch = [];
  const BATCH_SIZE = 500;

  const schemas = {
    anexo: { idanexo: 'INT64', idarquivoexterno: 'STRING', dataupload: 'TIMESTAMP' },
    autoresviolencia: { id: 'INT64', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    composicaofamiliar: { id: 'INT64', familiaidade: 'INT64', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP', datanascimento: 'DATE' },
    evolucao: { id: 'INT64', evolucaodata: 'DATE', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    prontuario: { 
      id: 'INT64', dataatendimento: 'DATE', datanascimento: 'DATE', idade: 'INT64', totalfilhos: 'INT64',
      deficienciasindrome: 'BOOL', atendimentopsicologo: 'BOOL', atendimentopsiquiatra: 'BOOL',
      usomedicamento: 'BOOL', gestante: 'BOOL', examehiv: 'BOOL',
      atendimento: { type: 'STRING', mode: 'REPEATED' },
      origemservico: { type: 'STRING', mode: 'REPEATED' },
      violenciafisica: { type: 'STRING', mode: 'REPEATED' },
      violenciapsicologica: { type: 'STRING', mode: 'REPEATED' },
      fatoresrelacionados: { type: 'STRING', mode: 'REPEATED' },
      createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP'
    }
  };

  async function flush() {
    if (batch.length === 0) return;
    const table = dataset.table(currentTable);
    try {
      await table.insert(batch);
      console.log(`[Migrate] ${batch.length} registros inseridos em ${currentTable}`);
    } catch (err) {
      console.error(`[Migrate] Erro ao inserir em ${currentTable}:`, JSON.stringify(err, null, 2));
      if (err.errors) {
        err.errors.forEach(e => console.error('Row error:', JSON.stringify(e, null, 2)));
      }
    }
    batch = [];
  }

  for await (const line of rl) {
    // Detectar INSERT INTO "tabela" ("col1", "col2") VALUES
    const insertMatch = line.match(/^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES/);
    if (insertMatch) {
      await flush();
      currentTable = insertMatch[1];
      currentColumns = insertMatch[2].split(',').map(c => c.trim().replace(/"/g, ''));
      continue;
    }

    if (currentTable && line.trim().startsWith('(')) {
      // Parse valores: (val1, val2, ...)
      // Usar uma abordagem mais robusta para splitar por vírgula que não esteja dentro de aspas
      let content = line.trim();
      if (content.endsWith(',') || content.endsWith(';')) {
        content = content.substring(1, content.length - 2);
      } else {
        content = content.substring(1, content.length - 1);
      }

      const values = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < content.length; i++) {
        const c = content[i];
        if (c === "'") {
            inQuotes = !inQuotes;
            current += c;
        } else if (c === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else if (c === '\t' && !inQuotes) {
            // Ignorar tabs fora de aspas
        } else {
            current += c;
        }
      }
      values.push(current.trim());

      const row = {};
      const schema = schemas[currentTable] || {};

      currentColumns.forEach((col, idx) => {
        const fieldSchema = schema[col];
        const type = typeof fieldSchema === 'string' ? fieldSchema : (fieldSchema?.type || 'STRING');
        const mode = fieldSchema?.mode || 'NULLABLE';
        row[col] = cleanValue(values[idx], type, mode);
      });

      batch.push(row);

      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    }
  }

  await flush();
  console.log('[Migrate] Migração finalizada.');
}

migrate().catch(err => {
  console.error('[Migrate] Erro fatal:', err);
  process.exit(1);
});
