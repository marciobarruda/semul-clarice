'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl } = require('../db');
const dayjs = require('dayjs');

/**
 * Tipos para BigQuery MERGE para evitar erros com valores NULL
 */
const BQ_TYPES = {
  numeroprontuario: 'STRING', unidadeatendimento: 'STRING', dataatendimento: 'DATE', horaatendimento: 'STRING',
  demandante: 'STRING', avaliacaoinicial: 'STRING', atendimento: ['STRING'], origemservico: ['STRING'],
  nomeusuaria: 'STRING', cpfusuaria: 'STRING', nomesocial: 'STRING', datanascimento: 'DATE', idade: 'INT64',
  rgusuaria: 'STRING', orgaoexpedidor: 'STRING', ufexpedicao: 'STRING', nacionalidade: 'STRING',
  ufnascimento: 'STRING', cidadenascimento: 'STRING', estadocivil: 'STRING', conjuge: 'STRING',
  identidadegenero: 'STRING', orientacaosexual: 'STRING', corraca: 'STRING', religiao: 'STRING',
  nomemae: 'STRING', nomepai: 'STRING', cep: 'STRING', logradouro: 'STRING', numeroendereco: 'STRING',
  complementoendereco: 'STRING', bairro: 'STRING', rpa: 'STRING', cidade: 'STRING', uf: 'STRING', 
  pontoreferencia: 'STRING', telefone: 'STRING', telefonesecundario: 'STRING', email: 'STRING', 
  escolaridade: 'STRING', situacaoescolar: 'STRING', anoperiodo: 'STRING', cursoformacao: 'STRING', 
  situacaoocupacional: 'STRING', profissao: 'STRING', rendaindividual: 'STRING', situacaotrabalho: 'STRING', 
  beneficios: 'STRING', rendafamiliar: 'STRING', redeapoio: 'STRING', situacaohabitacional: 'STRING',
  situacaohabitacionaloutro: 'STRING', totalfilhos: 'INT64', numerosus: 'STRING',
  deficienciasindrome: 'BOOL', deficienciaqual: 'STRING', atendimentopsicologo: 'BOOL',
  atendimentopsiquiatra: 'BOOL', usomedicamento: 'BOOL', medquais: 'STRING', gestante: 'BOOL',
  examehiv: 'BOOL', tipoviolencia: 'STRING', localviolencia: 'STRING', frequencia: 'STRING',
  violenciafisica: ['STRING'], violenciapsicologica: ['STRING'], fatoresrelacionados: ['STRING'],
  relatocaso: 'STRING', createdat: 'TIMESTAMP', updatedat: 'TIMESTAMP',
  outras_viol_fisicas: 'STRING', outras_viol_psicologicas: 'STRING', relato_ciods: 'STRING', outro_local_agressao: 'STRING'
};

async function gerarProximoNumero() {
  const prefix = dayjs().format('YYYYMM');
  const sql = `SELECT MAX(CAST(SUBSTR(numeroprontuario, 8) AS INT64)) as max_num FROM ${tbl('prontuario')} WHERE numeroprontuario LIKE @prefix`;
  const rows = await query(sql, { prefix: `${prefix}-%` }, { prefix: 'STRING' });
  const prox = (rows[0].max_num || 0) + 1;
  return `${prefix}-${String(prox).padStart(4, '0')}`;
}

function mapPayload(body) {
  const d = { ...body };
  
  // Garantir que datas vazias ou "Invalid Date" vindo do front não quebrem o BQ
  const parseDate = (val) => {
    if (!val || val === 'Invalid Date' || val === 'null' || val === '') return null;
    const m = dayjs(val, 'DD/MM/YYYY');
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
  };

  d.dataatendimento = parseDate(d.data_atendimento || d.dataatendimento);
  d.datanascimento = parseDate(d.data_nascimento || d.datanascimento);
  
  d.idade = d.datanascimento ? dayjs().diff(dayjs(d.datanascimento), 'year') : null;
  
  const arrayFields = ['atendimento', 'origemservico', 'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados'];
  arrayFields.forEach(f => {
    if (d[f] && !Array.isArray(d[f])) d[f] = String(d[f]).split(',').map(s => s.trim()).filter(Boolean);
    else if (!d[f]) d[f] = [];
  });

  const boolFields = ['deficienciasindrome', 'atendimentopsicologo', 'atendimentopsiquiatra', 'usomedicamento', 'gestante', 'examehiv'];
  boolFields.forEach(f => { if (d[f] !== undefined) d[f] = String(d[f]).toLowerCase() === 'true' || d[f] === true || d[f] === '1'; });
  if (d.total_filhos !== undefined) d.totalfilhos = parseInt(d.total_filhos, 10) || 0;
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
router.post('/', async (req, res) => {
  try {
    // Limitamos a 2000 registros para evitar que o Node trave ao serializar o JSON
    const sql = `SELECT * FROM ${tbl('prontuario')} ORDER BY createdat DESC LIMIT 2000`;
    const rows = await query(sql);
    res.json(flattenRows(rows));
  } catch (err) {
    console.error('[BQ Prontuarios] Erro:', err);
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
    let isNew = !body.numeroprontuario || body.numeroprontuario === 'NOVO';
    if (isNew) {
      body.numeroprontuario = await gerarProximoNumero();
      body.createdat = new Date().toISOString();
    }
    body.updatedat = new Date().toISOString();

    const cols = Object.keys(BQ_TYPES);
    const params = {};
    const types = {};
    cols.forEach(c => {
      params[c] = body[c] === undefined ? null : body[c];
      types[c] = BQ_TYPES[c];
    });

    const mergeSql = `
      MERGE ${tbl('prontuario')} T
      USING (SELECT @numeroprontuario as val) S
      ON T.numeroprontuario = S.val
      WHEN MATCHED THEN
        UPDATE SET ${cols.filter(c => c !== 'numeroprontuario' && c !== 'createdat').map(c => `${c} = @${c}`).join(', ')}
      WHEN NOT MATCHED THEN
        INSERT (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})
    `;

    await dml(mergeSql, params, types);
    res.json({ success: true, prontuario: { numeroprontuario: body.numeroprontuario } });
  } catch (err) {
    console.error('[BQ Salvar] Erro:', err);
    res.status(500).json({ error: 'Erro ao salvar' });
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
