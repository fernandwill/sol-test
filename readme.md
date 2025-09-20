# Solana Program Caller

Program ID: FzLMd2FEkKFPnLUy7v23n2BUS8txtXzPS97dEC2CB7q7

TypeScript CLI built with Anchor that invokes any Solana program by ID and instruction name.

## Prerequisites
- Node.js 18+
- `npm install` to set up TypeScript tooling (`ts-node`, `typescript`)
- A Solana keypair JSON file to pay fees (default: `~/.config/solana/id.json`)
- Program IDL JSON (local file or fetchable on-chain)

## Install
```bash
npm install
```

## Usage
```bash
npm run call -- --program-id <PROGRAM_PUBKEY> \
  --method <instructionName> \
  --idl ./path/to/idl.json \
  --accounts ./accounts.json \
  --args ./args.json
```

`npm run call` executes `node --loader ts-node/esm src/call-program.ts`, so no pre-build step is required. Use `npm run build` if you prefer to emit JavaScript into `dist/`.

### Quick example
```bash
npm run call -- \
  --program-id FzLMd2FEkKFPnLUy7v23n2BUS8txtXzPS97dEC2CB7q7 \
  --method increment \
  --idl ./idl.json \
  --accounts ./accounts.json \
  --args ./args.json \
  --wallet "C:\\keys\\payer.json" \
  --rpc https://api.devnet.solana.com \
  --simulate
```

### Required flags
- `--program-id` (`-p`): Target program public key.
- `--method` (`-m`): Instruction defined in the IDL.

### Common optional flags
- `--idl`: Path to IDL file or JSON string. If omitted, the CLI tries `anchor.Program.fetchIdl`.
- `--wallet` (`-k`): Payer keypair JSON (defaults to `ANCHOR_WALLET` env or `~/.config/solana/id.json`).
- `--rpc`: RPC endpoint (default devnet).
- `--accounts`: JSON object or file mapping account names to public keys.
- `--args`: JSON array or file providing instruction arguments.
- `--remaining-accounts`: Extra accounts array `[ { "pubkey", "isSigner", "isWritable" } ]`.
- `--extra-signers`: Comma-separated list of additional signer keypair files.
- `--simulate`: Call `simulate()` instead of submitting the transaction.
- `--skip-preflight`: Skip RPC preflight checks.

## Data helpers
Arguments accept helper objects for common Anchor types:
- `{ "bn": "123456789" }` -> converts to `anchor.BN`.
- `{ "pubkey": "..." }` -> converts to `PublicKey`.
- `{ "bytes": "base64==" }` or `{ "bytes": [1,2,3] }` -> converts to `Buffer`.

## Example account file (`accounts.json`)
```json
{
  "payer": "<YOUR PUBKEY>",
  "counter": "<ACCOUNT PUBKEY>",
  "systemProgram": "11111111111111111111111111111111"
}
```

## Example args file (`args.json`)
```json
[
  { "bn": "1" },
  "Hello Anchor"
]
```

## Troubleshooting
- `npm warn Unknown cli config "--program-id"`: npm still forwards arguments but logs this warning; the CLI now reconstructs the original flags so invocation continues.
- `Missing required argument: method`: supply `--method <instructionName>` as defined by the IDL.
- `Method '<name>' not found in the provided IDL.`: verify the method name and that the IDL matches the deployed program.

## Network note
Package installs require network access. This environment has restricted outbound connectivity, so run `npm install` from a machine that can reach the npm registry if needed.
