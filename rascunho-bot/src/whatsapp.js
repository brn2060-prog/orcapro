// Conexão com o WhatsApp. Dois provedores suportados:
//  - "meta":      WhatsApp Cloud API oficial (Meta). Recomendado.
//  - "evolution": Evolution API (conecta via QR Code, não oficial).
// Os dois recebem mensagens por webhook e enviam via HTTP, então o resto do sistema é igual.
import crypto from "node:crypto";

const digits = (s) => String(s || "").replace(/\D/g, "");

const MEDIA_LABEL = {
  audio: "[O paciente enviou um áudio]",
  voice: "[O paciente enviou um áudio]",
  image: "[O paciente enviou uma imagem]",
  video: "[O paciente enviou um vídeo]",
  document: "[O paciente enviou um documento]",
  sticker: "[O paciente enviou uma figurinha]",
  location: "[O paciente enviou uma localização]",
  contacts: "[O paciente enviou um contato]",
};

// ---------------------------------------------------------------- Meta Cloud API
export function metaProvider(env = process.env) {
  const version = env.META_GRAPH_VERSION || "v21.0";
  const base = `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}`;

  async function post(body) {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    name: "meta",

    /** GET de verificação do webhook. Retorna o challenge ou null. */
    verify(query) {
      if (query.get("hub.mode") === "subscribe" && query.get("hub.verify_token") === env.META_VERIFY_TOKEN) {
        return query.get("hub.challenge");
      }
      return null;
    },

    checkSignature(rawBody, headers) {
      if (!env.META_APP_SECRET) return true;
      const sig = headers["x-hub-signature-256"] || "";
      const expected = "sha256=" + crypto.createHmac("sha256", env.META_APP_SECRET).update(rawBody).digest("hex");
      return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    },

    /** Converte o corpo do webhook em eventos { kind: 'patient'|'staff', phone, text, id, profileName }. */
    parse(body) {
      const events = [];
      for (const entry of body?.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
          for (const m of v.messages || []) {
            const text = m.type === "text" ? m.text?.body
              : m.type === "button" ? m.button?.text
              : m.type === "interactive" ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)
              : MEDIA_LABEL[m.type] || `[Mensagem do tipo ${m.type}]`;
            events.push({ kind: "patient", phone: digits(m.from), text, id: m.id, profileName: names[m.from] });
          }
          // Mensagens enviadas pelo app WhatsApp Business no celular (modo coexistência).
          for (const m of v.message_echoes || []) {
            events.push({ kind: "staff", phone: digits(m.to), text: m.text?.body || "[mídia]", id: m.id });
          }
        }
      }
      return events;
    },

    sendText: (to, text) => post({ to, type: "text", text: { body: text, preview_url: false } }),

    markRead: (id) => post({ status: "read", message_id: id }).catch(() => {}),

    /** Fora da janela de 24h a Meta só permite mensagens de modelo (template) aprovadas. */
    sendTemplate: (to, name, lang, params) =>
      post({
        to,
        type: "template",
        template: {
          name,
          language: { code: lang },
          components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }],
        },
      }),
  };
}

// ---------------------------------------------------------------- Evolution API
export function evolutionProvider(env = process.env) {
  const base = (env.EVOLUTION_URL || "").replace(/\/$/, "");
  const instance = env.EVOLUTION_INSTANCE;

  function jidToPhone(key) {
    const jid = key.remoteJid || "";
    if (jid.endsWith("@lid")) return digits((key.senderPn || key.remoteJidAlt || jid).split("@")[0]);
    return digits(jid.split("@")[0]);
  }

  function extractText(msg = {}) {
    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.buttonsResponseMessage?.selectedDisplayText) return msg.buttonsResponseMessage.selectedDisplayText;
    if (msg.listResponseMessage?.title) return msg.listResponseMessage.title;
    if (msg.audioMessage) return MEDIA_LABEL.audio;
    if (msg.imageMessage) return msg.imageMessage.caption ? `${MEDIA_LABEL.image} Legenda: ${msg.imageMessage.caption}` : MEDIA_LABEL.image;
    if (msg.videoMessage) return MEDIA_LABEL.video;
    if (msg.documentMessage) return MEDIA_LABEL.document;
    if (msg.stickerMessage) return MEDIA_LABEL.sticker;
    if (msg.locationMessage) return MEDIA_LABEL.location;
    return null;
  }

  return {
    name: "evolution",
    verify: () => null,
    // A Evolution não assina os webhooks: protegemos com ?token= na URL configurada.
    checkSignature: (_raw, _headers, query) => !env.WEBHOOK_TOKEN || query.get("token") === env.WEBHOOK_TOKEN,

    parse(body) {
      const ev = String(body?.event || "").toLowerCase().replace("_", ".");
      if (ev !== "messages.upsert") return [];
      const items = Array.isArray(body.data) ? body.data : [body.data];
      const events = [];
      for (const d of items) {
        if (!d?.key) continue;
        const jid = d.key.remoteJid || "";
        if (jid.endsWith("@g.us") || jid === "status@broadcast") continue; // ignora grupos e status
        const text = extractText(d.message);
        if (!text) continue;
        events.push({
          kind: d.key.fromMe ? "staff" : "patient",
          phone: jidToPhone(d.key),
          text,
          id: d.key.id,
          profileName: d.pushName,
        });
      }
      return events;
    },

    async sendText(to, text) {
      const res = await fetch(`${base}/message/sendText/${instance}`, {
        method: "POST",
        headers: { apikey: env.EVOLUTION_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ number: to, text }),
      });
      if (!res.ok) throw new Error(`Evolution API ${res.status}: ${await res.text()}`);
      return res.json();
    },

    markRead: async () => {},
    sendTemplate: null,
  };
}

// ---------------------------------------------------------------- Sem WhatsApp (modo demonstração)
export function nullProvider() {
  return {
    name: "demo",
    verify: () => null,
    checkSignature: () => false,
    parse: () => [],
    sendText: async (to, text) => console.log(`[demo → ${to}] ${text}`),
    markRead: async () => {},
    sendTemplate: null,
  };
}

export function createProvider(env = process.env) {
  switch ((env.WHATSAPP_PROVIDER || "").toLowerCase()) {
    case "meta":
      return metaProvider(env);
    case "evolution":
      return evolutionProvider(env);
    default:
      return nullProvider();
  }
}
