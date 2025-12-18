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

// Wrapper para queries com timeout otimizado
async function queryWithTimeout(pool, sql, params, timeoutMs = 4000) {  // Reduzido de 8s -> 4s
  const queryPromise = pool.query(sql, params);
  const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB query timeout')), timeoutMs));
  return await withRetries(() => Promise.race([queryPromise, timeoutPromise]));
}

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token',
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

    // Busca todos os parceiros com dados completos (incluindo senha temporária fixa)
    const [parceiros] = await queryWithTimeout(pool,
      'SELECT id, nome, cpf, email, COALESCE(senha_temp, SUBSTRING(MD5(CONCAT(id, nome)), 1, 8)) as senha, whatsapp, razao_social, cnpj, cidade, uf, resp_tipo_cnpj, resp_perfil_clientes, resp_volume_indicacoes, created_at FROM parceiros ORDER BY created_at DESC'
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

    // Busca dados completos do parceiro (incluindo senha temporária fixa)
    const [rows] = await queryWithTimeout(pool,
      'SELECT id, nome, cpf, email, COALESCE(senha_temp, SUBSTRING(MD5(CONCAT(id, nome)), 1, 8)) as senha, whatsapp, razao_social, cnpj, cidade, uf, resp_tipo_cnpj, resp_perfil_clientes, resp_volume_indicacoes, created_at FROM parceiros WHERE id = ? LIMIT 1', 
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

    // Validação campos obrigatórios básicos se fornecidos
    if (nome_completo && !nome_completo.trim()) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: 'Nome completo não pode estar vazio' })
      };
    }

    if (email && !/\S+@\S+\.\S+/.test(email)) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ message: 'E-mail inválido' })
      };
    }

    // Cálculo de Elegibilidade (Regra de Negócio Backend)
    // Regra: Reprova se não tiver CNPJ (NAO) OU não tiver clientes (NAO)
    let status_elegibilidade = 'pre-aprovado';
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

// GET /admin/pre-cadastros - Listar todos os pré-cadastros
exports.adminListPreCadastros = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const { adminId } = event.queryStringParameters || {};

    if (!adminId) {
      return { 
        statusCode: 401, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Admin ID é obrigatório' }) 
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
        body: JSON.stringify({ message: 'Admin não autorizado' }) 
      };
    }

    // Busca todos os pré-cadastros
    const [preCadastros] = await queryWithTimeout(pool,
      `SELECT id, resp_tipo_cnpj, resp_perfil_clientes, resp_volume_indicacoes, status_elegibilidade,
              nome_completo, cpf, whatsapp, email, razao_social, cnpj, cidade, uf,
              aceite_termos, aceite_lgpd, data_cadastro 
       FROM pre_cadastros 
       ORDER BY data_cadastro DESC`
    );

    // Atualizar pré-cadastros sem status_elegibilidade
    for (const pre of preCadastros) {
      if (!pre.status_elegibilidade) {
        const novoStatus = (pre.resp_tipo_cnpj === 'NAO' || pre.resp_perfil_clientes === 'NAO') 
          ? 'reprovado' 
          : 'pre-aprovado';
          
        await queryWithTimeout(pool,
          'UPDATE pre_cadastros SET status_elegibilidade = ? WHERE id = ?',
          [novoStatus, pre.id]
        );
        
        pre.status_elegibilidade = novoStatus; // Atualizar no objeto retornado
      }
    }

    // Conta total de pré-cadastros
    const [countResult] = await queryWithTimeout(pool,
      'SELECT COUNT(*) as total FROM pre_cadastros'
    );

    const total = countResult[0].total;

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ preCadastros, total }) 
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR PRÉ-CADASTROS:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// GET /admin/pre-cadastros/{id} - Ver dados de um pré-cadastro específico
exports.adminGetPreCadastro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const { adminId, preCadastroId } = event.queryStringParameters || {};

    if (!adminId || !preCadastroId) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Admin ID e Pré-cadastro ID são obrigatórios' }) 
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
        body: JSON.stringify({ message: 'Admin não autorizado' }) 
      };
    }

    // Busca dados completos do pré-cadastro
    const [rows] = await queryWithTimeout(pool,
      `SELECT id, resp_tipo_cnpj, resp_perfil_clientes, resp_volume_indicacoes, status_elegibilidade,
              nome_completo, cpf, whatsapp, email, razao_social, cnpj, cidade, uf,
              aceite_termos, aceite_lgpd, data_cadastro 
       FROM pre_cadastros 
       WHERE id = ? LIMIT 1`, 
      [preCadastroId]
    );

    if (rows.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Pré-cadastro não encontrado' }) 
      };
    }

    const preCadastro = rows[0];

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ preCadastro }) 
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR PRÉ-CADASTRO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// PUT /admin/pre-cadastros/{id}/status - Atualizar status de um pré-cadastro
exports.adminUpdatePreCadastroStatus = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { adminId, preCadastroId, status } = body;

    if (!adminId || !preCadastroId || !status) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Admin ID, Pré-cadastro ID e status são obrigatórios' }) 
      };
    }

    // Validar status permitidos - "aprovado" só através da transformação em parceiro
    const statusPermitidos = ['reprovado'];
    if (!statusPermitidos.includes(status)) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Status inválido. Use apenas: reprovado. Para aprovar, use o endpoint de transformação em parceiro.' }) 
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
        body: JSON.stringify({ message: 'Admin não autorizado' }) 
      };
    }

    // Verifica se o pré-cadastro existe
    const [preCheck] = await queryWithTimeout(pool,
      'SELECT id FROM pre_cadastros WHERE id = ? LIMIT 1', 
      [preCadastroId]
    );

    if (preCheck.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Pré-cadastro não encontrado' }) 
      };
    }

    // Atualiza o status
    await queryWithTimeout(pool,
      'UPDATE pre_cadastros SET status_elegibilidade = ? WHERE id = ?', 
      [status, preCadastroId]
    );

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Status atualizado com sucesso' }) 
    };

  } catch (err) {
    console.error('ERRO AO ATUALIZAR STATUS:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};

// POST /admin/pre-cadastros/transformar-parceiro - Transformar pré-cadastro em parceiro
exports.adminTransformarParceiro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { adminId, preCadastroId } = body;

    if (!adminId || !preCadastroId) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'adminId e preCadastroId são obrigatórios' }) 
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

    // Busca o pré-cadastro
    const [preCadastroCheck] = await queryWithTimeout(pool,
      `SELECT id, nome_completo, cpf, email, resp_tipo_cnpj, resp_perfil_clientes, 
              resp_volume_indicacoes, whatsapp, razao_social, cnpj, cidade, uf,
              aceite_termos, aceite_lgpd 
       FROM pre_cadastros WHERE id = ? LIMIT 1`, 
      [preCadastroId]
    );

    if (preCadastroCheck.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Pré-cadastro não encontrado' }) 
      };
    }

    const preCadastro = preCadastroCheck[0];

    // Validação de dados obrigatórios para virar parceiro
    if (!preCadastro.nome_completo || !preCadastro.cpf || !preCadastro.email) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ 
          message: 'Pré-cadastro incompleto. Nome, CPF e email são obrigatórios para virar parceiro.' 
        }) 
      };
    }

    // Verifica se já existe parceiro com esse CPF ou email
    const [existingParceiro] = await queryWithTimeout(pool,
      'SELECT id, nome, cpf, email FROM parceiros WHERE cpf = ? OR email = ? LIMIT 1', 
      [preCadastro.cpf, preCadastro.email]
    );

    if (existingParceiro.length > 0) {
      const existing = existingParceiro[0];
      return { 
        statusCode: 409, 
        headers: jsonHeaders, 
        body: JSON.stringify({ 
          message: `Já existe um parceiro com este ${existing.cpf === preCadastro.cpf ? 'CPF' : 'email'}. Parceiro: ${existing.nome}`,
          details: {
            existingParceiroId: existing.id,
            field: existing.cpf === preCadastro.cpf ? 'cpf' : 'email'
          }
        }) 
      };
    }

    // Gerar senha temporária
    const senhaTemp = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(senhaTemp, 10);

    // Inserir na tabela parceiros (incluindo senha temporária original)
    const insertSql = `
      INSERT INTO parceiros (
        nome, cpf, email, senha, resp_tipo_cnpj, resp_perfil_clientes, 
        resp_volume_indicacoes, whatsapp, razao_social, cnpj, cidade, uf,
        aceite_termos, aceite_lgpd, status_elegibilidade, senha_temp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insertValues = [
      preCadastro.nome_completo,
      preCadastro.cpf,
      preCadastro.email,
      hash,
      preCadastro.resp_tipo_cnpj,
      preCadastro.resp_perfil_clientes,
      preCadastro.resp_volume_indicacoes,
      preCadastro.whatsapp,
      preCadastro.razao_social,
      preCadastro.cnpj,
      preCadastro.cidade,
      preCadastro.uf,
      preCadastro.aceite_termos,
      preCadastro.aceite_lgpd,
      'aprovado',
      senhaTemp  // Senha temporária original para visualização do admin
    ];

    const [insertResult] = await queryWithTimeout(pool, insertSql, insertValues);

    // Remover da tabela pre_cadastros
    await queryWithTimeout(pool,
      'DELETE FROM pre_cadastros WHERE id = ?', 
      [preCadastroId]
    );

    return { 
      statusCode: 200, 
      headers: jsonHeaders, 
      body: JSON.stringify({ 
        message: 'Pré-cadastro transformado em parceiro com sucesso',
        parceiroId: insertResult.insertId,
        senhaTemporaria: senhaTemp
      }) 
    };

  } catch (err) {
    console.error('ERRO AO TRANSFORMAR EM PARCEIRO:', err);
    return { 
      statusCode: 500, 
      headers: jsonHeaders, 
      body: JSON.stringify({ message: 'Erro interno', error: err.message }) 
    };
  }
};