'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const { query, dml, tbl } = require('../db');
const { uploadFile } = require('../storage');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Tipos para BigQuery MERGE para evitar erros com valores NULL
 */
const BQ_TYPES = {
  id: 'INT64', numeroprontuario: 'STRING', unidadeatendimento: 'STRING', dataatendimento: 'STRING', horaatendimento: 'STRING',
  demandante: 'STRING', avaliacaoinicial: 'STRING',
  nomeusuaria: 'STRING', cpfusuaria: 'STRING', nomesocial: 'STRING', datanascimento: 'STRING', idade: 'INT64',
  rgusuaria: 'STRING', orgaoexpedidor: 'STRING', ufexpedicao: 'STRING', nacionalidade: 'STRING',
  ufnascimento: 'STRING', cidadenascimento: 'STRING', estadocivil: 'STRING', conjuge: 'STRING',
  identidadegenero: 'STRING', orientacaosexual: 'STRING', corraca: 'STRING', religiao: 'STRING',
  nomemae: 'STRING', nomepai: 'STRING', cep: 'STRING', logradouro: 'STRING', numeroendereco: 'STRING',
  complementoendereco: 'STRING', bairro: 'STRING', rpa: 'STRING', cidade: 'STRING', uf: 'STRING',
  pontoreferencia: 'STRING', telefone: 'STRING', telefonesecundario: 'STRING', email: 'STRING',
  escolaridade: 'STRING', situacaoescolar: 'STRING', anoperiodo: 'STRING', cursoformacao: 'STRING',
  situacaoocupacional: 'STRING', profissao: 'STRING', rendaindividual: 'STRING', situacaotrabalho: 'STRING',
  beneficios: 'STRING', rendafamiliar: 'STRING', redeapoio: 'STRING', situacaohabitacional: 'STRING',
  situacaohabitacionaloutro: 'STRING', numerosus: 'STRING',
  deficienciasindrome: 'BOOL', deficienciaqual: 'STRING', atendimentopsicologo: 'BOOL',
  atendimentopsiquiatra: 'BOOL', usomedicamento: 'BOOL', medquais: 'STRING', gestante: 'BOOL',
  examehiv: 'BOOL', tipoviolencia: 'STRING', localviolencia: 'STRING', frequencia: 'STRING',
  relatocaso: 'STRING', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP',
  oidsesuite: 'STRING', wfid: 'STRING', outras_viol_fisicas: 'STRING', outras_viol_psicologicas: 'STRING',
  relato_ciods: 'STRING', outro_local_agressao: 'STRING', totalfilhos: 'STRING'
};

// Campos array (text[]) — tratados separadamente no SQL
const ARRAY_FIELDS = ['atendimento', 'origemservico', 'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados'];

async function gerarProximoNumero() {
  const prefix = dayjs().format('YYYYMM');
  const sql = `SELECT MAX(CAST(SUBSTR(numeroprontuario, 8) AS INT64)) as max_num FROM ${tbl('prontuario')} WHERE numeroprontuario LIKE @prefix`;
  const rows = await query(sql, { prefix: `${prefix}-%` }, { prefix: 'STRING' });
  const prox = (rows[0].max_num || 0) + 1;
  return `${prefix}-${String(prox).padStart(4, '0')}`;
}

function mapPayload(body) {
  const d = { ...body };

  // Aceitar tanto DD/MM/YYYY (frontend) quanto YYYY-MM-DD (banco)
  const parseDate = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    if (s === 'Invalid Date' || s === 'null' || s === '' || s === 'undefined') return null;
    
    // Se já estiver no formato ISO, retornar apenas a parte da data
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    
    // Tentar parsear formato brasileiro
    const m = dayjs(s, 'DD/MM/YYYY', true);
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
  };

  d.dataatendimento = parseDate(d.data_atendimento || d.dataatendimento);
  d.datanascimento  = parseDate(d.data_nascimento  || d.datanascimento);

  // Idade: calcular a partir da data de nascimento já convertida
  d.idade = d.datanascimento ? dayjs().diff(dayjs(d.datanascimento), 'year') : null;

  // Campos array: garantir que sejam arrays de strings limpas
  ARRAY_FIELDS.forEach(f => {
    if (Array.isArray(d[f])) {
      d[f] = d[f].map(s => String(s).trim()).filter(Boolean);
    } else if (d[f] && typeof d[f] === 'string') {
      d[f] = d[f].split(',').map(s => s.trim()).filter(Boolean);
    } else {
      d[f] = [];
    }
  });

  const boolFields = ['deficienciasindrome', 'atendimentopsicologo', 'atendimentopsiquiatra', 'usomedicamento', 'gestante', 'examehiv'];
  boolFields.forEach(f => { if (d[f] !== undefined) d[f] = String(d[f]).toLowerCase() === 'true' || d[f] === true || d[f] === '1'; });
  
  // Tratar campos vazios como null para evitar erros em colunas não-string
  const nonStringFields = [
    'idade', 'createdat', 'updatedat', 'oidsesuite', 'wfid', 'uf',
    'deficienciasindrome', 'atendimentopsicologo', 'atendimentopsiquiatra', 
    'usomedicamento', 'gestante', 'examehiv'
  ];

  Object.keys(d).forEach(k => {
    // 1. Se for um campo de ARRAY, não mexer (preservar lista)
    if (ARRAY_FIELDS.includes(k)) return;

    // 2. Tratar vazios
    if (d[k] === '' || d[k] === 'null' || d[k] === undefined) {
      d[k] = null;
    }
    
    // 3. Se for boolean ou número em nonStringFields, não converter para string
    if (nonStringFields.includes(k)) return;
    
    // 4. Caso contrário, se tiver valor, converter para string
    if (d[k] !== null && d[k] !== undefined) {
      d[k] = String(d[k]);
    }
  });

  return d;
}

/**
 * Achata objetos do BigQuery (DATE, DATETIME, TIMESTAMP) para strings simples
 */
function flattenRows(rows) {
  if (!rows) return [];
  const list = Array.isArray(rows) ? rows : [rows];
  return list.map(row => {
    const newRow = { ...row };
    Object.keys(newRow).forEach(key => {
      if (newRow[key] && typeof newRow[key] === 'object' && newRow[key].value) {
        newRow[key] = newRow[key].value;
      }
    });
    return newRow;
  });
}

// ── GET /api/prontuarios/stats (Dashboard otimizado) ────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const sql = `
      SELECT 
        COUNT(*) as total,
        COUNTIF(DATE(createdat) = CURRENT_DATE()) as hoje,
        COUNTIF(EXTRACT(MONTH FROM createdat) = EXTRACT(MONTH FROM CURRENT_DATE()) AND EXTRACT(YEAR FROM createdat) = EXTRACT(YEAR FROM CURRENT_DATE())) as mes,
        AVG(idade) as media_idade,
        COUNTIF(atendimentopsicologo = true) as psicologico,
        COUNTIF(atendimentopsiquiatra = true) as psiquiatrico
      FROM ${tbl('prontuario')}
    `;
    const rows = await query(sql);
    res.json(flattenRows(rows)[0] || {});
  } catch (err) {
    console.error('[BQ Stats] Erro:', err);
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

// ── POST /api/prontuarios (Listagem com limite para evitar OOM) ──────────────
router.get('/', async (req, res) => {
  const searchTerm = req.query.q || '';
  
  try {
    let sql = `SELECT * FROM ${tbl('prontuario')}`;
    let params = {};

    if (searchTerm) {
      sql += ` 
        WHERE LOWER(nomeusuaria) LIKE LOWER(@q) 
        OR cpfusuaria LIKE @q_cpf
        OR numeroprontuario LIKE @q_num
      `;
      params.q = `%${searchTerm}%`;
      params.q_cpf = `%${searchTerm.replace(/\D/g, '')}%`;
      params.q_num = `%${searchTerm.toUpperCase()}%`;
      sql += ` ORDER BY nomeusuaria ASC LIMIT 500`;
    } else {
      sql += ` ORDER BY createdat DESC LIMIT 200`;
    }

    const rows = await query(sql, params);
    res.json(flattenRows(rows));
  } catch (err) {
    console.error('[BQ Prontuarios List] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar prontuários' });
  }
});

router.post('/buscar', async (req, res) => {
  const { termo } = req.body;
  if (!termo) return res.status(400).json({ error: 'Termo obrigatório' });
  try {
    const sql = `SELECT * FROM ${tbl('prontuario')} WHERE nomeusuaria LIKE @termo OR cpfusuaria LIKE @termo OR numeroprontuario LIKE @termo ORDER BY createdat DESC LIMIT 500`;
    const rows = await query(sql, { termo: `%${termo}%` }, { termo: 'STRING' });
    res.json(flattenRows(rows));
  } catch (err) {
    console.error('[BQ Buscar] Erro:', err);
    res.status(500).json({ error: 'Erro na busca' });
  }
});

router.post('/get', async (req, res) => {
  const num = req.body.prontuario || req.body.numeroprontuario || req.body.id;
  if (!num) return res.status(400).json({ error: 'ID obrigatório' });
  try {
    const rows = await query(`SELECT * FROM ${tbl('prontuario')} WHERE numeroprontuario = @num`, { num: String(num) }, { num: 'STRING' });
    res.json(flattenRows(rows));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar' });
  }
});

router.post('/salvar', async (req, res) => {
  try {
    const body = mapPayload(req.body);
    const isNew = !body.numeroprontuario || body.numeroprontuario === 'NOVO';
    
    console.log(`[BQ Salvar] Recebido: ${body.numeroprontuario} | DataAtend: ${body.dataatendimento} | DataNasc: ${body.datanascimento}`);

    if (isNew) {
      body.numeroprontuario = await gerarProximoNumero();
      body.createdat = new Date().toISOString();
    }
    body.updatedat = new Date().toISOString();

    // Colunas escalares (sem arrays)
    const scalarCols = Object.keys(BQ_TYPES);
    const params = {};
    const types = {};
    scalarCols.forEach(c => {
      params[c] = body[c] === undefined ? null : body[c];
      types[c]  = BQ_TYPES[c];
    });

    // Serializar arrays como literais SQL: ['a','b'] → ["a","b"]
    const toArrayLiteral = (arr) => {
      if (!Array.isArray(arr) || arr.length === 0) return 'CAST([] AS ARRAY<STRING>)';
      const escaped = arr.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ');
      return `[${escaped}]`;
    };

    // Construir SET e VALUES para os campos array diretamente no SQL
    const arraySetClauses  = ARRAY_FIELDS.map(f => `${f} = ${toArrayLiteral(body[f])}`).join(', ');
    const scalarSetClauses = scalarCols
      .filter(c => c !== 'numeroprontuario' && c !== 'createdat' && c !== 'id')
      .map(c => `${c} = @${c}`).join(', ');

    const allInsertCols   = [...scalarCols, ...ARRAY_FIELDS];
    const insertColsSql   = allInsertCols.join(', ');
    const insertValsSql   = [
      ...scalarCols.map(c => `@${c}`),
      ...ARRAY_FIELDS.map(f => toArrayLiteral(body[f]))
    ].join(', ');

    const mergeSql = `
      MERGE ${tbl('prontuario')} T
      USING (SELECT @numeroprontuario as val) S
      ON T.numeroprontuario = S.val
      WHEN MATCHED THEN
        UPDATE SET ${scalarSetClauses}, ${arraySetClauses}
      WHEN NOT MATCHED THEN
        INSERT (${insertColsSql}) VALUES (${insertValsSql})
    `;

    console.log('[BQ Salvar] Params:', JSON.stringify(params, null, 2));
    
    await dml(mergeSql, params, types);

    // ── Processamento de Anexos ──────────────────────────────────────────────
    const totalAnexos = parseInt(req.body.totalanexos || 0);
    if (totalAnexos > 0) {
      console.log(`[Anexos] Processando ${totalAnexos} arquivos para o prontuário ${body.numeroprontuario}`);
      
      for (let i = 0; i < totalAnexos; i++) {
        const base64 = req.body[`arquivo_${i}`];
        const nome   = req.body[`arquivo_nome_${i}`];
        const desc   = req.body[`arquivo_desc_${i}`] || '';
        const data   = req.body[`arquivo_data_${i}`] || dayjs().format('YYYY-MM-DD');

        if (base64 && nome) {
          try {
            const ext = path.extname(nome).toLowerCase();
            const destination = `arquivos/${body.numeroprontuario}/${Date.now()}_${nome}`;
            const mediaLink = await uploadFile(base64, destination, 'application/octet-stream');

            const anexoParams = {
              idanexo: Math.floor(Date.now() % 1000000000),
              numeroprontuario: body.numeroprontuario,
              idarquivoexterno: destination,
              nomearquivo: nome,
              formatoarquivo: ext,
              categoriadoc: desc,
              dataupload: new Date().toISOString(),
              medialink: mediaLink
            };

            const anexoSql = `
              INSERT INTO ${tbl('anexo')} (idanexo, numeroprontuario, idarquivoexterno, nomearquivo, formatoarquivo, categoriadoc, dataupload, medialink)
              VALUES (@idanexo, @numeroprontuario, @idarquivoexterno, @nomearquivo, @formatoarquivo, @categoriadoc, CURRENT_TIMESTAMP(), @medialink)
            `;

            await dml(anexoSql, anexoParams, {
              idanexo: 'INT64', numeroprontuario: 'STRING', idarquivoexterno: 'STRING', 
              nomearquivo: 'STRING', formatoarquivo: 'STRING', categoriadoc: 'STRING', 
              medialink: 'STRING'
            });
            
            console.log(`[Anexos] Arquivo "${nome}" salvo com sucesso.`);
          } catch (errAnexo) {
            console.error(`[Anexos] Erro ao processar arquivo "${nome}":`, errAnexo);
          }
        }
      }
    }

    res.json({ message: 'Salvo com sucesso!', numeroprontuario: body.numeroprontuario });
  } catch (err) {
    console.error('[BQ Salvar] Erro detalhado:', err);
    res.status(500).json({ error: 'Erro ao salvar: ' + (err.message || err) });
  }
});

router.get('/novo', async (req, res) => {
  const { cpf } = req.query;
  if (!cpf) return res.status(400).json({ error: 'CPF obrigatório' });
  try {
    const rows = await query(`SELECT * FROM ${tbl('prontuario')} WHERE cpfusuaria = @cpf ORDER BY createdat DESC LIMIT 1`, { cpf: String(cpf) }, { cpf: 'STRING' });
    if (rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json(flattenRows(rows)[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar novo' });
  }
});

module.exports = router;
