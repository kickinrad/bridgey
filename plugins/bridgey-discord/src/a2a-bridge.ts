export class A2ABridge {
  constructor(
    private daemonUrl: string,
    private token?: string,
  ) {}

  async send(message: string, contextId?: string): Promise<string> {
    const body: Record<string, string> = { message };
    if (contextId) body.context_id = contextId;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.daemonUrl}/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`A2A send failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { response: string };
    return data.response;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.daemonUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
