# Rascunho do robô de WhatsApp (INCOMPLETO)

Código começado antes da decisão de **só apresentar a proposta** (veja `../PROJETO-DR-PABLO.md`).
Ficou guardado como ponto de partida para quando o Dr. Pablo fechar. **Ainda não roda.**

## O que já existe
| Arquivo | Conteúdo |
|---|---|
| `config/clinica.json` | Dados do consultório: horários, procedimentos e durações, feriados, lembretes (valores de exemplo) |
| `src/db.js` | Banco SQLite (`node:sqlite`): pacientes, agendamentos, bloqueios, conversas, log de mensagens |
| `src/agenda.js` | Horários livres, agendar, remarcar, cancelar, confirmar (com checagem de conflito) |
| `src/agent.js` | Secretária virtual com a Claude API: prompt do sistema, 7 ferramentas, histórico por paciente |
| `src/whatsapp.js` | Conexão com WhatsApp Cloud API (Meta) e Evolution API: receber webhook e enviar mensagens |
| `src/reminders.js` | Lembretes automáticos 24h antes da consulta |

## O que falta
- `src/server.js`: servidor HTTP (webhooks, painel, API), agrupamento de mensagens seguidas, avisos para a equipe
- Ignorar o "eco" das mensagens que o próprio robô envia na Evolution API (senão o robô se pausa sozinho)
- Painel web da equipe e simulador
- Assistente pessoal do Dr. Pablo (ferramentas próprias, acesso só para o número dele)
- Testes e Dockerfile/deploy
- Nenhuma chamada real à Claude API ou ao WhatsApp foi testada

Dependência: `npm install @anthropic-ai/sdk` (Node 22.5+).
