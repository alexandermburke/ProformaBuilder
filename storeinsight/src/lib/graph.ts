type CachedToken = {
  token: string;
  expiresAt: number;
};

let cached: CachedToken | null = null;

const TOKEN_TTL_BUFFER_MS = 60_000;

export async function getGraphAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - TOKEN_TTL_BUFFER_MS > now) {
    return cached.token;
  }

  const tenantId = process.env.MS_GRAPH_TENANT_ID;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing MS Graph credentials (tenant, client id, or client secret).');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Unable to obtain Graph token (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new Error('Graph token response missing access_token');
  }

  const ttlSec = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + ttlSec * 1000,
  };
  return json.access_token;
}

export function encodeShareUrl(shareUrl: string): string {
  // Per Graph: u! + base64url(sharing url) with no padding.
  const base64 = Buffer.from(shareUrl, 'utf8').toString('base64');
  const base64Url = base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `u!${base64Url}`;
}

export type GraphDriveItemRef = {
  driveId: string;
  itemId: string;
  name: string;
};

export async function resolveSharedDriveItem(shareUrl: string): Promise<GraphDriveItemRef> {
  const token = await getGraphAccessToken();
  const encoded = encodeShareUrl(shareUrl);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph /shares lookup failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    id?: string;
    name?: string;
    parentReference?: { driveId?: string };
  };
  const driveId = json.parentReference?.driveId;
  const itemId = json.id;
  const name = json.name;
  if (!driveId || !itemId || !name) {
    throw new Error('Graph /shares response missing driveId / id / name');
  }
  return { driveId, itemId, name };
}

export async function downloadDriveItem(ref: GraphDriveItemRef): Promise<Buffer> {
  const token = await getGraphAccessToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${ref.driveId}/items/${ref.itemId}/content`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph download failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
