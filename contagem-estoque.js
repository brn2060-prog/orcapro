/**
 * Módulo de contagem de estoque — sem dependências.
 *
 * Funciona no navegador (via <script> ou import) e em Node.js.
 * A persistência é plugável: passe um objeto storage com getItem/setItem
 * (ex.: localStorage) ou deixe em memória.
 *
 * Modelo de item:
 *   { id, codigo, nome, categoria, foto, quantidade, atualizadoEm }
 *   - codigo: código de barras (opcional)
 *   - foto: data URL da imagem (opcional)
 *
 * Contagem em vários aparelhos: cada aparelho conta a sua parte e gera
 * um JSON com exportarJSON(); no aparelho principal, importarJSON() soma
 * as quantidades e completa o catálogo (fotos, nomes, categorias).
 */
(function (global) {
  'use strict';

  const CHAVE_PADRAO = 'contagem-estoque-v2';
  const CHAVE_V1 = 'contagem-estoque';
  const CATEGORIAS = ['Cervejas', 'Bebidas', 'Tabacaria', 'Outros'];

  function agora() {
    return new Date().toISOString();
  }

  function normalizarNome(nome) {
    return String(nome || '').trim().toLowerCase();
  }

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
      this._itens = new Map(); // id -> item
      this._seq = 1;
      this._carregar();
    }

    /**
     * Cadastra um item novo no catálogo.
     * @param {object} dados { nome, codigo?, categoria?, foto?, quantidade? }
     * @returns {object} o item criado
     */
    cadastrar(dados) {
      dados = dados || {};
      const nome = String(dados.nome || '').trim();
      if (!nome) throw new Error('Nome do item é obrigatório.');

      const codigo = String(dados.codigo || '').trim();
      if (codigo && this.porCodigo(codigo)) {
        throw new Error('Já existe um item com o código ' + codigo + '.');
      }
      if (!codigo && this.porNome(nome)) {
        throw new Error('Já existe um item chamado "' + nome + '".');
      }

      const id = codigo || 'item-' + this._seq++;
      const item = {
        id: id,
        codigo: codigo,
        nome: nome,
        categoria: CATEGORIAS.indexOf(dados.categoria) !== -1 ? dados.categoria : 'Outros',
        foto: dados.foto || null,
        quantidade: Math.max(0, Number(dados.quantidade) || 0),
        atualizadoEm: agora(),
      };
      this._itens.set(id, item);
      this._salvar();
      return Object.assign({}, item);
    }

    /** Atualiza campos de um item (nome, codigo, categoria, foto). */
    atualizar(id, campos) {
      const item = this._exigir(id);
      campos = campos || {};

      if (campos.nome != null) {
        const nome = String(campos.nome).trim();
        if (!nome) throw new Error('Nome do item é obrigatório.');
        const outro = this.porNome(nome);
        if (outro && outro.id !== item.id) {
          throw new Error('Já existe um item chamado "' + nome + '".');
        }
        item.nome = nome;
      }
      if (campos.codigo != null) {
        const codigo = String(campos.codigo).trim();
        const outro = codigo ? this.porCodigo(codigo) : null;
        if (outro && outro.id !== item.id) {
          throw new Error('Já existe um item com o código ' + codigo + '.');
        }
        item.codigo = codigo;
      }
      if (campos.categoria != null && CATEGORIAS.indexOf(campos.categoria) !== -1) {
        item.categoria = campos.categoria;
      }
      if (campos.foto !== undefined) {
        item.foto = campos.foto || null;
      }
      item.atualizadoEm = agora();
      this._salvar();
      return Object.assign({}, item);
    }

    /** Soma (ou subtrai, com delta negativo) na quantidade. Nunca fica negativo. */
    contar(id, delta) {
      const item = this._exigir(id);
      delta = Number(delta);
      if (!isFinite(delta)) throw new Error('Quantidade inválida.');
      item.quantidade = Math.max(0, item.quantidade + delta);
      item.atualizadoEm = agora();
      this._salvar();
      return Object.assign({}, item);
    }

    /** Define a quantidade exata (substitui, não soma). */
    definirQuantidade(id, quantidade) {
      const item = this._exigir(id);
      quantidade = Number(quantidade);
      if (!isFinite(quantidade) || quantidade < 0) {
        throw new Error('Quantidade inválida.');
      }
      item.quantidade = quantidade;
      item.atualizadoEm = agora();
      this._salvar();
      return Object.assign({}, item);
    }

    /** Remove um item do catálogo. @returns {boolean} */
    remover(id) {
      const removeu = this._itens.delete(id);
      if (removeu) this._salvar();
      return removeu;
    }

    /** Zera as quantidades de todos os itens, mantendo o catálogo. */
    zerarQuantidades() {
      this._itens.forEach(function (item) {
        item.quantidade = 0;
        item.atualizadoEm = agora();
      });
      this._salvar();
    }

    /** Apaga tudo: catálogo e contagem. */
    limpar() {
      this._itens.clear();
      this._salvar();
    }

    /** @returns {object|null} */
    obter(id) {
      const item = this._itens.get(id);
      return item ? Object.assign({}, item) : null;
    }

    /** Busca item pelo código de barras. @returns {object|null} */
    porCodigo(codigo) {
      codigo = String(codigo || '').trim();
      if (!codigo) return null;
      let achado = null;
      this._itens.forEach(function (item) {
        if (!achado && item.codigo === codigo) achado = Object.assign({}, item);
      });
      return achado;
    }

    /** Busca item pelo nome (ignora maiúsculas/acentos não). @returns {object|null} */
    porNome(nome) {
      const alvo = normalizarNome(nome);
      if (!alvo) return null;
      let achado = null;
      this._itens.forEach(function (item) {
        if (!achado && normalizarNome(item.nome) === alvo) achado = Object.assign({}, item);
      });
      return achado;
    }

    /**
     * Lista itens ordenados por categoria e nome.
     * @param {string} [filtro]    filtra por nome ou código (contém)
     * @param {string} [categoria] filtra por categoria exata
     */
    itens(filtro, categoria) {
      let lista = Array.from(this._itens.values(), function (i) {
        return Object.assign({}, i);
      });
      if (categoria && CATEGORIAS.indexOf(categoria) !== -1) {
        lista = lista.filter(function (i) { return i.categoria === categoria; });
      }
      if (filtro && String(filtro).trim() !== '') {
        const f = String(filtro).trim().toLowerCase();
        lista = lista.filter(function (i) {
          return (
            i.nome.toLowerCase().indexOf(f) !== -1 ||
            i.codigo.toLowerCase().indexOf(f) !== -1
          );
        });
      }
      lista.sort(function (a, b) {
        const ca = CATEGORIAS.indexOf(a.categoria);
        const cb = CATEGORIAS.indexOf(b.categoria);
        if (ca !== cb) return ca - cb;
        return a.nome.localeCompare(b.nome, 'pt-BR');
      });
      return lista;
    }

    /** Totais gerais e por categoria. */
    resumo() {
      const porCategoria = {};
      CATEGORIAS.forEach(function (c) {
        porCategoria[c] = { itens: 0, unidades: 0 };
      });
      let unidades = 0;
      this._itens.forEach(function (i) {
        unidades += i.quantidade;
        porCategoria[i.categoria].itens += 1;
        porCategoria[i.categoria].unidades += i.quantidade;
      });
      return { itens: this._itens.size, unidades: unidades, porCategoria: porCategoria };
    }

    /**
     * Exporta tudo (catálogo + contagem) como JSON, para juntar em outro
     * aparelho ou enviar a outro sistema.
     * @param {string} [aparelho] identificação de quem contou
     */
    exportarJSON(aparelho) {
      return JSON.stringify(
        {
          geradoEm: agora(),
          aparelho: String(aparelho || '').trim() || null,
          resumo: this.resumo(),
          itens: this.itens(),
        },
        null,
        2
      );
    }

    /** Exporta a contagem como CSV (separador ";", padrão pt-BR/Excel). Sem fotos. */
    exportarCSV() {
      const linhas = ['categoria;codigo;nome;quantidade;atualizado_em'];
      this.itens().forEach(function (i) {
        const nome = '"' + String(i.nome).replace(/"/g, '""') + '"';
        linhas.push([i.categoria, i.codigo, nome, i.quantidade, i.atualizadoEm].join(';'));
      });
      return linhas.join('\r\n');
    }

    /**
     * Junta uma contagem exportada por outro aparelho (JSON de
     * exportarJSON() ou um array de itens): soma as quantidades e
     * completa dados que faltam (foto, código, categoria).
     * @returns {object} { novos, somados }
     */
    importarJSON(texto) {
      const dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
      const itens = Array.isArray(dados) ? dados : dados.itens || [];
      let novos = 0;
      let somados = 0;

      for (let k = 0; k < itens.length; k++) {
        const i = itens[k] || {};
        const quantidade = Math.max(0, Number(i.quantidade) || 0);
        const local =
          (i.codigo && this.porCodigo(i.codigo)) || this.porNome(i.nome);

        if (local) {
          const item = this._itens.get(local.id);
          item.quantidade += quantidade;
          if (!item.foto && i.foto) item.foto = i.foto;
          if (!item.codigo && i.codigo) item.codigo = String(i.codigo).trim();
          if (item.categoria === 'Outros' && CATEGORIAS.indexOf(i.categoria) !== -1) {
            item.categoria = i.categoria;
          }
          item.atualizadoEm = agora();
          somados++;
        } else if (String(i.nome || '').trim()) {
          this.cadastrar({
            nome: i.nome,
            codigo: i.codigo,
            categoria: i.categoria,
            foto: i.foto,
            quantidade: quantidade,
          });
          novos++;
        }
      }
      this._salvar();
      return { novos: novos, somados: somados };
    }

    // --- interno ------------------------------------------------------------

    _exigir(id) {
      const item = this._itens.get(id);
      if (!item) throw new Error('Item não encontrado.');
      return item;
    }

    _salvar() {
      if (!this._storage) return;
      try {
        this._storage.setItem(
          this._chave,
          JSON.stringify({ seq: this._seq, itens: Array.from(this._itens.values()) })
        );
      } catch (e) {
        /* storage cheio ou indisponível: segue em memória */
      }
    }

    _carregar() {
      if (!this._storage) return;
      try {
        const bruto = this._storage.getItem(this._chave);
        if (bruto) {
          const dados = JSON.parse(bruto);
          this._seq = Number(dados.seq) || 1;
          const self = this;
          (dados.itens || []).forEach(function (i) {
            if (i && i.id && i.nome) {
              self._itens.set(String(i.id), {
                id: String(i.id),
                codigo: String(i.codigo || ''),
                nome: String(i.nome),
                categoria: CATEGORIAS.indexOf(i.categoria) !== -1 ? i.categoria : 'Outros',
                foto: i.foto || null,
                quantidade: Math.max(0, Number(i.quantidade) || 0),
                atualizadoEm: i.atualizadoEm || null,
              });
            }
          });
          return;
        }
        // migração da versão 1 (itens só com código/descrição)
        const v1 = this._storage.getItem(CHAVE_V1);
        if (v1) {
          const self = this;
          JSON.parse(v1).forEach(function (i) {
            if (i && i.codigo) {
              self.cadastrar({
                nome: String(i.descricao || i.codigo),
                codigo: String(i.codigo),
                quantidade: Number(i.quantidade) || 0,
              });
            }
          });
        }
      } catch (e) {
        /* dados corrompidos: começa vazio */
      }
    }
  }

  ContagemEstoque.CATEGORIAS = CATEGORIAS.slice();

  // Exporta para Node.js (require/import) e para o navegador (global).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContagemEstoque;
  }
  global.ContagemEstoque = ContagemEstoque;
})(typeof globalThis !== 'undefined' ? globalThis : this);
