'use strict';

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT = process.env.GCP_PROJECT || 'automacao-de-processos-418519';
const DATASET = process.env.BQ_DATASET || 'clarice';
const LOCATION = process.env.BQ_LOCATION || 'southamerica-east1';

const bigquery = new BigQuery({ projectId: PROJECT });

async function setup() {
  console.log(`[BQ] Iniciando setup no projeto ${PROJECT}, dataset ${DATASET}...`);

  // 1. Criar Dataset se não existir
  const [datasets] = await bigquery.getDatasets();
  const datasetExists = datasets.some(d => d.id === DATASET);

  if (!datasetExists) {
    await bigquery.createDataset(DATASET, { location: LOCATION });
    console.log(`[BQ] Dataset ${DATASET} criado.`);
  } else {
    console.log(`[BQ] Dataset ${DATASET} já existe.`);
  }

  const dataset = bigquery.dataset(DATASET);

  // 2. Definir Schemas
  const schemas = {
    anexo: [
      { name: 'idanexo', type: 'INT64' },
      { name: 'numeroprontuario', type: 'STRING' },
      { name: 'idarquivoexterno', type: 'STRING' },
      { name: 'nomearquivo', type: 'STRING' },
      { name: 'formatoarquivo', type: 'STRING' },
      { name: 'categoriadoc', type: 'STRING' },
      { name: 'dataupload', type: 'TIMESTAMP' },
      { name: 'medialink', type: 'STRING' },
    ],
    autoresviolencia: [
      { name: 'id', type: 'INT64' },
      { name: 'numeroprontuario', type: 'STRING' },
      { name: 'autornome', type: 'STRING' },
      { name: 'autorcpf', type: 'STRING' },
      { name: 'autorvinculo', type: 'STRING' },
      { name: 'autorprofissao', type: 'STRING' },
      { name: 'createdat', type: 'TIMESTAMP' },
      { name: 'updatedat', type: 'TIMESTAMP' },
    ],
    composicaofamiliar: [
      { name: 'id', type: 'INT64' },
      { name: 'numeroprontuario', type: 'STRING' },
      { name: 'familianome', type: 'STRING' },
      { name: 'familiaparentesco', type: 'STRING' },
      { name: 'familiaidade', type: 'INT64' },
      { name: 'createdat', type: 'TIMESTAMP' },
      { name: 'updatedat', type: 'TIMESTAMP' },
      { name: 'datanascimento', type: 'DATE' },
    ],
    evolucao: [
      { name: 'id', type: 'INT64' },
      { name: 'numeroprontuario', type: 'STRING' },
      { name: 'evolucaodata', type: 'DATE' },
      { name: 'evolucaodescricao', type: 'STRING' },
      { name: 'tecnica', type: 'STRING' },
      { name: 'funcao', type: 'STRING' },
      { name: 'createdat', type: 'TIMESTAMP' },
      { name: 'updatedat', type: 'TIMESTAMP' },
    ],
    prontuario: [
      { name: 'id', type: 'INT64' },
      { name: 'numeroprontuario', type: 'STRING' },
      { name: 'unidadeatendimento', type: 'STRING' },
      { name: 'dataatendimento', type: 'DATE' },
      { name: 'horaatendimento', type: 'STRING' },
      { name: 'demandante', type: 'STRING' },
      { name: 'avaliacaoinicial', type: 'STRING' },
      { name: 'atendimento', type: 'STRING', mode: 'REPEATED' },
      { name: 'origemservico', type: 'STRING', mode: 'REPEATED' },
      { name: 'nomeusuaria', type: 'STRING' },
      { name: 'cpfusuaria', type: 'STRING' },
      { name: 'nomesocial', type: 'STRING' },
      { name: 'datanascimento', type: 'DATE' },
      { name: 'idade', type: 'INT64' },
      { name: 'rgusuaria', type: 'STRING' },
      { name: 'orgaoexpedidor', type: 'STRING' },
      { name: 'ufexpedicao', type: 'STRING' },
      { name: 'nacionalidade', type: 'STRING' },
      { name: 'ufnascimento', type: 'STRING' },
      { name: 'cidadenascimento', type: 'STRING' },
      { name: 'estadocivil', type: 'STRING' },
      { name: 'conjuge', type: 'STRING' },
      { name: 'identidadegenero', type: 'STRING' },
      { name: 'orientacaosexual', type: 'STRING' },
      { name: 'corraca', type: 'STRING' },
      { name: 'religiao', type: 'STRING' },
      { name: 'nomemae', type: 'STRING' },
      { name: 'nomepai', type: 'STRING' },
      { name: 'cep', type: 'STRING' },
      { name: 'logradouro', type: 'STRING' },
      { name: 'numeroendereco', type: 'STRING' },
      { name: 'complementoendereco', type: 'STRING' },
      { name: 'bairro', type: 'STRING' },
      { name: 'rpa', type: 'STRING' },
      { name: 'cidade', type: 'STRING' },
      { name: 'uf', type: 'STRING' },
      { name: 'pontoreferencia', type: 'STRING' },
      { name: 'telefone', type: 'STRING' },
      { name: 'telefonesecundario', type: 'STRING' },
      { name: 'email', type: 'STRING' },
      { name: 'escolaridade', type: 'STRING' },
      { name: 'situacaoescolar', type: 'STRING' },
      { name: 'anoperiodo', type: 'STRING' },
      { name: 'cursoformacao', type: 'STRING' },
      { name: 'situacaoocupacional', type: 'STRING' },
      { name: 'profissao', type: 'STRING' },
      { name: 'rendaindividual', type: 'STRING' },
      { name: 'situacaotrabalho', type: 'STRING' },
      { name: 'beneficios', type: 'STRING' },
      { name: 'rendafamiliar', type: 'STRING' },
      { name: 'redeapoio', type: 'STRING' },
      { name: 'situacaohabitacional', type: 'STRING' },
      { name: 'situacaohabitacionaloutro', type: 'STRING' },
      { name: 'totalfilhos', type: 'INT64' },
      { name: 'numerosus', type: 'STRING' },
      { name: 'deficienciasindrome', type: 'BOOL' },
      { name: 'deficienciaqual', type: 'STRING' },
      { name: 'atendimentopsicologo', type: 'BOOL' },
      { name: 'atendimentopsiquiatra', type: 'BOOL' },
      { name: 'usomedicamento', type: 'BOOL' },
      { name: 'medquais', type: 'STRING' },
      { name: 'gestante', type: 'BOOL' },
      { name: 'examehiv', type: 'BOOL' },
      { name: 'tipoviolencia', type: 'STRING', mode: 'REPEATED' },
      { name: 'localviolencia', type: 'STRING' },
      { name: 'frequencia', type: 'STRING' },
      { name: 'violenciafisica', type: 'STRING', mode: 'REPEATED' },
      { name: 'violenciapsicologica', type: 'STRING', mode: 'REPEATED' },
      { name: 'fatoresrelacionados', type: 'STRING', mode: 'REPEATED' },
      { name: 'relatocaso', type: 'STRING' },
      { name: 'createdat', type: 'TIMESTAMP' },
      { name: 'updatedat', type: 'TIMESTAMP' },
      { name: 'oidsesuite', type: 'STRING' },
      { name: 'wfid', type: 'STRING' },
      { name: 'outras_viol_fisicas', type: 'STRING' },
      { name: 'outras_viol_psicologicas', type: 'STRING' },
      { name: 'relato_ciods', type: 'STRING' },
      { name: 'outro_local_agressao', type: 'STRING' },
      { name: 'iniciador', type: 'STRING' },
      { name: 'atualizador', type: 'STRING' },
      { name: 'violenciasexual', type: 'STRING', mode: 'REPEATED' },
      { name: 'violenciapatrimonial', type: 'STRING', mode: 'REPEATED' },
      { name: 'violenciamoral', type: 'STRING', mode: 'REPEATED' },
      { name: 'traficosereshumanos', type: 'STRING', mode: 'REPEATED' },
      { name: 'discriminarbens', type: 'STRING' },
    ],
  };

  // 3. Criar Tabelas
  for (const [tableName, schema] of Object.entries(schemas)) {
    const table = dataset.table(tableName);
    const [exists] = await table.exists();

    if (!exists) {
      await dataset.createTable(tableName, { schema });
      console.log(`[BQ] Tabela ${tableName} criada.`);
    } else {
      console.log(`[BQ] Tabela ${tableName} já existe.`);
    }
  }

  console.log('[BQ] Setup finalizado com sucesso.');
}

setup().catch(err => {
  console.error('[BQ] Erro no setup:', err);
  process.exit(1);
});
