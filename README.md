# Mais Justiça

> Plataforma de análise e monitoramento de exposição de dados pessoais em fontes públicas, com classificação de risco e foco em conformidade com a LGPD.

<div align="center">
  <img src="assets/hero-preview.png" alt="Mais Justiça Preview" width="100%">
</div>

---

## 🚀 Sobre o Projeto

O **Mais Justiça** é uma aplicação web que identifica possíveis exposições de dados pessoais na internet (como nome e CPF), analisando resultados em múltiplas fontes públicas.

O sistema atua como uma ferramenta de **monitoramento e orientação estratégica de privacidade digital**, ajudando usuários a entender onde seus dados podem estar sendo exibidos.

---

## ⚙️ Funcionalidades

* 🔍 Varredura de dados em múltiplas fontes públicas
* 🧠 Classificação de risco (baixo, médio, alto)
* 🔐 Validação real de CPF com algoritmo oficial brasileiro
* 🔢 Formatação automática de CPF (000.000.000-00)
* 📊 Cálculo de nível de exposição (0–100)
* 🧾 Organização por categorias (jurídico, fiscal, social, etc.)
* 🔗 Análise de links informados manualmente
* 🗑️ Direcionamento para solicitação de remoção
* 📈 Interface moderna com dashboard visual
* 🕘 Histórico de ações realizadas

---

## 🧱 Tecnologias

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js + Express
* **API externa:** SerpAPI
* **Ambiente:** Local + Ngrok

---

## ▶️ Como usar

### 🔹 Execução Simples (Frontend)

1. Abra `index.html` usando Live Server no VS Code
2. Digite um nome completo
3. (Opcional) Digite um CPF válido
4. Clique em **"Iniciar Varredura"**
5. Visualize os resultados diretamente na tela

---

### 🔹 Execução com Backend Real

1. Instale Node.js
2. Instale as dependências:

```bash
npm install
```

3. Configure o `.env`:

```env
SERPAPI_KEY=SUA_CHAVE_AQUI
PORT=3000
```

4. Inicie o servidor:

```bash
node server.js
```

5. Abra o frontend (`index.html`)

---

## 🌐 Acesso externo (compartilhar com sócio)

```bash
ngrok http 3000
```

Use o link gerado no frontend para acessar de qualquer lugar.

---

## 📡 Rotas da API

* `GET /health` → Status do servidor
* `POST /scan` → Varredura principal
* `POST /scan-exposure` → Análise de exposição
* `POST /scan-processes` → Foco em processos
* `POST /scan-full` → Análise completa

---

## 📁 Estrutura do Projeto

* `index.html` → Interface principal
* `scanner.html` → Tela de análise
* `script-home.js` → Lógica da landing
* `script-scanner.js` → Lógica da varredura
* `style.css` → Estilos visuais
* `server.js` → Backend Node.js
* `package.json` → Dependências

---

## 🔐 Validação de CPF

O sistema utiliza o algoritmo oficial brasileiro:

* Verificação de formato (11 dígitos)
* Cálculo dos dígitos verificadores
* Bloqueio de sequências inválidas (ex: 111.111.111-11)

---

## 📊 Funcionamento da Análise

A aplicação:

* Busca dados públicos indexados
* Analisa relevância e confiança
* Classifica nível de risco
* Organiza resultados por categoria
* Gera um score de exposição

---

## ⚠️ Aviso Importante

Este sistema:

* ❌ NÃO confirma processos judiciais
* ❌ NÃO acessa dados sigilosos
* ❌ NÃO substitui consultas oficiais

✔ Ele identifica **possíveis exposições públicas na internet**

---

## 🔒 Segurança

* Validação de entrada no frontend e backend
* Sanitização de dados (anti XSS)
* Uso de variáveis de ambiente (`.env`)
* Timeout de requisições externas
* Tratamento de erros com `try/catch`

---

## 🧠 Melhorias Futuras

* Integração com mais fontes oficiais
* Geração de relatórios em PDF
* Sistema de login e área do cliente
* Cache de resultados
* Deploy em produção (cloud)
* Automação de solicitações LGPD

---

## 👨‍💻 Autor

**Gustavo Henrique**
Projeto focado em privacidade digital e reputação online.

---

## 📄 Licença

Uso educacional e experimental.
