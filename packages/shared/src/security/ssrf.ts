import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfValidationError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'SSRF_BLOCKED') {
    super(message);
    this.name = 'SsrfValidationError';
    this.code = code;
  }
}

export interface SafeUrlValidationOptions {
  allowHttp?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
  lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata'
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.corp',
  '.intranet'
];

function parseIpv4Octets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    octets.push(n);
  }
  return octets;
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return true;
  const [a, b, c] = octets;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private network)
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud Metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private network)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation TEST-NET)
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return true;
  }
  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Broadcast)
  if (a >= 224) return true;

  return false;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const family = net.isIP(cleaned);
  if (family === 4) {
    return isPrivateOrReservedIpv4(cleaned);
  }
  if (family !== 6) {
    return true;
  }

  if (cleaned === '::' || cleaned === '::1' || cleaned === '0:0:0:0:0:0:0:1' || cleaned === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // IPv4-mapped IPv6 em formato pontuado (ex: ::ffff:127.0.0.1)
  if (cleaned.startsWith('::ffff:')) {
    const rest = cleaned.slice('::ffff:'.length);
    if (net.isIP(rest) === 4) {
      return isPrivateOrReservedIpv4(rest);
    }
    // Formato hexadecimal ::ffff:7f00:0001
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateOrReservedIpv4(ipv4);
      }
    }
  }

  // Unique Local (fc00::/7 -> fc00..fdff)
  if (cleaned.startsWith('fc') || cleaned.startsWith('fd')) return true;
  // Link-local (fe80::/10 -> fe80..febf)
  if (
    cleaned.startsWith('fe8') ||
    cleaned.startsWith('fe9') ||
    cleaned.startsWith('fea') ||
    cleaned.startsWith('feb')
  ) {
    return true;
  }
  // Multicast (ff00::/8)
  if (cleaned.startsWith('ff')) return true;
  // Documentation (2001:db8::/32)
  if (cleaned.startsWith('2001:db8:') || cleaned.startsWith('2001:0db8:')) return true;

  return false;
}

export async function validateSafeExternalUrl(
  rawUrl: string,
  options: SafeUrlValidationOptions = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SsrfValidationError('URL inválido.', 'INVALID_URL');
  }

  const allowedProtocols = options.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new SsrfValidationError(
      `Protocolo não permitido (${parsed.protocol}). Utiliza HTTPS.`,
      'INVALID_PROTOCOL'
    );
  }

  if (parsed.username || parsed.password) {
    throw new SsrfValidationError(
      'URLs com credenciais embutidas não são permitidos.',
      'EMBEDDED_CREDENTIALS'
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new SsrfValidationError('Hostname inválido.', 'INVALID_HOSTNAME');
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new SsrfValidationError(
      `Acesso a host local ou interno bloqueado (${hostname}).`,
      'PRIVATE_HOST_BLOCKED'
    );
  }

  // Se o hostname já for um literal IP (IPv4, IPv6 ou formato numérico decimal/octal/hexadecimal)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(hostname)) {
    throw new SsrfValidationError(
      'Endereços IP em formato inteiro/hexadecimal não são permitidos.',
      'OBFUSCATED_IP_BLOCKED'
    );
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfValidationError(
        `Endereço IP privado ou reservado bloqueado (${hostname}).`,
        'PRIVATE_IP_BLOCKED'
      );
    }
    return parsed;
  }

  const lookup = options.lookupFn ?? ((host: string) => dns.lookup(host, { all: true, verbatim: true }));
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new SsrfValidationError(
      `Não foi possível resolver o domínio (${hostname}).`,
      'DNS_RESOLUTION_FAILED'
    );
  }

  if (!addresses || addresses.length === 0) {
    throw new SsrfValidationError(
      `Nenhum endereço IP encontrado para o domínio (${hostname}).`,
      'DNS_EMPTY'
    );
  }

  for (const entry of addresses) {
    if (isPrivateOrReservedIp(entry.address)) {
      throw new SsrfValidationError(
        `Domínio (${hostname}) resolveu para um IP interno ou reservado bloqueado (${entry.address}).`,
        'DNS_REBIND_OR_PRIVATE_IP'
      );
    }
  }

  return parsed;
}

export async function resolveSafeUrlWithRedirects(
  initialUrl: string,
  options: SafeUrlValidationOptions & { fetchFn?: typeof fetch } = {}
): Promise<{ finalUrl: URL; contentType: string | null; statusCode: number }> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 8000;
  const fetchImpl = options.fetchFn ?? fetch;

  let currentUrlStr = initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validatedUrl = await validateSafeExternalUrl(currentUrlStr, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(validatedUrl.toString(), {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Sonora/1.0.0 (AudioStreamValidator)'
        }
      });

      // Alguns servidores de áudio não suportam HEAD (405 Method Not Allowed)
      if (response.status === 405 || response.status === 501) {
        response = await fetchImpl(validatedUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Sonora/1.0.0 (AudioStreamValidator)',
            Range: 'bytes=0-0'
          }
        });
      }
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === maxRedirects) {
        throw new SsrfValidationError(
          `Número máximo de redirecionamentos excedido (${maxRedirects}).`,
          'TOO_MANY_REDIRECTS'
        );
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new SsrfValidationError('Redirecionamento sem cabeçalho Location.', 'INVALID_REDIRECT');
      }
      currentUrlStr = new URL(location, validatedUrl).toString();
      continue;
    }

    return {
      finalUrl: validatedUrl,
      contentType: response.headers.get('content-type'),
      statusCode: response.status
    };
  }

  throw new SsrfValidationError('Falha ao validar redirecionamentos.', 'TOO_MANY_REDIRECTS');
}
