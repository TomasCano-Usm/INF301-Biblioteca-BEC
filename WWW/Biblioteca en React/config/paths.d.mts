export function resolvePaths(
  projectRoot: string,
  env?: Partial<Record<'BEC_RUNTIME' | 'BEC_CA_CERT' | 'BEC_BACKEND_URL', string>>,
): {
  projectRoot: string
  workspaceRoot: string
  runtime: string
  bootstrapFile: string
  pfxFile: string
  caFile: string
  target: URL
}
