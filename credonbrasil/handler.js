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
      'SELECT id, nome, email, cpf, senha, created_at FROM parceiros WHERE cpf = ? OR email = ? LIMIT 1', 
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

// GET /parceiros/me - Buscar dados do usuário autenticado
exports.getUserData = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const { userId } = event.queryStringParameters || {};

    if (!userId) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'ID do usuário é obrigatório' }) 
      };
    }

    const pool = getPool();
    const [rows] = await queryWithTimeout(pool,
      'SELECT id, nome, email, cpf, created_at FROM parceiros WHERE id = ? LIMIT 1', 
      [userId]
    );

    if (rows.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Usuário não encontrado' }) 
      };
    }

    const user = rows[0];

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ user }) 
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR DADOS DO USUÁRIO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// POST /admin/cadastro
exports.adminCadastro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    console.log('Dados recebidos (Admin Cadastro):', body); 

    const { nome, email, senha } = body;

    if (!nome || !email || !senha) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campos obrigatórios ausentes' }) 
      };
    }

    const pool = getPool();

    // Verifica duplicação
    const [existing] = await queryWithTimeout(pool,
      'SELECT id FROM admin WHERE email = ? LIMIT 1', 
      [email]
    );

    if (existing.length > 0) {
      return { 
        statusCode: 409, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'E-mail já cadastrado' }) 
      };
    }

    // Hash da senha e insert
    const hash = await bcrypt.hash(senha, 10);
    const [result] = await queryWithTimeout(pool,
      'INSERT INTO admin (nome, email, senha) VALUES (?, ?, ?)', 
      [nome, email, hash]
    );

    return { 
      statusCode: 201, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Admin cadastrado com sucesso', id: result.insertId }) 
    };

  } catch (err) {
    console.error('ERRO CRÍTICO NO CADASTRO ADMIN:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno no servidor', error: err.message }) 
    };
  }
};

// POST /admin/login
exports.adminLogin = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    const { email, senha } = body;

    if (!email || !senha) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'Informe e-mail e senha' }) };
    }

    const pool = getPool();
    const [rows] = await queryWithTimeout(pool,
      'SELECT id, nome, email, senha, created_at FROM admin WHERE email = ? LIMIT 1', 
      [email]
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
      body: JSON.stringify({ message: 'Login efetuado com sucesso', user, type: 'admin' }) 
    };

  } catch (err) {
    console.error('ERRO NO LOGIN ADMIN:', err);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: 'Erro interno', error: err.message }) };
  }
};

// GET /admin/parceiros - Listar todos os parceiros
exports.adminListParceiros = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const { adminId } = event.queryStringParameters || {};

    if (!adminId) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'ID do admin é obrigatório' }) 
      };
    }

    const pool = getPool();
    
    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool,
      'SELECT id FROM admin WHERE id = ? LIMIT 1', 
      [adminId]
    );

    if (adminCheck.length === 0) {
      return { 
        statusCode: 403, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Acesso negado' }) 
      };
    }

    // Busca todos os parceiros (sem senha e CPF)
    const [parceiros] = await queryWithTimeout(pool,
      'SELECT id, nome, email, created_at FROM parceiros ORDER BY created_at DESC'
    );

    // Conta total de parceiros
    const [countResult] = await queryWithTimeout(pool,
      'SELECT COUNT(*) as total FROM parceiros'
    );

    const total = countResult[0].total;

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ parceiros, total }) 
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR PARCEIROS:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// GET /admin/parceiros/{id} - Ver dados de um parceiro específico
exports.adminGetParceiro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const { adminId, parceiroId } = event.queryStringParameters || {};

    if (!adminId || !parceiroId) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'ID do admin e do parceiro são obrigatórios' }) 
      };
    }

    const pool = getPool();
    
    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool,
      'SELECT id FROM admin WHERE id = ? LIMIT 1', 
      [adminId]
    );

    if (adminCheck.length === 0) {
      return { 
        statusCode: 403, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Acesso negado' }) 
      };
    }

    // Busca dados do parceiro (sem senha e CPF)
    const [rows] = await queryWithTimeout(pool,
      'SELECT id, nome, email, created_at FROM parceiros WHERE id = ? LIMIT 1', 
      [parceiroId]
    );

    if (rows.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Parceiro não encontrado' }) 
      };
    }

    const parceiro = rows[0];

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ parceiro }) 
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR PARCEIRO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// PUT /admin/parceiros/{id}/senha - Alterar senha de um parceiro
exports.adminUpdateParceiroSenha = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    const { adminId, parceiroId, novaSenha } = body;

    if (!adminId || !parceiroId || !novaSenha) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'ID do admin, do parceiro e nova senha são obrigatórios' }) 
      };
    }

    const pool = getPool();
    
    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool,
      'SELECT id FROM admin WHERE id = ? LIMIT 1', 
      [adminId]
    );

    if (adminCheck.length === 0) {
      return { 
        statusCode: 403, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Acesso negado' }) 
      };
    }

    // Verifica se o parceiro existe
    const [parceiroCheck] = await queryWithTimeout(pool,
      'SELECT id FROM parceiros WHERE id = ? LIMIT 1', 
      [parceiroId]
    );

    if (parceiroCheck.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Parceiro não encontrado' }) 
      };
    }

    // Hash da nova senha e atualiza
    const hash = await bcrypt.hash(novaSenha, 10);
    await queryWithTimeout(pool,
      'UPDATE parceiros SET senha = ? WHERE id = ?', 
      [hash, parceiroId]
    );

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Senha do parceiro alterada com sucesso' }) 
    };

  } catch (err) {
    console.error('ERRO AO ALTERAR SENHA DO PARCEIRO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

exports.hello = async (event) => {
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ message: 'API Online', time: new Date().toISOString() }),
  };
};

// POST /parceiros/pre-cadastro
exports.preCadastro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    console.log('Dados recebidos (Pré-Cadastro):', body);

    const {
      resp_tipo_cnpj,
      resp_perfil_clientes,
      resp_volume_indicacoes,
      nome_completo,
      cpf,
      whatsapp,
      email,
      razao_social,
      cnpj,
      cidade,
      uf,
      aceite_termos,
      aceite_lgpd
    } = body;

    // Validação Básica da Fase 1
    if (!resp_tipo_cnpj || !resp_perfil_clientes || !resp_volume_indicacoes) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: 'Dados de triagem incompletos' })
      };
    }

    // Cálculo de Elegibilidade (Regra de Negócio Backend)
    // Regra: Reprova se não tiver CNPJ (NAO) OU não tiver clientes (NAO)
    let status_elegibilidade = 'aprovado';
    if (resp_tipo_cnpj === 'NAO' || resp_perfil_clientes === 'NAO') {
      status_elegibilidade = 'reprovado';
    }

    const pool = getPool();

    // Verifica se já existe pré-cadastro com esse CPF ou CNPJ (se fornecidos)
    if (cpf || cnpj) {
        const queryCheck = `SELECT id FROM pre_cadastros WHERE (cpf = ? AND cpf IS NOT NULL) OR (cnpj = ? AND cnpj IS NOT NULL) LIMIT 1`;
        const [existing] = await queryWithTimeout(pool, queryCheck, [cpf || '', cnpj || '']);
        
        if (existing.length > 0) {
             return {
                statusCode: 409,
                headers: jsonHeaders,
                body: JSON.stringify({ message: 'CPF ou CNPJ já possui uma solicitação em análise.' })
             };
        }
    }

    const sql = `
      INSERT INTO pre_cadastros (
        resp_tipo_cnpj, resp_perfil_clientes, resp_volume_indicacoes, status_elegibilidade,
        nome_completo, cpf, whatsapp, email,
        razao_social, cnpj, cidade, uf,
        aceite_termos, aceite_lgpd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      resp_tipo_cnpj,
      resp_perfil_clientes,
      resp_volume_indicacoes,
      status_elegibilidade,
      nome_completo || null,
      cpf || null,
      whatsapp || null,
      email || null,
      razao_social || null,
      cnpj || null,
      cidade || null,
      uf || null,
      aceite_termos ? 1 : 0,
      aceite_lgpd ? 1 : 0
    ];

    const [result] = await queryWithTimeout(pool, sql, values);

    return {
      statusCode: 201,
      headers: jsonHeaders,
      body: JSON.stringify({ 
          message: 'Pré-cadastro realizado com sucesso', 
          id: result.insertId,
          status: status_elegibilidade 
      })
    };

  } catch (err) {
    console.error('ERRO NO PRE-CADASTRO:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Erro interno', error: err.message })
    };
  }
};