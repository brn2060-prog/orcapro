# Sistema de Contagem de Estoque — Adega

Sistema completo de contagem de estoque para adega (tabacaria, bebidas, cervejas), feito para rodar no celular e ser fácil de **integrar em outro sistema depois**. Sem dependências, sem build, sem servidor — só HTML e JavaScript puro.

## Arquivos

| Arquivo | O que é |
|---|---|
| `contagem-estoque.js` | Módulo com toda a lógica (portável — é ele que você leva para o outro sistema) |
| `index.html` | Aplicativo completo para usar no navegador do celular |

## O que o aplicativo faz

- **Cadastro de itens com foto** (câmera ou galeria — a foto é comprimida e salva no aparelho)
- **Categorias**: Cervejas, Bebidas, Tabacaria e Outros
- **Contagem** com botões grandes **+ / −**, toque na quantidade para digitar direto
- **Leitor de código de barras**: bipe no campo de busca e o item soma +1 sozinho; código desconhecido abre o cadastro já preenchido
- **Busca** por nome ou código e filtro por categoria
- **Resumo** com totais por categoria
- **Exportar CSV** (abre no Excel) e **JSON** (com fotos, para juntar aparelhos ou integrar)
- **Juntar contagem**: importa o JSON de outro celular e **soma** as quantidades
- **Zerar quantidades** (mantém o catálogo com fotos para a próxima contagem) ou apagar tudo
- Dados ficam salvos no aparelho (`localStorage`) — pode fechar e continuar depois

## Usando em 5 celulares

1. Abra o `index.html` (ou o link do sistema) em cada celular.
2. Em **Resumo → Este aparelho**, identifique cada um (ex.: "Celular 1 — João").
3. Cada pessoa conta uma parte da adega (ex.: um fica na tabacaria, outro nas cervejas…).
4. No fim, cada celular toca em **Exportar JSON** e envia o arquivo (WhatsApp, e-mail…).
5. No celular principal: **Juntar contagem** → escolhe cada arquivo recebido. As quantidades são somadas e o catálogo (fotos, códigos) é completado automaticamente.
6. Do celular principal, exporte o CSV/JSON final.

> Dica: para o catálogo (fotos e nomes) ficar igual nos 5 aparelhos antes da contagem, cadastre tudo em um celular, exporte o JSON e importe nos outros 4 com "Juntar contagem".

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

// catálogo
const item = contagem.cadastrar({
  nome: 'Cerveja Heineken 330ml',   // obrigatório
  codigo: '7896045506040',          // código de barras (opcional)
  categoria: 'Cervejas',            // Cervejas | Bebidas | Tabacaria | Outros
  foto: 'data:image/jpeg;base64,…', // opcional
  quantidade: 0,                    // opcional
});
contagem.atualizar(item.id, { nome: '...', codigo: '...', categoria: '...', foto: '...' });
contagem.remover(item.id);

// contagem
contagem.contar(item.id, +1);            // soma (ou subtrai com negativo, nunca fica < 0)
contagem.definirQuantidade(item.id, 24); // substitui

// consulta
contagem.obter(item.id);
contagem.porCodigo('7896045506040');     // para leitor de código de barras
contagem.porNome('heineken long neck');  // nome exato, ignora maiúsculas
contagem.itens('heineken', 'Cervejas');  // filtro e categoria opcionais
contagem.resumo();                       // { itens, unidades, porCategoria: {...} }

// integração / vários aparelhos
contagem.exportarJSON('Celular 1');      // catálogo + contagem (com fotos)
contagem.exportarCSV();                  // separador ";" (padrão Excel/pt-BR), sem fotos
contagem.importarJSON(texto);            // junta outra contagem: soma quantidades,
                                         // completa fotos/códigos → { novos, somados }

// recomeçar
contagem.zerarQuantidades();             // zera tudo, mantém o catálogo
contagem.limpar();                       // apaga tudo

ContagemEstoque.CATEGORIAS;              // ['Cervejas', 'Bebidas', 'Tabacaria', 'Outros']
```

### Persistência plugável

Por padrão a contagem fica em memória. Passe qualquer objeto com `getItem`/`setItem` para persistir:

```js
new ContagemEstoque({ storage: localStorage });                   // navegador
new ContagemEstoque({ storage: meuStorage, chave: 'filial-01' }); // chave customizada
```

Para integrar com um backend, envie o resultado de `exportarJSON()` para a sua API. Dados salvos pela versão 1 do sistema são migrados automaticamente.

## Formato de exportação (JSON)

```json
{
  "geradoEm": "2026-08-10T12:00:00.000Z",
  "aparelho": "Celular 1 — João",
  "resumo": {
    "itens": 2,
    "unidades": 31,
    "porCategoria": { "Cervejas": { "itens": 1, "unidades": 24 }, "...": {} }
  },
  "itens": [
    {
      "id": "7896045506040",
      "codigo": "7896045506040",
      "nome": "Cerveja Heineken 330ml",
      "categoria": "Cervejas",
      "foto": "data:image/jpeg;base64,…",
      "quantidade": 24,
      "atualizadoEm": "2026-08-10T11:58:00.000Z"
    }
  ]
}
```
