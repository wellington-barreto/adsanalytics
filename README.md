# AdsPilot Analytics V1.2

Primeira versão do painel Google Ads: dashboard geral, detalhes de campanha, histórico diário, alterações automáticas, notas manuais e sincronizador Google Ads → Supabase.

A V1.2 acrescenta ingestão autenticada via Google Ads Scripts para uso enquanto
o Acesso Básico da Google Ads API estiver pendente. Consulte
`INSTALACAO_V1.2.md`.

## Testar localmente

```bash
npm install
npm run dev
```

Sem credenciais, a interface abre em modo demonstração.

## Supabase

1. Crie o projeto.
2. Execute `supabase/migrations/001_initial_schema.sql` no SQL Editor.
3. Crie seu usuário e copie o UUID para `APP_USER_ID`.

## Railway

1. Coloque o projeto em um repositório privado no GitHub.
2. No Railway: **New Project → Deploy from GitHub**.
3. Copie `.env.example` para as Variables e preencha os valores.
4. O healthcheck é `/api/health`.

Para conferir se as variáveis foram preenchidas sem expor seus valores, acesse
`GET /api/config/status`. O endpoint retorna apenas indicadores `true`/`false`.

## Sincronização via Google Ads Script (V1.2)

```text
POST https://SEU-DOMINIO/api/webhook/google-ads
x-adspilot-secret: VALOR_DE_GOOGLE_ADS_SCRIPT_SECRET
```

O script pronto para conta individual e MCC está em
`google-ads-scripts/adspilot-v1.2.js`.

## Sincronizar

```text
POST https://SEU-DOMINIO/api/sync/google-ads
x-sync-secret: VALOR_DE_SYNC_SECRET
```

Agende essa chamada no n8n. A sincronização reprocessa 14 dias e faz upsert, capturando conversões atrasadas. O histórico de alterações consulta os últimos dias e precisa rodar continuamente porque a API mantém `change_event` por janela limitada.

## Segurança

Developer Token, Refresh Token e Service Role ficam somente no Railway. Nunca use prefixo `NEXT_PUBLIC_` nessas chaves e não faça commit de `.env`.

## Limites da V1

Os dados reais já podem ser gravados no Supabase, mas a interface entregue inicia em modo demonstração. Após você validar a primeira sincronização com uma conta, a próxima versão liga as consultas reais do dashboard, autenticação Supabase, termos de pesquisa, anúncios, locais e dispositivos. Tracker, postbacks e Claude serão módulos posteriores.
