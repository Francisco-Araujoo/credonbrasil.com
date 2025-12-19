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

// =============================================
// HANDLERS PARA OPERAÇÕES
// =============================================

// POST /operacoes/criar - Criar nova operação
exports.criarOperacao = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  
  let sql, values; // Declarar no escopo da função

  try {
    console.log('=== DEBUG CRIAR OPERAÇÃO ===');
    console.log('Event:', JSON.stringify(event, null, 2));
    
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    console.log('Dados recebidos (Criar Operação):', JSON.stringify(body, null, 2));

    const {
      parceiro_id,
      // Etapa 1 - Tipo
      tipo_operacao,
      // Etapa 2 - Dados do Cliente
      cliente_nome_completo,
      cliente_cpf,
      cliente_telefone,
      cliente_email,
      cliente_cep,
      cliente_endereco,
      cliente_renda_faixa,
      cliente_profissao,
      cliente_restricoes,
      cliente_casado,
      cliente_conjuge_nome,
      cliente_conjuge_cpf,
      // Etapa 3 - Dados do Imóvel
      imovel_tipo,
      imovel_cidade,
      imovel_uf,
      imovel_endereco_completo,
      imovel_valor_estimado,
      imovel_situacao,
      imovel_titular,
      // Etapa 4 - Dados da Operação
      operacao_valor_imovel,
      operacao_valor_pretendido,
      operacao_finalidade,
      operacao_prazo_desejado,
      // Etapa 5 - Documentos
      docs_cliente_rg_cnh,
      docs_cliente_cpf,
      docs_cliente_renda,
      docs_cliente_residencia,
      docs_cliente_extratos,
      docs_cliente_conjuge,
      docs_imovel_matricula,
      docs_imovel_iptu,
      docs_imovel_escritura,
      docs_imovel_fotos,
      docs_outros,
      // Controles
      status_operacao,
      aceite_lgpd,
      aceite_declaracao
    } = body;

    // Validação obrigatória - parceiro_id deve existir
    if (!parceiro_id) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campo obrigatório: parceiro_id' }) 
      };
    }

    // Validação obrigatória - tipo_operacao deve existir  
    if (!tipo_operacao) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campo obrigatório: tipo_operacao' }) 
      };
    }

    const pool = getPool();

    // Verificar se o parceiro existe (CRÍTICO para foreign key)
    console.log('Verificando parceiro_id:', parceiro_id);
    const [parceiroCheck] = await queryWithTimeout(pool,
      'SELECT id FROM parceiros WHERE id = ? LIMIT 1', 
      [parceiro_id]
    );
    
    console.log('Resultado verificação parceiro:', parceiroCheck);

    if (parceiroCheck.length === 0) {
      console.log('ERRO: Parceiro não encontrado');
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Usuário não encontrado. Faça login novamente.' }) 
      };
    }
    
    console.log('✓ Parceiro validado, criando operação...');

    // Usar valores padrão para campos NOT NULL se não preenchidos
    const cliente_nome_final = cliente_nome_completo || 'Nome não informado';
    const cliente_cpf_final = cliente_cpf || '000.000.000-00';
    const cliente_telefone_final = cliente_telefone || '(00) 0000-0000';
    const cliente_email_final = cliente_email || 'email@exemplo.com';

    // Sanitizações para campos ENUM e formatos específicos
    const allowedTipoOperacao = new Set(['home_equity', 'aquisicao_imovel']);
    const allowedImovelTipo = new Set(['casa', 'apartamento', 'comercial', 'terreno']);
    const allowedImovelSituacao = new Set(['quitado', 'financiado']);
    const allowedRestricoes = new Set(['sim', 'nao', 'nao_sei']);

    const tipo_operacao_final = allowedTipoOperacao.has((tipo_operacao || '').toLowerCase())
      ? (tipo_operacao || '').toLowerCase()
      : 'home_equity';

    const imovel_tipo_final = allowedImovelTipo.has((imovel_tipo || '').toLowerCase())
      ? (imovel_tipo || '').toLowerCase()
      : 'casa';

    const imovel_situacao_final = allowedImovelSituacao.has((imovel_situacao || '').toLowerCase())
      ? (imovel_situacao || '').toLowerCase()
      : 'quitado';

    const cliente_restricoes_final = allowedRestricoes.has((cliente_restricoes || '').toLowerCase())
      ? (cliente_restricoes || '').toLowerCase()
      : null;

    const imovel_uf_final = ((imovel_uf || 'SP').toString().toUpperCase().replace(/[^A-Z]/g, '')).slice(0,2) || 'SP';

    // Normalização robusta de valores monetários que podem vir formatados (ex.: R$ 1.234,56)
    function normalizeMoney(val, fallback) {
      if (val === null || val === undefined) return fallback;
      if (typeof val === 'number' && isFinite(val)) return val;
      let s = String(val).trim();
      if (!s) return fallback;
      // mantém apenas dígitos, vírgula e ponto
      s = s.replace(/[^0-9.,-]/g, '');
      // se tiver vírgula, assume que a vírgula é separador decimal
      if (s.includes(',')) {
        // remove pontos de milhar
        s = s.replace(/\./g, '');
        // troca vírgula por ponto
        s = s.replace(/,/g, '.');
      }
      const n = parseFloat(s);
      return isFinite(n) && !isNaN(n) ? n : fallback;
    }

    function normalizeBool(val, fallback = 0) {
      const truthy = new Set(['1','true','on','yes','sim',1,true]);
      const falsy = new Set(['0','false','off','no','nao','não',0,false]);
      if (truthy.has(val)) return 1;
      if (typeof val === 'string' && truthy.has(val.toLowerCase())) return 1;
      if (falsy.has(val)) return 0;
      if (typeof val === 'string' && falsy.has(val.toLowerCase())) return 0;
      return fallback;
    }

    // Contar campos corretamente: 40 campos
    sql = `
      INSERT INTO operacoes (
        parceiro_id, tipo_operacao,
        cliente_nome_completo, cliente_cpf, cliente_telefone, cliente_email, 
        cliente_cep, cliente_endereco, cliente_renda_faixa, cliente_profissao, 
        cliente_restricoes, cliente_casado, cliente_conjuge_nome, cliente_conjuge_cpf,
        imovel_tipo, imovel_cidade, imovel_uf, imovel_endereco_completo, 
        imovel_valor_estimado, imovel_situacao, imovel_titular,
        operacao_valor_imovel, operacao_valor_pretendido, operacao_finalidade, operacao_prazo_desejado,
        docs_cliente_rg_cnh, docs_cliente_cpf, docs_cliente_renda, docs_cliente_residencia, 
        docs_cliente_extratos, docs_cliente_conjuge, docs_imovel_matricula, docs_imovel_iptu, 
        docs_imovel_escritura, docs_imovel_fotos, docs_outros,
        status_operacao, aceite_lgpd, aceite_declaracao, enviado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Função para processar documentos Base64
    function processBase64Documents(docsField) {
      if (!docsField) return null;
      
      try {
        // Se já é uma string, retorna como está
        if (typeof docsField === 'string') {
          return docsField;
        }
        
        // Se é um array de objetos com base64
        if (Array.isArray(docsField)) {
          return JSON.stringify(docsField.map(doc => ({
            name: doc.name || 'arquivo',
            type: doc.type || 'application/octet-stream',
            size: doc.size || 0,
            base64: doc.base64 || '',
            compressedSize: doc.compressedSize || 0
          })));
        }
        
        // Se é um objeto único
        if (docsField.base64) {
          return JSON.stringify([{
            name: docsField.name || 'arquivo',
            type: docsField.type || 'application/octet-stream',
            size: docsField.size || 0,
            base64: docsField.base64 || '',
            compressedSize: docsField.compressedSize || 0
          }]);
        }
        
        return JSON.stringify(docsField);
      } catch (error) {
        console.error('Erro ao processar documento Base64:', error);
        return null;
      }
    }

    const imovel_valor_estimado_final = normalizeMoney(imovel_valor_estimado, 100000);
    const operacao_valor_imovel_final = normalizeMoney(operacao_valor_imovel, 100000);
    const operacao_valor_pretendido_final = normalizeMoney(operacao_valor_pretendido, 50000);

    // Processar todos os documentos Base64
    const docs_cliente_rg_cnh_final = processBase64Documents(docs_cliente_rg_cnh);
    const docs_cliente_cpf_final = processBase64Documents(docs_cliente_cpf);
    const docs_cliente_renda_final = processBase64Documents(docs_cliente_renda);
    const docs_cliente_residencia_final = processBase64Documents(docs_cliente_residencia);
    const docs_cliente_extratos_final = processBase64Documents(docs_cliente_extratos);
    const docs_cliente_conjuge_final = processBase64Documents(docs_cliente_conjuge);
    const docs_imovel_matricula_final = processBase64Documents(docs_imovel_matricula);
    const docs_imovel_iptu_final = processBase64Documents(docs_imovel_iptu);
    const docs_imovel_escritura_final = processBase64Documents(docs_imovel_escritura);
    const docs_imovel_fotos_final = processBase64Documents(docs_imovel_fotos);
    const docs_outros_final = processBase64Documents(docs_outros);

    values = [
      parceiro_id, tipo_operacao_final,
      cliente_nome_final, cliente_cpf_final, cliente_telefone_final, cliente_email_final,
      cliente_cep || null, cliente_endereco || null, cliente_renda_faixa || null, cliente_profissao || null,
      cliente_restricoes_final, normalizeBool(cliente_casado, 0), cliente_conjuge_nome || null, cliente_conjuge_cpf || null,
      imovel_tipo_final, imovel_cidade || 'Não informada', imovel_uf_final, imovel_endereco_completo || 'Endereço não informado',
      imovel_valor_estimado_final, imovel_situacao_final, imovel_titular || 'Titular não informado',
      operacao_valor_imovel_final, operacao_valor_pretendido_final, 
      operacao_finalidade || 'Finalidade não informada', operacao_prazo_desejado || '12 meses',
      docs_cliente_rg_cnh_final, docs_cliente_cpf_final, docs_cliente_renda_final, docs_cliente_residencia_final,
      docs_cliente_extratos_final, docs_cliente_conjuge_final, docs_imovel_matricula_final, docs_imovel_iptu_final,
      docs_imovel_escritura_final, docs_imovel_fotos_final, docs_outros_final,
      status_operacao || 'rascunho', normalizeBool(aceite_lgpd, 0), normalizeBool(aceite_declaracao, 0),
      status_operacao === 'recebida' ? new Date() : null
    ];

    console.log('SQL preparado:', sql);
    console.log('Values preparados (total:', values.length, '):', values);

    const [result] = await queryWithTimeout(pool, sql, values);

    console.log('✓ Operação criada com ID:', result.insertId);

    return {
      statusCode: 201,
      headers: jsonHeaders,
      body: JSON.stringify({ 
        message: 'Operação criada com sucesso', 
        id: result.insertId,
        status: status_operacao || 'rascunho'
      })
    };

  } catch (err) {
    console.error('=== ERRO DETALHADO ===');
    console.error('Tipo:', err.constructor.name);
    console.error('Message:', err.message);
    console.error('Code:', err.code);
    console.error('Errno:', err.errno);
    console.error('SQL State:', err.sqlState);
    console.error('SQL Message:', err.sqlMessage);
    console.error('Stack completo:', err.stack);
    if (sql) console.error('SQL que falhou:', sql);
    if (values) console.error('Valores que falharam:', values);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ 
        message: 'Erro interno', 
        error: err.message, 
        details: err.sqlMessage || err.toString() 
      })
    };
  }
};

// GET /operacoes/parceiro - Listar operações de um parceiro
exports.listarOperacoesParceiro = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const { parceiro_id } = event.queryStringParameters || {};

    if (!parceiro_id) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Parâmetro obrigatório: parceiro_id' }) 
      };
    }

    const pool = getPool();

    // Verifica se o parceiro existe
    const [parceiroCheck] = await queryWithTimeout(pool,
      'SELECT id FROM parceiros WHERE id = ? LIMIT 1', 
      [parceiro_id]
    );

    if (parceiroCheck.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Parceiro não encontrado' }) 
      };
    }

    // Busca todas as operações do parceiro
    const [operacoes] = await queryWithTimeout(pool,
      `SELECT id, tipo_operacao, cliente_nome_completo, cliente_cpf, 
              operacao_valor_pretendido, status_operacao, created_at, enviado_em, updated_at
       FROM operacoes 
       WHERE parceiro_id = ? 
       ORDER BY created_at DESC`,
      [parceiro_id]
    );

    // Calcula estatísticas
    const [stats] = await queryWithTimeout(pool,
      `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN status_operacao = 'rascunho' THEN 1 END) as rascunho,
         COUNT(CASE WHEN status_operacao = 'recebida' THEN 1 END) as recebida,
         COUNT(CASE WHEN status_operacao = 'em_analise' THEN 1 END) as em_analise,
         COUNT(CASE WHEN status_operacao = 'aprovada' THEN 1 END) as aprovada,
         COUNT(CASE WHEN status_operacao = 'recusada' THEN 1 END) as recusada
       FROM operacoes 
       WHERE parceiro_id = ?`,
      [parceiro_id]
    );

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ 
        operacoes,
        estatisticas: stats[0]
      })
    };

  } catch (err) {
    console.error('ERRO AO LISTAR OPERAÇÕES:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Erro interno', error: err.message })
    };
  }
};

// GET /operacoes/buscar - Buscar operação específica
exports.buscarOperacao = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const { operacao_id, parceiro_id } = event.queryStringParameters || {};

    if (!operacao_id || !parceiro_id) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Parâmetros obrigatórios: operacao_id, parceiro_id' }) 
      };
    }

    const pool = getPool();

    // Busca a operação específica
    const [rows] = await queryWithTimeout(pool,
      'SELECT * FROM operacoes WHERE id = ? AND parceiro_id = ? LIMIT 1',
      [operacao_id, parceiro_id]
    );

    if (rows.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Operação não encontrada' }) 
      };
    }

    const operacao = rows[0];

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ operacao })
    };

  } catch (err) {
    console.error('ERRO AO BUSCAR OPERAÇÃO:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Erro interno', error: err.message })
    };
  }
};

// PUT /operacoes/atualizar - Atualizar operação
exports.atualizarOperacao = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { operacao_id, parceiro_id, ...updateData } = body;

    if (!operacao_id || !parceiro_id) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campos obrigatórios: operacao_id, parceiro_id' }) 
      };
    }

    const pool = getPool();

    // Verifica se a operação existe e pertence ao parceiro
    const [operacaoCheck] = await queryWithTimeout(pool,
      'SELECT id, status_operacao FROM operacoes WHERE id = ? AND parceiro_id = ? LIMIT 1',
      [operacao_id, parceiro_id]
    );

    if (operacaoCheck.length === 0) {
      return { 
        statusCode: 404, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Operação não encontrada' }) 
      };
    }

    // Constrói a query de update dinamicamente
    const updateFields = [];
    const updateValues = [];

    const allowedFields = [
      'tipo_operacao', 'cliente_nome_completo', 'cliente_cpf', 'cliente_telefone', 'cliente_email',
      'cliente_cep', 'cliente_endereco', 'cliente_renda_faixa', 'cliente_profissao', 'cliente_restricoes',
      'cliente_casado', 'cliente_conjuge_nome', 'cliente_conjuge_cpf', 'imovel_tipo', 'imovel_cidade',
      'imovel_uf', 'imovel_endereco_completo', 'imovel_valor_estimado', 'imovel_situacao', 'imovel_titular',
      'operacao_valor_imovel', 'operacao_valor_pretendido', 'operacao_finalidade', 'operacao_prazo_desejado',
      'docs_cliente_rg_cnh', 'docs_cliente_cpf', 'docs_cliente_renda', 'docs_cliente_residencia',
      'docs_cliente_extratos', 'docs_cliente_conjuge', 'docs_imovel_matricula', 'docs_imovel_iptu',
      'docs_imovel_escritura', 'docs_imovel_fotos', 'docs_outros', 'status_operacao', 'aceite_lgpd', 'aceite_declaracao'
    ];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field.includes('valor_')) {
          updateValues.push(parseFloat(updateData[field]));
        } else if (field === 'cliente_casado' || field === 'aceite_lgpd' || field === 'aceite_declaracao') {
          updateValues.push(updateData[field] ? 1 : 0);
        } else {
          updateValues.push(updateData[field]);
        }
      }
    }

    // Se o status foi alterado para 'recebida', define enviado_em
    if (updateData.status_operacao === 'recebida') {
      updateFields.push('enviado_em = ?');
      updateValues.push(new Date());
    }

    if (updateFields.length === 0) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Nenhum campo válido para atualizar' }) 
      };
    }

    updateValues.push(operacao_id, parceiro_id);

    const sql = `UPDATE operacoes SET ${updateFields.join(', ')} WHERE id = ? AND parceiro_id = ?`;
    
    await queryWithTimeout(pool, sql, updateValues);

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Operação atualizada com sucesso' })
    };

  } catch (err) {
    console.error('ERRO AO ATUALIZAR OPERAÇÃO:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Erro interno', error: err.message })
    };
  }
};

// POST /operacoes/upload-documento - Upload de documento (placeholder)
exports.uploadDocumento = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: jsonHeaders, body: '' };
    }

    // Por enquanto, apenas retorna sucesso simulado
    // Em uma implementação real, você salvaria o arquivo no S3 ou outro storage
    const body = event.body ? JSON.parse(event.body) : {};
    const { operacao_id, parceiro_id, tipo_documento, arquivo_nome } = body;

    if (!operacao_id || !parceiro_id || !tipo_documento) {
      return { 
        statusCode: 400, 
        headers: jsonHeaders, 
        body: JSON.stringify({ message: 'Campos obrigatórios: operacao_id, parceiro_id, tipo_documento' }) 
      };
    }

    // Simula URL do arquivo salvo
    const arquivo_url = `https://storage.exemplo.com/operacoes/${operacao_id}/${tipo_documento}_${Date.now()}.pdf`;

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ 
        message: 'Documento enviado com sucesso',
        arquivo_url,
        tipo_documento
      })
    };

  } catch (err) {
    console.error('ERRO AO FAZER UPLOAD:', err);
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ message: 'Erro interno', error: err.message })
    };
  }
};

// =============================================
// ADMIN - OPERAÇÕES
// =============================================

// GET /admin/operacoes - Listar todas as operações (admin)
exports.adminListOperacoes = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const { adminId, status } = event.queryStringParameters || {};

    if (!adminId) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'ID do admin é obrigatório' }) };
    }

    const pool = getPool();

    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool, 'SELECT id FROM admin WHERE id = ? LIMIT 1', [adminId]);
    if (adminCheck.length === 0) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ message: 'Acesso negado' }) };
    }

    // Monta a query com filtro opcional de status
    const where = [];
    const params = [];
    if (status) {
      where.push('o.status_operacao = ?');
      params.push(status);
    }

    const sql = `
      SELECT 
        o.id, o.tipo_operacao, o.cliente_nome_completo, o.cliente_cpf,
        o.operacao_valor_pretendido, o.status_operacao, o.created_at, o.enviado_em, o.updated_at,
        p.id AS parceiro_id, p.nome AS parceiro_nome, p.email AS parceiro_email
      FROM operacoes o
      JOIN parceiros p ON p.id = o.parceiro_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY o.created_at DESC
    `;

    const [rows] = await queryWithTimeout(pool, sql, params);

    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ operacoes: rows }) };
  } catch (err) {
    console.error('ERRO AO LISTAR OPERAÇÕES (ADMIN):', err);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: 'Erro interno', error: err.message }) };
  }
};

// GET /admin/operacoes/view - Detalhar operação (admin)
exports.adminGetOperacao = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const { adminId, operacaoId } = event.queryStringParameters || {};

    if (!adminId || !operacaoId) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'Parâmetros obrigatórios: adminId, operacaoId' }) };
    }

    const pool = getPool();

    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool, 'SELECT id FROM admin WHERE id = ? LIMIT 1', [adminId]);
    if (adminCheck.length === 0) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ message: 'Acesso negado' }) };
    }

    const sql = `
      SELECT o.*, p.nome AS parceiro_nome, p.email AS parceiro_email
      FROM operacoes o
      JOIN parceiros p ON p.id = o.parceiro_id
      WHERE o.id = ?
      LIMIT 1
    `;
    const [rows] = await queryWithTimeout(pool, sql, [operacaoId]);

    if (rows.length === 0) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ message: 'Operação não encontrada' }) };
    }

    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ operacao: rows[0] }) };
  } catch (err) {
    console.error('ERRO AO BUSCAR OPERAÇÃO (ADMIN):', err);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: 'Erro interno', error: err.message }) };
  }
};

// PUT /admin/operacoes/status - Atualizar status da operação (admin)
exports.adminUpdateOperacaoStatus = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: jsonHeaders };

    const body = event.body ? JSON.parse(event.body) : {};
    const { adminId, operacaoId, status_operacao } = body;

    if (!adminId || !operacaoId || !status_operacao) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'Campos obrigatórios: adminId, operacaoId, status_operacao' }) };
    }

    const allowed = new Set(['rascunho','recebida','em_analise','pendencia_docs','aprovada','recusada','cancelada']);
    if (!allowed.has(String(status_operacao).toLowerCase())) {
      return { statusCode: 400, headers: jsonHeaders, body: JSON.stringify({ message: 'Status inválido' }) };
    }

    const pool = getPool();

    // Verifica se o admin existe
    const [adminCheck] = await queryWithTimeout(pool, 'SELECT id FROM admin WHERE id = ? LIMIT 1', [adminId]);
    if (adminCheck.length === 0) {
      return { statusCode: 403, headers: jsonHeaders, body: JSON.stringify({ message: 'Acesso negado' }) };
    }

    // Verifica se a operação existe
    const [opCheck] = await queryWithTimeout(pool, 'SELECT id FROM operacoes WHERE id = ? LIMIT 1', [operacaoId]);
    if (opCheck.length === 0) {
      return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ message: 'Operação não encontrada' }) };
    }

    // Atualiza status; se for 'recebida', define enviado_em
    const updates = ['status_operacao = ?'];
    const params = [String(status_operacao).toLowerCase()];
    if (String(status_operacao).toLowerCase() === 'recebida') {
      updates.push('enviado_em = ?');
      params.push(new Date());
    }
    params.push(operacaoId);

    const sql = `UPDATE operacoes SET ${updates.join(', ')} WHERE id = ?`;
    await queryWithTimeout(pool, sql, params);

    return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ message: 'Status atualizado com sucesso' }) };
  } catch (err) {
    console.error('ERRO AO ATUALIZAR STATUS (ADMIN):', err);
    return { statusCode: 500, headers: jsonHeaders, body: JSON.stringify({ message: 'Erro interno', error: err.message }) };
  }
};