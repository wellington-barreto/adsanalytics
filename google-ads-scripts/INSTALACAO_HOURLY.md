# AdsPilot Hourly V1.0

Este é um segundo script. Não substitua o script diário V1.2.1.

## Instalação

1. Na MCC, entre em **Ferramentas → Ações em massa → Scripts**.
2. Crie um novo script com o nome `AdsPilot Hourly`.
3. Cole o conteúdo de `adspilot-hourly-v1.0.js`.
4. Preencha `WEBHOOK_SECRET` com o mesmo valor usado no Railway.
5. Autorize e execute uma vez em Preview.
6. Confirme no log: `Sucesso: 26, parciais: 0, erros: 0`.
7. Agende com frequência **A cada hora**.

## Separação das rotinas

- `AdsPilot Hourly`: a cada hora; somente campanhas e métricas de hoje.
- `AdsPilot V1.2.1`: diariamente; últimos três dias, termos, segmentos e alterações.

O script horário faz upsert no registro do dia atual. Ele não duplica dados e
não remove os termos, segmentos ou alterações carregados pela rotina diária.

