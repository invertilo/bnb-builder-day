/** Shared descriptions and Zod input shapes for AI SDK and MCP read tools. */
import { z } from "zod";

const network = z
  .string()
  .optional()
  .describe("studio network name (defaults to the project's [network].default)");
const optionalAddress = z
  .string()
  .optional()
  .describe("0x address; omit for own wallet");

export const READ_TOOL_CATALOG = {
  wallet_info: {
    description:
      "Describe the agent's active wallet (address, kind, key location).",
    inputSchema: {},
  },
  wallet_list: {
    description: "List all local wallet addresses.",
    inputSchema: {},
  },
  wallet_address: {
    description: "Read the active wallet address.",
    inputSchema: {},
  },
  balance_native: {
    description:
      "Native BNB balance of an address (defaults to the agent's own wallet).",
    inputSchema: { address: optionalAddress, network },
  },
  balance_u: {
    description:
      "$U payment-token balance of an address (defaults to the agent's own wallet).",
    inputSchema: { address: optionalAddress, network },
  },
  network_info: {
    description: "Chain id, RPC, and token information for a Studio network.",
    inputSchema: { network },
  },
  tx_status: {
    description: "Status and receipt summary of a transaction hash.",
    inputSchema: {
      tx_hash: z.string().describe("0x transaction hash"),
      network,
    },
  },
  block_info: {
    description: "Read a block header summary.",
    inputSchema: { block: z.string().optional(), network },
  },
  contract_call_view: {
    description: "Call a read-only contract function by signature.",
    inputSchema: {
      address: z.string(),
      function_signature: z.string(),
      args: z.array(z.unknown()).optional(),
      output_types: z.array(z.string()).optional(),
      network,
    },
  },
  pieverse_usage: {
    description: "Pieverse LLM usage and credit summary for the last N days.",
    inputSchema: { days: z.number().int().optional() },
  },
  agent_info: {
    description: "ERC-8004 identity record for an agent id.",
    inputSchema: {
      agent_id: z.number().int().describe("ERC-8004 agent id"),
      network,
    },
  },
  agent_by_address: {
    description: "Look up an ERC-8004 registration by wallet address.",
    inputSchema: {
      address: z.string().describe("0x wallet address"),
      network,
    },
  },
  job_status: {
    description:
      "Read-only ERC-8183 job detail including the event-resolved deliverable URL.",
    inputSchema: {
      job_id: z.number().int().describe("on-chain job id"),
      network,
    },
  },
  job_list: {
    description: "List recent ERC-8183 jobs, optionally only this agent's.",
    inputSchema: {
      limit: z.number().int().optional(),
      mine: z.boolean().optional().describe("only jobs assigned to this agent"),
      network,
    },
  },
  job_count: {
    description: "Read the network-wide in-flight ERC-8183 job count.",
    inputSchema: { network },
  },
} as const;

export type ReadToolName = keyof typeof READ_TOOL_CATALOG;
