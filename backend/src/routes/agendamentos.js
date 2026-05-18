'use strict';

const express = require('express');
const router = express.Router();
const { query, dml, tbl } = require('../db');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

// ── AGENDAMENTOS ─────────────────────────────────────────────────────────────

// Listar agendamentos (GET /api/agendamentos)
router.get('/', async (req, res) => {
  const { tecnica, status } = req.query;

  try {
    let sql = `SELECT * FROM ${tbl('agendamento')} WHERE 1=1`;
    const params = {};

    if (tecnica) {
      sql += ' AND tecnica_login = @tecnica';
      params.tecnica = String(tecnica).toLowerCase().trim();
    }
    if (status) {
      sql += ' AND status = @status';
      params.status = String(status);
    }

    sql += ' ORDER BY datahorario ASC, createdat DESC';

    const rows = await query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[BQ Agendamentos List] Erro:', err);
    res.status(500).json({ error: 'Erro ao listar agendamentos' });
  }
});

// Salvar/Editar agendamento (POST /api/agendamentos/salvar)
router.post('/salvar', async (req, res) => {
  const {
    id,
    numeroprontuario,
    nomeusuaria,
    cpfusuaria,
    datanascimento,
    nomemae,
    tipoatendimento,
    tecnica_login,
    tecnica_nome,
    datahorario,
    observacao
  } = req.body;

  if (!numeroprontuario || !nomeusuaria || !tipoatendimento || !tecnica_login || !datahorario) {
    return res.status(400).json({ error: 'Dados obrigatórios ausentes para o agendamento' });
  }

  const userLogin = req.user?.login || 'sistema';
  const userName = req.user?.nome || 'Sistema';

  try {
    if (id) {
      // Editar existente
      const sql = `
        UPDATE ${tbl('agendamento')}
        SET 
          tipoatendimento = @tipoatendimento,
          tecnica_login = @tecnica_login,
          tecnica_nome = @tecnica_nome,
          datahorario = CAST(@datahorario AS TIMESTAMP),
          observacao = @observacao,
          updatedat = CURRENT_TIMESTAMP()
        WHERE id = @id
      `;
      const params = {
        id: String(id),
        tipoatendimento: String(tipoatendimento),
        tecnica_login: String(tecnica_login).toLowerCase().trim(),
        tecnica_nome: String(tecnica_nome),
        datahorario: String(datahorario),
        observacao: observacao ? String(observacao) : null
      };
      await dml(sql, params);
      res.json({ success: true, id });
    } else {
      // Criar novo
      const newId = uuidv4();
      const sql = `
        INSERT INTO ${tbl('agendamento')} (
          id, numeroprontuario, nomeusuaria, cpfusuaria, datanascimento, nomemae,
          tipoatendimento, tecnica_login, tecnica_nome, datahorario, status,
          observacao, createdat, updatedat, agendadopor, agendadopor_nome
        ) VALUES (
          @id, @numeroprontuario, @nomeusuaria, @cpfusuaria, CAST(@datanascimento AS DATE), @nomemae,
          @tipoatendimento, @tecnica_login, @tecnica_nome, CAST(@datahorario AS TIMESTAMP), 'Pendente',
          @observacao, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), @agendadopor, @agendadopor_nome
        )
      `;
      const params = {
        id: newId,
        numeroprontuario: String(numeroprontuario),
        nomeusuaria: String(nomeusuaria),
        cpfusuaria: cpfusuaria ? String(cpfusuaria) : null,
        datanascimento: datanascimento ? String(datanascimento) : null,
        nomemae: nomemae ? String(nomemae) : null,
        tipoatendimento: String(tipoatendimento),
        tecnica_login: String(tecnica_login).toLowerCase().trim(),
        tecnica_nome: String(tecnica_nome),
        datahorario: String(datahorario),
        observacao: observacao ? String(observacao) : null,
        agendadopor: userLogin,
        agendadopor_nome: userName
      };
      await dml(sql, params);
      res.json({ success: true, id: newId });
    }
  } catch (err) {
    console.error('[BQ Agendamento Salvar] Erro:', err);
    res.status(500).json({ error: 'Erro ao salvar agendamento' });
  }
});

// Cancelar agendamento (POST /api/agendamentos/cancelar)
router.post('/cancelar', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID obrigatório' });

  try {
    const sql = `
      UPDATE ${tbl('agendamento')}
      SET status = 'Cancelado', updatedat = CURRENT_TIMESTAMP()
      WHERE id = @id
    `;
    await dml(sql, { id: String(id) });
    res.json({ success: true });
  } catch (err) {
    console.error('[BQ Agendamento Cancelar] Erro:', err);
    res.status(500).json({ error: 'Erro ao cancelar agendamento' });
  }
});

// Concluir agendamento (POST /api/agendamentos/concluir)
router.post('/concluir', async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID obrigatório' });

  try {
    const sql = `
      UPDATE ${tbl('agendamento')}
      SET status = 'Concluído', updatedat = CURRENT_TIMESTAMP()
      WHERE id = @id
    `;
    await dml(sql, { id: String(id) });
    res.json({ success: true });
  } catch (err) {
    console.error('[BQ Agendamento Concluir] Erro:', err);
    res.status(500).json({ error: 'Erro ao concluir agendamento' });
  }
});

// ── DISPONIBILIDADE DA AGENDA (CONFIGURAÇÃO) ─────────────────────────────────

// Obter status das agendas de todas as técnicas (GET /api/agendamentos/users/agenda-status)
router.get('/users/agenda-status', async (req, res) => {
  try {
    const sql = `SELECT * FROM ${tbl('agenda_config')}`;
    const rows = await query(sql);
    res.json(rows);
  } catch (err) {
    console.error('[BQ Agenda Status Users] Erro:', err);
    res.status(500).json({ error: 'Erro ao obter status de agendas' });
  }
});

// Alternar status de abertura da agenda (POST /api/agendamentos/users/toggle-agenda)
router.post('/users/toggle-agenda', async (req, res) => {
  const { login, nome, funcao, agenda_aberta, unidade } = req.body;

  if (!login) {
    return res.status(400).json({ error: 'Login da técnica é obrigatório' });
  }

  const updatedBy = req.user?.login || 'sistema';

  try {
    const sql = `
      MERGE ${tbl('agenda_config')} T
      USING (SELECT 
        CAST(@login AS STRING) AS login, 
        CAST(@nome AS STRING) AS nome, 
        CAST(@funcao AS STRING) AS funcao, 
        CAST(@aberta AS BOOL) AS agenda_aberta, 
        CURRENT_TIMESTAMP() AS updatedat, 
        CAST(@by AS STRING) AS updatedby
      ) S
      ON T.login = S.login
      WHEN MATCHED THEN
        UPDATE SET 
          T.agenda_aberta = S.agenda_aberta, 
          T.nome = S.nome, 
          T.funcao = S.funcao, 
          T.updatedat = S.updatedat, 
          T.updatedby = S.updatedby
      WHEN NOT MATCHED THEN
        INSERT (login, nome, funcao, agenda_aberta, updatedat, updatedby)
        VALUES (S.login, S.nome, S.funcao, S.agenda_aberta, S.updatedat, S.updatedby)
    `;
    const params = {
      login: String(login).toLowerCase().trim(),
      nome: String(nome || ''),
      funcao: String(funcao || ''),
      aberta: Boolean(agenda_aberta),
      by: updatedBy
    };
    const types = {
      login: 'STRING',
      nome: 'STRING',
      funcao: 'STRING',
      aberta: 'BOOL',
      by: 'STRING'
    };
    await dml(sql, params, types);

    // Enviar dados para o webhook do n8n (para persistência no BigQuery via n8n)
    try {
      fetch('https://webhook-n8n-dev-conectarecife.recife.pe.gov.br/webhook/agenda_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{
          login: String(login).toLowerCase().trim(),
          nome: String(nome || ''),
          funcao: String(funcao || ''),
          unidade: String(unidade || ''),
          agenda_aberta: Boolean(agenda_aberta),
          updatedat: new Date().toISOString(),
          updatedby: updatedBy
        }]),
        timeout: 5000
      }).catch(err => {
        console.error('[Webhook Agenda Config Alert] Falha no envio para n8n:', err.message);
      });
    } catch (e) {
      console.error('[Webhook Agenda Config Error] Erro ao disparar webhook:', e.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[BQ Toggle Agenda Config] Erro:', err);
    res.status(500).json({ error: 'Erro ao alternar status da agenda' });
  }
});

module.exports = router;
