'use strict';

require('dotenv').config();
const fs = require('fs');
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
  // Se for uma string entre aspas, remove as aspas externas
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  // Se tiver chaves de array PG, remove
  if (s.startsWith("{") && s.endsWith("}")) s = s.substring(1, s.length - 1);
  if (!s) return [];
  
  // Tratamento simples para split por vírgula
  return s.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
}

/**
 * Limpa valor para BigQuery
 */
function cleanValue(val, type, mode) {
  if (val === undefined || val === null || val === 'NULL' || val === '') {
    // Para campos REPEATED, BigQuery exige array vazio, não null
    return mode === 'REPEATED' ? [] : null;
  }
  
  let s = val.trim();
  // Remove aspas simples e trata aspas duplicadas
  if (s.startsWith("'") && s.endsWith("'")) {
    s = s.substring(1, s.length - 1).replace(/''/g, "'");
  }

  if (mode === 'REPEATED') return parsePgArray(s);

  if (type === 'INT64') {
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  
  if (type === 'BOOL') {
    return s === '1' || s === 'true' || s === 't' || s === 'T';
  }
  
  if (type === 'DATE') {
    // BigQuery espera YYYY-MM-DD
    const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
  }
  
  if (type === 'TIMESTAMP') {
    return s || null;
  }

  return s;
}

async function migrate() {
  console.log(`[Migrate] Lendo arquivo SQL (13MB)...`);
  const content = fs.readFileSync(SQL_FILE, 'utf8');
  
  const schemas = {
    prontuario: { 
      id: 'INT64', 
      dataatendimento: 'DATE', 
      datanascimento: 'DATE', 
      idade: 'INT64', 
      totalfilhos: 'INT64',
      deficienciasindrome: 'BOOL', 
      atendimentopsicologo: 'BOOL', 
      atendimentopsiquiatra: 'BOOL',
      usomedicamento: 'BOOL', 
      gestante: 'BOOL', 
      examehiv: 'BOOL',
      atendimento: { type: 'STRING', mode: 'REPEATED' },
      origemservico: { type: 'STRING', mode: 'REPEATED' },
      violenciafisica: { type: 'STRING', mode: 'REPEATED' },
      violenciapsicologica: { type: 'STRING', mode: 'REPEATED' },
      fatoresrelacionados: { type: 'STRING', mode: 'REPEATED' },
      createdat: 'TIMESTAMP', 
      updatedat: 'TIMESTAMP'
    },
    evolucao: { id: 'INT64', evolucaodata: 'DATE', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    anexo: { idanexo: 'INT64', dataupload: 'TIMESTAMP' },
    autoresviolencia: { id: 'INT64', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' },
    composicaofamiliar: { id: 'INT64', familiaidade: 'INT64', datanascimento: 'DATE', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP' }
  };

  // Regex para encontrar blocos de INSERT completo (incluindo multi-linha)
  const insertRegex = /INSERT INTO "([^"]+)" \(([^)]+)\) VALUES\s+([\s\S]+?);/g;
  let match;

  while ((match = insertRegex.exec(content)) !== null) {
    const tableName = match[1];
    if (!schemas[tableName]) {
        console.log(`[Migrate] Pulando tabela não mapeada: ${tableName}`);
        continue;
    }

    const columns = match[2].split(',').map(c => c.trim().replace(/"/g, ''));
    const valuesBlock = match[3];
    
    console.log(`[Migrate] Parseando registros da tabela: ${tableName}...`);
    
    const rows = [];
    let currentRow = "";
    let inQuotes = false;
    
    // Parser de baixo nível para separar registros por "), " ou ");" lidando com aspas multi-linha
    for (let i = 0; i < valuesBlock.length; i++) {
      const char = valuesBlock[i];
      if (char === "'") {
        // Tratar aspas escapadas ''
        if (valuesBlock[i+1] === "'") {
          currentRow += "''";
          i++;
        } else {
          inQuotes = !inQuotes;
          currentRow += char;
        }
      } else if (!inQuotes && char === ')' && (valuesBlock[i+1] === ',' || i === valuesBlock.length - 1)) {
        currentRow += char;
        rows.push(currentRow.trim());
        currentRow = "";
        if (valuesBlock[i+1] === ',') i++; // Pula a vírgula
      } else {
        currentRow += char;
      }
    }

    console.log(`[Migrate] Encontrados ${rows.length} registros em ${tableName}. Iniciando upload...`);

    const bqRows = rows.map(rawRow => {
      // Remove parênteses externos
      let cleanRow = rawRow.trim();
      if (cleanRow.startsWith('(')) cleanRow = cleanRow.substring(1);
      if (cleanRow.endsWith(')')) cleanRow = cleanRow.substring(0, cleanRow.length - 1);

      const vals = [];
      let currentVal = "";
      let inValQuotes = false;
      
      for (let j = 0; j < cleanRow.length; j++) {
        const c = cleanRow[j];
        if (c === "'") {
          if (cleanRow[j+1] === "'") {
            currentVal += "''";
            j++;
          } else {
            inValQuotes = !inValQuotes;
            currentVal += c;
          }
        } else if (c === ',' && !inValQuotes) {
          vals.push(currentVal.trim());
          currentVal = "";
        } else if (c === '\t' && !inValQuotes) {
          // ignora tabs de indentação do SQL
        } else {
          currentVal += c;
        }
      }
      vals.push(currentVal.trim());

      const row = {};
      const schema = schemas[tableName];
      columns.forEach((col, idx) => {
        const field = schema[col];
        const type = typeof field === 'string' ? field : (field?.type || 'STRING');
        const mode = field?.mode || 'NULLABLE';
        row[col] = cleanValue(vals[idx], type, mode);
      });
      return row;
    });

    // Inserir no BigQuery em lotes para evitar limites de timeout
    const table = dataset.table(tableName);
    const BATCH_SIZE = 200;
    for (let i = 0; i < bqRows.length; i += BATCH_SIZE) {
      const batch = bqRows.slice(i, i + BATCH_SIZE);
      try {
        await table.insert(batch);
        console.log(`[Migrate] ${i + batch.length}/${bqRows.length} registros inseridos em ${tableName}`);
      } catch (err) {
        console.error(`[Migrate] Erro no lote ${i} da tabela ${tableName}:`);
        if (err.errors) {
          err.errors.forEach(e => {
            console.error(`- Row error:`, JSON.stringify(e.errors));
            // console.error(`- Row data:`, JSON.stringify(batch[e.index]));
          });
        } else {
          console.error(err);
        }
        // Em caso de erro crítico no lote, paramos para análise
        throw new Error("Falha na migração de dados.");
      }
    }
  }

  console.log('[Migrate] Migração finalizada com sucesso.');
}

migrate().catch(err => {
  console.error('[Migrate] Erro fatal:', err);
  process.exit(1);
});
