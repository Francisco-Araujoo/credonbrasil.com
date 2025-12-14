const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// Configurações lidas das variáveis de ambiente injetadas pelo serverless.yml
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONN_LIMIT || '5', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '100', 10),
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10)
};

let pool;

function getPool() {
  if (!pool) {
    // Se por algum motivo as variáveis falharem, loga o erro mas tenta criar
    if (!dbConfig.host || !dbConfig.user || !dbConfig.password) {
      console.error('ERRO: Variáveis de ambiente de banco de dados não carregadas corretamente.');
    }
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Função de retry para erros transitórios de conexão
async function withRetries(fn, attempts = 2, initialDelay = 200) {
  let lastErr;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTransient = /ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ER_LOCK_DEADLOCK|PROTOCOL_CONNECTION_LOST/i.test(err.message || '');
      if (!isTransient) break;
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`Transient DB error, retrying in ${delay}ms:`, err.message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Wrapper para queries com timeout
async function queryWithTimeout(pool, sql, params, timeoutMs = 8000) {
  const queryPromise = pool.query(sql, params);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB query timeout')), timeoutMs));
  return await withRetries(() => Promise.race([queryPromise, timeoutPromise]));
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true,
};

// --- HANDLERS ---

// POST /parceiros/cadastro
exports.cadastro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    console.log('Dados recebidos (Cadastro):', body); 

    const { nome, cpf, email, senha } = body;

    if (!nome || !cpf || !email || !senha) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campos obrigatórios ausentes' }) 
      };
    }

    const pool = getPool();

    // Verifica duplicação
    const [existing] = await queryWithTimeout(pool,
      'SELECT id FROM parceiros WHERE cpf = ? OR email = ? LIMIT 1', 
      [cpf, email]
    );

    if (existing.length > 0) {
      return { 
        statusCode: 409, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'CPF ou e-mail já cadastrado' }) 
      };
    }

    // Hash da senha e insert
    const hash = await bcrypt.hash(senha, 10);
    const [result] = await queryWithTimeout(pool,
      'INSERT INTO parceiros (nome, cpf, email, senha) VALUES (?, ?, ?, ?)', 
      [nome, cpf, email, hash]
    );

    return { 
      statusCode: 201, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Parceiro cadastrado com sucesso', id: result.insertId }) 
    };

  } catch (err) {
    console.error('ERRO CRÍTICO NO CADASTRO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno no servidor', error: err.message }) 
    };
  }
};

// POST /parceiros/login
exports.login = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    const { cpf, email, senha } = body;

    if ((!cpf && !email) || !senha) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'Informe CPF ou e-mail e senha' }) };
    }

    const pool = getPool();
    const [rows] = await queryWithTimeout(pool,
      'SELECT id, nome, email, cpf, senha FROM parceiros WHERE cpf = ? OR email = ? LIMIT 1', 
      [cpf || '', email || '']
    );

    if (rows.length === 0) {
      return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: 'Credenciais inválidas' }) };
    }

    const user = rows[0];
    const valid = await bcrypt.compare(senha, user.senha);

    if (!valid) {
      return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ message: 'Credenciais inválidas' }) };
    }

    delete user.senha; 

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Login efetuado com sucesso', user }) 
    };

  } catch (err) {
    console.error('ERRO NO LOGIN:', err);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: 'Erro interno', error: err.message }) };
  }
};

exports.hello = async (event) => {
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ message: 'API Online', time: new Date().toISOString() }),
  };
};