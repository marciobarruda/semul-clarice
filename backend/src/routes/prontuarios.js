'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl, DATASET, PROJECT } = require('../db');
const dayjs = require('dayjs');

/**
 * Utilitário para gerar o próximo número de prontuário (YYYYMM-XXXX)
 */
async function gerarProximoNumero() {
  const prefix = dayjs().format('YYYYMM');
  const sql = `
    SELECT MAX(CAST(SUBSTR(numeroprontuario, 8) AS INT64)) as max_num
    FROM ${tbl('prontuario')}
    WHERE numeroprontuario LIKE @prefix
  `;
  const rows = await query(sql, { prefix: `${prefix}-%` });
  const prox = (rows[0].max_num || 0) + 1;
  return `${prefix}-${String(prox).padStart(4, '0')}`;
}

/**
 * Calcula idade com base na data de nascimento
 */
function calcularIdade(datanascimento) {
  if (!datanascimento) return null;
  return dayjs().diff(dayjs(datanascimento), 'year');
}

/**
 * Mapeia o payload para o objeto de banco BigQuery
 */
function mapPayload(body) {
  const d = { ...body };
  
  // Tratar campos de data
  if (d.dataatendimento) d.dataatendimento = dayjs(d.dataatendimento).format('YYYY-MM-DD');
  if (d.datanascimento) d.datanascimento = dayjs(d.datanascimento).format('YYYY-MM-DD');
  
  // Calcular idade se houver nascimento
  d.idade = calcularIdade(d.datanascimento);
  
  // Garantir que campos REPEATED sejam arrays
  const arrayFields = ['atendimento', 'origemservico', 'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados'];
  arrayFields.forEach(f => {
    if (d[f] && !Array.isArray(d[f])) {
      d[f] = String(d[f]).split(',').map(s => s.trim()).filter(Boolean);
    } else if (!d[f]) {
      d[f] = [];
    }
  });

  // Booleanos
  const boolFields = ['deficienciasindrome', 'atendimentopsicologo', 'atendimentopsiquiatra', 'usomedicamento', 'gestante', 'examehiv'];
  boolFields.forEach(f => {
    if (d[f] !== undefined) {
      d[f] = String(d[f]).toLowerCase() === 'true' || d[f] === true || d[f] === '1';
    }
  });

  // Inteiros
  if (d.total_filhos !== undefined) d.totalfilhos = parseInt(d.total_filhos, 10) || 0;

  return d;
}

// ── POST /api/prontuarios ─────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const sql = `SELECT * FROM ${tbl('prontuario')} ORDER BY createdat DESC`;
    const rows = await query(sql);
    res.json(rows);
  } catch (err) {
    console.error('[BQ Prontuarios] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar prontuários' });
  }
});

// ── POST /api/prontuarios/buscar ──────────────────────────────────────────────
router.post('/buscar', async (req, res) => {
  const { termo } = req.body;
  if (!termo) return res.status(400).json({ error: 'Termo obrigatório' });
  
  try {
    const sql = `
      SELECT * FROM ${tbl('prontuario')}
      WHERE nomeusuaria LIKE @termo
         OR cpfusuaria LIKE @termo
         OR numeroprontuario LIKE @termo
      ORDER BY createdat DESC
    `;
    const rows = await query(sql, { termo: `%${termo}%` });
    res.json(rows);
  } catch (err) {
    console.error('[BQ Buscar] Erro:', err);
    res.status(500).json({ error: 'Erro na busca' });
  }
});

// ── POST /api/prontuarios/get ─────────────────────────────────────────────────
router.post('/get', async (req, res) => {
  const num = req.body.prontuario || req.body.numeroprontuario || req.body.id;
  if (!num) return res.status(400).json({ error: 'ID obrigatório' });

  try {
    const sql = `SELECT * FROM ${tbl('prontuario')} WHERE numeroprontuario = @num`;
    const rows = await query(sql, { num: String(num) });
    res.json(rows); // Retorna array para manter compatibilidade frontend
  } catch (err) {
    console.error('[BQ Get] Erro:', err);
    res.status(500).json({ error: 'Erro ao buscar' });
  }
});

// ── POST /api/prontuarios/salvar ──────────────────────────────────────────────
router.post('/salvar', async (req, res) => {
  try {
    const body = mapPayload(req.body);
    let isNew = !body.numeroprontuario || body.numeroprontuario === 'NOVO';
    
    if (isNew) {
      body.numeroprontuario = await gerarProximoNumero();
      body.createdat = new Date().toISOString();
    }
    body.updatedat = new Date().toISOString();

    // Colunas para UPSERT (MERGE)
    const cols = [
      'numeroprontuario', 'unidadeatendimento', 'dataatendimento', 'horaatendimento',
      'demandante', 'avaliacaoinicial', 'atendimento', 'origemservico',
      'nomeusuaria', 'cpfusuaria', 'nomesocial', 'datanascimento', 'idade',
      'rgusuaria', 'orgaoexpedidor', 'ufexpedicao', 'nacionalidade',
      'ufnascimento', 'cidadenascimento', 'estadocivil', 'conjuge',
      'identidadegenero', 'orientacaosexual', 'corraca', 'religiao',
      'nomemae', 'nomepai', 'cep', 'logradouro', 'numeroendereco',
      'complementoendereco', 'bairro', 'rpa', 'cidade', 'uf', 'pontoreferencia',
      'telefone', 'telefonesecundario', 'email', 'escolaridade',
      'situacaoescolar', 'anoperiodo', 'cursoformacao', 'situacaoocupacional',
      'profissao', 'rendaindividual', 'situacaotrabalho', 'beneficios',
      'rendafamiliar', 'redeapoio', 'situacaohabitacional',
      'situacaohabitacionaloutro', 'totalfilhos', 'numerosus',
      'deficienciasindrome', 'deficienciaqual', 'atendimentopsicologo',
      'atendimentopsiquiatra', 'usomedicamento', 'medquais', 'gestante',
      'examehiv', 'tipoviolencia', 'localviolencia', 'frequencia',
      'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados',
      'relatocaso', 'createdat', 'updatedat', 'outras_viol_fisicas',
      'outras_viol_psicologicas', 'relato_ciods', 'outro_local_agressao'
    ];

    const params = {};
    cols.forEach(c => params[c] = body[c] || null);
    // Ajustar tipos específicos para BigQuery
    params.atendimento = body.atendimento || [];
    params.origemservico = body.origemservico || [];
    params.violenciafisica = body.violenciafisica || [];
    params.violenciapsicologica = body.violenciapsicologica || [];
    params.fatoresrelacionados = body.fatoresrelacionados || [];

    const mergeSql = `
      MERGE ${tbl('prontuario')} T
      USING (SELECT @numeroprontuario as val) S
      ON T.numeroprontuario = S.val
      WHEN MATCHED THEN
        UPDATE SET ${cols.filter(c => c !== 'numeroprontuario' && c !== 'createdat').map(c => `${c} = @${c}`).join(', ')}
      WHEN NOT MATCHED THEN
        INSERT (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})
    `;

    await dml(mergeSql, params);
    res.json({ success: true, prontuario: { numeroprontuario: body.numeroprontuario } });
  } catch (err) {
    console.error('[BQ Salvar] Erro:', err);
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// ── GET /api/prontuarios/novo ─────────────────────────────────────────────────
router.get('/novo', async (req, res) => {
  const { cpf } = req.query;
  if (!cpf) return res.status(400).json({ error: 'CPF obrigatório' });

  try {
    const sql = `
      SELECT * FROM ${tbl('prontuario')}
      WHERE cpfusuaria = @cpf
      ORDER BY createdat DESC LIMIT 1
    `;
    const rows = await query(sql, { cpf: String(cpf) });
    if (rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[BQ Novo] Erro:', err);
    res.status(500).json({ error: 'Erro ao buscar novo' });
  }
});

module.exports = router;
