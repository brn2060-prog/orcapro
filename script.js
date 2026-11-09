// ===== Configuração do consultório =====
// Edite aqui o número do WhatsApp (formato internacional, só números: 55 + DDD + número)
const CONFIG = {
  whatsapp: "5500000000000",
};

const waLink = (msg) =>
  CONFIG.whatsapp && !/^550+$/.test(CONFIG.whatsapp)
    ? `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`
    : null;

// Botões/links de WhatsApp
document.querySelectorAll(".js-whatsapp").forEach((el) => {
  const url = waLink(el.dataset.msg || "Olá, Dr. Pablo!");
  if (url) {
    el.href = url;
    el.target = "_blank";
    el.rel = "noopener";
  }
});

// Formulário de agendamento -> WhatsApp
const form = document.getElementById("form-agendar");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const nome = (data.get("nome") || "").toString().trim();
  const erro = form.querySelector(".form-error");
  if (!nome) {
    erro.hidden = false;
    form.nome.focus();
    return;
  }
  erro.hidden = true;
  const msg =
    `Olá, Dr. Pablo! Meu nome é ${nome}.\n` +
    `Gostaria de agendar: ${data.get("tratamento")}.\n` +
    `Melhor período: ${data.get("periodo")}.`;
  const url = waLink(msg);
  if (url) window.open(url, "_blank", "noopener");
  else alert("Configure o número do WhatsApp em script.js (CONFIG.whatsapp).");
});

// Menu mobile
const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("menu");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", String(open));
});
nav.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  })
);

// Header com sombra ao rolar
const header = document.querySelector(".header");
const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Animação de entrada
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("is-visible");
          io.unobserve(en.target);
        }
      }),
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
}

document.getElementById("ano").textContent = new Date().getFullYear();
