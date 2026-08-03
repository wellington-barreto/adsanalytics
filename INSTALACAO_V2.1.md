# AdsPilot Analytics V2.1 — atualização

## 1. Banco de dados

No Supabase, abra **SQL Editor**, crie uma nova consulta, copie todo o conteúdo de `supabase/migrations/004_dashboard_v2_1.sql` e execute uma única vez.

A migração preserva os dados existentes e cria:

- preferências de tema, moeda e colunas;
- estratégia por campanha;
- lançamentos manuais diários separados dos dados do Google Ads;
- campo de URL final da campanha.

## 2. Railway

Envie o projeto V2.1 ao mesmo repositório usado pelo Railway. Não é necessário alterar as variáveis atuais. O health check deve retornar `version: 2.1.0`.

## 3. Script diário

Substitua o conteúdo do script diário pelo arquivo `google-ads-scripts/adspilot-v1.2.js`, preservando seu `WEBHOOK_URL` e `WEBHOOK_SECRET`.

Execute primeiro em **Visualizar**. O script continua somente leitura e passa a tentar coletar URL final e locais segmentados por país, estado/província e cidade. Consultas não suportadas por algum tipo de conta são registradas em `query_errors` sem impedir o envio dos demais dados.

O script por hora continua o mesmo. Ele permanece leve e não coleta públicos, locais ou URLs.

## 4. Conferência

1. Acesse `/api/health` e confirme a versão 2.1.0.
2. Entre no dashboard.
3. Alterne Dark/Light e USD/BRL/EUR.
4. Abra uma campanha e teste uma nota diária.
5. Faça um Lançamento Rápido em uma data de teste.
6. Confirme no Supabase a linha em `campaign_manual_daily`.
7. Execute o script novamente e confirme que o lançamento manual permanece.

## Observações

- A conversão cambial é apenas visual; o valor original não é alterado.
- A AwesomeAPI pode devolver uma cotação em cache por aproximadamente um minuto quando usada sem chave.
- Dados de funil que ainda não possuem tracker aparecem como zero somente quando houve lançamento manual; o sistema não inventa eventos.
