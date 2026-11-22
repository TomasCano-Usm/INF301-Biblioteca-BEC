import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { resolvePaths } from '../config/paths.mjs'

const root = path.join(os.tmpdir(), 'clon con espacios y tildes á', 'WWW', 'Biblioteca en React')
const backend = path.join(path.dirname(root), 'entrega_caso16')

test('encuentra el backend hermano y Oracle en cualquier ubicación de WWW', () => {
  const result = resolvePaths(root)
  assert.equal(result.projectRoot, root)
  assert.equal(result.workspaceRoot, path.dirname(root))
  assert.equal(result.runtime, path.join(backend, '.runtime-docker-oracle'))
  assert.equal(result.caFile, path.join(result.runtime, 'setup', 'ca.crt'))
  assert.equal(result.pfxFile, path.join(result.runtime, 'gateway', 'server.p12'))
  assert.equal(result.target.origin, 'https://localhost:8443')
})

test('resuelve runtime y CA relativos al proyecto, no a la terminal', () => {
  const result = resolvePaths(root, {
    BEC_RUNTIME: '../entrega_caso16/.runtime',
    BEC_CA_CERT: '../entrega_caso16/.runtime/setup/ca.crt',
  })
  assert.equal(result.runtime, path.join(backend, '.runtime'))
  assert.equal(result.caFile, path.join(backend, '.runtime', 'setup', 'ca.crt'))
})

test('admite rutas absolutas explícitas sin anteponer WWW otra vez', () => {
  const runtime = path.join(os.tmpdir(), 'runtime externo')
  const caFile = path.join(os.tmpdir(), 'ca externa.crt')
  const result = resolvePaths(root, { BEC_RUNTIME: runtime, BEC_CA_CERT: caFile })
  assert.equal(result.runtime, runtime)
  assert.equal(result.caFile, caFile)
})

test('cambiar el directorio de trabajo no cambia las rutas resueltas', () => {
  const before = process.cwd()
  const expected = resolvePaths(root, { BEC_RUNTIME: '../entrega_caso16/.runtime' })
  try {
    process.chdir(os.tmpdir())
    assert.deepEqual(resolvePaths(root, { BEC_RUNTIME: '../entrega_caso16/.runtime' }), expected)
  } finally {
    process.chdir(before)
  }
})

test('tolera espacios y tildes al convertir la URL de vite.config.ts', () => {
  const configUrl = pathToFileURL(path.join(root, 'vite.config.ts'))
  assert.equal(resolvePaths(fileURLToPath(new URL('.', configUrl))).projectRoot, root)
})

test('el backend sigue exigiendo HTTPS y nunca acepta credenciales en la URL', () => {
  for (const url of ['http://localhost:8443', 'https://usuario@localhost:8443', 'https://usuario:clave@localhost:8443']) {
    assert.throws(() => resolvePaths(root, { BEC_BACKEND_URL: url }), /HTTPS.*credenciales/)
  }
  assert.equal(resolvePaths(root, { BEC_BACKEND_URL: 'https://localhost:9443' }).target.origin, 'https://localhost:9443')
})
