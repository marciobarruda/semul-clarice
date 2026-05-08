'use strict';

/**
 * routes/prontuarios.js
 *
 * Mapeia exatamente os webhooks do n8n que eram chamados pelo index.html:
 *   POST /api/prontuarios          → buscar-todos-os-dados
 *   POST /api/prontuarios/buscar   → listar-prontuarios
 *   POST /api/prontuarios/get      → buscar-prontuario
 *   POST /api/prontuarios/salvar   → salvar-prontuario
 *   GET  /api/prontuarios/novo     → recuperar-prontuario-novo
 */

const express = require('express');
const router  = express.Router();
const { pool, SCHEMA } = require('../db');

// ── Utilitários de conversão de tipos ────────────────────────────────────────

/** Converte DD/MM/YYYY → YYYY-MM-DD. Aceita também formato ISO. */
function parseDate(val) {
  if (!val || String(val).trim() === '') return null;
  const s = String(val).trim();

  // DD/MM/YYYY
  const parts = s.split('/');
  if (parts.length === 3 && parts[2].length === 4) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }

  // Já está no formato ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss...)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);

  return null;
}

/** Converte valores diversos para boolean ou null. */
function toBool(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (s === 'true' || s === 'sim' || s === '1' || s === 't') return true;
  if (s === 'false' || s === 'não' || s === 'nao' || s === '0' || s === 'f') return false;
  return null;
}

/** Garante que o valor seja um array ou null. */
function toArray(val) {
  if (val === null || val === undefined || val === '') return null;
  if (Array.isArray(val)) return val.filter(v => v !== '' && v !== null);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === '{}') return null;
    // Formato Postgres: {a,"b c",d}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1);
      const result = [];
      let current = '';
      let inQuote = false;
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === ',' && !inQuote) { if (current.trim()) result.push(current.trim()); current = ''; }
        else { current += c; }
      }
      if (current.trim()) result.push(current.trim());
      return result.length ? result : null;
    }
    // Separado por vírgula simples
    return val.split(',').map(s => s.trim()).filter(Boolean) || null;
  }
  return null;
}

/**
 * Mapeia os campos do payload do frontend (snake_case dos IDs do form)
 * para as colunas do banco (camelCase compacto).
 * Aceita tanto o nome do frontend quanto o nome do banco diretamente.
 */
function mapPayloadToDb(body) {
  const get = (...keys) => {
    for (const k of keys) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== '') return body[k];
    }
    return undefined;
  };

  return {
    // Identificação e atendimento
    numeroprontuario:     get('numero_prontuario', 'numeroprontuario') || null,
    unidadeatendimento:   get('unidade_atendimento', 'unidadeatendimento'),
    dataatendimento:      parseDate(get('data_atendimento', 'dataatendimento')),
    horaatendimento:      get('hora_atendimento', 'horaatendimento') || null,
    demandante:           get('demandante'),
    avaliacaoinicial:     get('avaliacao_inicial', 'avaliacaoinicial'),

    // Arrays de atendimento
    atendimento:          toArray(get('atendimento')),
    origemservico:        toArray(get('origemservico', 'origem_servico')),

    // Dados da usuária
    nomeusuaria:          get('nome_usuaria', 'nomeusuaria'),
    cpfusuaria:           get('cpf_usuaria', 'cpfusuaria'),
    nomesocial:           get('nome_social', 'nomesocial'),
    datanascimento:       parseDate(get('data_nascimento', 'datanascimento')),
    rgusuaria:            get('rg_usuaria', 'rgusuaria'),
    orgaoexpedidor:       get('orgao_expedidor', 'orgaoexpedidor'),
    ufexpedicao:          get('uf_expedicao', 'ufexpedicao'),
    nacionalidade:        get('nacionalidade'),
    ufnascimento:         get('uf_nascimento', 'ufnascimento'),
    cidadenascimento:     get('cidade_nascimento', 'cidadenascimento'),
    estadocivil:          get('estado_civil', 'estadocivil'),
    conjuge:              get('conjuge'),
    identidadegenero:     get('identidade_genero', 'identidadegenero'),
    orientacaosexual:     get('orientacao_sexual', 'orientacaosexual'),
    corraca:              get('cor_raca', 'corraca'),
    religiao:             get('religiao'),
    nomemae:              get('nome_mae', 'nomemae'),
    nomepai:              get('nome_pai', 'nomepai'),

    // Endereço
    cep:                  get('cep'),
    logradouro:           get('logradouro'),
    numeroendereco:       get('numero_endereco', 'numeroendereco'),
    complementoendereco:  get('complemento_endereco', 'complementoendereco'),
    bairro:               get('bairro'),
    rpa:                  get('rpa'),
    cidade:               get('cidade'),
    uf:                   get('uf'),
    pontoreferencia:      get('ponto_referencia', 'pontoreferencia'),

    // Contato
    telefone:             get('telefone'),
    telefonesecundario:   get('telefone_secundario', 'telefonesecundario'),
    email:                get('email'),

    // Escolaridade / Trabalho
    escolaridade:         get('escolaridade'),
    situacaoescolar:      get('situacao_escolar', 'situacaoescolar'),
    anoperiodo:           get('ano_periodo', 'anoperiodo'),
    cursoformacao:        get('curso_formacao', 'cursoformacao'),
    situacaoocupacional:  get('situacao_ocupacional', 'situacaoocupacional'),
    profissao:            get('profissao'),
    rendaindividual:      get('renda_individual', 'rendaindividual'),
    situacaotrabalho:     get('situacao_trabalho', 'situacaotrabalho'),
    beneficios:           get('beneficios'),
    rendafamiliar:        get('renda_familiar', 'rendafamiliar'),
    redeapoio:            get('rede_apoio', 'redeapoio'),
    situacaohabitacional: get('situacao_habitacional', 'situacaohabitacional'),
    situacaohabitacionaloutro: get('situacao_habitacional_outro', 'situacaohabitacionaloutro'),
    totalfilhos:          get('total_filhos', 'totalfilhos'),

    // Saúde
    numerosus:            get('numero_sus', 'numerosus'),
    deficienciasindrome:  toBool(get('deficiencia_sindrome', 'deficienciasindrome')),
    deficienciaqual:      get('deficiencia_qual', 'deficienciaqual'),
    atendimentopsicologo: toBool(get('atendimentopsicologo', 'atendimento_psicologo')),
    atendimentopsiquiatra:toBool(get('atendimentopsiquiatra', 'atendimento_psiquiatra')),
    usomedicamento:       toBool(get('usomedicamento', 'uso_medicamento')),
    medquais:             get('quais_medicamentos', 'medquais'),
    gestante:             toBool(get('gestante')),
    examehiv:             toBool(get('examehiv', 'exame_hiv')),

    // Violência
    tipoviolencia:        get('tipo_violencia', 'tipoviolencia'),
    localviolencia:       get('local_violencia', 'localviolencia'),
    frequencia:           get('frequencia'),
    violenciafisica:      toArray(get('violenciafisica', 'violencia_fisica')),
    violenciapsicologica: toArray(get('violenciapsicologica', 'violencia_psicologica')),
    fatoresrelacionados:  toArray(get('fatoresrelacionados', 'fatores_relacionados')),
    outras_viol_fisicas:  get('outras_viol_fisicas'),
    outras_viol_psicologicas: get('outras_viol_psicologicas'),

    // Relato e extras
    relatocaso:           get('relato_caso', 'relatocaso'),
    relato_ciods:         get('relato_ciods'),
    outro_local_agressao: get('outro_local_agressao'),
  };
}

// ── POST /api/prontuarios ─────────────────────────────────────────────────────
// Equivale a: buscar-todos-os-dados
router.post('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.prontuario ORDER BY createdat DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[prontuarios] Erro ao listar:', err.message);
    res.status(500).json({ error: 'Erro ao consultar prontuários', detail: err.message });
  }
});

// ── POST /api/prontuarios/buscar ──────────────────────────────────────────────
// Equivale a: listar-prontuarios (busca por termo)
router.post('/buscar', async (req, res) => {
  const { termo } = req.body;
  if (!termo || String(termo).trim() === '') {
    return res.status(400).json({ error: 'Parâmetro "termo" é obrigatório.' });
  }

  try {
    const like = `%${termo.trim()}%`;
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.prontuario
       WHERE nomeusuaria       ILIKE $1
          OR cpfusuaria        ILIKE $1
          OR numeroprontuario  ILIKE $1
       ORDER BY createdat DESC`,
      [like]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[prontuarios/buscar] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao buscar prontuários', detail: err.message });
  }
});

// ── POST /api/prontuarios/get ─────────────────────────────────────────────────
// Equivale a: buscar-prontuario
router.post('/get', async (req, res) => {
  const { prontuario, numeroprontuario, id } = req.body;
  const num = prontuario || numeroprontuario || id;

  if (!num) return res.status(400).json({ error: 'Parâmetro "prontuario" é obrigatório.' });

  try {
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.prontuario WHERE numeroprontuario = $1`,
      [String(num).trim()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prontuário não encontrado.' });
    }
    res.json(result.rows);   // retorna array (igual ao n8n)
  } catch (err) {
    console.error('[prontuarios/get] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao buscar prontuário', detail: err.message });
  }
});

// ── POST /api/prontuarios/salvar ──────────────────────────────────────────────
// Equivale a: salvar-prontuario
// Usa INSERT ... ON CONFLICT (numeroprontuario) DO UPDATE SET ...
// Se numeroprontuario for null, o trigger do banco o gera automaticamente.
router.post('/salvar', async (req, res) => {
  try {
    const d = mapPayloadToDb(req.body);

    // Colunas e valores para insert/update
    // Excluímos campos de controle automático: id, createdat, updatedat, idade
    const cols = [
      'numeroprontuario', 'unidadeatendimento', 'dataatendimento', 'horaatendimento',
      'demandante', 'avaliacaoinicial', 'atendimento', 'origemservico',
      'nomeusuaria', 'cpfusuaria', 'nomesocial', 'datanascimento',
      'rgusuaria', 'orgaoexpedidor', 'ufexpedicao', 'nacionalidade',
      'ufnascimento', 'cidadenascimento', 'estadocivil', 'conjuge',
      'identidadegenero', 'orientacaosexual', 'corraca', 'religiao',
      'nomemae', 'nomepai',
      'cep', 'logradouro', 'numeroendereco', 'complementoendereco',
      'bairro', 'rpa', 'cidade', 'uf', 'pontoreferencia',
      'telefone', 'telefonesecundario', 'email',
      'escolaridade', 'situacaoescolar', 'anoperiodo', 'cursoformacao',
      'situacaoocupacional', 'profissao', 'rendaindividual', 'situacaotrabalho',
      'beneficios', 'rendafamiliar', 'redeapoio',
      'situacaohabitacional', 'situacaohabitacionaloutro', 'totalfilhos',
      'numerosus', 'deficienciasindrome', 'deficienciaqual',
      'atendimentopsicologo', 'atendimentopsiquiatra', 'usomedicamento', 'medquais',
      'gestante', 'examehiv',
      'tipoviolencia', 'localviolencia', 'frequencia',
      'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados',
      'outras_viol_fisicas', 'outras_viol_psicologicas',
      'relatocaso', 'relato_ciods', 'outro_local_agressao',
    ];

    const values = cols.map(c => d[c] !== undefined ? d[c] : null);
    const placeholders = cols.map((_, i) => {
      // Colunas de array precisam de cast explícito no Postgres
      const arrayCols = ['atendimento', 'origemservico', 'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados'];
      return arrayCols.includes(cols[i]) ? `$${i + 1}::text[]` : `$${i + 1}`;
    });

    // Monta cláusula DO UPDATE SET (exclui numeroprontuario da atualização)
    const updateClauses = cols
      .filter(c => c !== 'numeroprontuario')
      .map(c => {
        const idx = cols.indexOf(c) + 1;
        const arrayCols = ['atendimento', 'origemservico', 'violenciafisica', 'violenciapsicologica', 'fatoresrelacionados'];
        return `${c} = $${idx}${arrayCols.includes(c) ? '::text[]' : ''}`;
      });

    const sql = `
      INSERT INTO ${SCHEMA}.prontuario (${cols.join(', ')})
      VALUES (${placeholders.join(', ')})
      ON CONFLICT (numeroprontuario) DO UPDATE SET
        ${updateClauses.join(',\n        ')}
      RETURNING numeroprontuario, nomeusuaria, createdat, updatedat
    `;

    const result = await pool.query(sql, values);
    res.json({ success: true, prontuario: result.rows[0] });
  } catch (err) {
    console.error('[prontuarios/salvar] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao salvar prontuário', detail: err.message });
  }
});

// ── GET /api/prontuarios/novo ─────────────────────────────────────────────────
// Equivale a: recuperar-prontuario-novo
// Busca o prontuário mais recente de um CPF (usado após novo cadastro)
router.get('/novo', async (req, res) => {
  const cpf = (req.query.cpf || '').replace(/\D/g, '');
  if (!cpf) return res.status(400).json({ error: 'Parâmetro "cpf" é obrigatório.' });

  try {
    const result = await pool.query(
      `SELECT * FROM ${SCHEMA}.prontuario
       WHERE REGEXP_REPLACE(cpfusuaria, '[^0-9]', '', 'g') = $1
       ORDER BY createdat DESC LIMIT 1`,
      [cpf]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Prontuário não encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[prontuarios/novo] Erro:', err.message);
    res.status(500).json({ error: 'Erro ao buscar novo prontuário', detail: err.message });
  }
});

module.exports = router;
