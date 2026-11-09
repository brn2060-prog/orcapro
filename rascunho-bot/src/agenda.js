// Regras de agenda: horários livres, agendar, cancelar, remarcar.
// Datas e horas são sempre no horário local do consultório (fuso em config.fusoHorario).

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const DIAS_EXTENSO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const ACTIVE = "status IN ('agendado', 'confirmado')";

export const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Instante (ms) de uma data/hora local do consultório. */
export function localToEpoch(config, date, time) {
  return Date.parse(`${date}T${time}:00${config.fusoHorario || "-03:00"}`);
}

/** "Agora" no horário do consultório: { date, time, weekday, minutes }. */
export function nowLocal(config, now = Date.now()) {
  const offset = config.fusoHorario || "-03:00";
  const sign = offset.startsWith("-") ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const d = new Date(now + sign * (oh * 60 + om) * 60_000);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return { date, time, weekday: d.getUTCDay(), minutes: toMin(time) };
}

export function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date) {
  return new Date(date + "T12:00:00Z").getUTCDay();
}

export function formatDateBR(date) {
  const [y, m, d] = date.split("-");
  return `${DIAS_EXTENSO[weekdayOf(date)]}, ${d}/${m}/${y}`;
}

export function findProcedure(config, name) {
  if (!name) return null;
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const n = norm(name);
  return (
    config.procedimentos.find((p) => norm(p.nome) === n) ||
    config.procedimentos.find((p) => norm(p.nome).includes(n) || n.includes(norm(p.nome))) ||
    null
  );
}

export function createAgenda(db, config, clock = () => Date.now()) {
  const step = config.intervaloEntreHorariosMin || 30;

  function busyIntervals(date, ignoreId = null) {
    const appts = db
      .prepare(`SELECT id, time, duration FROM appointments WHERE date = ? AND ${ACTIVE}`)
      .all(date)
      .filter((a) => a.id !== ignoreId)
      .map((a) => [toMin(a.time), toMin(a.time) + a.duration]);
    const blocks = db
      .prepare("SELECT start, end FROM blocks WHERE date = ?")
      .all(date)
      .map((b) => [toMin(b.start), toMin(b.end)]);
    return [...appts, ...blocks];
  }

  /** Horários livres (HH:MM) em uma data para um procedimento com a duração dada. */
  function freeSlots(date, duration, ignoreId = null) {
    if (!isDate(date)) return [];
    if ((config.feriados || []).includes(date)) return [];
    const now = nowLocal(config, clock());
    const maxDate = addDays(now.date, config.agendaAbertaDias || 60);
    if (date < now.date || date > maxDate) return [];

    const earliest = clock() + (config.antecedenciaMinimaHoras ?? 2) * 3600_000;
    const periods = config.horarioAtendimento[DIAS[weekdayOf(date)]] || [];
    const busy = busyIntervals(date, ignoreId);
    const slots = [];
    for (const [ini, fim] of periods) {
      for (let t = toMin(ini); t + duration <= toMin(fim); t += step) {
        if (localToEpoch(config, date, toHHMM(t)) < earliest) continue;
        const overlaps = busy.some(([s, e]) => t < e && t + duration > s);
        if (!overlaps) slots.push(toHHMM(t));
      }
    }
    return slots;
  }

  function availability(startDate, days, procedureName) {
    const proc = findProcedure(config, procedureName) || findProcedure(config, "Avaliação") || config.procedimentos[0];
    const today = nowLocal(config, clock()).date;
    let date = isDate(startDate) && startDate >= today ? startDate : today;
    const result = [];
    const n = Math.min(Math.max(days || 7, 1), 21);
    for (let i = 0; i < n; i++, date = addDays(date, 1)) {
      const slots = freeSlots(date, proc.duracaoMin);
      if (slots.length) result.push({ data: date, dia: formatDateBR(date), horarios: slots });
    }
    return { procedimento: proc.nome, duracaoMin: proc.duracaoMin, dias: result };
  }

  function validateSlot(date, time, duration, ignoreId = null) {
    if (!isDate(date)) return "Data inválida. Use o formato AAAA-MM-DD.";
    if (!isTime(time)) return "Horário inválido. Use o formato HH:MM.";
    if (!freeSlots(date, duration, ignoreId).includes(time)) {
      return "Esse horário não está disponível. Consulte os horários livres novamente.";
    }
    return null;
  }

  function book({ phone, name, procedure, date, time, notes = null, source = "whatsapp", force = false }) {
    const proc = findProcedure(config, procedure);
    const duration = proc?.duracaoMin || 30;
    const procName = proc?.nome || procedure || "Avaliação";
    if (!name || !name.trim()) return { ok: false, erro: "Informe o nome do paciente." };
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!force) {
        const err = validateSlot(date, time, duration);
        if (err) {
          db.exec("ROLLBACK");
          return { ok: false, erro: err };
        }
      }
      const ts = Date.now();
      const r = db
        .prepare(`INSERT INTO appointments (phone, name, procedure, date, time, duration, notes, source, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(phone, name.trim(), procName, date, time, duration, notes, source, ts, ts);
      db.exec("COMMIT");
      return { ok: true, agendamento: get(Number(r.lastInsertRowid)) };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function get(id) {
    return db.prepare("SELECT * FROM appointments WHERE id = ?").get(id);
  }

  function upcomingForPhone(phone) {
    const today = nowLocal(config, clock()).date;
    return db
      .prepare(`SELECT * FROM appointments WHERE phone = ? AND ${ACTIVE} AND date >= ? ORDER BY date, time`)
      .all(phone, today);
  }

  function ownActive(id, phone) {
    const a = get(id);
    if (!a || (phone && a.phone !== phone)) return { erro: "Agendamento não encontrado para este paciente." };
    if (!["agendado", "confirmado"].includes(a.status)) return { erro: `Este agendamento está ${a.status}.` };
    return { a };
  }

  function setStatus(id, status, phone = null) {
    // Pelo WhatsApp (phone informado) só altera agendamentos ativos do próprio paciente;
    // pelo painel (phone = null) a equipe pode alterar qualquer um.
    if (phone) {
      const { erro } = ownActive(id, phone);
      if (erro) return { ok: false, erro };
    } else if (!get(id)) {
      return { ok: false, erro: "Agendamento não encontrado." };
    }
    db.prepare("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
    return { ok: true, agendamento: get(id) };
  }

  function reschedule(id, phone, date, time) {
    const { a, erro } = ownActive(id, phone);
    if (erro) return { ok: false, erro };
    db.exec("BEGIN IMMEDIATE");
    try {
      const err = validateSlot(date, time, a.duration, a.id);
      if (err) {
        db.exec("ROLLBACK");
        return { ok: false, erro: err };
      }
      db.prepare(`UPDATE appointments SET date = ?, time = ?, status = 'agendado', reminder_sent_at = NULL, updated_at = ? WHERE id = ?`)
        .run(date, time, Date.now(), id);
      db.exec("COMMIT");
      return { ok: true, anterior: { data: a.date, horario: a.time }, agendamento: get(id) };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function list(from, to) {
    return db.prepare("SELECT * FROM appointments WHERE date BETWEEN ? AND ? ORDER BY date, time").all(from, to);
  }

  return { freeSlots, availability, book, get, upcomingForPhone, setStatus, reschedule, list };
}
