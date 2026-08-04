# Atualização do AdsPilot Analytics para V2.2

Esta atualização preserva os dados existentes. A conversão USD/BRL/EUR ocorre somente no navegador; valores recebidos do Google Ads continuam armazenados na moeda original da conta.

## 1. Supabase

Antes de publicar o código, abra **SQL Editor → New query**, copie todo o conteúdo de:

`supabase/migrations/005_dashboard_v2_2.sql`

Execute uma vez. A migração acrescenta os metadados de campanha e cria a tabela geográfica hierárquica. Ela não apaga nem recria tabelas existentes.

## 2. Railway

Substitua os arquivos do projeto pela V2.2, envie para o mesmo repositório e aguarde o deploy. Nenhuma variável nova é obrigatória. Confirme:

```text
GET /api/health
```

Resposta esperada:

```json
{"status":"ok","app":"AdsPilot Analytics","version":"2.2.0","mode":"configured"}
```

## 3. Google Ads Script

No MCC, abra o script **AdsPilot Hourly**, substitua seu código pelo conteúdo de:

`google-ads-scripts/adspilot-v1.2.js`

Mantenha no bloco `CONFIG` o mesmo `WEBHOOK_URL` e `WEBHOOK_SECRET`. Execute primeiro em **Visualizar** e confirme no log:

```text
AdsPilot MCC finalizado. Sucesso: N, erros: 0
```

Depois salve e mantenha o agendamento por hora. O script permanece somente leitura no Google Ads. As únicas gravações ocorrem no Supabase por meio do webhook.

## 4. Conferência

Depois da primeira execução V2.2, confirme no Supabase:

```sql
select location_level, count(*)
from google_ads_locations_daily
group by location_level
order by location_level;
```

```sql
select campaign_name, ad_group_count, ad_count,
       desired_cpa_micros, desired_cpa_is_average
from google_ads_campaign_daily
order by report_date desc
limit 20;
```

Os nomes de país, estado e cidade só aparecem após o script V2.2 executar. O histórico anterior continua disponível; dias antigos podem ser enriquecidos executando novamente a carga histórica em janelas pequenas.

## 5. Observações

- As colunas de funil ficam preparadas e mostram `—` enquanto não houver lançamento manual ou módulo de tracking.
- O “CPA Desejado (Média)” é a média do CPA efetivo dos grupos ativos. O CPA do grupo prevalece; quando ausente, usa o CPA da campanha.
- O campo “Data de criação” usa a data de início disponível no Google Ads.
- URLs finais abrem em uma nova aba com proteção `noopener/noreferrer`.
