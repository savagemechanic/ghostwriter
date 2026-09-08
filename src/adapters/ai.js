export class OpenAICompatibleTextProvider {
  constructor({ apiUrl, apiKey, model }) {
    this.apiUrl = apiUrl; this.apiKey = apiKey; this.model = model;
  }
  async generateJson(system, payload) {
    if (!this.apiUrl || !this.apiKey || !this.model) throw new Error('AI provider is not configured');
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });
    if (!res.ok) throw new Error(`AI provider failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned no content');
    return JSON.parse(content);
  }
}
