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

/**
 * 用「签名 CA 证书」签发 leaf。签名 CA 必须是证书包中与 CA 私钥匹配的那一张，
 * 而不是包里第一张；否则 issuer 字段会指向错误的 CA，客户端无法补全信任链。
 */
async function createLeaf(signerCertPem: string, caKeyPem: string, hosts: string[]): Promise<{ certPem: string; keyPem: string }> {
  const signerCert = forge.pki.certificateFromPem(signerCertPem)
  const caKey = forge.pki.privateKeyFromPem(caKeyPem)
  const keys = await generateKeyPair()
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = randomSerial()
  cert.validity.notBefore = new Date(Date.now() - 5 * 60 * 1000)
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000)
  const primary = hosts[0] ?? 'dsh-enhancement'
  cert.setSubject([{ name: 'commonName', value: primary }])
  cert.setIssuer(signerCert.subject.attributes)
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

/** 从一段 PEM 里按顺序拆出所有 CERTIFICATE 块。node-forge / X509Certificate 只解析第一张，必须自己拆。 */
function splitPemCertificates(pem: string): string[] {
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
  return matches ? matches.map((item) => item.trim()) : []
}

interface SignerSelection {
  signerPem: string
  signer: X509Certificate
}

/**
 * 在 CA 证书包里找出与给定私钥匹配的那张证书（真正的签名者）。
 * 包内通常是「签名者 + 一个或多个上级中间 CA + 可选自签根」，顺序不固定。
 */
function selectSignerFromBundle(bundlePem: string, keyPem: string): SignerSelection {
  const pems = splitPemCertificates(bundlePem)
  if (pems.length === 0) throw new Error('CA 证书无效（未找到 PEM 证书）')
  const key = createPrivateKey(keyPem)
  let signerPem: string | null = null
  let signer: X509Certificate | null = null
  for (const pem of pems) {
    const cert = new X509Certificate(pem)
    if (cert.checkPrivateKey(key)) {
      signerPem = pem
      signer = cert
      break
    }
  }
  if (!signerPem || !signer) throw new Error('CA 证书与 CA 私钥不匹配')
  if (!signer.ca) throw new Error('签名证书不是 CA（basicConstraints CA=false）')
  if (signer.validToDate.getTime() <= Date.now()) throw new Error(`CA 证书已过期（${signer.validTo}）`)
  return { signerPem, signer }
}

/**
 * 从签名 CA 向上按 issuer→subject 拼出「需要随 TLS 下发的中间 CA 链」。
 * - 签名者是自签根（subject === issuer）：返回空——根由客户端信任库提供，不随服务器下发。
 * - 签名者是中间 CA：返回 [签名者, 其上级中间 CA, ...]，到自签根为止但不含根。
 * 只有把中间 CA 一起下发，客户端才能把 leaf 接到受信任的根，形成完整信任链。
 */
function buildServedChain(signerPem: string, signer: X509Certificate, bundlePem: string): string[] {
  const bySubject = new Map<string, { pem: string; cert: X509Certificate }>()
  for (const pem of splitPemCertificates(bundlePem)) {
    const cert = new X509Certificate(pem)
    bySubject.set(cert.subject, { pem, cert })
  }
  const out: string[] = []
  let current = signer
  let currentPem = signerPem
  const seen = new Set<string>()
  while (current.subject !== current.issuer) {
    if (seen.has(current.subject)) break
    seen.add(current.subject)
    out.push(currentPem)
    const parent = bySubject.get(current.issuer)
    if (!parent) break
    current = parent.cert
    currentPem = parent.pem
  }
  return out
}

/**
 * 用一段 CA 证书包 + 私钥签发 leaf，并返回「leaf + 中间 CA」拼接后的完整证书链。
 * 这样交给 TLS 服务器的 cert 就带有完整链，浏览器可补全到受信任的根。
 */
async function issueLeafFromBundle(bundlePem: string, caKeyPem: string, hosts: string[]): Promise<{ certPem: string; keyPem: string }> {
  const { signerPem, signer } = selectSignerFromBundle(bundlePem, caKeyPem)
  const leaf = await createLeaf(signerPem, caKeyPem, hosts)
  const chain = buildServedChain(signerPem, signer, bundlePem)
  const certPem = [leaf.certPem.trim(), ...chain].join('\n') + '\n'
  return { certPem, keyPem: leaf.keyPem }
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
      // 上传的可能是「签名者 + 上级中间 CA」的完整链；先校验签名者是否与私钥匹配。
      selectSignerFromBundle(caCertPem, caKeyPem)
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
    const issued = await issueLeafFromBundle(caCertPem, caKeyPem, hosts)
    atomicWrite(TLS_FILES.cert, issued.certPem, 0o600)
    atomicWrite(TLS_FILES.key, issued.keyPem, 0o600)
    return { material: { cert: issued.certPem, key: issued.keyPem, caCert: caCertPem }, warnings, caCertPem }
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
  const hosts = hostsFor(config, webHost)
  const issued = await issueLeafFromBundle(caCertPem, caKeyPem, hosts)
  atomicWrite(TLS_FILES.uploadedCaCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.uploadedCaKey, caKeyPem, 0o600)
  atomicWrite(TLS_FILES.caCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.caKey, caKeyPem, 0o600)
  atomicWrite(TLS_FILES.cert, issued.certPem, 0o600)
  atomicWrite(TLS_FILES.key, issued.keyPem, 0o600)
  return []
}

export async function useStoredUploadedCa(config: GatewayConfig, webHost: string): Promise<void> {
  const caCertPem = readIf(TLS_FILES.uploadedCaCert)
  const caKeyPem = readIf(TLS_FILES.uploadedCaKey)
  if (!caCertPem || !caKeyPem) throw new Error('尚未保存过上传的 CA 证书/私钥')
  const hosts = hostsFor(config, webHost)
  const issued = await issueLeafFromBundle(caCertPem, caKeyPem, hosts)
  atomicWrite(TLS_FILES.caCert, caCertPem, 0o600)
  atomicWrite(TLS_FILES.caKey, caKeyPem, 0o600)
  atomicWrite(TLS_FILES.cert, issued.certPem, 0o600)
  atomicWrite(TLS_FILES.key, issued.keyPem, 0o600)
}

export async function generateSelfSigned(config: GatewayConfig, webHost: string): Promise<void> {
  const hosts = hostsFor(config, webHost)
  const ca = await createCa()
  atomicWrite(TLS_FILES.caCert, ca.certPem, 0o600)
  atomicWrite(TLS_FILES.caKey, ca.keyPem, 0o600)
  const issued = await issueLeafFromBundle(ca.certPem, ca.keyPem, hosts)
  atomicWrite(TLS_FILES.cert, issued.certPem, 0o600)
  atomicWrite(TLS_FILES.key, issued.keyPem, 0o600)
}

export function caCertificatePem(): string | null {
  return readIf(TLS_FILES.caCert)
}
