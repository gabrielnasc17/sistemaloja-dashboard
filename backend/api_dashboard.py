from flask import Flask, jsonify, request
import pyodbc
import json
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config_api.json"

with CONFIG_PATH.open("r", encoding="utf-8") as f:
    CONFIG = json.load(f)

API_TOKEN = CONFIG["api_token"]
SQL_CONNECTION = CONFIG["sql_connection"]

if not API_TOKEN or API_TOKEN == "TROQUE_POR_UMA_CHAVE_FORTE":
    raise RuntimeError(
        "Edite config_api.json e defina uma chave forte em api_token antes de iniciar a API."
    )

app = Flask(__name__)


def conectar():
    return pyodbc.connect(SQL_CONNECTION, timeout=5, autocommit=False)


def autorizado():
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {API_TOKEN}"


@app.before_request
def proteger_api():
    if request.path == "/health":
        return None
    if not autorizado():
        return jsonify({"erro": "Não autorizado"}), 401


def int_seguro(valor, padrao=None, minimo=None, maximo=None):
    try:
        n = int(valor)
    except (TypeError, ValueError):
        return padrao

    if minimo is not None:
        n = max(minimo, n)
    if maximo is not None:
        n = min(maximo, n)
    return n


def obter_filtros():
    dias = int_seguro(request.args.get("dias"), 30, 1, 365)
    forma = (request.args.get("forma_pagamento") or "").strip()
    produto_id = int_seguro(request.args.get("produto_id"), None, 1, None)
    data = (request.args.get("data") or "").strip()

    if data:
        try:
            datetime.strptime(data, "%Y-%m-%d")
        except ValueError:
            data = ""

    return {
        "dias": dias,
        "forma_pagamento": forma or None,
        "produto_id": produto_id,
        "data": data or None,
    }


def where_vendas(filtros, alias="v", incluir_forma=True, incluir_produto=True, incluir_data=True):
    condicoes = [
        f"{alias}.data >= DATEADD(DAY, -?, GETDATE())",
        f"UPPER(ISNULL({alias}.status, '')) <> 'CANCELADA'",
    ]
    params = [filtros["dias"]]

    if incluir_forma and filtros["forma_pagamento"]:
        condicoes.append(f"{alias}.forma_pagamento = ?")
        params.append(filtros["forma_pagamento"])

    if incluir_data and filtros["data"]:
        condicoes.append(f"CONVERT(date, {alias}.data) = ?")
        params.append(filtros["data"])

    if incluir_produto and filtros["produto_id"]:
        condicoes.append(
            f"""EXISTS (
                SELECT 1
                FROM dbo.itens_venda fx
                WHERE fx.venda_id = {alias}.id
                  AND fx.produto_id = ?
            )"""
        )
        params.append(filtros["produto_id"])

    return " AND ".join(condicoes), params


@app.get("/health")
def health():
    try:
        conn = conectar()
        cur = conn.cursor()
        cur.execute("SELECT DB_NAME()")
        banco = cur.fetchone()[0]
        cur.close()
        conn.close()
        return jsonify({"ok": True, "banco": banco})
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 500


@app.get("/api/dashboard/resumo")
def resumo():
    filtros = obter_filtros()
    where, params = where_vendas(filtros)

    conn = conectar()
    cur = conn.cursor()

    cur.execute(
        f"""
        SELECT
            COUNT(*) AS total_vendas,
            COALESCE(SUM(v.valor_total), 0) AS faturamento,
            COALESCE(AVG(CAST(v.valor_total AS DECIMAL(18,2))), 0) AS ticket_medio
        FROM dbo.vendas v
        WHERE {where}
        """,
        *params,
    )
    row = cur.fetchone()

    where_itens, params_itens = where_vendas(filtros, alias="v")
    extra_item = ""
    if filtros["produto_id"]:
        extra_item = " AND iv.produto_id = ?"
        params_itens = params_itens + [filtros["produto_id"]]

    cur.execute(
        f"""
        SELECT COALESCE(SUM(iv.quantidade), 0)
        FROM dbo.itens_venda iv
        INNER JOIN dbo.vendas v ON v.id = iv.venda_id
        WHERE {where_itens}
        {extra_item}
        """,
        *params_itens,
    )
    itens_vendidos = cur.fetchone()[0]

    # Estoque baixo também respeita os filtros ativos.
    cond_prod = ["p.estoque <= 5"]
    params_prod = []

    if filtros["produto_id"]:
        cond_prod.append("p.id = ?")
        params_prod.append(filtros["produto_id"])

    # Se houver filtros de venda, mostra apenas produtos que aparecem nessas vendas.
    where_stock, params_stock = where_vendas(
        filtros,
        alias="vx",
        incluir_produto=False,
    )
    cond_prod.append(
        f"""EXISTS (
            SELECT 1
            FROM dbo.itens_venda ix
            INNER JOIN dbo.vendas vx ON vx.id = ix.venda_id
            WHERE ix.produto_id = p.id
              AND {where_stock}
        )"""
    )
    params_prod += params_stock

    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM dbo.produtos p
        WHERE {" AND ".join(cond_prod)}
        """,
        *params_prod,
    )
    estoque_baixo = cur.fetchone()[0]

    cur.close()
    conn.close()

    return jsonify({
        "periodo_dias": filtros["dias"],
        "total_vendas": int(row[0] or 0),
        "faturamento": float(row[1] or 0),
        "ticket_medio": float(row[2] or 0),
        "itens_vendidos": int(itens_vendidos or 0),
        "produtos_estoque_baixo": int(estoque_baixo or 0),
    })


@app.get("/api/dashboard/vendas-dia")
def vendas_dia():
    filtros = obter_filtros()

    # Ignora o filtro de data no próprio gráfico para manter os demais dias clicáveis.
    where, params = where_vendas(filtros, incluir_data=False)

    conn = conectar()
    cur = conn.cursor()

    cur.execute(
        f"""
        SELECT
            CONVERT(date, v.data) AS dia,
            COUNT(*) AS vendas,
            COALESCE(SUM(v.valor_total), 0) AS faturamento
        FROM dbo.vendas v
        WHERE {where}
        GROUP BY CONVERT(date, v.data)
        ORDER BY dia
        """,
        *params,
    )

    dados = [{
        "dia": row[0].isoformat(),
        "vendas": int(row[1] or 0),
        "faturamento": float(row[2] or 0),
    } for row in cur.fetchall()]

    cur.close()
    conn.close()
    return jsonify(dados)


@app.get("/api/dashboard/formas-pagamento")
def formas_pagamento():
    filtros = obter_filtros()

    # Ignora o filtro de forma no próprio gráfico.
    where, params = where_vendas(filtros, incluir_forma=False)

    conn = conectar()
    cur = conn.cursor()

    cur.execute(
        f"""
        SELECT
            COALESCE(NULLIF(LTRIM(RTRIM(v.forma_pagamento)), ''), 'Não informado') AS forma,
            COUNT(*) AS vendas,
            COALESCE(SUM(v.valor_total), 0) AS faturamento
        FROM dbo.vendas v
        WHERE {where}
        GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(v.forma_pagamento)), ''), 'Não informado')
        ORDER BY faturamento DESC
        """,
        *params,
    )

    dados = [{
        "forma": row[0],
        "vendas": int(row[1] or 0),
        "faturamento": float(row[2] or 0),
    } for row in cur.fetchall()]

    cur.close()
    conn.close()
    return jsonify(dados)


@app.get("/api/dashboard/produtos-mais-vendidos")
def produtos_mais_vendidos():
    filtros = obter_filtros()
    limite = int_seguro(request.args.get("limite"), 10, 1, 50)

    # Ignora o próprio filtro de produto para manter as barras disponíveis.
    where, params = where_vendas(filtros, incluir_produto=False)

    conn = conectar()
    cur = conn.cursor()

    cur.execute(
        f"""
        SELECT TOP {limite}
            p.id,
            p.nome,
            p.categoria,
            SUM(iv.quantidade) AS quantidade,
            SUM(iv.subtotal) AS faturamento
        FROM dbo.itens_venda iv
        INNER JOIN dbo.vendas v ON v.id = iv.venda_id
        INNER JOIN dbo.produtos p ON p.id = iv.produto_id
        WHERE {where}
        GROUP BY p.id, p.nome, p.categoria
        ORDER BY quantidade DESC, faturamento DESC
        """,
        *params,
    )

    dados = [{
        "id": int(row[0]),
        "nome": row[1],
        "categoria": row[2] or "Sem categoria",
        "quantidade": int(row[3] or 0),
        "faturamento": float(row[4] or 0),
    } for row in cur.fetchall()]

    cur.close()
    conn.close()
    return jsonify(dados)


@app.get("/api/dashboard/estoque-baixo")
def estoque_baixo():
    filtros = obter_filtros()
    limite_estoque = int_seguro(request.args.get("limite"), 5, 0, 999999)

    condicoes = ["p.estoque <= ?"]
    params = [limite_estoque]

    if filtros["produto_id"]:
        condicoes.append("p.id = ?")
        params.append(filtros["produto_id"])

    where, params_v = where_vendas(
        filtros,
        alias="v",
        incluir_produto=False,
    )

    condicoes.append(
        f"""EXISTS (
            SELECT 1
            FROM dbo.itens_venda iv
            INNER JOIN dbo.vendas v ON v.id = iv.venda_id
            WHERE iv.produto_id = p.id
              AND {where}
        )"""
    )
    params += params_v

    conn = conectar()
    cur = conn.cursor()

    cur.execute(
        f"""
        SELECT
            p.id,
            p.codigo_barras,
            p.nome,
            p.categoria,
            p.preco,
            p.estoque
        FROM dbo.produtos p
        WHERE {" AND ".join(condicoes)}
        ORDER BY p.estoque ASC, p.nome ASC
        """,
        *params,
    )

    dados = [{
        "id": int(row[0]),
        "codigo_barras": row[1],
        "nome": row[2],
        "categoria": row[3] or "Sem categoria",
        "preco": float(row[4] or 0),
        "estoque": int(row[5] or 0),
    } for row in cur.fetchall()]

    cur.close()
    conn.close()
    return jsonify(dados)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
