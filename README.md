# Dr. Pablo Rodrigo — site do consultório

Site estático (HTML/CSS/JS, sem build) para o consultório odontológico do Dr. Pablo Rodrigo.
Identidade preto + dourado, baseada no logotipo "A odontologia que você confia".

## Seções
Hero · Sobre · Tratamentos · Como funciona · Agendamento (formulário → WhatsApp) · Dúvidas · Contato/mapa · botão flutuante de WhatsApp.

## O que editar antes de publicar
| O quê | Onde |
|---|---|
| Número do WhatsApp | `script.js` → `CONFIG.whatsapp` (ex.: `5511999999999`) |
| Telefone exibido | `index.html` → `#whatsapp-label` |
| Endereço | `index.html` → `#endereco` e o `q=` do iframe do mapa |
| Instagram | `index.html` → seção Contato |
| Número do CRO | `index.html` → `.cro` e rodapé |
| Foto do Dr. Pablo | `index.html` → trocar `.photo-placeholder` por `<img src="assets/dr-pablo.jpg">` |
| Dias de atendimento | Hero, FAQ e Contato (hoje: segunda a sexta, 07h–20h) |

## Rodar localmente
Abra `index.html` no navegador, ou `npx serve .`

## Publicar na Vercel
Importe o repositório na Vercel; sem configuração (framework "Other", sem comando de build).
