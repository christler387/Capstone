// WebMCP: lets an agent running in this browser use the page. Both tools are read-only.
// Browsers without navigator.modelContext simply skip registration.

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

interface ModelContext {
  registerTool: (tool: WebMcpTool) => unknown;
}

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

const SITE_INFO =
  'Skyrun AutoSupply is the warehouse and inventory system for Skyrun auto parts: stock in and out, stock card, sales and profit, suppliers and the warehouse map. Sign-in is required to use it.';

export function registerWebMcpTools(): void {
  const modelContext = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
  if (!modelContext?.registerTool) return;

  try {
    modelContext.registerTool({
      name: 'get_site_info',
      description: 'Describe Skyrun AutoSupply and what it is used for.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => text(SITE_INFO),
    });

    modelContext.registerTool({
      name: 'search_inventory',
      description:
        'Search the item list by the text of its fields. Returns id, name, category and quantity only. Works only for a signed-in user.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Text to search for.' } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = typeof input.query === 'string' ? input.query.slice(0, 100) : '';
        const response = await fetch(`/api/inventory/page?${new URLSearchParams({ q: query, pageSize: '10' })}`, {
          credentials: 'same-origin',
        });
        if (!response.ok) return text('Sign in to Skyrun AutoSupply to search the inventory.');
        const data = (await response.json()) as { items: Array<{ id: string; name: string; category: string; quantity: number }> };
        const rows = data.items.map((item) => ({ id: item.id, name: item.name, category: item.category, quantity: item.quantity }));
        return text(JSON.stringify(rows));
      },
    });
  } catch {
    // A failed registration must not stop the page from loading.
  }
}
