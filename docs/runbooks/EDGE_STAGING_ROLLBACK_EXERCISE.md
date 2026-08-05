# Ensaio de rollback do Edge staging

## Escopo

- Worker: `yuisync-edge-api-staging`
- URL: `https://yuisync-edge-api-staging.gabrielboalento3004.workers.dev`
- versão estável anterior restaurada: `357d5aed-6ea6-49ae-bde0-f48dba74ed60`
- versão ativa antes do ensaio: `6998c7b9-edcd-4c21-a298-30ee861e56ea`
- versão ativa após restauração final: `42c12bba-4017-45a1-b216-faa14e32dd03`
- commit restaurado ao final: `7aad6f228fe4ede42634ce16aad44e1e439b7335`
- ambiente: somente staging

## Resultado

1. a versão anterior foi restaurada com sucesso;
2. health, readiness, 404 sanitizado e correlação passaram após o rollback;
3. o commit atual da PR3 foi republicado;
4. os mesmos smoke tests passaram após a restauração final;
5. Workers Logs permaneceu habilitado no painel Cloudflare;
6. o painel registrou zero erros durante o ensaio.

## Restrições preservadas

- nenhum tráfego produtivo;
- nenhum dado real;
- nenhum domínio customizado;
- nenhum banco ou binding externo.
