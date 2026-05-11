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
 * Converte array do Postgres "{a,b}" ou string "a,b" para array JS
 */
function parsePgArray(str) {
  if (!str || str === 'NULL' || str === '{}') return [];
  let s = str.trim();
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  if (s.startsWith("{") && s.endsWith("}")) s = s.substring(1, s.length - 1);
  if (!s) return [];
  return s.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
}

/**
 * Limpa valor para BigQuery
 */
function cleanValue(val, type, mode) {
  if (val === undefined || val === null || val === 'NULL' || val === '') {
    return mode === 'REPEATED' ? [] : null;
  }
  let s = val.trim();
  if (s.startsWith("'") && s.endsWith("'")) {
    s = s.substring(1, s.length - 1).replace(/''/g, "'");
  }
  if (mode === 'REPEATED') return parsePgArray(s);
  if (type === 'INT64') {
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  if (type === 'BOOL') return s === '1' || s === 'true' || s === 't' || s === 'T';
  if (type === 'DATE') {
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  return s;
}

async function migrate() {
  console.log(`[Migrate] Iniciando migração para BigQuery...`);
  
  const tablesToTruncate = ['prontuario', 'evolucao', 'anexo', 'autoresviolencia', 'composicaofamiliar'];
  for (const t of tablesToTruncate) {
    console.log(`[Migrate] Limpando tabela ${t}...`);
    try {
        await bigquery.query(`DELETE FROM \`${PROJECT}.${DATASET}.${t}\` WHERE true`);
    } catch (e) {
        console.warn(`[Migrate] Aviso ao limpar ${t}: ${e.message}`);
    }
  }

  const schemas = {
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
    },
    evolucao: { id: 'INT64', evolucaodata: 'DATE', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    anexo: { idanexo: 'INT64', dataupload: 'TIMESTAMP' },
    autoresviolencia: { id: 'INT64', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    composicaofamiliar: { id: 'INT64', familiaidade: 'INT64', datanascimento: 'DATE', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' }
  };

  const fileStream = fs.createReadStream(SQL_FILE);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentTable = null;
  let columns = [];
  let rowBuffer = "";
  let inInsertValues = false;
  let batch = [];
  const BATCH_SIZE = 500;
  let totalMigrated = 0;

  async function flushBatch() {
    if (batch.length === 0) return;
    const table = dataset.table(currentTable);
    try {
      await table.insert(batch);
      totalMigrated += batch.length;
      console.log(`[Migrate] ${totalMigrated} registros inseridos em ${currentTable}`);
    } catch (err) {
      console.error(`[Migrate] Erro ao inserir em ${currentTable}:`, JSON.stringify(err.errors, null, 2));
      throw new Error("Falha na inserção.");
    }
    batch = [];
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detectar início de INSERT
    const insertMatch = trimmed.match(/^INSERT INTO "([^"]+)" \(([^)]+)\) VALUES/);
    if (insertMatch) {
      await flushBatch();
      currentTable = insertMatch[1];
      columns = insertMatch[2].split(',').map(c => c.trim().replace(/"/g, ''));
      inInsertValues = true;
      totalMigrated = 0;
      console.log(`[Migrate] Processando tabela: ${currentTable}...`);
      continue;
    }

    if (inInsertValues) {
      rowBuffer += (rowBuffer ? "\n" : "") + line;
      
      // Um registro termina com "), " ou ");" (respeitando aspas)
      // Mas simplificando: se a linha termina com ), ou ); e não estamos dentro de aspas ímpares
      const isEnd = (trimmed.endsWith('),') || trimmed.endsWith(');'));
      
      // Contagem de aspas simples para ver se o registro está completo
      const quoteCount = (rowBuffer.match(/'/g) || []).length;
      const escapedQuoteCount = (rowBuffer.match(/''/g) || []).length;
      const realQuoteCount = quoteCount - escapedQuoteCount; // Simplificado, mas aspas são complexas
      
      // Mais seguro: checar se terminou com ), ou ); e o número de aspas simples não-escapadas é par
      if (isEnd && (realQuoteCount % 2 === 0)) {
        let rawRow = rowBuffer.trim();
        if (rawRow.endsWith(';')) rawRow = rawRow.substring(0, rawRow.length - 1);
        if (rawRow.endsWith(',')) rawRow = rawRow.substring(0, rawRow.length - 1);
        
        // Remove ( ) externos
        if (rawRow.startsWith('(')) rawRow = rawRow.substring(1);
        if (rawRow.endsWith(')')) rawRow = rawRow.substring(0, rawRow.length - 1);

        // Parse valores do registro
        const vals = [];
        let currentVal = "";
        let inValQuotes = false;
        for (let j = 0; j < rawRow.length; j++) {
          const c = rawRow[j];
          if (c === "'") {
            if (rawRow[j+1] === "'") { currentVal += "''"; j++; }
            else { inValQuotes = !inValQuotes; currentVal += c; }
          } else if (c === ',' && !inValQuotes) {
            vals.push(currentVal.trim());
            currentVal = "";
          } else if (c === '\t' && !inValQuotes) {
            // ignorar
          } else {
            currentVal += c;
          }
        }
        vals.push(currentVal.trim());

        const row = {};
        const schema = schemas[currentTable];
        if (schema) {
          columns.forEach((col, idx) => {
            const field = schema[col];
            const type = typeof field === 'string' ? field : (field?.type || 'STRING');
            const mode = field?.mode || 'NULLABLE';
            row[col] = cleanValue(vals[idx], type, mode);
          });
          batch.push(row);
        }

        rowBuffer = "";
        if (batch.length >= BATCH_SIZE) await flushBatch();
        
        if (trimmed.endsWith(');')) {
          inInsertValues = false;
          await flushBatch();
        }
      }
    }
  }

  await flushBatch();
  console.log('[Migrate] Migração finalizada com sucesso.');
}

migrate().catch(err => {
  console.error('[Migrate] Erro fatal:', err);
  process.exit(1);
});
