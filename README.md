# AdsPilot Analytics V1

Primeira versão do painel Google Ads: dashboard geral, detalhes de campanha, histórico diário, alterações automáticas, notas manuais e sincronizador Google Ads → Supabase.

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
