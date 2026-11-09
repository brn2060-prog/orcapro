# Projeto: Consultório Inteligente — Dr. Pablo Rodrigo

> Documento de contexto para continuar o projeto em outra ferramenta (ex.: Antigravity).
> Status: **fase de apresentação/proposta**. Nada do sistema deve ser construído antes de o Dr. Pablo fechar o contrato.

---

## 1. Resumo da conversa até aqui

1. **Cliente:** Dr. Pablo Rodrigo, dentista. WhatsApp Business: "Pablo Dentista". Slogan: *"A odontologia que você confia"*. Identidade visual preta e dourada (logo com dente dourado).
   - Site atual: https://drpablorodrigo-site.vercel.app/
   - Dados do perfil do WhatsApp: "Dentista e consultório odontológico", "Odontologia especializada", horário visto no print: segunda-feira 07:00–20:00 (os outros dias precisam ser confirmados).
2. **Primeira entrega já feita:** uma landing page nova (HTML/CSS/JS estático, pronta para Vercel), neste repositório (`index.html`, `styles.css`, `script.js`, `assets/logo.png`). Contém hero, sobre, tratamentos, como funciona, formulário que abre o WhatsApp, FAQ e contato. Telefone, endereço, CRO, Instagram e foto ainda são dados de exemplo.
3. **Mudança de rumo:** o objetivo não é só o site, e sim **"iazar" o consultório**: um sistema completo de IA dentro do WhatsApp, começando pelo agendamento.
4. **Modelo de negócio pretendido:**
   - Implantação vendida **sem recorrência** (sem mensalidade para quem implanta).
   - O próprio Dr. Pablo **contrata o Claude** (conta/API da Anthropic no nome dele) e paga o uso diretamente.
5. **Decisão atual:** **não construir 100% agora.** Primeiro montar a **apresentação** com tudo o que é possível implantar. Construir só depois que ele fechar — é complexo demais para começar antes.
6. **Referência:** o responsável pelo projeto já tem um robô próprio com que conversa pelo WhatsApp (um assistente pessoal). A ideia é oferecer algo parecido para o Dr. Pablo. *(Os detalhes desse robô não foram passados nesta conversa — ver seção 9.)*

---

## 2. A proposta em uma frase

**Dois assistentes de IA no WhatsApp:** uma *secretária virtual* que atende os pacientes 24h e cuida da agenda, e um *assistente pessoal* com quem o próprio Dr. Pablo conversa para gerenciar o consultório e o dia a dia.

---

## 3. Tudo o que dá para implantar no consultório

Organizado por módulo. A coluna **Fase** sugere a ordem: 1 = começar por aqui, 2 = logo depois, 3 = evolução.

### A. Secretária virtual (para os pacientes)

| Funcionalidade | O que faz | Fase |
|---|---|---|
| Atendimento 24h | Responde dúvidas (endereço, horários, procedimentos, pagamento, convênio) a qualquer hora | 1 |
| Agendamento automático | Consulta horários livres de verdade e marca a consulta na conversa | 1 |
| Remarcar e cancelar | O paciente resolve sozinho; ao cancelar, o robô oferece outro horário | 1 |
| Lembrete de consulta | Mensagem 24h antes pedindo confirmação ("responda SIM") | 1 |
| Confirmação de presença | Registra quem confirmou e avisa a equipe sobre quem não respondeu | 1 |
| Passagem para humano | Reclamação, urgência, preço fora da tabela ou "quero falar com alguém" → avisa a equipe e pausa o robô naquela conversa | 1 |
| Triagem de urgência | Identifica dor forte e inchaço e orienta pronto-socorro em casos graves (sem diagnosticar) | 1 |
| Entende áudio | Transcreve áudios dos pacientes (muito usado no Brasil) | 2 |
| Lista de espera / encaixe | Quando alguém cancela, oferece a vaga para quem está esperando | 2 |
| Pré-cadastro / anamnese | Coleta dados e histórico antes da primeira consulta | 2 |
| Pós-consulta | Orientações pós-procedimento (ex.: após extração) e mensagem de "como você está?" | 2 |
| Pesquisa de satisfação + Google | Pede uma avaliação e direciona os satisfeitos para o Google Meu Negócio | 2 |
| Retorno / recall | Avisa quem está há 6 meses sem limpeza ou com tratamento parado | 3 |
| Reativação de pacientes | Campanhas para pacientes antigos (respeitando as regras do WhatsApp e a LGPD) | 3 |
| Orçamento acompanhado | Faz o follow-up de orçamentos não fechados | 3 |
| Aniversários | Mensagem de parabéns personalizada | 3 |
| Fotos e documentos | Recebe foto do sorriso ou exame e anexa à ficha para o dentista ver | 3 |

### B. Assistente pessoal do Dr. Pablo (ele conversa com o robô no WhatsApp)

| Funcionalidade | Exemplo de uso | Fase |
|---|---|---|
| Agenda por conversa | "Como está minha agenda amanhã?" / "Quem é o próximo paciente?" | 1 |
| Bloquear horários | "Bloqueia sexta à tarde" / "Vou atrasar 30 min, avisa os pacientes da manhã" | 1 |
| Resumo diário | Todo dia às 7h: consultas do dia, quem confirmou, quem faltou ontem e pendências | 1 |
| Avisos em tempo real | Novo agendamento, cancelamento, paciente pedindo atendimento humano | 1 |
| Falar com paciente | "Manda mensagem pro João dizendo que o exame chegou" | 2 |
| Anotações por áudio | Ele grava um áudio após a consulta e o robô transcreve e salva na ficha do paciente | 2 |
| Lembretes pessoais | "Me lembra de ligar para o laboratório às 15h" | 2 |
| Financeiro simples | "Quanto faturei este mês?" / registro de recebimentos / orçamentos em aberto | 3 |
| Relatórios | Taxa de faltas, procedimentos mais feitos, horários mais procurados | 3 |
| Conteúdo para redes | Sugestões de posts para o Instagram com base nos tratamentos | 3 |
| Estoque e fornecedores | "Anota que acabou a resina A2" → lista de compras | 3 |

### C. Painel web (para a secretária/equipe)

| Funcionalidade | Fase |
|---|---|
| Agenda visual (dia/semana) com status: agendado, confirmado, faltou, concluído | 1 |
| Ver as conversas do robô e assumir uma conversa manualmente | 1 |
| Pausar e retomar o robô por paciente | 1 |
| Bloqueios de agenda, feriados, procedimentos e durações | 1 |
| **Simulador do robô** (testar e demonstrar sem WhatsApp) — ótimo para a apresentação | 1 |
| Cadastro e histórico do paciente | 2 |

### D. Site
- Landing page já criada (seção 1). Integrar o botão "Agendar" ao robô. **Fase 1.**

---

## 4. Proposta técnica (para quem for construir)

> Isto é um rascunho de arquitetura. Ainda não é uma decisão final.

**Visão geral**

```
Paciente / Dr. Pablo ──WhatsApp──► Provedor WhatsApp ──webhook──► Servidor (Node.js)
                                                                   │
                                     ┌─────────────────────────────┼──────────────────────┐
                                     ▼                             ▼                      ▼
                              Claude API (IA)              Banco de dados          Painel web
                         (conversa + ferramentas)    (agenda, pacientes, chats)   (equipe/admin)
```

**Componentes**
- **IA:** Claude API da Anthropic, usando *tool use* (o modelo chama funções do sistema). Modelo padrão: `claude-opus-5-5` com `effort: "low"` para conversas (rápido e econômico). Também dá para testar `claude-haiku-5-5`, mais barato, se a qualidade se mantiver. Use cache de prompt no texto fixo (dados do consultório).
- **WhatsApp — duas opções:**
  1. **WhatsApp Cloud API (Meta, oficial)** — recomendada. Estável e sem risco de bloqueio. Exige um app na Meta e um template aprovado para lembretes (mensagens fora da janela de 24h). Hoje existe o modo "coexistência", em que o número pode continuar no app WhatsApp Business do celular.
  2. **Evolution API (não oficial, conecta por QR Code)** — mais simples de começar, mas tem risco de bloqueio do número.
- **Servidor:** Node.js 22, com um processo sempre ligado (Railway, Render, Fly.io ou uma VPS). A Vercel serve só para o site.
- **Banco:** SQLite para começar (um consultório só) ou Postgres se for virar produto para vários consultórios.
- **Painel:** página web protegida por senha, servida pelo mesmo servidor.

**Ferramentas que a IA da secretária usaria (já esboçadas)**
- `consultar_horarios(data_inicial, quantidade_dias, procedimento)`
- `agendar_consulta(nome_paciente, procedimento, data, horario, observacoes)`
- `listar_meus_agendamentos()` — só do próprio paciente (o telefone vem do sistema, nunca da IA)
- `remarcar_agendamento(id, nova_data, novo_horario)`
- `cancelar_agendamento(id)`
- `confirmar_presenca(id)`
- `encaminhar_para_atendente(motivo, resumo)` — avisa a equipe e pausa o robô

**Ferramentas do assistente pessoal (a desenhar)**
- `agenda_do_dia(data)`, `bloquear_horario(...)`, `enviar_mensagem_paciente(...)`, `salvar_anotacao(paciente, texto)`, `criar_lembrete(...)`, `resumo_financeiro(periodo)`
- Só responde ao número do Dr. Pablo (lista de números autorizados).

**Cuidados importantes**
- **LGPD:** dados de saúde são dados sensíveis. É preciso aviso de privacidade, consentimento, guardar só o necessário e definir quem acessa.
- O robô **não diagnostica nem prescreve**. Casos clínicos vão para o dentista.
- Configuração do consultório (horários, procedimentos, duração, endereço, preços se houver) em um arquivo/painel editável, sem mexer no código.
- Webhooks: deduplicar mensagens repetidas e processar uma mensagem por vez para cada paciente.
- Agrupar mensagens picadas (o paciente manda 3 mensagens seguidas) antes de responder.

> Existe um **rascunho de código incompleto** desse robô na pasta `rascunho-bot/` (agenda, banco SQLite, integração com o Claude, conexão Meta/Evolution e lembretes). Ainda não roda; o `rascunho-bot/README.md` lista o que falta. Só deve ser retomado depois que o Dr. Pablo fechar.

---

## 5. Custos (quem paga o quê)

Modelo pretendido: **implantação paga uma vez**, sem mensalidade para quem implanta. Os custos de uso ficam com o consultório:

| Item | Quem paga | Observação |
|---|---|---|
| Claude API (Anthropic) | Dr. Pablo (conta própria) | Cobrança por uso. Referência atual por milhão de tokens: Opus 5.5 US$ 4 entrada / US$ 20 saída; Haiku 5.5 US$ 0,10 / US$ 0,50. Uma conversa de agendamento é curta. **Estimar com o volume real de mensagens antes de apresentar valores.** |
| Hospedagem do servidor | Dr. Pablo | Plano pequeno de Railway/Render/VPS — conferir o preço atual |
| WhatsApp Cloud API (Meta) | Dr. Pablo | Respostas ao paciente dentro de 24h costumam ser gratuitas; templates (lembretes) são cobrados por mensagem — conferir a tabela atual da Meta para o Brasil |
| Domínio/site | Dr. Pablo | Opcional (a Vercel tem plano gratuito) |

> Ponto a decidir: quem dá suporte e manutenção depois da implantação (ajustes, mudanças de horário, problemas). Sem recorrência, vale prever um **pacote de horas avulso** ou um **suporte opcional**.

---

## 6. Roteiro da apresentação para o Dr. Pablo

1. **O problema:** pacientes mandam mensagem fora do horário e ficam sem resposta, há faltas, a secretária fica sobrecarregada e o próprio dentista responde WhatsApp entre um atendimento e outro.
2. **A solução:** uma secretária virtual 24h + um assistente pessoal no WhatsApp dele.
3. **Demonstração ao vivo:** simular um paciente marcando, remarcando e confirmando uma consulta. Depois, o Dr. Pablo perguntando "como está minha agenda amanhã?".
4. **O que ele ganha:** menos faltas (lembretes + confirmação), nenhum paciente sem resposta, agenda organizada e tempo livre.
5. **Fases:** Fase 1 (agendamento + lembretes + assistente básico) → Fase 2 → Fase 3 (seção 3).
6. **Como funciona o custo:** implantação única + ele contrata o Claude e a hospedagem no nome dele (transparência total, os dados são dele).
7. **Segurança e LGPD.**
8. **Próximos passos:** fechar → levantar dados → implantar a Fase 1 em X semanas → acompanhar.

---

## 7. Informações a coletar com o Dr. Pablo (após fechar)

- [ ] Horário real de cada dia da semana e o intervalo de almoço
- [ ] Lista de procedimentos, duração de cada um e se divulga preço
- [ ] Endereço, link do Google Maps, Instagram, número do CRO, foto profissional
- [ ] Formas de pagamento e convênios
- [ ] Número que o robô vai usar (o atual do WhatsApp Business?) e quem recebe os avisos
- [ ] Tem secretária? Quem assume quando o robô passa para um humano?
- [ ] Usa algum sistema de agenda hoje (Google Agenda, software odontológico)? Precisa integrar?
- [ ] Volume aproximado de mensagens e consultas por dia (para estimar o custo)
- [ ] Tom de voz desejado e o que o robô **não** pode falar

---

## 8. Próximos passos imediatos

1. Montar a apresentação (slides ou página) a partir das seções 2, 3, 5 e 6.
2. Preparar uma **demonstração simples** (pode ser só o simulador ou um vídeo/gravação).
3. Definir preço da implantação e o que está incluso em cada fase.
4. Apresentar → fechar → só então construir a Fase 1.

---

## 9. A preencher: robô de referência (o assistente pessoal do responsável pelo projeto)

O responsável pelo projeto já usa um robô próprio no WhatsApp e quer algo parecido para o Dr. Pablo. Descreva aqui para orientar o desenvolvimento:

- O que ele faz hoje:
- Ferramenta/stack usada (n8n, código próprio, Evolution, Meta, etc.):
- Quais funções você quer replicar para o Dr. Pablo:
- O que funcionou bem / o que não funcionou:
