# orcapro

Serviço para criar e publicar **campanhas de anúncios** em Meta Ads (Facebook/Instagram),
Google Ads e TikTok Ads a partir de uma única definição de campanha.

Você descreve a campanha uma vez, no vocabulário do orcapro, e cada adaptador
traduz para o formato da plataforma. Tem API HTTP e CLI.

## Como funciona

```
campanha (JSON)  ──►  CampaignService  ──►  MetaAdsProvider    ──►  Graph API
                            │                GoogleAdsProvider ──►  Google Ads API
                            │                TikTokAdsProvider ──►  Business API
                            ▼
                     campaigns.json
```

O resultado de cada plataforma fica guardado em `campaign.publications` — ID
externo, status, data e o erro, quando houver. Uma plataforma falhar não
impede as outras.

## Segurança: nada é enviado sem credenciais

Uma plataforma sem credenciais entra em **dry-run**: a publicação é simulada,
nada sai para a rede, e a publicação fica marcada com `dryRun: true` e o ID
`dryrun-<plataforma>-<hash>`. Ligue `ORCAPRO_DRY_RUN=true` para simular tudo
mesmo com credenciais válidas.

Republicar uma campanha já publicada de verdade é **pulado** — criar de novo
geraria uma campanha duplicada na plataforma e gastaria orçamento em dobro.
Publicações simuladas são reprocessadas normalmente quando as credenciais
chegam.

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
npm run campanha -- publicar examples/campanha.json  # cria e publica
npm run campanha -- publicar examples/campanha.json --plataformas meta,tiktok
npm run campanha -- listar
npm run campanha -- status <id> pausar               # ativar | pausar | arquivar
npm run campanha -- sincronizar <id>                 # relê o status nas plataformas
```

Sai com código 1 se alguma plataforma falhar, então serve em CI/cron.

## API HTTP

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness. |
| `GET` | `/providers` | Quais plataformas estão configuradas e em que modo. |
| `POST` | `/campaigns` | Cria a campanha (não publica). `201`. |
| `GET` | `/campaigns?status=&platform=` | Lista com filtros. |
| `GET` | `/campaigns/:id` | Uma campanha. |
| `PATCH` | `/campaigns/:id` | Edita. Revalida as regras cruzadas. |
| `DELETE` | `/campaigns/:id` | Remove do orcapro (não remove da plataforma). |
| `POST` | `/campaigns/:id/publish` | Publica. Corpo opcional: `{"platforms":["meta"]}`. |
| `POST` | `/campaigns/:id/status` | `{"status":"active\|paused\|archived"}`, propaga. |
| `POST` | `/campaigns/:id/sync` | Relê o status em cada plataforma. |

`publish` e `status` devolvem `200` quando tudo passou, **`207`** quando parte
das plataformas falhou e **`502`** quando todas falharam — o corpo traz o
resultado plataforma a plataforma.

```bash
curl -X POST localhost:3000/campaigns \
  -H 'content-type: application/json' \
  -d @examples/campanha.json
```

## A campanha

Veja `examples/campanha.json`. Os campos que costumam pegar:

- **`budget.amountMinor`** — sempre em **centavos**, inteiro. `15000` = R$ 150,00.
  Cada provider converte: Meta e Google querem unidades menores/micros, TikTok
  quer a unidade principal. Você nunca lida com isso.
- **`budget.mode: "lifetime"`** exige `schedule.endAt`.
- **`objective`** — `awareness`, `traffic`, `engagement`, `leads`,
  `app_promotion`, `sales`, `video_views`. Cada plataforma tem seu mapa:

| orcapro | Meta | Google (canal) | TikTok |
| --- | --- | --- | --- |
| `awareness` | `OUTCOME_AWARENESS` | `DISPLAY` | `REACH` |
| `traffic` | `OUTCOME_TRAFFIC` | `SEARCH` | `TRAFFIC` |
| `engagement` | `OUTCOME_ENGAGEMENT` | `DISPLAY` | `ENGAGEMENT` |
| `leads` | `OUTCOME_LEADS` | `SEARCH` | `LEAD_GENERATION` |
| `app_promotion` | `OUTCOME_APP_PROMOTION` | `MULTI_CHANNEL` | `APP_PROMOTION` |
| `sales` | `OUTCOME_SALES` | `SEARCH` | `PRODUCT_SALES` |
| `video_views` | `OUTCOME_AWARENESS` | `VIDEO` | `VIDEO_VIEWS` |

- **`status: "draft"`** cria a campanha **pausada** na plataforma. A TikTok cria
  habilitada por padrão, então o adaptador desliga logo em seguida.

## Credenciais

Tudo em `.env` (veja `.env.example`):

- **Meta** — `META_ACCESS_TOKEN` (com `ads_management`) e `META_AD_ACCOUNT_ID`.
- **Google Ads** — `GOOGLE_ADS_ACCESS_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID` e, se você opera via MCC,
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. O access token precisa vir já renovado — o
  refresh do OAuth está fora do escopo deste serviço.
- **TikTok** — `TIKTOK_ACCESS_TOKEN` e `TIKTOK_ADVERTISER_ID`.

## Desenvolvimento

```bash
npm run typecheck
npm test          # 61 testes
npm run build
npm start
```

Os testes não tocam a rede: os providers rodam contra um `fetch` stubado e o
serviço contra providers falsos.

## Limites conhecidos

- Cria a **campanha**, não os conjuntos de anúncios nem os criativos. O
  `targeting` é validado e guardado, mas quem consome segmentação na Meta e na
  TikTok é o ad set / ad group — o próximo passo natural é uma camada de
  `AdSet` usando os mesmos adaptadores.
- Persistência em arquivo JSON único. Serve para o volume de uma agência e para
  uma instância só; para várias instâncias, troque por um repositório de banco —
  a interface `CampaignRepository` é o único ponto de contato.
- A estratégia de lance do Google Ads é `manualCpc` fixa. Contas que exigem
  outra estratégia precisam de ajuste em `src/providers/google.ts`.
- `DELETE /campaigns/:id` remove só do orcapro; o que já foi criado continua
  existindo na plataforma.
