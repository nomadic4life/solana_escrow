import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import { createHash } from "crypto";
import {
  createMint,
  mintTo,

  getAccount,
  getMint,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createInitializeMint2Instruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint
} from "@solana/spl-token";

const {
  sendAndConfirmTransaction,
  Transaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} = anchor.web3



class Token {
  mint: anchor.web3.Keypair;
  mintAuthority: anchor.web3.Keypair;   // optional
  freezeAuthority: anchor.web3.Keypair; // optional
  supply: number;     // u64
  decimals: number;   // u8
  isInitialized: boolean;

  createMint = async (connection: anchor.web3.Connection, payer: anchor.web3.Keypair) => {

    this.mint = anchor.web3.Keypair.generate()
    this.mintAuthority = anchor.web3.Keypair.generate()
    this.freezeAuthority = anchor.web3.Keypair.generate()
    this.supply = 0
    this.decimals = 9
    this.isInitialized = false

    const lamports = await getMinimumBalanceForRentExemptMint(connection);
    const blockhash = await connection.getLatestBlockhash()

    const transaction = new Transaction({ ...blockhash, feePayer: payer.publicKey }).add(

      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: this.mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),

      createInitializeMintInstruction(
        this.mint.publicKey,
        this.decimals,
        this.mintAuthority.publicKey,
        this.freezeAuthority.publicKey
      )
    )


    const tx = await sendAndConfirmTransaction(connection, transaction, [payer, this.mint])

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx
    }, "confirmed")

    console.log("TOKEN MINT CREATED")
  }


  airdrop = async (connection, payer, address) => {

    const associatedToken = await getAssociatedTokenAddress(
      this.mint.publicKey,
      address || payer.publicKey,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        address || payer.publicKey,
        associatedToken,
        address || payer.publicKey,
        this.mint.publicKey,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )

    // seems to be an issue if I use the commitment. but why? is it a bug?
    // await sendAndConfirmTransaction(connection, transaction, [payer], { commitment: "finalized" })
    const tx = await sendAndConfirmTransaction(connection, transaction, [payer])

    const blockhash = connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx
    }, "confirmed")


    const transaction2 = new Transaction().add(
      createMintToInstruction(
        this.mint.publicKey,
        associatedToken,
        this.mintAuthority.publicKey,
        10 * LAMPORTS_PER_SOL
      )
    )

    const tx2 = await sendAndConfirmTransaction(connection, transaction2, [payer, this.mintAuthority])

    const blockhash2 = connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash2,
      signature: tx2
    }, "confirmed")

    console.log("AIRDROP SUCCESS")

    return associatedToken
  }
}


class User {

  keypair: anchor.web3.Keypair | null;
  address: anchor.web3.PublicKey;
  associatedTokenAccount: anchor.web3.PublicKey;

  generate = async (connection) => {

    if (!!this.address) {
      return
    }

    const payer = anchor.web3.Keypair.generate()

    const tx = await connection.requestAirdrop(payer.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL)
    const blockhash = await connection.getLatestBlockhash()

    await connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")


    this.keypair = payer
    this.address = payer.publicKey
  }

  airdrop = async (connection, token, payer) => {
    this.associatedTokenAccount = await token.airdrop(connection, payer, this.address)
  }

  getPDA = async (connection, program, token, payer) => {
    const [signer, bump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )

    if (!!this.address) {
      const tx = await connection.requestAirdrop(signer, 10000 * anchor.web3.LAMPORTS_PER_SOL)

      const blockhash = await connection.getLatestBlockhash()

      await connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")

      this.address = signer

      // await this.airdrop(connection, token, payer)

      console.log(await connection.getBalance(signer))
    }


    return [signer, bump]
  }
}

describe("solana_escrow", () => {

  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider()
  const program = anchor.workspace.SolanaEscrow as Program<SolanaEscrow>;

  const token = new Token()
  const payer = new User()
  const prog = new User()

  const recipients = []

  before(async () => {

    await payer.generate(provider.connection)
    await token.createMint(provider.connection, payer.keypair)
    await payer.airdrop(provider.connection, token, payer.keypair)
    await prog.getPDA(provider.connection, program, token, payer.keypair)

    console.log("GENERATED:")
  });


  it("Is initialized!", async () => {

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    const tx = await program.methods
      .initializeProgramSigner()
      .accounts({
        payer: payer.keypair.publicKey,
        newProgramAuthority: signer,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
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

    const tokenAccount = await getAssociatedTokenAddress(
      token.mint.publicKey,
      signer,
      true
    )

    const tx = await program.methods
      .createAuthorityTokenAccount()
      .accounts({

        payer: payer.keypair.publicKey,
        programAuthority: signer,

        tokenAccount: tokenAccount,
        mint: token.mint.publicKey,

        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
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


  it("Create Escrow Sol Account", async () => {

    const hash = createHash('sha256')
    const receiver = anchor.web3.Keypair.generate()

    hash.update(receiver.publicKey.toBuffer())
    const merkleRoot = hash.digest()

    const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        payer.keypair.publicKey.toBuffer(),
        merkleRoot
      ],
      program.programId
    )

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    recipients.push({
      currency: "SOL",
      user: receiver,
      root: merkleRoot,
      nodes: [payer.address],
    })

    const tx = await program.methods
      .openEscrowTargetSol({
        amount: new anchor.BN(100),
        merkleRoot: {
          hash: [...merkleRoot]
        }
      })
      .accounts({
        sender: payer.keypair.publicKey,
        programAuthority: signer,
        newEscrowAccount: escrow,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
      .rpc()

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const state = await program.account.escrowAccount.fetch(escrow)
    const buffer = await provider.connection.getAccountInfoAndContext(escrow)


    console.log(buffer.value.data)
    console.log(state)


    console.log(await provider.connection.getBalance(signer))
  });


  it("Create Escrow Token Account", async () => {

    const hash = createHash('sha256')
    const receiver = anchor.web3.Keypair.generate()

    hash.update(receiver.publicKey.toBuffer())
    const merkleRoot = hash.digest()

    const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        payer.keypair.publicKey.toBuffer(),
        merkleRoot
      ],
      program.programId
    )

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )

    const tokenAccount = await getAssociatedTokenAddress(
      token.mint.publicKey,
      signer,
      true
    )


    const tx = await program.methods
      .openEscrowTargetToken({
        amount: new anchor.BN(100),
        merkleRoot: {
          hash: [...merkleRoot]
        }
      })
      .accounts({
        sender: payer.keypair.publicKey,
        programAuthority: signer,
        newEscrowAccount: escrow,
        senderToken: payer.associatedTokenAccount,
        authorityToken: tokenAccount,
        mint: token.mint.publicKey,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([payer.keypair])
      .rpc()

    const blockhash = await provider.connection.getLatestBlockhash()

    await provider.connection.confirmTransaction({
      ...blockhash,
      signature: tx,
    }, "confirmed")

    const state = await program.account.escrowAccount.fetch(escrow)
    const buffer = await provider.connection.getAccountInfoAndContext(escrow)


    console.log(buffer.value.data)
    console.log(state)


    console.log(await provider.connection.getBalance(signer))
  });


  describe("", () => {

    before(async () => {
      const payer = recipients[0].user
      const tx = await provider.connection.requestAirdrop(payer.publicKey, 1000 * anchor.web3.LAMPORTS_PER_SOL)
      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })

    const [signer] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("signer")],
      program.programId
    )


    it("Collect Escrow On Sol", async () => {

      const data = recipients[0]


      const [escrow] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          payer.keypair.publicKey.toBuffer(),
          data.root
        ],
        program.programId
      )

      const tx = await program.methods
        .collectEscrowOnSol()
        .accounts({
          signer: data.user.publicKey,
          programAuthority: signer,
          escrowAccount: escrow,
          systemProgram: SystemProgram.programId,
        })
        .signers([data.user])
        .rpc()

      const blockhash = await provider.connection.getLatestBlockhash()

      await provider.connection.confirmTransaction({
        ...blockhash,
        signature: tx,
      }, "confirmed")
    })
  })


});
