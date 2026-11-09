// Atendente virtual: conversa com o paciente via Claude e usa ferramentas de agenda.
import Anthropic from "@anthropic-ai/sdk";
import { logMessage, upsertPatient, getPatient, pauseBot } from "./db.js";
import { nowLocal, formatDateBR, localToEpoch } from "./agenda.js";

const SESSION_IDLE_MS = 12 * 3600_000; // após 12h sem conversa, começa um novo histórico
const MAX_HISTORY = 60;                // mensagens por sessão antes de reiniciar
const MAX_TOOL_ROUNDS = 8;
// Modelos que aceitam o fallback automático do servidor em caso de recusa.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1"]);

export function buildSystemPrompt(config) {
  const horarios = Object.entries(config.horarioAtendimento)
    .map(([d, p]) => `${d}: ${p.length ? p.map(([a, b]) => `${a}–${b}`).join(", ") : "fechado"}`)
    .join("; ");
  const procs = config.procedimentos
    .map((p) => `- ${p.nome} (${p.duracaoMin} min): ${p.descricao}${p.preco ? ` Valor: ${p.preco}.` : ""}`)
    .join("\n");

  return `Você é a atendente virtual do ${config.nome} (${config.dentista} – "${config.slogan}"), respondendo pacientes pelo WhatsApp.

Seu trabalho: tirar dúvidas sobre o consultório e cuidar da agenda (marcar, confirmar, remarcar e cancelar consultas) usando as ferramentas disponíveis. Você não é dentista: não faça diagnósticos, não indique remédios e não prometa resultados de tratamento. Para dúvidas clínicas, sugira uma avaliação ou encaminhe para a equipe.

Como escrever:
- Português do Brasil, tom acolhedor e profissional, frases curtas, como uma boa secretária escreveria no WhatsApp.
- Mensagens curtas (normalmente até 4–5 linhas). Use *negrito* do WhatsApp com moderação; nada de títulos ou tabelas em Markdown.
- Use o nome do paciente quando souber. Emojis só ocasionalmente (😊 🦷).
- Na primeira mensagem de uma conversa, apresente-se brevemente como a assistente virtual do consultório.

Agendamento:
- Toda mensagem do paciente chega com a data e hora atuais entre colchetes. Use isso para entender "amanhã", "sexta que vem" etc. Nas ferramentas, datas são AAAA-MM-DD e horários HH:MM.
- Nunca invente horários: consulte sempre consultar_horarios antes de oferecer opções, e ofereça poucas opções (2 a 4), de preferência no período que o paciente pediu.
- Para marcar você precisa do nome completo do paciente, do procedimento (se não souber, use "Avaliação") e do horário escolhido. Antes de chamar agendar_consulta, confirme dia, horário e procedimento com o paciente em uma frase; quando ele concordar, agende.
- Depois de agendar, envie um resumo: procedimento, dia da semana, data, horário e endereço.
- Para remarcar ou cancelar, use listar_meus_agendamentos para achar o agendamento. Ao cancelar, ofereça remarcar.
- Se o paciente responder a um lembrete confirmando (ex.: "sim", "confirmo"), use confirmar_presenca.
- Se uma ferramenta retornar erro, explique de forma simples e ofereça outra opção.

Encaminhe para a equipe humana (encaminhar_para_atendente) quando: o paciente pedir para falar com uma pessoa ou com o Dr. Pablo; houver reclamação; for urgência com dor forte ou inchaço que precise de encaixe sem horário livre; perguntarem valores que não estão abaixo; ou você não souber responder. Depois de encaminhar, avise que a equipe vai responder por aqui em breve.

Se o paciente mandar áudio, imagem ou documento, você receberá apenas um aviso disso. Peça gentilmente que escreva a mensagem em texto.

Dados do consultório:
- Endereço: ${config.endereco}${config.linkMapa ? ` (mapa: ${config.linkMapa})` : ""}
- Horário de atendimento: ${horarios}
- Feriados sem atendimento: ${(config.feriados || []).join(", ") || "nenhum cadastrado"}
- Pagamento: ${config.formasPagamento}
- Convênios: ${config.convenios}
- Site: ${config.site} · Instagram: ${config.instagram}

Procedimentos que podem ser agendados:
${procs}

Orientações do consultório:
${(config.orientacoesExtras || []).map((o) => `- ${o}`).join("\n")}`;
}

const TOOLS = [
  {
    name: "consultar_horarios",
    description: "Lista os horários livres na agenda a partir de uma data, para um procedimento. Use antes de oferecer qualquer horário.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        data_inicial: { type: "string", description: "AAAA-MM-DD. Primeiro dia a consultar." },
        quantidade_dias: { type: "integer", description: "Quantos dias consultar a partir da data inicial (1 a 14)." },
        procedimento: { type: "string", description: "Nome do procedimento (ex.: Avaliação, Limpeza (profilaxia))." },
      },
      required: ["data_inicial", "quantidade_dias", "procedimento"],
      additionalProperties: false,
    },
  },
  {
    name: "agendar_consulta",
    description: "Marca uma consulta para o paciente desta conversa. Só use depois que o paciente confirmar dia, horário e procedimento.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        nome_paciente: { type: "string", description: "Nome completo do paciente." },
        procedimento: { type: "string" },
        data: { type: "string", description: "AAAA-MM-DD" },
        horario: { type: "string", description: "HH:MM, exatamente como retornado por consultar_horarios." },
        observacoes: { type: "string", description: "Queixa ou observação relevante informada pelo paciente (pode ser vazio)." },
      },
      required: ["nome_paciente", "procedimento", "data", "horario", "observacoes"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_meus_agendamentos",
    description: "Lista as próximas consultas ativas do paciente desta conversa, com seus IDs.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "remarcar_agendamento",
    description: "Muda a data/horário de uma consulta do paciente. Consulte horários livres antes.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        nova_data: { type: "string", description: "AAAA-MM-DD" },
        novo_horario: { type: "string", description: "HH:MM" },
      },
      required: ["id", "nova_data", "novo_horario"],
      additionalProperties: false,
    },
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela uma consulta do paciente. Confirme com o paciente antes.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "confirmar_presenca",
    description: "Registra que o paciente confirmou que vai comparecer à consulta.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "encaminhar_para_atendente",
    description: "Avisa a equipe humana do consultório para assumir esta conversa e pausa o robô para este paciente.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Motivo curto (ex.: urgência, valores, reclamação, pediu humano)." },
        resumo: { type: "string", description: "Resumo do que o paciente precisa, para a equipe." },
      },
      required: ["motivo", "resumo"],
      additionalProperties: false,
    },
  },
];

const fmtAppt = (a) => ({
  id: a.id,
  procedimento: a.procedimento ?? a.procedure,
  data: a.date,
  dia: formatDateBR(a.date),
  horario: a.time,
  duracaoMin: a.duration,
  status: a.status,
  paciente: a.name,
});

export function createAgent({ db, config, agenda, client, model, effort, notifyStaff = async () => {}, handoffPauseHours = 4, clock = () => Date.now() }) {
  client ??= new Anthropic();
  model ??= process.env.CLAUDE_MODEL || "claude-opus-5-5";
  effort ??= process.env.CLAUDE_EFFORT || "low";
  const system = [{ type: "text", text: buildSystemPrompt(config), cache_control: { type: "ephemeral" } }];
  const locks = new Map();

  async function runTool(name, input, phone) {
    switch (name) {
      case "consultar_horarios":
        return agenda.availability(input.data_inicial, input.quantidade_dias, input.procedimento);
      case "agendar_consulta": {
        const r = agenda.book({
          phone,
          name: input.nome_paciente,
          procedure: input.procedimento,
          date: input.data,
          time: input.horario,
          notes: input.observacoes || null,
        });
        if (!r.ok) return r;
        upsertPatient(db, phone, input.nome_paciente);
        const a = r.agendamento;
        logMessage(db, phone, "sistema", `Consulta #${a.id} agendada: ${a.procedure} em ${formatDateBR(a.date)} às ${a.time}`);
        await notifyStaff(`🦷 *Novo agendamento* #${a.id}\n${a.name} (${phone})\n${a.procedure}\n${formatDateBR(a.date)} às ${a.time}${a.notes ? `\nObs.: ${a.notes}` : ""}`);
        return { ok: true, agendamento: fmtAppt(a), endereco: config.endereco };
      }
      case "listar_meus_agendamentos": {
        const list = agenda.upcomingForPhone(phone).map(fmtAppt);
        return { agendamentos: list, total: list.length };
      }
      case "remarcar_agendamento": {
        const r = agenda.reschedule(input.id, phone, input.nova_data, input.novo_horario);
        if (!r.ok) return r;
        const a = r.agendamento;
        logMessage(db, phone, "sistema", `Consulta #${a.id} remarcada de ${r.anterior.data} ${r.anterior.horario} para ${a.date} ${a.time}`);
        await notifyStaff(`🔁 *Consulta remarcada* #${a.id}\n${a.name} (${phone})\nDe ${formatDateBR(r.anterior.data)} ${r.anterior.horario}\nPara ${formatDateBR(a.date)} às ${a.time}`);
        return { ok: true, agendamento: fmtAppt(a) };
      }
      case "cancelar_agendamento": {
        const r = agenda.setStatus(input.id, "cancelado", phone);
        if (!r.ok) return r;
        const a = r.agendamento;
        logMessage(db, phone, "sistema", `Consulta #${a.id} cancelada pelo paciente`);
        await notifyStaff(`❌ *Consulta cancelada* #${a.id}\n${a.name} (${phone})\n${formatDateBR(a.date)} às ${a.time}`);
        return { ok: true, agendamento: fmtAppt(a) };
      }
      case "confirmar_presenca": {
        const r = agenda.setStatus(input.id, "confirmado", phone);
        if (!r.ok) return r;
        logMessage(db, phone, "sistema", `Consulta #${input.id} confirmada pelo paciente`);
        return { ok: true, agendamento: fmtAppt(r.agendamento) };
      }
      case "encaminhar_para_atendente": {
        pauseBot(db, phone, handoffPauseHours);
        logMessage(db, phone, "sistema", `Encaminhado para a equipe: ${input.motivo} — ${input.resumo}`);
        const nome = getPatient(db, phone)?.name || "";
        await notifyStaff(`🙋 *Paciente precisa de atendimento*\n${nome} (${phone})\nMotivo: ${input.motivo}\n${input.resumo}\n\nO robô ficará pausado ${handoffPauseHours}h para este contato.`);
        return { ok: true, robo_pausado_horas: handoffPauseHours };
      }
      default:
        return { ok: false, erro: `Ferramenta desconhecida: ${name}` };
    }
  }

  function loadHistory(phone) {
    const row = db.prepare("SELECT messages_json, last_activity FROM conversations WHERE phone = ?").get(phone);
    if (!row) return [];
    const msgs = JSON.parse(row.messages_json);
    if (clock() - row.last_activity > SESSION_IDLE_MS || msgs.length > MAX_HISTORY) return [];
    return msgs;
  }

  function saveHistory(phone, messages) {
    db.prepare(`
      INSERT INTO conversations (phone, messages_json, last_activity) VALUES (?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET messages_json = excluded.messages_json, last_activity = excluded.last_activity
    `).run(phone, JSON.stringify(messages), clock());
  }

  function buildUserText(phone, text, isNewSession, profileName) {
    const now = nowLocal(config, clock());
    const lines = [`[${formatDateBR(now.date)}, ${now.time}]`];
    if (isNewSession) {
      const p = getPatient(db, phone);
      if (p?.name) lines.push(`[Paciente já cadastrado: ${p.name}]`);
      else if (profileName) lines.push(`[Nome no perfil do WhatsApp: ${profileName}]`);
      // Se mandamos lembrete recentemente, a resposta provavelmente é sobre ele.
      const remind = db
        .prepare(`SELECT * FROM appointments WHERE phone = ? AND status = 'agendado' AND reminder_sent_at > ? ORDER BY date, time LIMIT 1`)
        .get(phone, clock() - 48 * 3600_000);
      if (remind) {
        lines.push(`[Enviamos a este paciente um lembrete da consulta #${remind.id} (${remind.procedure}, ${formatDateBR(remind.date)} às ${remind.time}) pedindo confirmação.]`);
      }
    }
    lines.push(text);
    return lines.join("\n");
  }

  async function callClaude(messages) {
    const params = {
      model,
      max_tokens: 16000,
      system,
      tools: TOOLS,
      messages,
      output_config: { effort },
    };
    if (FALLBACK_MODELS.has(model)) {
      return client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    }
    return client.beta.messages.create(params);
  }

  async function converse(phone, text, { profileName } = {}) {
    let messages = loadHistory(phone);
    const isNewSession = messages.length === 0;
    messages.push({ role: "user", content: buildUserText(phone, text, isNewSession, profileName) });

    let reply = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await callClaude(messages);

      if (response.stop_reason === "refusal") {
        reply = "Desculpe, não consigo ajudar com isso por aqui. Vou pedir para alguém da equipe falar com você. 😊";
        await runTool("encaminhar_para_atendente", { motivo: "mensagem fora do escopo", resumo: text.slice(0, 300) }, phone);
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      const toolUses = response.content.filter((b) => b.type === "tool_use");

      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        break;
      }

      const results = [];
      for (const tu of toolUses) {
        let out;
        try {
          out = await runTool(tu.name, tu.input, phone);
        } catch (e) {
          console.error(`[ferramenta ${tu.name}]`, e);
          out = { ok: false, erro: "Falha interna ao executar a ação." };
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out),
          ...(out && out.ok === false ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
    }

    // Se o histórico terminou num pedido de ferramenta sem resposta, começa do zero na próxima vez.
    const last = messages[messages.length - 1];
    const dangling = last.role === "assistant" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_use");
    saveHistory(phone, dangling ? [] : messages);

    return reply || "Desculpe, não entendi. Pode repetir, por favor?";
  }

  /** Processa uma mensagem do paciente e devolve o texto da resposta. Serializa por telefone. */
  async function handleMessage(phone, text, opts = {}) {
    const prev = locks.get(phone) || Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      logMessage(db, phone, "in", text);
      const reply = await converse(phone, text, opts);
      logMessage(db, phone, "out", reply);
      return reply;
    });
    locks.set(phone, run);
    try {
      return await run;
    } finally {
      if (locks.get(phone) === run) locks.delete(phone);
    }
  }

  return { handleMessage, runTool, TOOLS };
}

export { TOOLS, localToEpoch };
