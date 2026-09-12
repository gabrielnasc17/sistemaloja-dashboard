const PROP_BASE_URL = 'API_BASE_URL';
const PROP_TOKEN = 'DASHBOARD_TOKEN';
const PROP_ADMIN_EMAIL = 'ADMIN_EMAIL';

const SESSION_PREFIX = 'SESSION_';
const USER_PREFIX = 'USER_';
const APPROVAL_PREFIX = 'APPROVAL_';
const SESSION_SECONDS = 21600; // 6 horas
const APPROVAL_SECONDS = 86400; // 24 horas

function doGet(e) {
  e = e || {};
  const action = e.parameter && e.parameter.action;
  const token = e.parameter && e.parameter.token;

  if (action && token && (action === 'approve' || action === 'reject')) {
    return processApprovalAction_(action, token);
  }

  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Dashboard • SistemaLoja')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();

  const baseUrl = (props.getProperty(PROP_BASE_URL) || '').replace(/\/+$/, '');
  const apiToken = props.getProperty(PROP_TOKEN) || '';
  const adminEmail = (props.getProperty(PROP_ADMIN_EMAIL) || '').trim();

  if (!baseUrl || !apiToken || !adminEmail) {
    throw new Error(
      'Configure API_BASE_URL, DASHBOARD_TOKEN e ADMIN_EMAIL nas Propriedades do script.'
    );
  }

  return { baseUrl, apiToken, adminEmail };
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hex_(bytes) {
  return bytes.map(function(b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sha256_(texto) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    texto,
    Utilities.Charset.UTF_8
  );
  return hex_(bytes);
}

function userKey_(email) {
  return USER_PREFIX + sha256_(normalizeEmail_(email));
}

function hashPassword_(password, salt) {
  return sha256_(salt + '|' + String(password || ''));
}

function createSecureToken_() {
  return sha256_(
    Utilities.getUuid() +
    '|' +
    Utilities.getUuid() +
    '|' +
    new Date().getTime()
  );
}

function safeParse_(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function getUserByEmail_(email) {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty(userKey_(email));

  return safeParse_(raw);
}

function saveUser_(user) {
  PropertiesService
    .getScriptProperties()
    .setProperty(userKey_(user.email), JSON.stringify(user));
}

function registerUser(nome, email, password) {
  nome = String(nome || '').trim();
  email = normalizeEmail_(email);
  password = String(password || '');

  if (nome.length < 2) {
    return { ok: false, message: 'Informe seu nome.' };
  }

  if (!isValidEmail_(email)) {
    return { ok: false, message: 'Informe um e-mail válido.' };
  }

  if (password.length < 8) {
    return {
      ok: false,
      message: 'A senha precisa ter pelo menos 8 caracteres.'
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const existente = getUserByEmail_(email);

    if (existente) {
      if (existente.status === 'approved') {
        return {
          ok: false,
          message: 'Este e-mail já possui uma conta aprovada. Faça login.'
        };
      }

      if (existente.status === 'pending') {
        return {
          ok: false,
          message: 'Este cadastro já está aguardando aprovação.'
        };
      }
    }

    const salt = createSecureToken_().substring(0, 32);
    const approvalToken = createSecureToken_();

    const user = {
      name: nome,
      email: email,
      salt: salt,
      passwordHash: hashPassword_(password, salt),
      status: 'pending',
      createdAt: new Date().toISOString(),
      approvedAt: null
    };

    saveUser_(user);

    PropertiesService
      .getScriptProperties()
      .setProperty(
        APPROVAL_PREFIX + approvalToken,
        JSON.stringify({
          email: email,
          createdAt: new Date().toISOString()
        })
      );

    sendApprovalEmail_(user, approvalToken);

    return {
      ok: true,
      message:
        'Cadastro enviado. Aguarde a aprovação do administrador e tente entrar novamente mais tarde.'
    };

  } finally {
    lock.releaseLock();
  }
}

function sendApprovalEmail_(user, approvalToken) {
  const cfg = getConfig_();
  const baseUrl = ScriptApp.getService().getUrl();

  if (!baseUrl) {
    throw new Error(
      'Implante o projeto como Aplicativo da Web antes de receber cadastros.'
    );
  }

  const approveUrl =
    baseUrl +
    '?action=approve&token=' +
    encodeURIComponent(approvalToken);

  const rejectUrl =
    baseUrl +
    '?action=reject&token=' +
    encodeURIComponent(approvalToken);

  const subject =
    'Novo cadastro pendente - Dashboard SistemaLoja';

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto">
      <h2>Novo pedido de acesso</h2>

      <p>Uma pessoa solicitou acesso ao Dashboard SistemaLoja.</p>

      <div style="background:#f4f6f8;padding:16px;border-radius:10px;margin:18px 0">
        <p style="margin:0 0 8px"><strong>Nome:</strong> ${escapeHtmlEmail_(user.name)}</p>
        <p style="margin:0"><strong>E-mail:</strong> ${escapeHtmlEmail_(user.email)}</p>
      </div>

      <p>Escolha uma opção:</p>

      <p style="margin:22px 0">
        <a href="${approveUrl}"
           style="display:inline-block;background:#1677ff;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;margin-right:8px">
          APROVAR
        </a>

        <a href="${rejectUrl}"
           style="display:inline-block;background:#d9363e;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">
          REJEITAR
        </a>
      </p>

      <p style="font-size:12px;color:#777">
        O usuário não receberá e-mail. A decisão será aplicada apenas ao acesso do dashboard.
      </p>
    </div>
  `;

  MailApp.sendEmail({
    to: cfg.adminEmail,
    subject: subject,
    htmlBody: htmlBody,
    body:
      'Novo pedido de acesso ao Dashboard SistemaLoja.\n\n' +
      'Nome: ' + user.name + '\n' +
      'E-mail: ' + user.email + '\n\n' +
      'Aprovar: ' + approveUrl + '\n' +
      'Rejeitar: ' + rejectUrl
  });
}

function escapeHtmlEmail_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function processApprovalAction_(action, token) {
  const props = PropertiesService.getScriptProperties();
  const key = APPROVAL_PREFIX + token;
  const data = safeParse_(props.getProperty(key));

  if (!data || !data.email) {
    return approvalPage_(
      'Link inválido ou já utilizado',
      'Este link de aprovação não está mais disponível.',
      false
    );
  }

  const createdAt = new Date(data.createdAt).getTime();
  const ageSeconds = (new Date().getTime() - createdAt) / 1000;

  if (ageSeconds > APPROVAL_SECONDS) {
    props.deleteProperty(key);

    return approvalPage_(
      'Link expirado',
      'O pedido de aprovação expirou. Peça para a pessoa se cadastrar novamente.',
      false
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const user = getUserByEmail_(data.email);

    if (!user) {
      props.deleteProperty(key);

      return approvalPage_(
        'Usuário não encontrado',
        'O cadastro associado a este link não existe mais.',
        false
      );
    }

    if (action === 'approve') {
      user.status = 'approved';
      user.approvedAt = new Date().toISOString();
      saveUser_(user);
      props.deleteProperty(key);

      return approvalPage_(
        'Acesso aprovado',
        user.name + ' agora pode entrar no dashboard com o e-mail e a senha cadastrados.',
        true
      );
    }

    user.status = 'rejected';
    user.rejectedAt = new Date().toISOString();
    saveUser_(user);
    props.deleteProperty(key);

    return approvalPage_(
      'Cadastro rejeitado',
      'O acesso de ' + user.name + ' foi rejeitado.',
      false
    );

  } finally {
    lock.releaseLock();
  }
}

function approvalPage_(title, message, success) {
  const color = success ? '#1677ff' : '#d9363e';

  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>${escapeHtmlEmail_(title)}</title>
      </head>

      <body style="margin:0;background:#0b1628;color:#fff;font-family:Arial,sans-serif">
        <div style="min-height:100vh;display:grid;place-items:center;padding:20px">
          <div style="max-width:520px;width:100%;background:#101c30;border:1px solid rgba(255,255,255,.1);padding:30px;border-radius:18px;text-align:center">

            <div style="width:54px;height:54px;margin:0 auto 18px;border-radius:50%;background:${color};display:grid;place-items:center;font-size:26px">
              ${success ? '✓' : '!'}
            </div>

            <h2>${escapeHtmlEmail_(title)}</h2>
            <p style="color:#a9b6c9">${escapeHtmlEmail_(message)}</p>

            <p style="margin-top:24px">
              <a href="${ScriptApp.getService().getUrl()}"
                 style="color:#fff;background:#4f8cff;padding:11px 16px;border-radius:9px;text-decoration:none">
                Abrir dashboard
              </a>
            </p>

          </div>
        </div>
      </body>
    </html>
  `);
}

function loginUser(email, password) {
  email = normalizeEmail_(email);
  password = String(password || '');

  const user = getUserByEmail_(email);

  if (!user) {
    Utilities.sleep(400);
    return {
      ok: false,
      message: 'E-mail ou senha inválidos.'
    };
  }

  if (user.status === 'pending') {
    return {
      ok: false,
      message:
        'Seu cadastro ainda está aguardando aprovação do administrador.'
    };
  }

  if (user.status !== 'approved') {
    return {
      ok: false,
      message:
        'Este cadastro não possui autorização de acesso.'
    };
  }

  const candidateHash =
    hashPassword_(password, user.salt);

  if (candidateHash !== user.passwordHash) {
    Utilities.sleep(400);

    return {
      ok: false,
      message: 'E-mail ou senha inválidos.'
    };
  }

  const sessionToken =
    createSecureToken_();

  CacheService
    .getScriptCache()
    .put(
      SESSION_PREFIX + sessionToken,
      JSON.stringify({
        email: user.email,
        name: user.name
      }),
      SESSION_SECONDS
    );

  return {
    ok: true,
    token: sessionToken,
    user: {
      name: user.name,
      email: user.email
    }
  };
}

function validateSession(sessionToken) {
  if (!sessionToken) {
    return { ok: false };
  }

  const raw = CacheService
    .getScriptCache()
    .get(SESSION_PREFIX + sessionToken);

  const session = safeParse_(raw);

  if (!session) {
    return { ok: false };
  }

  return {
    ok: true,
    user: session
  };
}

function logoutUser(sessionToken) {
  if (sessionToken) {
    CacheService
      .getScriptCache()
      .remove(SESSION_PREFIX + sessionToken);
  }

  return true;
}

function requireSession_(sessionToken) {
  const validation =
    validateSession(sessionToken);

  if (!validation.ok) {
    throw new Error(
      'Sessão expirada ou inválida. Faça login novamente.'
    );
  }

  return validation.user;
}

function apiGet_(path) {
  const cfg = getConfig_();

  const response =
    UrlFetchApp.fetch(cfg.baseUrl + path, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + cfg.apiToken,
        Accept: 'application/json'
      },
      muteHttpExceptions: true
    });

  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(
      'Erro da API (' + status + '): ' + body
    );
  }

  return JSON.parse(body);
}

function montarQuery_(filtros, extras) {
  filtros = filtros || {};
  extras = extras || {};

  const pares = [];

  function addParametro_(chave, valor) {
    if (
      valor === null ||
      valor === undefined ||
      valor === ''
    ) {
      return;
    }

    pares.push(
      encodeURIComponent(chave) +
      '=' +
      encodeURIComponent(String(valor))
    );
  }

  addParametro_(
    'dias',
    Number(filtros.dias) || 30
  );

  if (filtros.formaPagamento) {
    addParametro_(
      'forma_pagamento',
      filtros.formaPagamento
    );
  }

  if (filtros.produtoId) {
    addParametro_(
      'produto_id',
      filtros.produtoId
    );
  }

  if (filtros.data) {
    addParametro_(
      'data',
      filtros.data
    );
  }

  Object.keys(extras).forEach(function(chave) {
    addParametro_(
      chave,
      extras[chave]
    );
  });

  return pares.length
    ? '?' + pares.join('&')
    : '';
}

function getDashboardData(sessionToken, filtros) {
  requireSession_(sessionToken);

  filtros = filtros || { dias: 30 };

  return {
    resumo: apiGet_(
      '/api/dashboard/resumo' +
      montarQuery_(filtros)
    ),

    vendasDia: apiGet_(
      '/api/dashboard/vendas-dia' +
      montarQuery_(filtros)
    ),

    pagamentos: apiGet_(
      '/api/dashboard/formas-pagamento' +
      montarQuery_(filtros)
    ),

    produtos: apiGet_(
      '/api/dashboard/produtos-mais-vendidos' +
      montarQuery_(filtros, {
        limite: 10
      })
    ),

    estoqueBaixo: apiGet_(
      '/api/dashboard/estoque-baixo' +
      montarQuery_(filtros, {
        limite: 5
      })
    ),

    filtros: filtros,
    atualizadoEm:
      new Date().toISOString()
  };
}
