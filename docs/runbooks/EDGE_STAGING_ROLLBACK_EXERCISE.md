# Ensaio de rollback do Edge staging

## Escopo

- Worker: `yuisync-edge-api-staging`
- URL: `https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev`
- versão estável anterior a restaurar: `357d5aed-6ea6-49ae-bde0-f48dba74ed60`
- versão ativa antes do ensaio: `6998c7b9-edcd-4c21-a298-30ee861e56ea`
- ambiente: somente staging

## Procedimento

1. restaurar a versão estável anterior;
2. executar smoke tests de health, readiness, 404 sanitizado e correlação;
3. republicar o commit atual da PR3;
4. repetir os smoke tests;
5. registrar os resultados na PR3.

## Restrições

- nenhum tráfego produtivo;
- nenhum dado real;
- nenhum domínio customizado;
- nenhum banco ou binding externo.
