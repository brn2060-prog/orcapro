// Lembretes automáticos de consulta (ex.: 24h antes), pedindo confirmação.
import { logMessage } from "./db.js";
import { localToEpoch, formatDateBR, nowLocal, addDays } from "./agenda.js";

export function reminderText(config, a) {
  const primeiroNome = a.name.split(" ")[0];
  return (
    `Olá, ${primeiroNome}! 😊 Passando para lembrar da sua consulta no ${config.nome}:\n\n` +
    `🦷 *${a.procedure}*\n📅 ${formatDateBR(a.date)} às *${a.time}*\n📍 ${config.endereco}\n\n` +
    `Responda *SIM* para confirmar ou me diga se precisa remarcar.`
  );
}

export function startReminders({ db, config, provider, clock = () => Date.now(), intervalMs = 5 * 60_000 }) {
  const cfg = config.lembretes || {};
  if (!cfg.ativo) return { stop() {}, runOnce: async () => 0 };

  async function runOnce() {
    const now = clock();
    const horizon = now + (cfg.horasAntes ?? 24) * 3600_000;
    const today = nowLocal(config, now).date;
    const candidates = db
      .prepare(`SELECT * FROM appointments WHERE status = 'agendado' AND reminder_sent_at IS NULL AND date BETWEEN ? AND ?`)
      .all(today, addDays(today, 3));
    let sent = 0;
    for (const a of candidates) {
      const at = localToEpoch(config, a.date, a.time);
      // Envia dentro da janela [horasAntes, 2h antes]; consultas marcadas em cima da hora não recebem lembrete.
      if (at > horizon || at - now < 2 * 3600_000) continue;
      const text = reminderText(config, a);
      try {
        if (provider.name === "meta" && provider.sendTemplate && cfg.templateMeta) {
          // Template aprovado na Meta com 4 variáveis: nome, procedimento, data, horário.
          await provider.sendTemplate(a.phone, cfg.templateMeta, cfg.idiomaTemplate || "pt_BR", [
            a.name.split(" ")[0], a.procedure, formatDateBR(a.date), a.time,
          ]);
        } else {
          await provider.sendText(a.phone, text);
        }
        db.prepare("UPDATE appointments SET reminder_sent_at = ? WHERE id = ?").run(now, a.id);
        logMessage(db, a.phone, "out", text);
        sent++;
      } catch (e) {
        console.error(`[lembrete #${a.id}]`, e.message);
      }
    }
    return sent;
  }

  const timer = setInterval(() => runOnce().catch((e) => console.error("[lembretes]", e)), intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), runOnce };
}
