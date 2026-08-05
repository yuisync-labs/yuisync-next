# YuiSync - CRM Completo (Supabase + OpenAI + React)

YuiSync é um sistema de CRM moderno e robusto que utiliza React no frontend, Node.js no backend, Supabase como banco de dados e autenticação, e integração com OpenAI para funcionalidades de IA.

## 🚀 Guia de Inicialização

Siga os passos abaixo para configurar o projeto localmente a partir do GitHub.

### 1. Pré-requisitos

Certifique-se de ter instalado em sua máquina:
- Node.js 22.x, conforme `.nvmrc` e `package.json`;
- npm;
- uma conta no Supabase para executar o ambiente legado de desenvolvimento.

### 2. Clonar o Repositório

```bash
git clone https://github.com/yuisync-labs/yuisync-next.git
cd yuisync-next
```

### 3. Selecionar o Node correto

Com um gerenciador compatível com `.nvmrc`:

```bash
nvm use
```

Confirme:

```bash
node --version
```

A versão deve pertencer à linha `22.x`.

### 4. Instalar Dependências

Para reproduzir exatamente o lockfile:

```bash
npm ci
```

Use `npm install` apenas quando estiver alterando dependências de forma intencional.

### 5. Configurar Variáveis de Ambiente

O projeto utiliza um arquivo `.env` para gerenciar chaves de API e URLs. Copie o arquivo de exemplo e preencha com credenciais exclusivas de desenvolvimento ou homologação:

```bash
cp .env.example .env
```

Variáveis essenciais do ambiente legado:
- **Supabase**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- **OpenAI**: `OPENAI_API_KEY`;
- **WhatsApp**: configurações da Cloud API somente quando o fluxo for utilizado.

Nunca use credenciais pessoais ou de produção no YuiSync Next.

### 6. Configurar o Banco de Dados legado

O diretório `database/` contém os scripts SQL da implementação atual e o diretório `supabase/` contém migrations, funções e validações adicionais.

A ordem de execução deve seguir a documentação de migrações existente. Não execute todos os arquivos indiscriminadamente e não altere migrations históricas.

### 7. Executar o Projeto

Para iniciar o servidor backend e o frontend simultaneamente:

```bash
npm start
```

Isso executa:
- backend Node/Express na porta configurada por `API_PORT`;
- frontend Vite na porta de desenvolvimento disponível.

---

## 🛠️ Verificações locais

Antes de enviar mudanças:

```bash
npm run typecheck
npm run test
npm run test:petbot
npm run test:luna
npm run test:transactions
npm run build
npm run audit:ci
```

Os testes de isolamento de tenant e E2E dependem de credenciais exclusivas de homologação.

## 📂 Estrutura atual

- `src/`: frontend React;
- `server/`: backend Node/Express;
- `api/` e `serverless/`: entradas serverless legadas;
- `database/` e `supabase/`: esquema, migrations, funções e testes SQL;
- `scripts/`: automação, avaliação e manutenção;
- `test/`: testes unitários, de caracterização e regressão;
- `docs/migration/`: plano da modernização Cloudflare-first;
- `docs/adr/`: decisões arquiteturais.

## 🌩️ Modernização Cloudflare-first

O YuiSync Next está sendo modernizado de forma incremental. O sistema atual permanece como referência, enquanto contratos, domínios e adapters são estabilizados antes da migração do runtime e dos serviços.

Consulte:

- `docs/migration/README.md`;
- `docs/migration/MIGRATION_PLAN.md`;
- `docs/migration/RISK_REGISTER.md`;
- `docs/adr/0001-cloudflare-first-modular-monolith.md`.

## 📄 Licença

Este projeto está sob a licença ISC.
