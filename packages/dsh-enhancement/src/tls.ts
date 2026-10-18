/**
 * dsh-enhancement · HTTPS 证书管理。
 *
 * 四种模式：
 * - off：纯 HTTP
 * - uploaded：用户上传证书链 + 私钥
 * - ca：用户上传 CA 证书 + CA 私钥，由插件为当前监听地址签发 leaf
 * - selfsigned：插件生成本地 CA + leaf，CA 证书可下载安装到手机
 *
 * 私钥只写入 $DSH_HOME/dsh-enhancement/tls/（仅当前用户可读），不进入日志/响应。
 */
import { createPrivateKey, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import forge from 'node-forge'
import { atomicWrite, TLS_FILES, type GatewayConfig, type HttpsMode } from './state.js'

export interface TlsCertInfo {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  fingerprint256: string
  subjectAltName: string
}

export interface TlsStatus {
  mode: HttpsMode
  hostnames: string[]
  cert: TlsCertInfo | null
  caAvailable: boolean
  caInfo: TlsCertInfo | null
  uploadedCaAvailable: boolean
  uploadedCaInfo: TlsCertInfo | null
}

export interface TlsMaterial {
  cert: string
  key: string
  caCert?: string
}

function randomSerial(): string {
  const bytes = forge.random.getBytesSync(16)
  return forge.util.bytesToHex(bytes)
}

function generateKeyPair(): Promise<forge.pki.rsa.KeyPair> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 2 }, (error, keypair) => {
      if (error) reject(error)
      else resolve(keypair)
    })
  })
}

type AltName = { type: number; ip?: string; value?: string }

function altNames(hosts: string[]): AltName[] {
  return hosts.map((host) => (isIP(host) ? { type: 7, ip: host } : { type: 2, value: host }))
}

async function createCa(): Promise<{ certPem: string; keyPem: string }> {
  const keys = await generateKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000)
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
  const subject = [
    { name: 'commonName', value: 'DSH Enhancement Local CA' },
    { name: 'organizationName', value: 'dsh-enhancement' },
  ]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

async function createLeaf(caCertPem: string, caKeyPem: string, hosts: string[]): Promise<{ certPem: string; keyPem: string }> {
  const caCert = forge.pki.certificateFromPem(caCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)
  const keys = await generateKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000)
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000)
  const primary = hosts[0] ?? 'dsh-enhancement'
  cert.setSubject([{ name: 'commonName', value: primary }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: altNames(hosts) },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) }
}

function readIf(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function hostsFor(config: GatewayConfig, webHost: string): string[] {
  const list = [
    config.bindHost === '0.0.0.0' || config.bindHost === '::' ? webHost : config.bindHost,
    webHost,
    'localhost',
    '127.0.0.1',
    '::1',
    ...config.httpsHostnames,
  ]
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of list) {
    const host = item.trim()
    if (!host || host === '0.0.0.0' || host === '::') continue
    const key = host.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(host)
  }
  return result
}

export function tlsHosts(config: GatewayConfig, webHost: string): string[] {
  return hostsFor(config, webHost)
}

export function certInfo(path: string): TlsCertInfo | null {
  const pem = readIf(path)
  if (!pem) return null
  try {
    const x509 = new X509Certificate(pem)
    return {
      subject: x509.subject,
      issuer: x509.issuer,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      fingerprint256: x509.fingerprint256,
      subjectAltName: x509.subjectAltName ?? '',
    }
  } catch {
    return null
  }
}

export function tlsStatus(config: GatewayConfig, webHost: string): TlsStatus {
  return {
    mode: config.httpsMode,
    hostnames: hostsFor(config, webHost),
    cert: certInfo(TLS_FILES.cert),
    caAvailable: existsSync(TLS_FILES.caCert),
    caInfo: certInfo(TLS_FILES.caCert),
    uploadedCaAvailable: existsSync(TLS_FILES.uploadedCaCert) && existsSync(TLS_FILES.uploadedCaKey),
    uploadedCaInfo: certInfo(TLS_FILES.uploadedCaCert),
  }
}

function assertCovered(cert: X509Certificate, hosts: string[]): string[] {
  const missing: string[] = []
  for (const host of hosts) {
    const ok = isIP(host) ? cert.checkIP(host) !== undefined : cert.checkHost(host) !== undefined
    if (!ok) missing.push(host)
  }
  if (missing.length === hosts.length) {
    throw new Error(`证书 SAN 不覆盖任何监听地址（缺少 ${hosts.join(', ')}）`)
  }
  return missing
}

function validateCertKey(certPem: string, keyPem: string, hosts: string[]): string[] {
  const cert = new X509Certificate(certPem)
  const key = createPrivateKey(keyPem)
  if (!cert.checkPrivateKey(key)) throw new Error('证书与私钥不匹配')
  if (cert.validToDate.getTime() <= Date.now()) throw new Error(`证书已过期（${cert.validTo}）`)
  if (cert.validFromDate.getTime() > Date.now() + 60_000) throw new Error('证书尚未生效')
  return assertCovered(cert, hosts)
}

function validateCa(caCertPem: string, caKeyPem: string): X509Certificate {
  const ca = new X509Certificate(caCertPem)
  if (!ca.ca) throw new Error('上传的证书不是 CA（basicConstraints CA=false）')
  const key = createPrivateKey(caKeyPem)
  if (!ca.checkPrivateKey(key)) throw new Error('CA 证书与 CA 私钥不匹配')
  if (ca.validToDate.getTime() <= Date.now()) throw new Error(`CA 证书已过期（${ca.validTo}）`)
  return ca
}

export interface PreparedTls {
  material: TlsMaterial
  warnings: string[]
  caCertPem?: string
}

/**
 * 根据当前配置准备 TLS 材料；失败时抛错，由网关把错误展示在状态里。
 * 自签/CA 模式会在每次启动时重新签发 leaf（CA 不变，信任不受影响）。
 */
export async function prepareTls(config: GatewayConfig, webHost: string): Promise<PreparedTls | null> {
  if (config.httpsMode === 'off') return null
  const hosts = hostsFor(config, webHost)
  const warnings: string[] = []

  if (config.httpsMode === 'uploaded') {
    const certPem = readIf(TLS_FILES.cert)
    const keyPem = readIf(TLS_FILES.key)
    if (!certPem || !keyPem) throw new Error('尚未上传 HTTPS 证书/私钥')
    const missing = validateCertKey(certPem, keyPem, hosts)
    if (missing.length > 0) warnings.push(`证书不包含这些地址的 SAN：${missing.join(', ')}`)
    return { material: { cert: certPem, key: keyPem }, warnings }
  }

  if (config.httpsMode === 'ca' || config.httpsMode === 'selfsigned') {
    let caCertPem = readIf(TLS_FILES.caCert)
    let caKeyPem = readIf(TLS_FILES.caKey)
    if (config.httpsMode === 'ca') {
      if (!caCertPem || !caKeyPem) throw new Error('尚未上传 CA 证书/CA 私钥')
      validateCa(caCertPem, caKeyPem)
      // 兼容旧版本：旧版只把上传 CA 放在 ca.crt/key；第一次启动时复制为可复用副本。
      if (!existsSync(TLS_FILES.uploadedCaCert) || !existsSync(TLS_FILES.uploadedCaKey)) {
        atomicWrite(TLS_FILES.uploadedCaCert, caCertPem, 0o600)
        atomicWrite(TLS_FILES.uploadedCaKey, caKeyPem, 0o600)
      }
    } else if (!caCertPem || !caKeyPem) {
      const generated = await createCa()
      caCertPem = generated.certPem
      caKeyPem = generated.keyPem
      atomicWrite(TLS_FILES.caCert, caCertPem, 0o600)
      atomicWrite(TLS_FILES.caKey, caKeyPem, 0o600)
    }
    const leaf = await createLeaf(caCertPem, caKeyPem, hosts)
    atomicWrite(TLS_FILES.cert, leaf.certPem, 0o600)
    atomicWrite(TLS_FILES.key, leaf.keyPem, 0o600)
    return { material: { cert: leaf.certPem, key: leaf.keyPem, caCert: caCertPem }, warnings, caCertPem }
  }

  throw new Error(`未知 HTTPS 模式：${String(config.httpsMode)}`)
}

export async function installUploadedCertificate(certPem: string, keyPem: string, config: GatewayConfig, webHost: string): Promise<string[]> {
  const hosts = hostsFor(config, webHost)
  const missing = validateCertKey(certPem, keyPem, hosts)
  atomicWrite(TLS_FILES.cert, certPem, 0o600)
  atomicWrite(TLS_FILES.key, keyPem, 0o600)
  return missing
}

export async function installUploadedCa(caCertPem: string, caKeyPem: string, config: GatewayConfig, webHost: string): Promise<string[]> {
  validateCa(caCertPem, caKeyPem)
  atomicWrite(TLS_FILES.uploadedCaCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.uploadedCaKey, caKeyPem, 0o600)
  atomicWrite(TLS_FILES.caCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.caKey, caKeyPem, 0o600)
  const hosts = hostsFor(config, webHost)
  const leaf = await createLeaf(caCertPem, caKeyPem, hosts)
  atomicWrite(TLS_FILES.cert, leaf.certPem, 0o600)
  atomicWrite(TLS_FILES.key, leaf.keyPem, 0o600)
  return []
}

export async function useStoredUploadedCa(config: GatewayConfig, webHost: string): Promise<void> {
  const caCertPem = readIf(TLS_FILES.uploadedCaCert)
  const caKeyPem = readIf(TLS_FILES.uploadedCaKey)
  if (!caCertPem || !caKeyPem) throw new Error('尚未保存过上传的 CA 证书/私钥')
  validateCa(caCertPem, caKeyPem)
  const hosts = hostsFor(config, webHost)
  const leaf = await createLeaf(caCertPem, caKeyPem, hosts)
  atomicWrite(TLS_FILES.caCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.caKey, caKeyPem, 0o600)
  atomicWrite(TLS_FILES.cert, leaf.certPem, 0o600)
  atomicWrite(TLS_FILES.key, leaf.keyPem, 0o600)
}

export async function generateSelfSigned(config: GatewayConfig, webHost: string): Promise<void> {
  const hosts = hostsFor(config, webHost)
  const ca = await createCa()
  atomicWrite(TLS_FILES.caCert, ca.certPem, 0o600)
  atomicWrite(TLS_FILES.caKey, ca.keyPem, 0o600)
  const leaf = await createLeaf(ca.certPem, ca.keyPem, hosts)
  atomicWrite(TLS_FILES.cert, leaf.certPem, 0o600)
  atomicWrite(TLS_FILES.key, leaf.keyPem, 0o600)
}

export function caCertificatePem(): string | null {
  return readIf(TLS_FILES.caCert)
}
