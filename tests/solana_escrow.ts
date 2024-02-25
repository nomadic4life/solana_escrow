import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import {
  createMint,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";

describe("solana_escrow", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider()
  const program = anchor.workspace.SolanaEscrow as Program<SolanaEscrow>;
  const payer = anchor.web3.Keypair.generate()

  before(async () => {
    const tx = await provider.connection.requestAirdrop(payer.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL)

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    console.log(await provider.connection.getBalance(payer.publicKey))
  })


  it("Is initialized!", async () => {

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    const tx = await program.methods
      .initializeProgramSigner()
      .accounts({
        payer: payer.publicKey,
        newProgramAuthority: signer,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.log("Your transaction signature", tx);

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const state = await program.account.programAuthority.fetch(signer)
    const buffer = await provider.connection.getAccountInfoAndContext(signer)

    console.log(state, buffer)

  });


  it("Create Token Account!", async () => {

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      9,
    )

    const tokenAccount = await getAssociatedTokenAddress(
      mint,
      signer,
      true
    )


    const tx = await program.methods
      .createAuthorityTokenAccount()
      .accounts({

        payer: payer.publicKey,
        programAuthority: signer,

        tokenAccount: tokenAccount,
        mint: mint,

        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer])
      .rpc();

    console.log("Your transaction signature", tx);

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const buffer = await provider.connection.getAccountInfoAndContext(tokenAccount)

    console.log(buffer)

  });
});
