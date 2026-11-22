import path from 'node:path'

// Solo Node/Vite: las rutas locales y certificados nunca se importan en src/.
export function resolvePaths(projectRoot, env = {}) {
  const root = path.resolve(projectRoot)
  const runtime = path.resolve(root, env.BEC_RUNTIME || '../entrega_caso16/.runtime-docker-oracle')
  const target = new URL(env.BEC_BACKEND_URL || 'https://localhost:8443')
  if (target.protocol !== 'https:' || target.username || target.password) {
    throw new Error('BEC_BACKEND_URL debe ser HTTPS y no debe incluir credenciales.')
  }
  return {
    projectRoot: root,
    workspaceRoot: path.dirname(root),
    runtime,
    bootstrapFile: path.join(runtime, 'gateway/bootstrap.json'),
    pfxFile: path.join(runtime, 'gateway/server.p12'),
    caFile: env.BEC_CA_CERT ? path.resolve(root, env.BEC_CA_CERT) : path.join(runtime, 'setup/ca.crt'),
    target,
  }
}
