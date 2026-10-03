import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type TransactionRequest,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import type { Address } from "../domain/types.js";

/**
 * Quien firma por el agente. La firma siempre ocurre en código fijo, después de que el usuario confirma:
 * el LLM nunca llama a esto.
 */
export interface Signer {
  readonly address: Address;
  signTransaction(tx: TransactionRequest & { to: Address }): Promise<Hex>;
  signTypedData(typed: TypedDataDefinition): Promise<Hex>;
}

/** Wallet local a partir de una clave privada (usa una wallet nueva, solo para el agente). */
export class LocalSigner implements Signer {
  readonly address: Address;
  private readonly wallet;

  constructor(privateKey: Hex, rpcUrl: string) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address as Address;
    this.wallet = createWalletClient({ account, chain: bsc, transport: http(rpcUrl) });
  }

  async signTransaction(tx: TransactionRequest & { to: Address }): Promise<Hex> {
    const prepared = await this.wallet.prepareTransactionRequest({ ...tx, account: this.wallet.account, chain: bsc } as never);
    return this.wallet.signTransaction(prepared as never);
  }

  signTypedData(typed: TypedDataDefinition): Promise<Hex> {
    return this.wallet.signTypedData({ ...typed, account: this.wallet.account } as never);
  }
}

export function bscPublicClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: bsc, transport: http(rpcUrl, { batch: true }) }) as PublicClient;
}
