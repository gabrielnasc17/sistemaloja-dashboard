# Segurança

Este repositório é uma versão sanitizada para portfólio.

Nunca publique no GitHub:

- `config_api.json` real;
- `DASHBOARD_TOKEN` / `api_token`;
- URLs temporárias do Cloudflare Tunnel usadas em produção;
- senhas de usuários;
- dados pessoais de clientes;
- backups ou arquivos do banco SQL Server.

As credenciais do Google Apps Script devem ser armazenadas em **Script Properties** e não diretamente no código.

O SQL Server deve permanecer acessível apenas localmente. A aplicação não requer exposição pública da porta 1433.
