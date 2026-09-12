# SistemaLoja Dashboard

Dashboard web desenvolvido para acompanhar vendas e indicadores de uma loja a partir de dados armazenados em **Microsoft SQL Server**.

O projeto integra uma API em **Python/Flask**, **Google Apps Script**, **HTML/CSS/JavaScript** e **Chart.js**, com filtros cruzados semelhantes aos encontrados em ferramentas de BI.

> Este repositório é uma versão sanitizada para portfólio. Tokens, senhas, URLs privadas e dados reais não são incluídos.

## Funcionalidades

- Faturamento do período;
- quantidade de vendas;
- ticket médio;
- itens vendidos;
- produtos com estoque baixo;
- faturamento e vendas por dia;
- distribuição por forma de pagamento;
- ranking de produtos mais vendidos;
- filtro por 7, 30, 90 ou 365 dias;
- filtros cruzados ao clicar em gráficos;
- login e controle de acesso no Google Apps Script;
- aprovação manual de novos usuários;
- dashboard responsivo com tema escuro.

## Tecnologias

- **Microsoft SQL Server** — armazenamento dos dados;
- **Python** — camada de API;
- **Flask** — endpoints do dashboard;
- **PyODBC** — comunicação com SQL Server;
- **Google Apps Script** — aplicação web e camada intermediária;
- **HTML / CSS / JavaScript** — interface;
- **Chart.js** — visualização de dados;
- **Cloudflare Tunnel** — acesso HTTPS à API sem exposição direta do SQL Server.

## Arquitetura

```text
PDV / Sistema da Loja
        │
        ▼
Microsoft SQL Server
    SistemaLoja
        │
        ▼
Python + Flask API
        │
        ▼
Cloudflare Tunnel (HTTPS)
        │
        ▼
Google Apps Script
        │
        ▼
HTML + JavaScript + Chart.js
        │
        ▼
Dashboard
```

Uma visão mais detalhada está em [`docs/architecture.md`](docs/architecture.md).

## Estrutura do projeto

```text
sistemaloja-dashboard/
│
├── backend/
│   ├── api_dashboard.py
│   ├── config_api.example.json
│   └── requirements.txt
│
├── apps-script/
│   ├── Code.gs
│   └── Index.html
│
├── docs/
│   └── architecture.md
│
├── .gitignore
├── SECURITY.md
├── LICENSE
└── README.md
```

## Cross-filter

Os gráficos funcionam também como filtros. Por exemplo, ao selecionar uma forma de pagamento, os demais indicadores são recalculados usando aquele recorte.

Exemplos de filtros disponíveis:

- **Cartão / PIX / outras formas de pagamento**;
- **produto**;
- **dia específico**;
- **período de análise**.

Os filtros podem ser combinados e removidos pela própria interface.

## Configuração da API

Instale as dependências:

```bash
pip install -r backend/requirements.txt
```

Crie uma cópia de:

```text
backend/config_api.example.json
```

com o nome:

```text
backend/config_api.json
```

Exemplo:

```json
{
  "api_token": "SUA_CHAVE_PRIVADA",
  "sql_connection": "DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=SistemaLoja;Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=yes;"
}
```

O arquivo real é ignorado pelo Git através do `.gitignore`.

## Google Apps Script

No projeto Apps Script, crie:

- `Code.gs`;
- `Index.html`.

As informações privadas devem ser cadastradas em **Project Settings → Script Properties**.

Exemplo de propriedades utilizadas:

```text
API_BASE_URL
DASHBOARD_TOKEN
ADMIN_EMAIL
```

Nenhuma dessas informações deve ser escrita diretamente no código publicado no GitHub.

## Segurança da arquitetura

O banco SQL Server não precisa ficar diretamente disponível na internet.

```text
Internet
   │
   ▼
HTTPS / Tunnel
   │
   ▼
API
   │
   ▼
SQL Server local
```

A porta padrão do SQL Server não é exposta publicamente.

Consulte [`SECURITY.md`](SECURITY.md) antes de publicar ou implantar o projeto.

## Objetivo do projeto

O projeto foi desenvolvido para aplicar conhecimentos de:

- SQL e modelagem de dados;
- integração entre sistemas;
- criação de APIs;
- indicadores de negócio;
- visualização de dados;
- desenvolvimento de dashboards;
- automação com Google Apps Script.

## Autor

**Gabriel Nascimento**

Projeto desenvolvido para estudo e portfólio nas áreas de **Dados, BI e Tecnologia da Informação**.
