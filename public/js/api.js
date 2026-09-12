// 接口封装：统一错误处理与 401/428 拦截
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const listeners = { unauthorized: [], setupRequired: [] };
export function onUnauthorized(fn) {
  listeners.unauthorized.push(fn);
}
export function onSetupRequired(fn) {
  listeners.setupRequired.push(fn);
}

function emit(name, payload) {
  for (const fn of listeners[name]) fn(payload);
}

async function request(method, path, body, options = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(0, 'NETWORK', '网络连接失败，请检查服务是否正常');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const code = data?.error?.code || `HTTP_${res.status}`;
    const message = data?.error?.message || `请求失败（${res.status}）`;
    if (res.status === 401 && !options.silent) emit('unauthorized');
    if (code === 'SETUP_REQUIRED' && !options.silent) emit('setupRequired');
    throw new ApiError(res.status, code, message);
  }
  return data ?? {};
}

export const api = {
  get: (p, o) => request('GET', p, undefined, o),
  post: (p, b, o) => request('POST', p, b ?? {}, o),
  put: (p, b, o) => request('PUT', p, b ?? {}, o),
  patch: (p, b, o) => request('PATCH', p, b ?? {}, o),
  del: (p, o) => request('DELETE', p, undefined, o),

  setupStatus: () => request('GET', '/api/setup/status', undefined, { silent: true }),
  createAdmin: (payload) => request('POST', '/api/setup/admin', payload, { silent: true }),
  login: (payload) => request('POST', '/api/auth/login', payload, { silent: true }),
  logout: () => request('POST', '/api/auth/logout', {}, { silent: true }),
  me: () => request('GET', '/api/auth/me', undefined, { silent: true }),
};
