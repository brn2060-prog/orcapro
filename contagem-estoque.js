/**
 * Módulo de contagem de estoque — sem dependências.
 *
 * Pode ser usado no navegador (via <script> ou import) ou em Node.js.
 * A persistência é plugável: passe um objeto storage com getItem/setItem
 * (ex.: localStorage) ou deixe em memória.
 *
 * Uso básico:
 *   const contagem = new ContagemEstoque({ storage: localStorage });
 *   contagem.registrar('7891000100103', 'Leite Integral 1L', 12);
 *   contagem.registrar('7891000100103', null, 3); // soma: total 15
 *   contagem.itens();        // lista de itens contados
 *   contagem.exportarJSON(); // string JSON para enviar a outro sistema
 *   contagem.exportarCSV();  // string CSV
 */
(function (global) {
  'use strict';

  const CHAVE_PADRAO = 'contagem-estoque';

  class ContagemEstoque {
    /**
     * @param {object} [opcoes]
     * @param {object} [opcoes.storage] Objeto com getItem/setItem (ex.: localStorage).
     * @param {string} [opcoes.chave]   Chave usada no storage.
     */
    constructor(opcoes) {
      opcoes = opcoes || {};
      this._storage = opcoes.storage || null;
      this._chave = opcoes.chave || CHAVE_PADRAO;
      this._itens = new Map(); // codigo -> { codigo, descricao, quantidade, atualizadoEm }
      this._carregar();
    }

    /**
     * Registra uma contagem. Se o código já existe, soma a quantidade.
     * Quantidade negativa abate do total (ajuste).
     * @returns {object} o item atualizado
     */
    registrar(codigo, descricao, quantidade) {
      codigo = String(codigo || '').trim();
      if (!codigo) throw new Error('Código é obrigatório.');

      quantidade = Number(quantidade);
      if (!isFinite(quantidade)) throw new Error('Quantidade inválida.');

      const existente = this._itens.get(codigo);
      const item = existente || {
        codigo: codigo,
        descricao: '',
        quantidade: 0,
        atualizadoEm: null,
      };

      item.quantidade += quantidade;
      if (item.quantidade < 0) item.quantidade = 0;
      if (descricao != null && String(descricao).trim() !== '') {
        item.descricao = String(descricao).trim();
      }
      item.atualizadoEm = new Date().toISOString();

      this._itens.set(codigo, item);
      this._salvar();
      return Object.assign({}, item);
    }

    /** Define a quantidade exata de um item (substitui, não soma). */
    definirQuantidade(codigo, quantidade) {
      codigo = String(codigo || '').trim();
      const item = this._itens.get(codigo);
      if (!item) throw new Error('Item não encontrado: ' + codigo);

      quantidade = Number(quantidade);
      if (!isFinite(quantidade) || quantidade < 0) {
        throw new Error('Quantidade inválida.');
      }
      item.quantidade = quantidade;
      item.atualizadoEm = new Date().toISOString();
      this._salvar();
      return Object.assign({}, item);
    }

    /** Remove um item da contagem. @returns {boolean} */
    remover(codigo) {
      const removeu = this._itens.delete(String(codigo || '').trim());
      if (removeu) this._salvar();
      return removeu;
    }

    /** Zera toda a contagem. */
    limpar() {
      this._itens.clear();
      this._salvar();
    }

    /** @returns {object|null} cópia do item ou null */
    obter(codigo) {
      const item = this._itens.get(String(codigo || '').trim());
      return item ? Object.assign({}, item) : null;
    }

    /**
     * Lista os itens contados, mais recentes primeiro.
     * @param {string} [filtro] filtra por código ou descrição (contém).
     */
    itens(filtro) {
      let lista = Array.from(this._itens.values(), function (i) {
        return Object.assign({}, i);
      });
      if (filtro && String(filtro).trim() !== '') {
        const f = String(filtro).trim().toLowerCase();
        lista = lista.filter(function (i) {
          return (
            i.codigo.toLowerCase().indexOf(f) !== -1 ||
            i.descricao.toLowerCase().indexOf(f) !== -1
          );
        });
      }
      lista.sort(function (a, b) {
        return (b.atualizadoEm || '').localeCompare(a.atualizadoEm || '');
      });
      return lista;
    }

    /** Totais gerais da contagem. */
    resumo() {
      let unidades = 0;
      this._itens.forEach(function (i) {
        unidades += i.quantidade;
      });
      return { itens: this._itens.size, unidades: unidades };
    }

    /** Exporta a contagem como string JSON (para integração). */
    exportarJSON() {
      return JSON.stringify(
        {
          geradoEm: new Date().toISOString(),
          resumo: this.resumo(),
          itens: this.itens(),
        },
        null,
        2
      );
    }

    /** Exporta a contagem como CSV (separador ";", padrão pt-BR/Excel). */
    exportarCSV() {
      const linhas = ['codigo;descricao;quantidade;atualizado_em'];
      this.itens().forEach(function (i) {
        const desc = '"' + String(i.descricao).replace(/"/g, '""') + '"';
        linhas.push([i.codigo, desc, i.quantidade, i.atualizadoEm].join(';'));
      });
      return linhas.join('\r\n');
    }

    /**
     * Importa itens de um JSON gerado por exportarJSON() (ou um array
     * de itens). Soma com o que já existe.
     */
    importarJSON(texto) {
      const dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
      const itens = Array.isArray(dados) ? dados : dados.itens || [];
      const self = this;
      itens.forEach(function (i) {
        self.registrar(i.codigo, i.descricao, i.quantidade);
      });
      return this.resumo();
    }

    // --- persistência -----------------------------------------------------

    _salvar() {
      if (!this._storage) return;
      try {
        this._storage.setItem(
          this._chave,
          JSON.stringify(Array.from(this._itens.values()))
        );
      } catch (e) {
        /* storage cheio ou indisponível: segue em memória */
      }
    }

    _carregar() {
      if (!this._storage) return;
      try {
        const bruto = this._storage.getItem(this._chave);
        if (!bruto) return;
        const self = this;
        JSON.parse(bruto).forEach(function (i) {
          if (i && i.codigo) {
            self._itens.set(String(i.codigo), {
              codigo: String(i.codigo),
              descricao: String(i.descricao || ''),
              quantidade: Number(i.quantidade) || 0,
              atualizadoEm: i.atualizadoEm || null,
            });
          }
        });
      } catch (e) {
        /* dados corrompidos: começa vazio */
      }
    }
  }

  // Exporta para Node.js (require/import) e para o navegador (global).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContagemEstoque;
  }
  global.ContagemEstoque = ContagemEstoque;
})(typeof globalThis !== 'undefined' ? globalThis : this);
