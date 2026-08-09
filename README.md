# Sistema de Contagem de Estoque

Sistema simples de contagem de estoque, feito para ser fácil de **integrar em outro sistema depois**. Sem dependências, sem build, sem servidor — só HTML e JavaScript puro.

## Arquivos

| Arquivo | O que é |
|---|---|
| `contagem-estoque.js` | Módulo com toda a lógica de contagem (portável — é ele que você leva para o outro sistema) |
| `index.html` | Interface pronta para usar no navegador |

## Como usar

Abra o `index.html` no navegador (basta dar dois cliques no arquivo). Pronto:

1. Bipe ou digite o **código** do produto, informe a **quantidade** e pressione Enter.
2. Se o mesmo código for lido de novo, a quantidade é **somada** automaticamente.
3. Use ✎ para corrigir uma quantidade e ✕ para remover um item.
4. Exporte a contagem em **CSV** (abre no Excel) ou **JSON** (para importar em outro sistema).

Os dados ficam salvos no navegador (`localStorage`) — pode fechar a página e continuar a contagem depois.

## Como integrar em outro sistema

A lógica toda está em `contagem-estoque.js`, que funciona no navegador e no Node.js:

```html
<script src="contagem-estoque.js"></script>
```

```js
// Node.js
const ContagemEstoque = require('./contagem-estoque.js');
```

### API

```js
const contagem = new ContagemEstoque({ storage: localStorage }); // storage é opcional

contagem.registrar('7891000100103', 'Leite Integral 1L', 12); // soma se já existir
contagem.definirQuantidade('7891000100103', 10);              // substitui a quantidade
contagem.obter('7891000100103');       // { codigo, descricao, quantidade, atualizadoEm }
contagem.itens('leite');               // lista (filtro opcional), mais recentes primeiro
contagem.resumo();                     // { itens: 1, unidades: 10 }
contagem.remover('7891000100103');
contagem.limpar();                     // zera tudo

contagem.exportarJSON();               // string JSON com resumo + itens
contagem.exportarCSV();                // CSV separado por ";" (padrão Excel/pt-BR)
contagem.importarJSON(texto);          // importa um JSON exportado (soma com o atual)
```

### Persistência plugável

Por padrão a contagem fica em memória. Passe qualquer objeto com `getItem`/`setItem` para persistir:

```js
new ContagemEstoque({ storage: localStorage });                  // navegador
new ContagemEstoque({ storage: meuStorage, chave: 'filial-01' }); // chave customizada
```

Para integrar com um backend, basta enviar o resultado de `exportarJSON()` para a sua API.

## Formato de exportação

```json
{
  "geradoEm": "2026-08-09T12:00:00.000Z",
  "resumo": { "itens": 2, "unidades": 27 },
  "itens": [
    { "codigo": "7891000100103", "descricao": "Leite Integral 1L", "quantidade": 15, "atualizadoEm": "..." }
  ]
}
```
