# orcapro

Serviço para criar e publicar **campanhas de anúncios** em Meta Ads (Facebook/Instagram),
Google Ads e TikTok Ads a partir de uma única definição.

Você descreve a campanha uma vez — com seus conjuntos de anúncios e criativos —
e cada adaptador traduz para o formato da plataforma. Tem API HTTP e CLI.

## Como funciona

```
campanha ─┬─ conjunto ─┬─ anúncio      MetaAdsProvider    ──►  Graph API
          │            └─ anúncio  ──► GoogleAdsProvider  ──►  Google Ads API
          └─ conjunto ─── anúncio      TikTokAdsProvider  ──►  Business API
                                │
                                ▼
                    campaigns.json / adsets.json / ads.json
```

Os três níveis existem porque as plataformas trabalham assim: a **campanha**
define objetivo e orçamento, o **conjunto** define para quem entregar e como
otimizar, e o **anúncio** é o que a pessoa vê. Na Meta é "ad set"; no Google e
na TikTok, "ad group" — o orcapro chama tudo de conjunto.

O resultado de cada plataforma fica em `publications`, em cada nível: ID
externo, status, data e o erro, quando houver. Uma plataforma falhar não
impede as outras.

## Segurança: nada é enviado sem credenciais

Uma plataforma sem credenciais entra em **dry-run**: a publicação é simulada,
nada sai para a rede, e a publicação fica marcada com `dryRun: true` e o ID
`dryrun-<plataforma>-<hash>`. Ligue `ORCAPRO_DRY_RUN=true` para simular tudo
mesmo com credenciais válidas.

Três regras protegem o orçamento e a consistência da árvore:

- **Republicar é pulado.** O que já existe de verdade na plataforma não é
  recriado — isso duplicaria a campanha e gastaria orçamento em dobro.
  Publicações simuladas são reprocessadas quando as credenciais chegam.
- **A hierarquia é respeitada.** Um conjunto só é criado depois que a campanha
  tem ID naquela plataforma; um anúncio, depois que o conjunto tem. Publicar
  fora de ordem devolve `blocked` com a razão, sem chamar a plataforma.
- **Pai simulado força filho simulado.** Não dá para pendurar um conjunto real
  numa campanha que não existe, então a simulação desce a árvore inteira.

## Começando

```bash
npm install
cp .env.example .env      # preencha só o que for usar
npm run dev               # sobe em http://localhost:3000
```

Sem preencher nada, tudo roda em dry-run — dá para exercitar o fluxo inteiro
sem tocar em conta de anúncio nenhuma.

## CLI

```bash
npm run campanha -- provedores                       # o que está configurado
npm run campanha -- publicar examples/campanha.json  # sobe a árvore inteira
npm run campanha -- publicar examples/campanha.json --plataformas meta,tiktok
npm run campanha -- listar                           # campanhas, conjuntos e anúncios
npm run campanha -- status <id> pausar               # ativar | pausar | arquivar
npm run campanha -- sincronizar <id>                 # relê o status nas plataformas
```

`publicar` cria a campanha, os conjuntos e os anúncios do arquivo e publica
tudo na ordem certa. Sai com código 1 se alguma plataforma falhar ou ficar
bloqueada, então serve em CI/cron.

## API HTTP

**Campanha**

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness. |
| `GET` | `/providers` | Quais plataformas estão configuradas e em que modo. |
| `POST` | `/campaigns` | Cria a campanha (não publica). `201`. |
| `GET` | `/campaigns?status=&platform=` | Lista com filtros. |
| `GET` `PATCH` `DELETE` | `/campaigns/:id` | Lê, edita, remove. |
| `POST` | `/campaigns/:id/publish` | Publica só a campanha. |
| `POST` | `/campaigns/:id/status` | `{"status":"active\|paused\|archived"}`, propaga. |
| `POST` | `/campaigns/:id/sync` | Relê o status em cada plataforma. |
| `POST` | `/campaigns/:id/deploy` | **Publica a árvore inteira**, na ordem. |

**Conjunto de anúncios**

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` `POST` | `/campaigns/:campaignId/adsets` | Lista / cria. |
| `GET` `PATCH` `DELETE` | `/adsets/:id` | Lê, edita, remove. |
| `POST` | `/adsets/:id/publish` | Publica o conjunto. |
| `POST` | `/adsets/:id/status` | Muda o status e propaga. |

**Anúncio**

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` `POST` | `/adsets/:adSetId/ads` | Lista / cria. |
| `GET` `PATCH` `DELETE` | `/ads/:id` | Lê, edita, remove. |
| `POST` | `/ads/:id/publish` | Publica o anúncio. |
| `POST` | `/ads/:id/status` | Muda o status e propaga. |

Toda rota que publica devolve `200` quando tudo passou, **`207`** quando parte
falhou ou ficou bloqueada, e **`502`** quando nada passou — o corpo traz o
resultado plataforma a plataforma.

```bash
# o caminho mais curto: sobe a árvore inteira de um arquivo
curl -X POST localhost:3000/campaigns \
  -H 'content-type: application/json' -d @examples/campanha.json
```

## A campanha

Veja `examples/campanha.json` — campanha, conjuntos e anúncios aninhados. Os
campos que costumam pegar:

- **`budget.amountMinor`** — sempre em **centavos**, inteiro. `15000` = R$ 150,00.
  Cada provider converte: Meta e Google querem unidades menores/micros, TikTok
  quer a unidade principal. Você nunca lida com isso.
- **`budget.mode: "lifetime"`** exige `schedule.endAt`.
- **No conjunto, `budget` e `schedule` são opcionais** — omitidos, ele herda os
  da campanha. Na Meta isso é o Campaign Budget Optimization, que distribui o
  orçamento entre os conjuntos.
- **`objective`** — fica na campanha e determina como cada plataforma otimiza
  a entrega dos conjuntos abaixo dela:

| orcapro | Meta (objetivo / otimização) | Google (canal) | TikTok (otimização) |
| --- | --- | --- | --- |
| `awareness` | `OUTCOME_AWARENESS` / `REACH` | `DISPLAY` | `REACH` |
| `traffic` | `OUTCOME_TRAFFIC` / `LINK_CLICKS` | `SEARCH` | `CLICK` |
| `engagement` | `OUTCOME_ENGAGEMENT` / `POST_ENGAGEMENT` | `DISPLAY` | `ENGAGED_VIEW` |
| `leads` | `OUTCOME_LEADS` / `LEAD_GENERATION` | `SEARCH` | `CONVERT` |
| `app_promotion` | `OUTCOME_APP_PROMOTION` / `APP_INSTALLS` | `MULTI_CHANNEL` | `INSTALL` |
| `sales` | `OUTCOME_SALES` / `OFFSITE_CONVERSIONS` | `SEARCH` | `CONVERT` |
| `video_views` | `OUTCOME_AWARENESS` / `THRUPLAY` | `VIDEO` | `VIDEO_VIEW` |

- **`status: "draft"`** cria pausado na plataforma. Meta e TikTok criam
  habilitado por padrão, então os adaptadores desligam logo em seguida.

## O criativo

Os campos são a união do que as três plataformas pedem, e cada uma usa o que
lhe cabe:

| Campo | Meta | Google | TikTok |
| --- | --- | --- | --- |
| `headlines` | usa o primeiro | usa todos (**exige 3+**) | usa o primeiro |
| `descriptions` | usa a primeira | usa todas (**exige 2+**) | — |
| `primaryText` | "primary text" | — | "ad text" |
| `imageUrl` | direto por URL | ignorado | sobe para a conta e usa o ID |
| `videoIds` | `videoIds.meta` | ignorado | `videoIds.tiktok` |
| `callToAction` | botão do anúncio | automático | botão do anúncio |

- **`format: "single_image"`** exige `imageUrl`; **`"single_video"`** exige
  `videoIds`. O mesmo vídeo tem IDs diferentes em cada plataforma, então
  `videoIds` é um mapa: `{"meta": "...", "tiktok": "..."}`. Falta o ID de uma
  plataforma? Só ela fica `blocked`; as outras publicam.
- O Google monta um **anúncio de pesquisa responsivo** a partir dos textos e
  ignora a mídia. Menos de 3 títulos ou 2 descrições falha antes da chamada,
  com mensagem explicando o mínimo.

## Credenciais

Tudo em `.env` (veja `.env.example`):

- **Meta** — `META_ACCESS_TOKEN` (com `ads_management`), `META_AD_ACCOUNT_ID` e
  `META_PAGE_ID` (a página dona dos anúncios, exigida para criar criativos).
  `META_INSTAGRAM_ACTOR_ID` é opcional.
- **Google Ads** — `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID` e, se você opera via MCC,
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. O access token precisa vir já renovado — o
  refresh do OAuth está fora do escopo deste serviço.
- **TikTok** — `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID` e
  `TIKTOK_IDENTITY_ID` (a identidade que assina os anúncios).

## Desenvolvimento

```bash
npm run typecheck
npm test          # 120 testes
npm run build
npm start
```

Os testes não tocam a rede: os providers rodam contra um `fetch` stubado e os
serviços contra providers falsos.

## Limites conhecidos

- **Segmentação no Google Ads não é aplicada.** O grupo é criado com nome,
  status, tipo e lance; geo e demografia no Google são critérios separados
  (`CampaignCriterion` e `AdGroupCriterion`) e o geo ainda exige traduzir ISO
  para os IDs de localização do Google. Meta e TikTok recebem a segmentação
  completa — a TikTok inclusive traduz os países para os IDs de região dela.
- **A estratégia de lance do Google Ads é `manualCpc` fixa.** Contas que
  exigem outra estratégia precisam de ajuste em `src/providers/google.ts`.
- **`sync` só cobre a campanha.** Conjuntos e anúncios propagam status para as
  plataformas, mas ainda não releem o status de lá.
- **Persistência em arquivos JSON.** Serve para o volume de uma agência e para
  uma instância só; para várias instâncias, troque por um repositório de banco —
  a interface `Repository` em `src/repository/repository.ts` é o único ponto de
  contato.
- **`DELETE` remove só do orcapro**; o que já foi criado continua existindo na
  plataforma.
